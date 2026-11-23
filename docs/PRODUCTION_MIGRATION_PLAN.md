# Lantern production D1 migration plan

**Status:** VERIFIED PLAN — read-only production inspection complete; no migrations executed; not authorized for execution  
**Owner:** DB/Infra (to be assigned)  
**Related:** `docs/CUTOVER_READINESS.md`, `docs/CUTOVER_RUNBOOK.md`, `docs/RELEASE_READINESS_20261124.md`, `migrations/`, `scripts/migrate.mjs`

## 1. Purpose and limits

This document is the reviewed production migration plan required by B2 in `docs/CUTOVER_READINESS.md`. It records **what would be applied and how**, based on the verified staging rehearsal. It does **not** authorize production work.

Production D1 (`lantern_db`) was read-only inspected on 2026-11-24 for object names, schema DDL, and migration history. No application rows were read and no DDL or DML was executed. `scripts/migrate.mjs` intentionally refuses production bindings and must not be bypassed.

## 2. Evidence from staging rehearsal

The staging rehearsal was completed on `lantern_staging_db` with the following verified results:

- `lantern_schema_migrations` was absent; Wrangler's `d1_migrations` already recorded all four migrations applied at `2026-11-14 10:01:41`.
- `scripts/migrate.mjs` was dry-run first: 4 applied via `d1_migrations`, 0 pending, 4 checksum rows to backfill, no DDL replay.
- The backfill was then applied. `lantern_schema_migrations` now holds 4 rows with matching SHA-256 checksums and the original applied-at timestamps.
- Re-plan is idempotent: 4 applied, 0 pending, 0 backfill.
- `npm run verify` passes in post-merge CI at `962cd95`.

## 2a. Read-only production inspection (2026-11-24)

`lantern-db` was inspected with read-only `sqlite_master` and `d1_migrations`
queries. Every query reported `rows_written: 0` and `changed_db: false`.

- `d1_migrations` contains exactly `0001_initial_schema.sql`,
  `0002_auth_rate_limits.sql`, `0003_comment_feedback.sql`, and
  `0004_video_upload.sql`.
- All required tables are present: `users`, `works`, `email_tokens`, `chapters`,
  `comic_episodes`, `comic_pages`, `comments`, `auth_rate_limits`,
  `comment_likes`, and `comment_reports`.
- `works.video_path` is present.
- The five reference indexes from `0001`–`0003` are present.
- `lantern_schema_migrations` is absent; production `d1_migrations` stores no
  checksums, so historical checksum equality cannot be read from production.
- The staging-only performance indexes in `scripts/staging-d1-indexes.sql` are
  not present in production and are not required for schema parity.

No production DDL is required for release commit `962cd95`. Full command
evidence is recorded in `docs/RELEASE_READINESS_20261124.md`.

## 3. Migration inventory

| Version | File | SHA-256 checksum |
|---|---|---|
| `0001` | `migrations/0001_initial_schema.sql` | `da50b7fdbcc6181dfcc113fa13168e6a1312caac661458cceb7f03356e55abc8` |
| `0002` | `migrations/0002_auth_rate_limits.sql` | `c6ea9c39b50a14767ce9bf1cffc853589e2efeac6ab2e176d5d43ea0a6d18000` |
| `0003` | `migrations/0003_comment_feedback.sql` | `afe3a47705dac4f6ad0ab64492290bfa4b0048476c3fc2a2950df9382311cdfa` |
| `0004` | `migrations/0004_video_upload.sql` | `21497012115d1ad6814e4cc13d88c7243a1cea370a8b5c9d44b7ee74b2eac3e1` |

Checksums are computed by `scripts/migrations-core.mjs` and recorded by the staging runner. The four local files at `962cd95` were reverified against these exact values on 2026-11-24. Production `d1_migrations` does not store checksums; the production check is migration-name and physical-schema verification, not a historical hash comparison.

## 4. Preconditions

All must pass before this plan may be executed:

- [ ] G0 green on the exact release commit: `npm run verify`.
- [ ] B1 resolved: production R2 bound as `lantern_media` in the release configuration.
- [ ] B5 decision recorded (see `docs/CUTOVER_READINESS.md`): legacy Worker remains media origin, or assets/URLs migrated.
- [ ] B6 resolved: `npm run release:check` passes for the exact release commit. `npm run deploy` remains fail-closed; there is no separate npm deploy command.
- [ ] G3 sign-off complete in `docs/CUTOVER_READINESS.md` §7.
- [ ] Production D1 snapshot identifier recorded and restore tested.
- [ ] Production `d1_migrations` history inspected read-only and reconciled against the migration names in section 3 and the physical schema in section 2a. No production checksum comparison is available or required.

## 5. Planned procedure (not executed)

1. **Read-only inspection.** Confirm production `d1_migrations` rows and table list. Compare with the staging evidence in section 2. If production history differs, stop and produce a revised plan.
2. **Snapshot.** Capture production D1 using the recorded snapshot identifier. Verify it is restorable.
3. **Apply migrations only if the read-only check finds a gap.** For `962cd95`, all four migrations and the required schema are already present, so this step is skipped. If a gap is found, stop and obtain a revised, separately approved plan. The documented native form (not authorized here) is:

   ```
   npx wrangler d1 migrations apply lantern_db --remote
   ```

   This command is **not to be run** until section 4 is complete and sign-off is recorded. The Nuxt staging runner is not used for production.
4. **Verify tracking.** Read back `d1_migrations`. All four versions must be present. `lantern_schema_migrations` is absent in production and is not required; if a future approved runner introduces it, its checksums must match section 3.
5. **Verify schema.** Confirm `auth_rate_limits`, `email_tokens`, `comments`, `comment_likes`, `comment_reports`, and `works.video_path` exist with the expected structure.
6. **Record evidence.** Attach command output, local-file checksum reverification from section 3, production migration-name and physical-schema verification results, and snapshot identifier to the release ticket.

## 6. Failure handling

- Any local file checksum mismatch, unexpected or missing `d1_migrations` row, or schema verification failure stops the release. Do not request or report a production D1 checksum comparison; production `d1_migrations` does not store historical checksums and `lantern_schema_migrations` is absent.
- A failed application rolls back by restoring the production D1 snapshot from step 2. This requires owner and DB/Infra approval.
- No ad hoc SQL, manual table drops, or bypass of the migration tracking tables is permitted.

## 7. Rollback reference

See `docs/CUTOVER_RUNBOOK.md` §8. The reference migrations are additive (`CREATE TABLE` / `ADD COLUMN`), so full D1 restore may be unnecessary if only new tables were written. That decision requires explicit approval.
