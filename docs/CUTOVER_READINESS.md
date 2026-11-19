# Lantern cutover readiness report

**Status:** NOT READY for production cutover  
**Scope:** staging validation only; no production writes, binding changes, or deploy enablement performed  
**Last verified:** remote staging migration backfill / `npm run verify`  
**Cutover runbook:** `docs/CUTOVER_RUNBOOK.md` (draft; not rehearsed)

## 1. Executive summary

The Flask → Nuxt migration has a green staging harness: all 48 inventoried Flask routes have an explicit disposition, behavior tests pass against in-memory D1/R2 doubles, and CI runs the same verification on pull requests and `main`. This establishes **staging behavioral coverage**, not production readiness.

Production cutover remains blocked by operational work: production media binding, migration execution, durable auth state, legacy password hashes, and release controls. `npm run deploy` is intentionally disabled.

## 2. What is verified

| Area | Evidence | Result |
|---|---|---|
| Route coverage | `npm run parity:routes`, `docs/parity-route-map.json` | 48 routes reviewed; `vendor=2`, `api=29`, `covered=11`, `alias=4`, `embedded=2`, `gap=0` |
| Behavior tests | `npm test` | 104 passing tests across 13 files |
| Migration runner | `npm run migrate:plan`, `npm run migrate` (local and remote) | Local apply/re-apply idempotent; remote staging backfill applied checksum rows for `0001`–`0004` without replaying DDL; re-plan is idempotent; production target refused |
| Build | `npm run build` | Nuxt/Nitro build passes |
| CI | `.github/workflows/verify.yml` | Runs `npm run verify` on PRs and `main`; no deploy step |
| Testing model | `tests/helpers/fake-d1.ts`, `fake-r2.ts`, `handler.ts` | Real h3 handlers exercised against in-memory D1/R2 doubles |
| Release guard | `scripts/deploy-guard.mjs` | Exits non-zero; deploy fails closed |

Covered behavior domains: login/registration/token flows, profile and work creation, work ownership/deletion, novel chapters, comic pages/episodes, discussions, publishing, public discovery/readers, video upload, media serving, thumbnails, and staging/production isolation.

## 3. Current production posture

- `wrangler.jsonc` binds production D1 (`lantern_db`), staging D1 (`lantern_staging_db`), and staging R2 (`lantern_staging_media`).
- There is **no `lantern_media` production R2 binding**. Public media URLs are generated against the legacy Flask Worker base in `server/utils/lantern-public.ts`.
- Studio and auth write handlers gate mutations to staging sessions; production sessions are rejected with 409.
- Sessions are signed stateless cookies; CSRF and login/action rate limits are process-local `Map` state.
- `verifyLanternPasswordHash` accepts the Nuxt PBKDF2 format and rejects legacy `scrypt:` hashes.
- SQL migrations `0001`–`0004` are driven by a staging-only runner (`scripts/migrate.mjs`, `scripts/migrations-core.mjs`) with a `lantern_schema_migrations` tracking table, SHA-256 checksums, atomic per-migration SQL, dry-run, and a hard refusal for production targets.
- The runner also reads Wrangler's `d1_migrations` table. Remote staging already has all four migrations applied there, so the checksum backfill was applied instead of replaying DDL.
- The remote staging checksum backfill was executed: `lantern_schema_migrations` now has `0001`–`0004` with matching SHA-256 checksums and the original `2026-11-14 10:01:41` applied-at timestamps. A re-plan is idempotent (4 applied, 0 pending, 0 backfill). No DDL was replayed and production D1 was not touched.
- CI verifies code but does not provision bindings, apply migrations, or deploy.

## 4. Blockers

| ID | Blocker | Evidence | Impact | Owner | Exit criteria |
|---|---|---|---|---|---|
| B1 | Production media binding missing | `wrangler.jsonc` has only `lantern_staging_media` | Nuxt cannot serve or write production R2 objects; public URLs still depend on the legacy Worker | Infra/Cloudflare | Bind production R2 as `lantern_media` in a release config; verify media reads and range behavior against a production-shaped staging bucket |
| B2 | Production migration plan not reviewed | `scripts/migrate.mjs`, `scripts/migrations-core.mjs`, `tests/migrations.test.ts` | Remote staging backfill is applied and verified with idempotent re-plan, but no production migration plan has been reviewed | DB/Infra | Produce and review a production migration plan using the verified staging evidence. Production remains gated by B6/G3 |
| B3 | Non-durable auth state | `lantern-auth.ts` uses in-memory `Map` limits and stateless cookies | Sessions cannot be revoked; rate limits reset on isolate restart and are inconsistent across instances | Auth/Security | Durable session store and shared rate-limit table; logout invalidation; multi-instance test |
| B4 | Legacy password hashes rejected | `verifyLanternPasswordHash` only accepts `pbkdf2-sha256-custom:*` | Existing production users with `scrypt:` hashes cannot log in after cutover | Auth/Security | Verify or transparently rehash legacy hashes, or run a forced-reset migration with user communication |
| B5 | Legacy media URL dependency | `LEGACY_BASE` in `lantern-public.ts` | Public works still emit Flask Worker URLs; cutover does not fully remove Flask | Platform | Decide whether the Worker remains the media origin; otherwise migrate assets and update URL generation |
| B6 | Deploy guard fails closed | `scripts/deploy-guard.mjs` | No deployment path exists | Release | Replace guard with an explicit gated release command requiring the signed checklist below |
| B7 | Runbook drafted, not rehearsed | `docs/CUTOVER_RUNBOOK.md` | Rollout and rollback steps exist on paper but have not been rehearsed; the runbook grants no rollout authority | Release | Rehearse rollback in a staging-shaped environment, record results, and attach evidence to the window ticket |

Non-blocking follow-ups: add typecheck/lint to `verify`, pin dependency audit policy, and confirm whether the disabled “Creators” nav item is intentional (it is not a Flask route).

## 5. Readiness gates

| Gate | Status | Notes |
|---|---|---|
| G0 — Staging behavioral parity | **PASS** | 48 routes dispositioned, 104 tests passing, build and CI green |
| G1 — Operational readiness | **BLOCKED** | B1–B5 |
| G2 — Release controls | **BLOCKED** | B6–B7 |
| G3 — Explicit sign-off | **PENDING** | Required before any production mutation or deploy enablement |

## 6. Recommended sequence

1. Resolve B1 and produce a reviewed production migration plan for B2 (staging rehearsal is complete); rerun `npm run verify`.
2. Resolve B3 and B4 with a multi-instance test and a legacy-account migration rehearsal.
3. Decide B5: keep the legacy Worker as media origin, or migrate media URLs/assets.
4. Rehearse the B7 runbook (`docs/CUTOVER_RUNBOOK.md`) and record rollback results.
5. Replace the B6 guard only after G0–G2 pass.
6. Obtain written sign-off below, then perform the cutover.

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
