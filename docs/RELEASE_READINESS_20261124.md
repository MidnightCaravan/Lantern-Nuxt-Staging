# Lantern production release readiness — 2026-11-24

**Status:** PREPARATION ONLY — not deployed, not authorized for production work  
**Release commit:** `962cd95f4d0bf11dc4fdd11442fee0162659b032`  
**Scope:** read-only production D1 metadata inspection, production-only configuration preparation, runbook/gate corrections, and draft PR review material  
**No production writes were performed.** No deploy, DNS/route change, secret provisioning, write enablement, migration, R2 object access, or Flask Worker change was performed.

## 1. Owner decision recorded

The project owner approved B5 for the initial production cutover:

> Retain the original Flask Worker as the temporary production media origin.

No change to `lanternMediaUrl`, no media Service Binding, and no R2 asset migration is proposed. A later switch away from the Flask media origin requires a separate owner decision.

## 2. Production `/media/*` dependency review

Verified from the release commit:

- `server/utils/lantern-public.ts:4` sets `LEGACY_BASE = 'https://lantern.midnightcaravans.workers.dev'`.
- `server/utils/lantern-public.ts:57-70` converts every relative work cover, video path, and `media/` path to an absolute URL on that legacy origin.
- `server/utils/lantern-public.ts:72-78` applies those URLs to public work data.
- `server/utils/lantern-studio.ts:100-107` emits legacy-origin URLs for production content and `/media/<key>` only for staging content.
- `server/routes/media/[...key].get.ts:96-103` forwards to a media-origin Service Binding only when one exists. The release config does not declare one.
- `tests/public-reading.test.ts:20,118,158,227,312` pins the legacy-origin URLs, so this behavior is covered by the existing suite.

Conclusion: with B5 approved, the release Worker must keep emitting the existing Flask-origin media URLs. The production R2 binding remains declared for B1 and future media work, but it does not change public URLs during the initial cutover.

## 3. Production-only release configuration

`wrangler.release.jsonc` was reduced to production resources only:

| Item | Value | Evidence |
|---|---|---|
| Worker name | `lantern-nuxt` (**proposed**, not owner-confirmed) | `wrangler.release.jsonc:32-33` |
| `workers_dev` | `false` | `wrangler.release.jsonc:34` |
| Routes / domains / triggers | none | `wrangler.release.jsonc:20-21`; no keys in config |
| Anonymous write target | `LANTERN_ANONYMOUS_WRITE_DATABASE=production` | `wrangler.release.jsonc:45-48` |
| Public read target | `LANTERN_PUBLIC_READ_DATABASE=production` | `wrangler.release.jsonc:45-48` |
| Production-write flag | absent | `wrangler.release.jsonc:18-19`; no key in config |
| D1 | `lantern_db` → `lantern-db` → `bf50e1be-81d7-4cd1-b082-8aa03a784860`, `remote: true` | `wrangler.release.jsonc:50-57` |
| R2 | `lantern_media` → `lantern-media` | `wrangler.release.jsonc:64-69` |
| Staging bindings | removed | verified by `tests/release-config.test.ts`, `tests/environment-configs.test.ts` |
| Media Service Binding | absent | verified by `tests/release-config.test.ts` |

The staging-only bindings are not required by the verified production runtime. Production selectors are explicit, and the production session secret must be distinct from staging, so a staging cookie cannot select staging resources on the release Worker.

`LANTERN_ANONYMOUS_WRITE_DATABASE=production` does **not** enable writes. With the production-write flag absent, anonymous account flows fail closed with `409` (`server/utils/lantern-writes.ts:23-35,45-56,105-123`). Production login also fails closed with `409` until write enablement is explicitly approved.

## 4. Read-only production D1 inspection

Two read-only Wrangler commands were run against `lantern-db` from the release worktree using `wrangler@4.166.0`:

