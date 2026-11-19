# Lantern cutover rehearsal record

**Status:** PARTIAL PASS — smoke rehearsal complete; route/DNS rollback rehearsal pending infra
**Related:** `docs/CUTOVER_RUNBOOK.md`, `docs/CUTOVER_READINESS.md`, `scripts/smoke-check.mjs`, `scripts/seed-local-d1.mjs`

## 1. Purpose

This records what was actually rehearsed for B7. It does **not** authorize production work and does **not** close the route/DNS rollback portion of B7, which requires Cloudflare infrastructure access.

## 2. Environment

- Built Worker: `npm run build` output in `.output/`, served with `npx wrangler dev --cwd .output --local --port 8799`.
- Bindings: local-only D1 (`lantern-db`, `lantern-staging-db`), local-only R2 (`lantern-staging-media`), ASSETS, and local secret bindings supplied by Wrangler's local dev environment.
- No remote binding, remote D1, remote R2, or production resource was read or written. No credential file was inspected.

## 3. Rehearsal steps performed

1. Started the built Worker locally.
2. Ran `node scripts/smoke-check.mjs http://127.0.0.1:8799` against an unseeded local D1. Result: **2 required checks failed** (`/api/public/health` and `/api/public/works` returned 500) because `works` did not exist. This is the expected "schema not applied" failure and was recorded as such.
3. Seeded the local D1 databases with `npm run db:seed:local` (runs `migrations/0001`–`0004` against `--local` databases only).
4. Re-ran the smoke check. Result below.
5. Stopped the local Worker.

## 4. Smoke result (after local seed)

| Check | Status | Detail |
|---|---|---|
| Worker health `GET /api/public/health` | PASS | 200 |
| Application shell `GET /` | PASS | 200 |
| Login page `GET /login` | PASS | 200 |
| Discovery page `GET /discover` | PASS | 200 |
| Public works API `GET /api/public/works` | PASS | 200 |
| Anonymous session `GET /api/auth/me` | PASS | 200 (anonymous payload) |
| Verification alias `GET /verify/invalid-smoke-token` | PASS | 302 redirect, matching the documented alias behavior |
| Logout parity `GET /logout` | PASS | 405, matching Flask |
| Public work detail `/api/public/works/1` | INFO | 404 — empty local D1 has no published work; not a required check |
| Media delivery `/media/smoke-missing-object` | INFO | 503 — expected while B1 (production R2 binding) is open |

**All required checks passed.** The two INFO results are environment-limited, not regressions: no seeded content and no media binding.

## 5. What this proves and what it does not

- Proves: the built Nuxt Worker boots under Wrangler, serves the documented pages and read-only APIs, and the runbook's section 6 smoke checklist is executable and green on a parity-shaped local environment.
- Proves: `scripts/smoke-check.mjs` is reusable for the real cutover window ticket.
- Does not prove: Cloudflare route/DNS shift and revert (runbook §5 step 5 and §8 step 2). That requires infra access and an actual deployed Worker.
- Does not prove: production D1/R2 snapshot and restore (runbook §5 step 2, §8 step 4). No production resource was touched.
- Does not close: G1/B1, G3, or the route portion of B7.

## 6. Reproduce

```
npm run build
npm run db:seed:local
npx wrangler dev --cwd .output --local --port 8799
# in another terminal:
node scripts/smoke-check.mjs http://127.0.0.1:8799
```
