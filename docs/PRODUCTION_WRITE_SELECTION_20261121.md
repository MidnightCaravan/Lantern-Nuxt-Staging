# Gated production-write selection design

Date: 2026-11-21
Status: local implementation design. Not a release approval and not authorization to deploy.

## 1. Objective

Reproduce the Flask mutation behavior in Nuxt while keeping production writes disabled by default.

This document defines how each Nuxt mutation selects its D1 database and R2 bucket. It does not enable production writes in `wrangler.release.jsonc`, any deployed Worker, DNS, routes, or Cloudflare resources.

## 2. Source-of-truth findings

The original Flask application uses one production D1 binding and one production R2 bucket:

- `lantern_db` → `lantern-db` (`/Users/christian/lantern/wrangler.jsonc:17-24`).
- `lantern_media` → `lantern-media` (`/Users/christian/lantern/wrangler.jsonc:25-30`).
- D1 statements are individually committed; there is no multi-statement transaction (`/Users/christian/lantern/src/lantern_database.py:62-76`).
- R2/D1 ordering and best-effort cleanup are part of the observed behavior.

The current Nuxt staging tree has:

- Session-aware D1 selection in `server/utils/lantern-public.ts:12-30`.
- Before this implementation, R2 mutation helpers were hardcoded to `lantern_staging_media` in `server/utils/lantern-studio.ts` and `server/utils/lantern-comic.ts`.
- Production write guards in `assertStudioWritable`, `assertComicWritable`, dashboard handlers, and discussion handlers.
- Staging-only auth rate-limit counters in `server/utils/lantern-rate-limits.ts:86-103`.

The authoritative method-suffixed mutation inventory is the 33 entries in `tests/write-isolation.test.ts`. The state-changing GET route `server/api/auth/verify.get.ts` is registered separately by `EXPLICIT_GET_MUTATIONS`, making 34 mutation handlers in total. GET handlers are not included by blanket; only that explicit Flask-parity route is registered.

## 3. Feature gate

The server-side variable is:

```text
LANTERN_ENABLE_PRODUCTION_WRITES
```

Rules:

1. Missing variable: production writes disabled.
2. Boolean `false`, string `"false"`, `1`, `"TRUE"`, empty value, or any other invalid value: production writes disabled.
3. Only Boolean `true` or exact string `"true"`: production mutations permitted.
4. The value is read from the Cloudflare/Nitro environment only. Request body, query strings, headers, and cookies cannot set or clear it.
5. Staging mutation target selection never reads this flag.

The release configuration intentionally does not set this variable. `wrangler.release.jsonc` remains production-write-disabled.

## 4. Authenticated mutation target selection

Authenticated requests carry a signed session containing `uid` and `db` (`server/utils/lantern-auth.ts:138-180`). The database identity is server-side state, not a client-supplied target on each mutation.

| Session identity | D1 binding | R2 binding | Gate behavior |
| --- | --- | --- | --- |
| `staging` | `lantern_staging_db` | `lantern_staging_media` | Never consults production-write flag |
| `production`, flag disabled | no mutation performed | no mutation performed | 409 before any D1/R2 write; `auth-logout` is cookie-only and remains 200 |
| `production`, flag enabled | `lantern_db` | `lantern_media` | Mutation allowed |

The shared implementation is `server/utils/lantern-writes.ts`:

- `assertProductionWritesEnabled(event, message)` is the fail-closed gate.
- `getMutationDatabase(event, database, message)` selects D1 for D1-only mutations.
- `getMutationMediaBucket(event, database)` selects R2 without fallback.
- `resolveMutationTarget(event, database, message)` selects D1 and R2 together when one handler needs both.
- `assertMutationDatabase` rejects unknown identities with 403.

`assertStudioWritable(event, identity)` and `assertComicWritable(event, identity)` delegate production sessions to the gate. Every mutation uses the session-selected D1 binding. Every mutation that touches media uses the mutation-specific R2 helper; legacy staging-only helpers remain for read-only media routes.

A missing production binding produces 503. No handler falls back from `lantern_media` to `lantern_staging_media` or from `lantern_db` to `lantern_staging_db`.

## 5. Anonymous account target selection

Registration, forgot-password, resend-verification, reset-password, and email verification have no session identity. Their target is selected only by:

```text
LANTERN_ANONYMOUS_WRITE_DATABASE
```

