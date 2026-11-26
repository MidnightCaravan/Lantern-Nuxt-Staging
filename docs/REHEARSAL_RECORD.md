# Lantern cutover rehearsal record

**Status:** The 2026-11-24 staging Worker-version rollback checks technically PASSED, but that rehearsal's formal B7 closure remained PENDING because the pre-execution incident/window-record precondition was not met (see §10.6). A new rehearsal was executed on 2026-11-26 under the properly opened `B7-STAGING-20261126-02` record; its technical evidence is complete. B7-T1 owner exception and B7-T2 fresh Dashboard evidence were recorded 2026-11-27 (§12); independent review and final owner closure approval remain pending. B7 remains FORMALLY OPEN. A1 has no DNS/route switching step.
**Related:** `docs/CUTOVER_RUNBOOK.md`, `docs/CUTOVER_READINESS.md`, `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md`, `docs/ROLLBACK_REHEARSAL_CHECKLIST.md`, `scripts/smoke-check.mjs`, `scripts/seed-local-d1.mjs`

## 1. Purpose

This record distinguishes the technical results of the 2026-11-24 and
2026-11-26 staging Worker-version rehearsals from formal B7 closure. It does
**not** authorize production work. Under approved A1, DNS/route switching is not
part of the architecture. The 2026-11-24 rehearsal had the unmet pre-execution
incident/window-record precondition described in §10.6; the 2026-11-26 rehearsal
was executed under a properly opened window record. B7-T1 and B7-T2 received
owner disposition/evidence on 2026-11-27 (§12), but its evidence still requires
independent review and owner closure approval before B7 can be closed.

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
| Media delivery `/media/smoke-missing-object` | INFO | 503 — expected because the local-only rehearsal had no media binding; not evidence about the production R2 binding |

**All required checks passed.** The two INFO results are environment-limited, not regressions: no seeded content and no media binding.

## 5. What this proves and what it does not

- Proves: the built Nuxt Worker boots under Wrangler, serves the documented pages and read-only APIs, and the runbook's section 7 smoke checklist is executable and green on a parity-shaped local environment.
- Proves: `scripts/smoke-check.mjs` is reusable for the real cutover window ticket.
- A1 does not use a Cloudflare route/DNS shift or revert; those steps are not part of the approved A1 architecture. Earlier route/DNS instructions are superseded.
- Does not prove: a production D1 Time Travel restore or R2 asset restore.
  Under approved A1, a D1 Time Travel bookmark is recorded before the window
  (runbook §4) and no R2 restore is planned (runbook §9 step 7); no production
  resource was touched.
- Does not close: G1/B1 or G3. The 2026-11-26 staging technical rehearsal checks
  passed (§11), and B7-T1/B7-T2 received owner disposition/evidence on
  2026-11-27 (§12), but formal B7 closure remains pending independent review and
  owner closure approval. The 2026-11-24 missed pre-execution record is
  historical evidence (§10.6).

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

At the time of the 2026-11-20 preparation, no Worker had been deployed and
no remote Wrangler command had been run. The subsequent staging-only
deployment and smoke check are recorded in section 9. Under the then-current
plan, the route/DNS rehearsal had not been performed and B7 remained open.
Approved A1 later superseded route/DNS switching; see section 10 for the
November 24 Worker-version rehearsal and its current formal B7 status.

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
- **Status at the time of the 2026-11-20 rehearsal:** this did not close B7
  (the then-planned route/DNS rollback rehearsal had not been performed) or B1
  (the production `lantern_media` binding on `lantern-nuxt` remained open at
  that time). Approved A1 later superseded route/DNS switching; see §10 for the
  November 24 Worker-version rehearsal and current formal B7 status.

---

## 10. B7 staging-only Worker-version rollback rehearsal (2026-11-24)

**Technical result:** PASSED. **Formal B7 closure:** PENDING. This section
records the owner-authorized rehearsal executed against the staging Worker
only. Version A/Version B activation, smoke checks, and exact Version A restore
succeeded. However, the checklist precondition `Incident/window record opened`
was not met before execution (see §10.6), so this record does not represent B7
as formally closed. It does not authorize or perform production cutover.

### 10.1 Window and scope

