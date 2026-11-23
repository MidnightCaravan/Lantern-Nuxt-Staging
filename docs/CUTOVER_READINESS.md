# Lantern cutover readiness report

**Status:** NOT READY for production cutover  
**Scope:** staging validation plus read-only production D1 metadata inspection; no production writes, binding changes, or deploy enablement performed  
**Last verified:** post-merge CI at `962cd95` and read-only production D1 inspection on 2026-11-24  
**Cutover runbook:** `docs/CUTOVER_RUNBOOK.md` (draft; traffic rollback not rehearsed)  
**Production migration plan:** `docs/PRODUCTION_MIGRATION_PLAN.md` (read-only inspection complete; no migrations executed)  
**Rehearsal record:** `docs/REHEARSAL_RECORD.md` (smoke rehearsal PASS; traffic rollback pending infra)  
**Release preparation:** `docs/RELEASE_READINESS_20261124.md`  
**Targeted source audit:** `docs/PARITY_AUDIT_20261119.md` (confirmed gaps fixed; differences recorded)

## 1. Executive summary

The Flask → Nuxt migration has a green staging harness: all 48 inventoried Flask routes have an explicit disposition, behavior tests pass against in-memory D1/R2 doubles, and post-merge CI passed at `962cd95`. This establishes **staging behavioral coverage**, not production readiness.

Production D1 was read-only inspected on 2026-11-24: all four migrations are recorded in `d1_migrations`, all required tables/indexes exist, and no DDL was executed. Production cutover remains blocked by operational work: production media binding/deploy, hostname and traffic mechanism, secrets, sign-off, traffic rollback rehearsal, and write-enable approval. The owner approved B5 for the first cutover: the Flask Worker remains the temporary media origin. `npm run deploy` is intentionally disabled.

## 2. What is verified

| Area | Evidence | Result |
|---|---|---|
| Route coverage | `npm run parity:routes`, `docs/parity-route-map.json` | 48 routes reviewed; `vendor=2`, `api=29`, `covered=11`, `alias=4`, `embedded=2`, `gap=0` |
| Behavior tests | post-merge `npm run verify` | CI passed at `962cd95`; see PR #1 check run `45215837040` |
| Migration runner | `npm run migrate:plan`, `npm run migrate` (local and remote) | Local apply/re-apply idempotent; remote staging backfill applied checksum rows for `0001`–`0004` without replaying DDL; re-plan is idempotent; production target refused |
| Build | `npm run build` | Nuxt/Nitro build passes |
| CI | `.github/workflows/verify.yml` | Runs `npm run verify` on PRs and `main`; no deploy step |
| Testing model | `tests/helpers/fake-d1.ts`, `fake-r2.ts`, `handler.ts` | Real h3 handlers exercised against in-memory D1/R2 doubles |
| Release guard | `scripts/deploy-guard.mjs` | Exits non-zero; deploy fails closed |
| Release gate check | `npm run release:check`, `docs/release-gates.json` | Reports unmet gates and blockers; currently NOT READY because B1, B7, and sign-off are open |

Covered behavior domains: login/registration/token flows, profile and work creation, work ownership/deletion, novel chapters, comic pages/episodes, discussions, publishing, public discovery/readers, video upload, media serving, thumbnails, and staging/production isolation.

## 3. Current production posture

- `wrangler.jsonc` binds production D1 (`lantern_db`), staging D1 (`lantern_staging_db`), and staging R2 (`lantern_staging_media`).
- The default `wrangler.jsonc` has no production R2 binding. The production-only `wrangler.release.jsonc` declares `lantern_media` but it is not deployed. Public media URLs remain on the legacy Flask Worker base in `server/utils/lantern-public.ts`; B5 approval preserves that behavior.
- Studio and auth write handlers gate mutations to staging sessions; production sessions are rejected with 409.
- Sessions are signed stateless cookies, matching Flask's default Flask session implementation.
- Authentication rate limits are durable in `auth_rate_limits` D1 with Flask's HMAC key derivation, fixed windows, atomic `INSERT ... ON CONFLICT ... RETURNING`, and the same five endpoint policies. Counters are written to staging D1 while production remains read-only.
- `verifyLanternPasswordHash` accepts the Nuxt PBKDF2 format and rejects legacy `scrypt:` hashes.
- SQL migrations `0001`–`0004` are driven by a staging-only runner (`scripts/migrate.mjs`, `scripts/migrations-core.mjs`) with a `lantern_schema_migrations` tracking table, SHA-256 checksums, atomic per-migration SQL, dry-run, and a hard refusal for production targets.
- The runner also reads Wrangler's `d1_migrations` table. Remote staging already has all four migrations applied there, so the checksum backfill was applied instead of replaying DDL.
- The remote staging checksum backfill was executed: `lantern_schema_migrations` now has `0001`–`0004` with matching SHA-256 checksums and the original `2026-11-14 10:01:41` applied-at timestamps. A re-plan is idempotent (4 applied, 0 pending, 0 backfill). No DDL was replayed and production D1 was not touched.
- CI verifies code but does not provision bindings, apply migrations, or deploy.

