# Lantern production D1 migration plan

**Status:** PLAN ONLY — not executed, not authorized for execution  
**Owner:** DB/Infra (to be assigned)  
**Related:** `docs/CUTOVER_READINESS.md`, `docs/CUTOVER_RUNBOOK.md`, `migrations/`, `scripts/migrate.mjs`

## 1. Purpose and limits

This document is the reviewed production migration plan required by B2 in `docs/CUTOVER_READINESS.md`. It records **what would be applied and how**, based on the verified staging rehearsal. It does **not** authorize production work.

Production D1 (`lantern_db`) has not been read or written during this migration project. `scripts/migrate.mjs` intentionally refuses production bindings and must not be bypassed.

## 2. Evidence from staging rehearsal

The staging rehearsal was completed on `lantern_staging_db` with the following verified results:

- `lantern_schema_migrations` was absent; Wrangler's `d1_migrations` already recorded all four migrations applied at `2026-11-14 10:01:41`.
- `scripts/migrate.mjs` was dry-run first: 4 applied via `d1_migrations`, 0 pending, 4 checksum rows to backfill, no DDL replay.
- The backfill was then applied. `lantern_schema_migrations` now holds 4 rows with matching SHA-256 checksums and the original applied-at timestamps.
- Re-plan is idempotent: 4 applied, 0 pending, 0 backfill.
- `npm run verify` passes: 48 routes, `gap=0`, 115 tests across 14 files, build green.

## 3. Migration inventory

| Version | File | SHA-256 checksum |
|---|---|---|
| `0001` | `migrations/0001_initial_schema.sql` | `da50b7fdbcc6181dfcc113fa13168e6a1312caac661458cceb7f03356e55abc8` |
| `0002` | `migrations/0002_auth_rate_limits.sql` | `c6ea9c39b50a14767ce9bf1cffc853589e2efeac6ab2e176d5d43ea0a6d18000` |
| `0003` | `migrations/0003_comment_feedback.sql` | `afe3a47705dac4f6ad0ab64492290bfa4b0048476c3fc2a2950df9382311cdfa` |
| `0004` | `migrations/0004_video_upload.sql` | `21497012115d1ad6814e4cc13d88c7243a1cea370a8b5c9d44b7ee74b2eac3e1` |

Checksums are computed by `scripts/migrations-core.mjs` and recorded by the staging runner. Production must be checked against these exact values before and after application.

## 4. Preconditions

All must pass before this plan may be executed:

- [ ] G0 green on the exact release commit: `npm run verify`.
- [ ] B1 resolved: production R2 bound as `lantern_media` in the release configuration.
- [ ] B5 decision recorded (see `docs/CUTOVER_READINESS.md`): legacy Worker remains media origin, or assets/URLs migrated.
- [ ] B6 resolved: gated release command replaces `scripts/deploy-guard.mjs`.
- [ ] G3 sign-off complete in `docs/CUTOVER_READINESS.md` §7.
- [ ] Production D1 snapshot identifier recorded and restore tested.
- [ ] Production `d1_migrations` history inspected read-only and reconciled against section 3.

## 5. Planned procedure (not executed)

1. **Read-only inspection.** Confirm production `d1_migrations` rows and table list. Compare with the staging evidence in section 2. If production history differs, stop and produce a revised plan.
2. **Snapshot.** Capture production D1 using the recorded snapshot identifier. Verify it is restorable.
3. **Apply migrations.** Use Wrangler's native migration command against the production binding, which writes to `d1_migrations`:

   ```
   npx wrangler d1 migrations apply lantern_db --remote
   ```

   This command is **not to be run** until section 4 is complete and sign-off is recorded. The Nuxt staging runner is not used for production.
4. **Verify tracking.** Read back `d1_migrations` and, if present, `lantern_schema_migrations`. All four versions must be `applied` with checksums matching section 3.
5. **Verify schema.** Confirm `auth_rate_limits`, `email_tokens`, `comments`, `comment_likes`, `comment_reports`, and `works.video_path` exist with the expected structure.
6. **Record evidence.** Attach command output, checksum comparison, and snapshot identifier to the release ticket.

## 6. Failure handling

- Any checksum mismatch, unexpected `d1_migrations` row, or schema verification failure stops the release.
- A failed application rolls back by restoring the production D1 snapshot from step 2. This requires owner and DB/Infra approval.
- No ad hoc SQL, manual table drops, or bypass of the migration tracking tables is permitted.

## 7. Rollback reference

See `docs/CUTOVER_RUNBOOK.md` §8. The reference migrations are additive (`CREATE TABLE` / `ADD COLUMN`), so full D1 restore may be unnecessary if only new tables were written. That decision requires explicit approval.
