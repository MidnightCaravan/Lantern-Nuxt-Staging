# Lantern cutover rehearsal record

**Status:** STAGING WORKER DEPLOYED — rehearsal smoke passed on `lantern-nuxt-rehearsal`; route/DNS rollback rehearsal still pending infra
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

## 7. B7 preparation (2026-11-20)

Read-only Cloudflare inspection and local preparation are recorded in
`docs/RELEASE_PREPARATION_20261120.md`. A candidate rollback artifact was
identified (legacy `lantern` deployment `472f489c-b597-44d8-87a6-f3b59b80adbb`,
version `93be1fa1-8ac2-49c7-adf3-2682b3be8365`, created
`2026-10-26T22:30:22.06084Z`), but its live status is unconfirmed. The current
token has `zone (read)` only, so a DNS edit is not possible with these
credentials. No route, DNS, snapshot, or Worker state was changed. This
section does not close B7.

## 8. Two-config preparation (same day)

`wrangler.rehearsal.jsonc` was prepared as a separate Worker
(`lantern-nuxt-rehearsal`) with staging-only D1/R2 bindings, `workers_dev:
true`, and no routes or domains. `wrangler.release.jsonc` was set to
`workers_dev: false` and retains the verified production bindings.
`tests/environment-configs.test.ts` proves rehearsal cannot carry production
identifiers. Both configs were loaded by `wrangler dev --local` (local bindings
only, `/login` 200). `scripts/rehearsal-smoke-check.mjs` was added for the
staged Worker, where production-backed endpoints are expected to return 503.

At the time of preparation no Worker had been deployed and no remote Wrangler
command had been run. The subsequent staging-only deployment and smoke check
are recorded in section 9. The route/DNS rehearsal was not performed; B7
remains open.

---

## 9. Staging rehearsal Worker deployment and smoke check (2026-11-20)

**Evidence provenance:** the deployment and smoke results below were supplied
by the release owner from their terminal session. The agent did not execute
the deployment (the local harness rejected the `wrangler deploy` invocation)
and did not independently re-run the remote checks. The version ID and status
codes are recorded exactly as provided; none were guessed or reconstructed.

### 9.1 Deployment

| Item | Value |
|---|---|
| Worker | `lantern-nuxt-rehearsal` |
| URL | `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev` |
| Version ID | `4919d5b5-88fd-446e-9293-3a54c35b1d13` |
| Config | `wrangler.rehearsal.jsonc` |
| D1 binding | `lantern_staging_db` → `lantern-staging-db` |
| R2 binding | `lantern_staging_media` → `lantern-staging-media` |
| Static assets | 64 uploaded successfully |
| Result | Deployment successful |

No production D1/R2 binding, route, custom domain, trigger, or DNS change was
part of this deployment. `workers_dev` is enabled; no production hostname is
involved.

### 9.2 Smoke check

Command:
```
node scripts/rehearsal-smoke-check.mjs https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev
```

| # | Check | Status | Expected | Result |
|---|---|---|---|---|
| 1 | Rehearsal health `/api/public/health` | 503 | 503 | PASS |
| 2 | Application shell `/` | 200 | 200 | PASS |
| 3 | Login page `/login` | 200 | 200 | PASS |
| 4 | Discovery page `/discover` | 200 | 200 | PASS |
| 5 | Public works API `/api/public/works` | 503 | 503 | PASS |
| 6 | Anonymous session state `/api/auth/me` | 200 | 200 or 401 | PASS |
| 7 | Legacy verification alias `/verify/invalid-smoke-token` | 302 | accepted redirect | PASS |
| 8 | Logout parity `/logout` | 405 | 405 | PASS |
| 9 | Media `/media/smoke-missing-object` (Range `bytes=0-10`) | 503 | 503 | PASS |

**All nine checks passed.**

The 503 responses for rehearsal health, public works API, and media are
expected: `wrangler.rehearsal.jsonc` deliberately binds only
`lantern-staging-db` and `lantern-staging-media`; production D1 (`lantern_db`)
and production R2 (`lantern_media`) are intentionally absent. These 503s
confirm environment isolation, not a regression.

### 9.3 Scope and remaining work

- No secrets were provisioned. No DNS/route change, route flip/revert, or
  production infrastructure/data access was performed.
- The smoke script does not exercise authenticated or email flows, so this run
  does not establish whether `LANTERN_NUXT_SESSION_SECRET`,
  `LANTERN_BREVO_API_KEY`, or `LANTERN_MAIL_FROM` are present on the Worker.
- This does not close B7 (route/DNS rollback rehearsal remains pending) or B1
  (production `lantern_media` binding on `lantern-nuxt` remains open).