Accepted values are exactly `production` and `staging`. Missing or invalid values produce 503. If the value is `production`, `LANTERN_ENABLE_PRODUCTION_WRITES` must also be explicitly `true`; otherwise production writes are rejected. No target is inferred from submitted email, body, query, headers, or request origin.

This explicit setting is required because Flask has one implicit production database, while the local Nuxt harness has two. The setting preserves a deterministic target and prevents an anonymous request from silently crossing environments.

Login is distinct: its account database is part of the existing Flask-equivalent login workflow. The server validates `body.database`: only the exact strings `production` and `staging` are accepted. Any other explicit value, including a case variant, returns 403 before any rate-limit counter is written and without fallback. Missing, `null`, or empty `database` preserves the legacy production default. Production login requires the production-write flag because the request writes the durable rate-limit counter and creates the credential used for later mutations. A production-disabled login returns 409 before production D1 is read or written.

Logout has no D1/R2 write and does not consult the gate.

## 6. Rate limits and token operations

- `checkAuthRateLimit` writes counters to the resolved target database for the account flow. Production counters are never written to staging, and staging counters are never written to production.
- Rate-limit key derivation, fixed windows, limits, and error behavior remain unchanged from Flask.
- Email and reset tokens remain SHA-256 hashes in `email_tokens`.
- Issuing a token marks prior unused tokens of the same user and type as used.
- Email verification marks the user verified first, then consumes the token in one ordered D1 `batch()`. One timestamp is captured before the lookup and bound as the expiry threshold in the lookup and both updates. The updates use equivalent token id, token type, unused-token, expiry, and user identity predicates.
- Password reset updates the password hash first, then consumes the token in the same ordered conditional D1 `batch()`. It uses the same single captured expiry threshold across the lookup and both updates.
- Both workflows require result metadata `[1, 1]` before reporting success. `[0, 0]` keeps the original invalid/expired 400 response. Any mismatched pair, including `[1, 0]` or `[0, 1]`, is logged and fails closed with 500. Checking results after `batch()` does not roll back committed statements; the no-partial-update argument relies on the shared timestamp, equivalent predicates, and sequential batch semantics. A failure thrown by either statement rolls back the modeled batch. Replay and expiry tests verify the resulting database state and change metadata; no remote D1 atomicity or distributed concurrency was tested.
- The canonical emailed GET verification link uses the secret token as its authorization and intentionally has no CSRF check, matching Flask.

## 7. Cleanup, rollback, and failure order

No cross-environment cleanup is permitted. If a mutation targets production, every R2 put, delete, abort, multipart operation, and rollback cleanup targets `lantern_media`. If it targets staging, all of those operations target `lantern_staging_media`.

Flask ordering is preserved:

- Direct thumbnail/video and comic page uploads: R2 put before D1 write.
- Video multipart complete: R2 complete before D1 write; failed verification removes the new production object when the target is production.
- Work deletes: R2 cleanup before D1 batch deletes; R2 failure aborts the D1 delete.
- Thumbnail removals and old-object cleanup remain best-effort after the D1 update.
- Novel publish with no publishable chapter retains Flask's correction-to-draft behavior.
- D1 statements remain individually committed in the general mutation paths, as in Flask. The sole exception is the two-write token-redemption flow, which uses D1 `batch()` as one ordered transaction. No global transaction layer is introduced.

## 8. Verification requirements

Tests must establish:

1. Production sessions receive 409 with zero D1/R2 writes while the flag is disabled.
2. With the flag enabled, production sessions write only `lantern_db` and `lantern_media`.
3. Staging sessions write only `lantern_staging_db` and `lantern_staging_media`, with or without the flag.
4. Missing/invalid identities, missing bindings, invalid anonymous settings, CSRF failures, ownership failures, and failed publish/delete paths fail closed.
5. Token replay and cleanup paths use only the selected environment.
6. The full 34-handler inventory (33 method-suffixed handlers plus the explicit verification GET) remains registered exactly once.
7. The disabled-production matrix covers all 34 routes with zero D1/R2 writes; `auth-logout` is the cookie-only exception that returns 200.
8. `npm run verify` and `node scripts/release-gate.mjs` are run and reported verbatim.

Passing these tests is necessary evidence for local parity; it is not a release approval. Enabling production writes remotely still requires explicit owner authorization, the unresolved B1/B7/G3 gates, and a separate approval record.

## 9. Local implementation record