| Item | Value |
|---|---|
| Start | `2026-11-24T17:56:51.980270000Z` |
| End verification | `2026-11-24T17:58:42.834983000Z` |
| Wrangler | `4.162.0` |
| Worker | `lantern-nuxt-rehearsal` |
| Hostname | `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev` |
| Version A | `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad` |
| Version B | `34625007-ff3d-4809-9e6e-95ad80e27def` |

### 10.2 Deployment evidence

| Event | Deployment ID | Deployment created (UTC) | Command timestamp (UTC) | Traffic |
|---|---|---|---|---|
| Version A activation | `b445a220-1d0f-4c55-ae11-bb1292cdb4d2` | `2026-11-24T17:57:33.298728Z` | `2026-11-24T17:57:27.837748000Z` | Version A at 100% |
| Version B activation | `1f7c15e4-b481-4b21-ad72-5479ef9221e6` | `2026-11-24T17:57:59.996608Z` | `2026-11-24T17:57:52.641330000Z` | Version B at 100% |
| Version A rollback | `92f1a430-6a6b-4de1-8f64-0bad9ae98123` | `2026-11-24T17:58:24.074125Z` | `2026-11-24T17:58:18.351677000Z` | Exact Version A restored at 100% |

The post-rollback deployment listing showed
`23f0ed07-d9a8-4e08-9b6e-0b4d814280ad@100` as the active deployment.

### 10.3 Verification

- All nine application smoke checks passed on Version A, Version B, and after
  rollback: rehearsal health, application shell, login page, discovery page,
  public works API, anonymous session state, legacy verification alias, logout
  parity, and media origin.
- Known-object media check:
  `/media/a1-rehearsal/cover.png` returned HTTP `200`, body `image-bytes`,
  `11` bytes, and SHA-256
  `2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c`.
- Known-object response headers were `Content-Type: image/png` and
  `Cache-Control: public, max-age=31536000`.
- Missing-object media check:
  `/media/smoke-missing-object` returned HTTP `404` and body
  `Media not found.`.
- Video range check: `/media/a1-rehearsal/video.mp4` with
  `Range: bytes=2-5` returned HTTP `206`, body `cdef`, and
  `Content-Range: bytes 2-5/10`.
- No strict media check returned HTTP `503`.
- The staging Service Binding targeted `lantern-media-rehearsal`.
- The rehearsal media Worker remained bound exclusively to
  `lantern-staging-media`.

### 10.4 Production isolation

- Production Worker `lantern` remained on Flask version
  `93be1fa1-8ac2-49c7-adf3-2682b3be8365@100`.
- Neither staging version existed on the production Worker; both version-ID
  lookups against `lantern` returned Cloudflare error code `100146`.
- Production D1, R2, secrets, routes, domains, DNS, traffic settings, and
  production-write settings were untouched.
- No production deployment occurred.
- The original dirty working branch retained its 252 pre-existing Git status
  entries.

### 10.5 Operational disclosure

The activation and rollback commands included `--yes`. Wrangler's
non-interactive execution automatically accepted its fallback confirmations.
The rollback output explicitly reported
`Using default value in non-interactive context: B7 rehearsal: restore version A`
and `Using fallback value in non-interactive context: yes`.

### 10.6 Authorization and window provenance

The project owner explicitly authorized the staging-only B7 deployment and
rollback rehearsal in the conversation before execution. The authorization
covered `lantern-nuxt-rehearsal` and the exact Version A/B procedure: activate
Version A `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad`, verify it, activate Version B
`34625007-ff3d-4809-9e6e-95ad80e27def`, verify it, roll back to exact Version A,
and verify restoration without touching production. No separate authorization
timestamp, ticket number, participant, or contemporaneous record is inferred.

The execution window was November 24, 2026, from
`2026-11-24T17:56:51.980270000Z` through `2026-11-24T17:58:42.834983000Z`.
Section 10 is the retained rehearsal-window evidence record. It was documented
after execution from the actual command outputs and timestamps, including the
`--yes` confirmation disclosure in Section 10.5. No separate incident ticket or
external window ID was created.