```sh
npx wrangler d1 execute lantern-db --remote --json --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name; SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('users','works','email_tokens','chapters','comic_episodes','comic_pages','comments','auth_rate_limits','comment_likes','comment_reports','lantern_schema_migrations','d1_migrations') ORDER BY name; SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;"

npx wrangler d1 execute lantern-db --remote --json --command "SELECT name, applied_at FROM d1_migrations ORDER BY name;"
```

Every result reported `success: true`, `rows_written: 0`, and `changed_db: false`. No application table rows were read.

### Schema result

Present tables:

- `users`
- `works`
- `email_tokens`
- `chapters`
- `comic_episodes`
- `comic_pages`
- `comments`
- `auth_rate_limits`
- `comment_likes`
- `comment_reports`
- `d1_migrations`

`lantern_schema_migrations` is absent.

Present indexes:

- `idx_auth_rate_limits_expires_at`
- `idx_comment_likes_user`
- `idx_comment_reports_status_created`
- `idx_comments_content`
- `idx_comments_parent`

`works.video_path` is present. The observed DDL matches the reference migration shape for the four required migrations. The three staging-only performance indexes from `scripts/staging-d1-indexes.sql` are not present in production; they are not required for schema parity and no index DDL was applied.

### Migration history result

`d1_migrations` contains exactly the four expected rows:

| Migration | Applied at |
|---|---|
| `0001_initial_schema.sql` | `2026-10-15 02:18:07` |
| `0002_auth_rate_limits.sql` | `2026-10-15 02:30:12` |
| `0003_comment_feedback.sql` | `2026-10-25 04:31:29` |
| `0004_video_upload.sql` | `2026-10-25 05:17:24` |

Conclusion: no production DDL is needed for the current release commit. `scripts/migrate.mjs` remains forbidden for production, and no native Wrangler migration command was run.

## 5. Migration checksum verification

SHA-256 values recomputed locally at the release commit:

| Version | File | SHA-256 |
|---|---|---|
| `0001` | `migrations/0001_initial_schema.sql` | `da50b7fdbcc6181dfcc113fa13168e6a1312caac661458cceb7f03356e55abc8` |
| `0002` | `migrations/0002_auth_rate_limits.sql` | `c6ea9c39b50a14767ce9bf1cffc853589e2efeac6ab2e176d5d43ea0a6d18000` |
| `0003` | `migrations/0003_comment_feedback.sql` | `afe3a47705dac4f6ad0ab64492290bfa4b0048476c3fc2a2950df9382311cdfa` |
| `0004` | `migrations/0004_video_upload.sql` | `21497012115d1ad6814e4cc13d88c7243a1cea370a8b5c9d44b7ee74b2eac3e1` |

These match `docs/PRODUCTION_MIGRATION_PLAN.md`. Production `d1_migrations` stores only `name` and `applied_at`; it cannot prove historical checksum equality. The verified facts are: exact local file hashes, exact production migration names, and matching physical schema. No checksum can be read from production D1 because `lantern_schema_migrations` does not exist there.

## 6. Backup and rollback procedure

### Pre-window backup and recording

1. Freeze the release commit and record it in the window ticket.
2. Record the current Flask Worker version:
   ```sh
   npx wrangler deployments list --name lantern --json
   ```
3. Record the current D1 Time Travel bookmark:
   ```sh
   npx wrangler d1 time-travel info lantern-db --json
   ```
4. Obtain owner/Infra approval of the bookmark as the restore point.
5. Confirm that a restore rehearsal has been completed outside production. No restore rehearsal was performed in this preparation pass.
6. Under B5, no R2 snapshot or asset rollback is planned. The R2 bucket content is not accessed by this preparation.
7. Record the public hostname, traffic-switch mechanism, and exact revert step. This remains unresolved.

### Rollback

1. Announce rollback, stop the rollout, and open an incident record.
2. Revert the owner-approved traffic mechanism to the last known-good Flask Worker or version. If the chosen mechanism is a Worker-name swap, the documented version rollback form is:
   ```sh
   npx wrangler rollback <last-known-good-version> --name lantern
   ```