The following local changes implement the design:

- Added `server/utils/lantern-writes.ts` for gate evaluation, anonymous-target selection, login-target selection, D1 selection, R2 selection, and combined target resolution.
- Changed `server/utils/lantern-studio.ts`, `server/utils/lantern-comic.ts`, and `server/utils/lantern-rate-limits.ts` so authenticated mutations and rate-limit counters use the selected database; mutation media helpers no longer use the staging-only read helpers.
- Updated all 33 method-suffixed mutation handlers in `server/api/auth`, `server/api/studio`, `server/api/comic`, `server/api/dashboard`, and `server/api/discussions` to resolve an explicit target, plus the explicit `auth/verify.get.ts` route. Studio/comic/discussion write gates now run after Flask-equivalent CSRF and route validation.
- Added shared anonymous email-token consumption in `server/utils/lantern-email-verification.ts`; verification GET and POST both use it. The GET route is inventoried through `EXPLICIT_GET_MUTATIONS` and keeps the Flask emailed-token authorization without CSRF.
- Corrected token ordering in the shared verification helper and reset handler: the user state or password hash is written first, token consumption second, in one conditional D1 batch that rolls back if either write fails.
- Made discussion `source` agree with the signed session identity; the query string no longer chooses the database.
- Expanded `tests/write-isolation.test.ts` from the creator-only disabled-production matrix to a 34-route disabled-production matrix, enabled isolated production, flag-independent staging, invalid gate values, invalid/missing anonymous target, missing bindings, D1/R2 failure ordering, cleanup, token replay, ownership, CSRF/origin, and failed publish/delete cases. The verification GET is also covered by missing-binding and replay tests.
- Updated `tests/helpers/session.ts` and `tests/auth.test.ts` to set the explicit anonymous target and to check duplicates only in the selected database.
- Left `wrangler.release.jsonc`, release gates, sign-off, deployment configuration, remote resources, and the original Flask tree unchanged.

## 10. Verification evidence

Verified at Nuxt HEAD `c1302d7f07d50b8d7134734e7cb5396634ae5705` (`c1302d7`):

- Focused auth/token suite: 2 files, 36 tests passed, exit `0`. Log: `/private/var/folders/q_/l6pcnzw95116kmzhp02rhhyw0000gn/T/opencode/lantern-findings-close-focused-auth-tokens-final.log`.
- Isolation matrix alone: 190 tests passed, exit `0`. Log: `/private/var/folders/q_/l6pcnzw95116kmzhp02rhhyw0000gn/T/opencode/lantern-findings-close-write-isolation-final.log`.
- Auth/rate-limit regression suite: 5 files, 24 tests passed, exit `0`. Log: `/private/var/folders/q_/l6pcnzw95116kmzhp02rhhyw0000gn/T/opencode/lantern-findings-close-auth-regression-final.log`.
- `npm run verify`: 48 Flask routes reviewed, zero gaps or stale evidence; 32 test files and 419 tests passed; `nuxt build` completed successfully. Exit `0`. Log: `/private/var/folders/q_/l6pcnzw95116kmzhp02rhhyw0000gn/T/opencode/lantern-findings-close-verify-final.log`.
- `node scripts/release-gate.mjs`: `Lantern release gates: NOT READY. No deployment was performed.` Exit status `1`. Log: `/private/var/folders/q_/l6pcnzw95116kmzhp02rhhyw0000gn/T/opencode/lantern-findings-close-release-gate-final.log`.
- Unresolved gates remain G1/B1 (the `lantern_media` production binding is declared in `wrangler.release.jsonc` but is not deployed or operationally verified; B5 keeps the original Flask Worker as the first-cutover media origin), G2/B7 (route/DNS rollback rehearsal pending), and G3 (`docs/release-signoff.json` absent). This document does not close any gate or provide sign-off.

## 11. Authoritative 34-handler status

All entries below are in `MUTATION_MATRIX` and were exercised in the disabled-production, enabled-isolated-production, and flag-independent-staging matrices. Success status refers to the expected response when the selected target is writable. The disabled-production matrix also asserts zero D1/R2 writes for every entry; `auth-logout` is the cookie-only exception that returns 200.