The canonical checklist lists `Incident/window record opened` as a precondition
(`docs/ROLLBACK_REHEARSAL_CHECKLIST.md:35`) but does not specify a ticket system.
No pre-execution incident/window ticket was opened, so that specific
precondition was not met. The machine-readable release-gate logic evaluates
gate pass flags, blocker closed flags, and signoff
(`scripts/release-gate-core.mjs:9-40`); it does not evaluate checklist
preconditions, incident tickets, or window IDs. The machine-readable gate
does not independently enforce this checklist precondition. The successful
technical execution evidence establishes that the staging rollback procedure
worked, but does not by itself support formal B7 closure. B7 remains formally
open pending an explicitly documented owner-approved exception or a new
rehearsal under a properly opened window record.

### 10.7 Conclusion

The B7 staging technical rehearsal passed: both version activations, strict
media checks, exact Version A rollback, post-rollback verification, and
production-isolation checks succeeded. Formal B7 closure remains pending
because the required pre-execution incident/window record was not opened. The
owner must either authorize and record an explicit exception to that missed
precondition or require a new rehearsal under a properly opened window record
before B7 can be marked closed and G2 passed. No production cutover was
performed.

---

## 11. B7 staging-only Worker-version rehearsal under window record 02 (2026-11-26)

**Technical result:** PASSED. **Formal B7 closure:** PENDING independent review
and explicit owner closure approval; B7-T1 and B7-T2 received owner
disposition/evidence on 2026-11-27 (§12).
This section supplements, and does not rewrite, the retained 2026-11-24 evidence
in §10. Authoritative evidence:
`docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9.

### 11.1 Window, scope, and deployment evidence

| Item | Value |
|---|---|
| Window record | `B7-STAGING-20261126-02` |
| Approved window | 2026-11-26 15:10–18:10 Asia/Jakarta (08:10–11:10 UTC) |
| Actual verification span | 2026-11-26 15:28:51–16:46:37 WIB (08:28:51–09:46:37 UTC) |
| Worker | `lantern-nuxt-rehearsal` |
| Hostname | `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev` |
| Version A / exact rollback target | `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad` |
| Version B / activation test | `34625007-ff3d-4809-9e6e-95ad80e27def` |
| Version A baseline | Pre-existing deployment `92f1a430-6a6b-4de1-8f64-0bad9ae98123`, Version A at 100% |
| Version B activation | Deployment `3360865e-1ea7-4fdc-8961-b806a0917833`, created `2026-11-26T08:36:30.732695Z` / 15:36:30 WIB, Version B at 100% |
| Exact Version A restoration | Deployment `606250b3-72ca-4c5d-be6c-96b7b5f3cb53`, created `2026-11-26T09:36:27.796647Z` / 16:36:27 WIB, annotation `B7-STAGING-20261126-02: restore exact Version A` |
| Final Wrangler status | `npx wrangler deployments status --name lantern-nuxt-rehearsal --json` reports deployment `606250b3-72ca-4c5d-be6c-96b7b5f3cb53` with Version A at 100% |

### 11.2 Verification

All nine application smoke checks and all three strict media fixture checks
passed at the Version A baseline, at Version B, and after the final Version A
restoration. Terminal evidence recorded `SMOKE_EXIT=0` and `STRICT_EXIT=0` at
each stage. The exact expected and observed HTTP statuses, bodies, headers,
byte count, and SHA-256 value are in
`docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9.2–§9.3.

### 11.3 Deviations, review findings, and isolation

The T1/T2 status statements below reflect the 2026-11-26 review record. Section
§12 records the 2026-11-27 owner disposition and fresh Dashboard evidence.

- **B7-T1 — CONFIRMED PROCEDURAL DEVIATION.** The Version B activation was
  performed with a fully specified Wrangler command during prompt inspection;
  Wrangler presented no confirmation prompt. The intended interactive-only
  confirmation was not achieved. Deployment
  `3360865e-1ea7-4fdc-8961-b806a0917833` is retained in the audit trail. A
  distinct, explicit owner decision is pending on whether to accept this
  staging-only deviation as an exception; it must record approver/rejecter,
  timestamp, and exact scope. The original record 02 authorization did not
  approve this separate deviation, and it must not be retroactively described as
  an interactive confirmation.