### Verified parity finding: legacy password hashes (B4)

Flask and Nuxt behave the same for legacy Werkzeug `scrypt:` hashes: both refuse login and require the user to reset their password.

- Flask: `/Users/christian/lantern/src/lantern_auth.py:470-483` checks `password_hash.startswith("scrypt:")` and redirects to `forgot_password` with an error flash.
- Nuxt: `server/api/auth/login.post.ts:53-57` returns `409 PASSWORD_RESET_REQUIRED`; `app/pages/login.vue:65` exposes `/forgot-password` as the recovery link.
- Test: `tests/auth.test.ts:79-89` asserts the Nuxt response "matching Flask"; `tests/auth.test.ts:48-52` asserts the verifier rejects `scrypt:` input.
- Reset flow: `server/api/auth/forgot-password.post.ts` and `server/api/auth/reset-password/[token].post.ts` issue a one-hour token and replace the hash with the Nuxt PBKDF2 format, matching Flask's `lantern_auth.py:563-637` and `:658-753`.

No code change is warranted: teaching `verifyLanternPasswordHash` to accept `scrypt:` would diverge from Flask. One presentation difference is documented rather than changed: Flask redirects the browser to the recovery page, while Nuxt keeps the user on `/login` with an inline error and recovery link (the same Nuxt pattern used for unverified-email errors). Reopen B4 only if the owner requires exact redirect behavior.

### Verified parity finding: sessions, and durable rate limits (B3)

- Flask uses Flask's default signed-cookie session (`app.config["SECRET_KEY"]`, `session["user_id"]` in `lantern_auth.py:512-514`, no server-side session extension). Nuxt uses an HMAC-signed stateless cookie. Both are client-side, revocable only by rotating the secret. On 2026-11-22 the remaining lifetime difference was corrected: Nuxt no longer sets a 12-hour `Max-Age` or `exp`, so it now issues a browser-session cookie exactly like Flask; legacy `exp` cookies remain valid until their timestamp.
- Flask's rate limits were durable in D1 (`app.py:329-419`, table `auth_rate_limits` from migration `0002`). Nuxt previously used process-local `Map` counters — a confirmed behavioral difference. This is now fixed in `server/utils/lantern-rate-limits.ts` with the same HMAC key derivation, fixed epoch windows, cleanup, atomic upsert/RETURNING, retry-after calculation, and the five Flask policies: login 10/15m, register 5/1h, forgot_password 5/15m, resend_verification 5/15m, reset_password 10/15m.
- Nuxt previously had no limits on forgot-password or reset-password; both are now enforced.
- Tests: `tests/rate-limits.test.ts` (11 tests) covers windows, isolation, cleanup, retry-after, fail-closed behavior, and all five handlers.

## 4. Blockers

