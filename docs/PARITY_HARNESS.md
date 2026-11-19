# Lantern parity harness

This harness tracks Flask → Nuxt route coverage and tests the highest-risk behavior without touching production D1/R2 or sending email.

## Commands

```bash
npm run parity:routes  # route disposition check
npm test               # Vitest behavior tests
npm run verify         # both of the above, then nuxt build
npm run migrate:plan   # dry-run migration plan against local staging D1
npm run migrate        # apply pending migrations to local staging D1
```

`npm run migrate` uses `--local` Wrangler D1 state by default. It refuses production database names. Remote staging execution requires explicit approval and `--remote --confirm-staging-remote`.

`.github/workflows/verify.yml` runs `npm run verify` on pushes to `main` and on pull requests. It has no deploy step and uses no Cloudflare credentials.

## Route coverage

`scripts/parity-coverage.mjs` reads the Nov 18 Flask route inventory (`LANTERN_MIGRATION_AUDIT_20261118-002806/01_FLASK_ROUTES.csv`) and the explicit dispositions in `docs/parity-route-map.json`. It fails on unreviewed routes, gaps, stale map entries, missing evidence files, and invalid statuses.

Dispositions:

| Status | Meaning |
|---|---|
| `covered` | Nuxt serves the same URL/page. |
| `api` | The form POST moved to a Nuxt API endpoint; page/API evidence is listed. |
| `alias` | The legacy URL redirects to a canonical Nuxt URL. |
| `embedded` | The behavior is mounted inside another page rather than served at the legacy URL. |
| `vendor` | Flask dependency static route, out of scope. |
| `gap` | No equivalent found; fails the check. |

Current dispositions: `vendor=2`, `api=29`, `covered=11`, `alias=4`, `embedded=2`, `gap=0`.

This is **coverage, not semantic parity**. A disposition only says an implementation and evidence file exist.

## Behavior tests

Tests are in `tests/` and run with Vitest. `tests/setup.ts` provides Nuxt's `defineEventHandler` auto-import; `tests/helpers/handler.ts` runs real h3 handlers through `toWebHandler`; `tests/helpers/fake-d1.ts` is an in-memory D1 double with only the statements the tested handlers use; `tests/helpers/fake-r2.ts` doubles R2 objects and multipart uploads.

Current tests cover:

- Password hash round-trip and legacy `scrypt:` rejection.
- Login CSRF/origin enforcement, invalid credentials, unverified accounts, scrypt reset path, and staging session issuance resolved by `/api/auth/me`.
- Registration staging-only writes, duplicate protection against production, and verification-token creation.
- `GET /logout` returning 405 to match Flask.
- Studio work reads, ownership 404s, anonymous 401s, title/description validation matching Flask, CSRF enforcement, production-session mutation blocking, draft-only deletion, and R2 key cleanup.
- Novel chapter creation with Flask's `MAX(chapter_number) + 1` numbering, draft status, and work timestamp updates.
- Chapter manual save and 10-second autosave parity: trimmed titles, preserved content, owner-only access, production-session blocking, and `updated_at` stamping on both chapter and work.
- Comic page upload with allowed extensions, R2 key layout (`uploads/comics/<work>/<episode>/page-<n>-<id>.<ext>`), next-page numbering, and owner-only access.
- Comic page deletion with R2 cleanup, preserved page on storage failure, and production-session blocking.
- Discussion like toggling, edit/delete ownership (including reply cascade), report reason validation, duplicate-report 409, and Flask's 201 on successful report.
- Episode-targeted comments and rejection of mismatched targets or production source.
- Novel publishing: complete chapters become public, blank chapters are demoted, an empty novel is unpublished with a 400, and ownership/type/CSRF/staging guards hold.
- Comic publishing: work publish requires every episode to have a page; episode publish requires at least one page without publishing the whole work; owners and staging sessions only.
- Video publishing: upload-before-publish gate and owner/staging-only transitions.
- Public discovery: published-only results, newest-first ordering, Flask-compatible `type`/`limit` filters, and production/staging source isolation.
- Public work detail: only published chapters and episodes, with source-correct media URLs.
- Novel reader: draft chapters are hidden and skipped in previous/next navigation.
- Comic reader: public episodes hide drafts and use production media; owners can preview draft staging episodes with draft-aware navigation.
- Public comic episode API: published-only episode metadata, ordered pages, and production media URLs.
- Direct video upload: 201 response, Worker-compatible `uploads/videos/<work>/video-<24hex>.<ext>` key, R2 metadata, D1 reference update, old-object cleanup, and 502 on storage failure without a D1 write.
- Multipart video upload: 201 start, part upload, ordered assembly, 200 completion, best-effort abort, part/size/key validation, and ownership/production guards.
- Media serving: production bytes, byte-range and suffix ranges with 206/416 headers, image range bypass, staging-vs-production bucket selection, published staging access for staging sessions, draft staging access for owners only, and traversal/missing/storage failures.
- Studio profile: safe read projection, production read-only flag, Flask-equivalent trimming/validation, duplicate username 409, avatar clearing, CSRF/origin checks, and staging-only writes.
- Work creation: Novel/Comic/Video type mapping, trimming, draft status with matching timestamps, title/description length limits, CSRF checks, and production-session blocking.
- Direct thumbnail upload: Flask key layout, image format allowlist, R2 metadata, D1 cover update, old-object cleanup, and storage-failure preservation.
- Dashboard thumbnail actions: remove and first-page modes, earliest-page selection, R2 copy, cleanup-failure messaging, comic-only rule, path/extension validation, and ownership/CSRF/production guards.
- Token flows: email verification with token consumption and production isolation, resend with old-token invalidation and rate limiting, password-reset request non-enumeration, and one-time reset redemption with validated passwords.

Migration runner tests: version discovery and ordering, SHA-256 content checksums, SQL statement splitting/comment removal, atomic script rendering with applied-version rows, fresh apply, idempotent re-run, dry-run without writes, inconsistent-state refusal (checksum mismatch/failed/unknown versions), and production/unknown remote target guards.

Total: **99 passing tests** across 13 files.

## Known gaps outside this harness

See `docs/CUTOVER_READINESS.md` for the production-readiness gates, blockers, owners, and sign-off checklist. This harness verifies staging behavior only; it does not authorize deployment.

- Comment reports are recorded exactly as in Flask (including 201/409); neither Flask nor Nuxt exposes a moderation queue or status transition, so this is not a parity gap.
- Production authentication remains transitional: legacy password hashes, durable sessions, and durable rate limits are unresolved.
- Production media still relies on the legacy Flask Worker and an unbound `lantern_media` binding.
- The migration runner has been rehearsed against local Wrangler D1 only. Remote staging rehearsal and a reviewed production migration plan remain pending.
- `npm run deploy` remains intentionally disabled.