- **B7-T2 — UNABLE TO VERIFY from the published evidence; not a proven
  configuration fault.** Fresh 2026-11-26 Wrangler metadata in record 02 §9.1
  verified the staging D1 identifier `5ce6be03-45c1-465e-a461-20e40148404e`,
  the staging R2 bucket `lantern-staging-media`, the `LANTERN_MEDIA_ORIGIN`
  Service Binding target `lantern-media-rehearsal`, and the media Worker's
  `lantern_media` → `lantern-staging-media` binding. Those binding identifiers
  are verified and are not missing. The 2026-11-25 owner-observed dashboard
  inventory is carried forward only as historical evidence. B7-T2 is limited to
  live workers.dev and Preview URL settings, custom domains, routes, cron
  triggers, queue consumers, and email routing rules for `lantern-nuxt-rehearsal`
  and `lantern-media-rehearsal`; the available 2026-11-26 Wrangler metadata did
  not independently establish those live settings. Obtain read-only current
  evidence from an authorized Cloudflare reviewer/operator, or record an explicit
  owner disposition of the missing evidence. Do not infer that any route,
  domain, or trigger existed.
- Subsequent timed/Expect restoration attempts were stopped and did not
  complete a deployment. The manual interactive restoration produced deployment
  `606250b3-72ca-4c5d-be6c-96b7b5f3cb53`.
- No production Worker, D1 database, R2 object, secret, route, custom domain,
  DNS record, or traffic setting was accessed or changed.
- No application code, Worker configuration, release gate, G2 state, or
  production setting was changed by this documentation-only evidence update.
- B7 remains formally open. B7-T1 and B7-T2 were dispositioned on 2026-11-27
  (§12), but an independent reviewer must still record identity, role, date,
  evidence reviewed, results, and conclusion, and the project owner must
  explicitly authorize closure.

## 12. Dated B7 disposition update — 2026-11-27

This is a current-status addendum. It does not rewrite §10 or §11.

### 12.1 B7-T1 owner disposition

The project owner explicitly accepted the Version B activation's missing
interactive confirmation as a **ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION** for
Worker `lantern-nuxt-rehearsal`, window `B7-STAGING-20261126-02`, Version B
deployment `3360865e-1ea7-4fdc-8961-b806a0917833`, and this single staging
activation only. The decision date is 2026-11-27 Asia/Jakarta; the exact
approval minute is not preserved and is not invented here. Do not describe the
activation as interactive. This exception does not waive interactive
confirmation for future operations and does not authorize production changes.

### 12.2 B7-T2 fresh Dashboard evidence

Four owner-supplied Cloudflare Dashboard screenshots, with macOS menu-bar
timestamps of 2026-11-27 Asia/Jakarta, record:

- `lantern-nuxt-rehearsal` Domains at 02:35: workers.dev ON; Preview / Version
  URLs OFF; no custom domains; no custom routes.
- `lantern-nuxt-rehearsal` Settings → Trigger events at 02:38: no Cron triggers;
  no Queue consumers; no Email routing rules.
- `lantern-media-rehearsal` Domains at 02:39: workers.dev OFF; Preview / Version
  URLs OFF; no custom domains; no custom routes.
- `lantern-media-rehearsal` Settings → Trigger events at 02:40: no Cron
  triggers; no Queue consumers; no Email routing rules; Other triggers shows
  `lantern-nuxt-rehearsal (production) fetch()`.

That `fetch()` entry is the expected internal Service Binding invocation between
the rehearsal Workers, not a public domain, custom route, Cron trigger, Queue
consumer, or Email routing rule. The Dashboard's `Production` label is the
selected environment within the named rehearsal Worker; it does not turn the
rehearsal Worker into the production application Worker.

The fresh 2026-11-26 Wrangler binding metadata remains verified and was never
missing: staging D1 ID `5ce6be03-45c1-465e-a461-20e40148404e`, staging R2
`lantern-staging-media`, `LANTERN_MEDIA_ORIGIN` → `lantern-media-rehearsal`, and
media Worker `lantern_media` → `lantern-staging-media`.

B7 remains open pending independent review and final owner closure approval. No
release gate was changed.