| Group | Handler | File under `server/api/` | Success status | Result |
| --- | --- | --- | --- | --- |
| account/auth | auth-register | `auth/register.post.ts` | 200 | PASS |
| account/auth | auth-login | `auth/login.post.ts` | 200 | PASS |
| account/auth | auth-logout | `auth/logout.post.ts` | 200 | PASS |
| account/auth | auth-forgot-password | `auth/forgot-password.post.ts` | 200 | PASS |
| account/auth | auth-resend-verification | `auth/resend-verification.post.ts` | 200 | PASS |
| account/auth | auth-reset-password | `auth/reset-password/[token].post.ts` | 200 | PASS |
| account/auth | auth-verify-email | `auth/verify.post.ts` | 200 | PASS |
| account/auth | auth-verify-email-get | `auth/verify.get.ts` | 200 | PASS |
| studio | studio-work-create | `studio/works.post.ts` | 200 | PASS |
| studio | studio-work-update | `studio/works/[workId].put.ts` | 200 | PASS |
| studio | studio-chapter-create | `studio/works/[workId]/chapters.post.ts` | 200 | PASS |
| studio | studio-chapter-update | `studio/chapters/[chapterId].put.ts` | 200 | PASS |
| studio | studio-chapter-autosave | `studio/chapters/[chapterId]/autosave.post.ts` | 200 | PASS |
| studio | studio-profile-update | `studio/profile.put.ts` | 200 | PASS |
| studio | studio-work-delete | `studio/works/[workId]/delete.post.ts` | 200 | PASS |
| studio | studio-novel-publish | `studio/works/[workId]/novel/publish.post.ts` | 200 | PASS |
| studio | studio-video-publish | `studio/works/[workId]/video/publish.post.ts` | 200 | PASS |
| studio | studio-thumbnail-direct | `studio/works/[workId]/thumbnail-direct.put.ts` | 200 | PASS |
| studio | studio-video-direct | `studio/works/[workId]/video-direct.put.ts` | 201 | PASS |
| studio | studio-upload-start | `studio/works/[workId]/video-multipart/start.post.ts` | 201 | PASS |
| studio | studio-upload-part | `studio/works/[workId]/video-multipart/part.put.ts` | 200 | PASS |
| studio | studio-upload-complete | `studio/works/[workId]/video-multipart/complete.post.ts` | 200 | PASS |
| studio | studio-upload-abort | `studio/works/[workId]/video-multipart/abort.post.ts` | 200 | PASS |
| comic | comic-episode-update | `comic/episodes/[episodeId].put.ts` | 200 | PASS |
| comic | comic-page-upload | `comic/episodes/[episodeId]/pages.put.ts` | 200 | PASS |
| comic | comic-episode-publish | `comic/episodes/[episodeId]/publish.post.ts` | 200 | PASS |
| comic | comic-page-delete | `comic/pages/[pageId]/delete.post.ts` | 200 | PASS |
| comic | comic-episode-create | `comic/works/[workId]/episodes.post.ts` | 200 | PASS |
| comic | comic-work-publish | `comic/works/[workId]/publish.post.ts` | 200 | PASS |
| dashboard | dashboard-work-delete | `dashboard/works/[id]/delete.post.ts` | 200 | PASS |
| dashboard | dashboard-thumbnail-remove | `dashboard/works/[id]/thumbnail.post.ts` | 200 | PASS |
| dashboard | dashboard-thumbnail-upload | `dashboard/works/[id]/thumbnail.put.ts` | 200 | PASS |
| discussions | discussion-post | `discussions/[kind]/[targetId].post.ts` | 201 | PASS |
| discussions | discussion-action | `discussions/[kind]/[targetId]/[commentId]/[action].post.ts` | 200 | PASS |

### 11.1 Account/auth disabled-production matrix

With `LANTERN_ENABLE_PRODUCTION_WRITES` disabled and an authenticated production session, the account/auth routes were exercised individually. Every row asserts zero writes to both D1 databases and both R2 buckets. `auth-logout` intentionally returns 200 because it only clears a cookie.

| Handler | Disabled-production status | D1/R2 writes | Result |
| --- | --- | --- | --- |
| `auth-register` | 409 | none | PASS |
| `auth-login` | 409 | none | PASS |
| `auth-logout` | 200 | none | PASS |
| `auth-forgot-password` | 409 | none | PASS |
| `auth-resend-verification` | 409 | none | PASS |
| `auth-reset-password` | 409 | none | PASS |
| `auth-verify-email` | 409 | none | PASS |
| `auth-verify-email-get` | 409 | none | PASS |