| ID | Blocker | Evidence | Impact | Owner | Exit criteria |
|---|---|---|---|---|---|
| B1 | Production media binding missing — **prepared, not deployed** | `wrangler.jsonc` has only `lantern_staging_media`; `wrangler.release.jsonc` now declares the verified `lantern-media` → `lantern_media` binding; `docs/RELEASE_PREPARATION_20261120.md` records read-only Cloudflare evidence | Nuxt cannot serve or write production R2 objects until the release Worker is deployed; public URLs still depend on the legacy Worker (B5) | Infra/Cloudflare | Deploy the prepared release config with `lantern_media`, verify media reads/range, then set `B1.closed: true` with evidence |
| B2 | **Closed — read-only inspection complete, no DDL executed** | `docs/PRODUCTION_MIGRATION_PLAN.md`, `docs/RELEASE_READINESS_20261124.md`, `scripts/migrate.mjs` | Production `d1_migrations` has all four versions; required tables/indexes and `works.video_path` are present; local checksums match the plan. No application rows were read and nothing was written | DB/Infra | No migration is required for `962cd95`. Any future DDL still requires a separate approved plan; the Nuxt runner continues to refuse production targets |
| B3 | **Closed.** Rate limits durable; sessions at parity | `lantern-rate-limits.ts`, `lantern-auth.ts`, `app.py:312-326,329-419`, `tests/rate-limits.test.ts`, `tests/auth-parity-batch-20261122.test.ts` | No in-process counters remain; IP canonicalization and browser-session cookie lifetime now match Flask | — | No further code change; rate-limit counters target staging D1 while production is read-only |
| B4 | **Closed — verified parity.** Legacy `scrypt:` hashes are refused and routed to password reset in both implementations | `lantern_auth.py:470-483`, `login.post.ts:53-57`, `tests/auth.test.ts:79-89` | No login regression; documented difference is Flask redirect vs Nuxt inline recovery link | — | No code change. Reopen only if exact redirect behavior is required by the owner |
| B5 | **Approved 2026-11-24 — legacy Worker remains temporary media origin** | `server/utils/lantern-public.ts:4,57-70`, `server/routes/media/[...key].get.ts:96-103`, `tests/public-reading.test.ts` | Public works keep emitting Flask Worker URLs for the initial cutover. The release config adds no media Service Binding and does not change `lanternMediaUrl` | Platform | Reopen only when the owner approves a later media-origin switch |
| B6 | **Closed — release gate check implemented** | `scripts/release-gate.mjs`, `scripts/release-gate-core.mjs`, `docs/release-gates.json`, `tests/release-gate.test.ts` | Deploy still fails closed; readiness is machine-checked against gates, blockers, and a commit-matched four-role sign-off. There is no npm deploy command replacing the guard | Release | `npm run release:check` passes with signed `docs/release-signoff.json`; execution still requires G3 |
| B7 | **Partial — smoke rehearsal complete, traffic rollback pending** | `docs/CUTOVER_RUNBOOK.md`, `docs/REHEARSAL_RECORD.md`, `scripts/smoke-check.mjs`, `docs/RELEASE_PREPARATION_20261120.md` | Section 6 smoke checklist ran green against a locally built, locally seeded Worker. Production traffic switch and revert, and D1/R2 snapshot restore, still require Cloudflare infra; current token has `zone (read)` only. Candidate rollback version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` recorded but live status unconfirmed | Release | Rehearse the selected traffic rollback in a staging-shaped Cloudflare environment, record results, and attach evidence to the window ticket |

Non-blocking follow-ups: add typecheck/lint to `verify` and pin a dependency audit policy. The disabled “Creators” nav item was confirmed intentional Flask behavior (`templates/base.html:26`, `:59`) and is no longer a follow-up.

## 5. Readiness gates

| Gate | Status | Notes |
|---|---|---|
| G0 — Staging behavioral parity | **PASS** | 48 routes dispositioned; post-merge CI passed at `962cd95` |
| G1 — Operational readiness | **BLOCKED** | B1 only (B2–B5 closed; B5 approved for the initial cutover) |
| G2 — Release controls | **BLOCKED** | B7 traffic rollback only; smoke rehearsal passed, B6 closed with `npm run release:check` |
| G3 — Explicit sign-off | **PENDING** | Required before any production mutation or deploy enablement |

## 6. Recommended sequence

1. Resolve B1 by deploying the production-only release config with explicit authorization.
2. B2 is closed: the required production DDL is already present and no migration command is needed for `962cd95`. Rerun `npm run verify` before the window.
3. B3 and B4 are closed as verified parity; no session, rate-limit, or legacy-account code change is required.
4. B5 is approved for the first cutover as of 2026-11-24. Switching `lanternMediaUrl` to Nuxt-served URLs is a separate later decision.
5. Smoke rehearsal is recorded in `docs/REHEARSAL_RECORD.md`. Resolve the hostname/traffic mechanism and rehearse the selected B7 rollback, then record results.
6. Keep `npm run deploy` failing closed; use the explicit Wrangler release command only after G0–G2 pass and sign-off is complete.
7. Obtain written sign-off below, then perform the cutover.

## 7. Sign-off

Production work must not begin until all required roles approve.

| Role | Name | Date | Decision |
|---|---|---|---|
| Application owner |  |  | Approve / Reject |
| Infra / Cloudflare |  |  | Approve / Reject |
| Auth / Security |  |  | Approve / Reject |
| Release manager |  |  | Approve / Reject |

**Cutover approved:** ☐ Yes ☐ No  
**Approved deployment window / ticket:** ______________________