3. Keep the Nuxt Worker deployed but off-route. Do not retry in the same window.
4. Do not restore D1 if Nuxt only touched new tables or if no data corruption occurred. All four migrations are already applied and production writes are disabled for the initial release.
5. Only with explicit owner and DB/Infra approval, restore the approved D1 point:
   ```sh
   npx wrangler d1 time-travel restore lantern-db --bookmark <approved-bookmark>
   ```
6. Under B5, do not roll back R2 assets.
7. Repeat the runbook smoke checks against Flask and record the outcome.
8. Retain traffic records, smoke output, monitoring exports, and the final decision in the window ticket.

## 7. Production deployment and cutover sequence

No step below has been executed.

1. Approve the release Worker name, public hostname, traffic mechanism, secrets, and sign-off.
2. Confirm `npm run release:check` passes for the exact release commit.
3. Record the D1 Time Travel bookmark and Flask Worker version.
4. Provision the three secrets privately on the release Worker:
   - `LANTERN_NUXT_SESSION_SECRET`
   - `LANTERN_BREVO_API_KEY`
   - `LANTERN_MAIL_FROM`
5. Build the release commit and deploy once, only with explicit authorization:
   ```sh
   npx wrangler deploy --config wrangler.release.jsonc
   ```
6. Confirm the Worker version and bindings. Do not expose secret values.
7. Keep the Worker off-route. Run bounded read-only validation only. Do not repeat the staging email test.
8. Switch traffic using the owner-approved mechanism. No route or DNS change is authorized by this preparation.
9. Run the runbook read-only smoke checks once each. Under B5, media checks use the existing Flask origin; no repeated or bulk media checks.
10. Observe with the owner-approved thresholds. Roll back using section 6 if any trigger fires.

## 8. Remaining owner decisions and launch blockers

| Decision / blocker | Status |
|---|---|
| Production hostname and traffic-switch mechanism | **Required.** No route or custom domain exists in the release config; `[zone/record]` remains unresolved. |
| Release Worker name `lantern-nuxt` | **Required.** Config marks it proposed. |
| Production-write enablement | **Required if production writes are expected.** Current config keeps them disabled with `409` fail-closed behavior. This preparation does not enable them. |
| Production secrets | **Required.** Must be provisioned privately on the release Worker. |
| Four-role release sign-off | **Required.** `docs/release-signoff.json` is absent; G3 fails closed. |
| B1 deployment evidence | **Required.** The `lantern_media` binding is declared but not deployed. |
| B7 traffic rollback rehearsal | **Required.** D1/R2 snapshot restore and route/DNS rollback have not been rehearsed. |
| `LANTERN_PUBLIC_BASE_URL` | **Decision only if the public hostname changes.** It affects verification/resend links but not password-reset links, which use request origin. |
| Staging-only D1 performance indexes | **No production action proposed.** Schema parity does not require them. |
| Residual documented behavior differences | **Acceptance required.** Include session cookie change/re-login, exact-origin CSRF, and documented media/storage error differences. |

## 9. Documentation corrections in this PR

- `wrangler.release.jsonc` is now production-only and explicitly fails closed on writes.
- `tests/release-config.test.ts` and `tests/environment-configs.test.ts` pin the production-only bindings and absence of the write flag.
- `docs/CUTOVER_RUNBOOK.md` no longer references a nonexistent “gated release command”; it records the direct Wrangler command, B5 approval, and concrete backup/rollback steps.
- `docs/release-gates.json` records the current release commit and the read-only production D1 evidence while leaving launch gates closed.
- `docs/PRODUCTION_MIGRATION_PLAN.md` no longer states that production D1 was never read; it records the read-only inspection and the fact that no DDL is required.
- `docs/CUTOVER_READINESS.md` is updated to the current evidence and B5 approval.
- `docs/RELEASE_PREPARATION_20261120.md` stale forgot-password email-failure statement is corrected to match code.

**Final readiness:** NOT READY for launch. The configuration is prepared, but owner hostname/route, Worker-name, secret, sign-off, B1 deploy, and B7 rehearsal decisions remain open.
