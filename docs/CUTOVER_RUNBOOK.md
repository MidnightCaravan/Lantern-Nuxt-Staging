# Lantern cutover and rollback runbook

**Status:** DRAFT — this document does not authorize production work  
**Owner:** Release manager (to be assigned)  
**Related:** `docs/CUTOVER_READINESS.md`, `docs/PARITY_HARNESS.md`, `docs/parity-route-map.json`  
**Last verified:** commit `ff86f1a` / `npm run verify`

## 1. Purpose and limits

This runbook defines the controlled process for moving Lantern traffic from the legacy Flask Worker to the Nuxt Worker, and for returning traffic to Flask if cutover fails.

It is **not** a deployment instruction and does **not** override the production restrictions in `AGENTS.md`. No production database, binding, route, or deployment may be changed until every gate in `docs/CUTOVER_READINESS.md` passes and the sign-off in section 10 is complete.

Current verified state, from the readiness report:

- Staging behavioral coverage: **PASS** (48 routes dispositioned, 115 tests, build and CI green).
- Operational readiness: **BLOCKED** (B1–B5).
- Release controls: **BLOCKED** (B6 and B7 rehearsal).
- Explicit sign-off: **PENDING**.

No cutover step below has been executed.

## 2. Preconditions

| Gate | Current status | Required before cutover |
|---|---|---|
| G0 — Staging behavioral parity | PASS | Record the tested commit and rerun `npm run verify` immediately before the window. |
| G1 — Operational readiness | BLOCKED | Close B1 production R2 binding, B2 reviewed production migration plan, and B5 media URL decision. B3 (sessions and durable rate limits) and B4 (legacy password hashes) are verified parity and closed. |
| G2 — Release controls | BLOCKED | Close B6 by replacing the deploy guard with a gated release command, and rehearse this runbook end to end. |
| G3 — Explicit sign-off | PENDING | Complete the table in section 10. |

Open blockers are tracked in `docs/CUTOVER_READINESS.md` §4. This runbook is the written artifact for B7; it does not close B7 until a rollback rehearsal is recorded.

## 3. Roles

| Role | Responsibility | Name / contact |
|---|---|---|
| Application owner | Confirms functional acceptance and approves product-visible risk | `[to be assigned]` |
| Infra / Cloudflare | Owns bindings, D1/R2 snapshots, route or DNS changes | `[to be assigned]` |
| Auth / Security | Confirms sessions, rate limits, and legacy-account handling | `[to be assigned]` |
| Release manager | Runs the window, smoke tests, monitoring, and rollback decision | `[to be assigned]` |

## 4. Pre-cutover checklist

All items are read-only until sign-off is complete.

- [ ] Record the exact commit to be released: `ff86f1a` or approved successor: `[commit]`
- [ ] CI on that commit is green; locally rerun `npm run verify`
- [ ] Route coverage shows 48 reviewed routes and `gap=0`
- [ ] B1 decision recorded: production R2 bound as `lantern_media` `[ticket/binding]`
- [ ] B2 decision recorded: reviewed production migration plan `[ticket/plan]`
- [ ] B3 verified parity recorded: signed-cookie sessions match Flask; rate limits are durable in D1 with Flask's five policies `[evidence]`
- [ ] B4 verified parity recorded: legacy `scrypt:` accounts are refused at login and routed to password reset, matching Flask (no code change) `[evidence]`
- [ ] B5 decision recorded: legacy Worker remains media origin, or assets/URLs migrated `[ticket]`
- [ ] B6 decision recorded: gated release command replaces `scripts/deploy-guard.mjs` `[ticket]`
- [ ] Production D1 snapshot identifier recorded `[snapshot id]`
- [ ] Production R2 snapshot/versioning identifier recorded `[snapshot id]`
- [ ] Last known-good Flask Worker version and rollback artifact recorded `[worker version]`
- [ ] Cloudflare route/DNS record to be changed identified `[zone/record]`
- [ ] Monitoring dashboard and alert channels identified `[dashboard/channel]`
- [ ] Deployment window and ticket recorded `[window/ticket]`
- [ ] Sign-off table in section 10 completed

## 5. Cutover procedure

**Do not execute any step below until section 4 is complete and sign-off is recorded.**

1. **Announce the window.** Notify the owner, infra, auth/security, and release channels. Freeze unrelated deploys.
2. **Snapshot production state.** Capture production D1 and R2 using the identifiers recorded in section 4. Verify the snapshots are restorable.
3. **Apply migrations.** Use the separately approved production migration plan. `scripts/migrate.mjs` intentionally refuses production database names; it must not be bypassed ad hoc.
4. **Deploy the Nuxt Worker.** Use the gated release command that replaces `scripts/deploy-guard.mjs`. Confirm the deployed version matches the commit recorded in section 4.
5. **Shift traffic.** Update the Cloudflare route/DNS record `[zone/record]` from the legacy Worker to the Nuxt Worker. Prefer a canary or gradual rollout if the account supports it; otherwise use an atomic switch.
6. **Run smoke tests.** Execute section 6 immediately and record results in the window ticket.
7. **Observe.** Watch section 7 signals for the agreed observation period `[duration]`.
8. **Close or roll back.** If all checks pass, record cutover complete. If any rollback trigger fires, execute section 8.

## 6. Smoke tests

Read-only checks only. Do not exercise upload, publish, edit, or delete handlers against production during smoke testing; those behaviors are covered by the staging harness in `docs/PARITY_HARNESS.md`.

| Check | Request | Expected result |
|---|---|---|
| Worker health | `GET /api/public/health` | 200 with a healthy response |
| Application shell | `GET /` | 200, Nuxt-rendered Lantern home page |
| Login page | `GET /login` | 200, Flask-equivalent login form |
| Discovery page | `GET /discover` | 200, published works visible |
| Public works API | `GET /api/public/works` | 200, published-only results |
| Public work detail | `GET /api/public/works/:id` for a known published id | 200 with expected title and media fields |
| Session state | `GET /api/auth/me` | 200 with current session payload, or 401 for anonymous requests as designed |
| Media delivery | `GET /media/:key` for a known object, with `Range` header | 200/206 with correct bytes and headers; note B1/B5 may keep the legacy Worker as media origin |
| Verification alias | `GET /verify/:token` | Legacy alias redirects or resolves to the canonical Nuxt route per `docs/parity-route-map.json` |
| Logout parity | `GET /logout` | 405, matching Flask behavior |

Record pass/fail for each check in the window ticket.

## 7. Monitoring and rollback triggers

Thresholds marked `[threshold]` must be set by the release manager and owner before the window.

| Signal | Source | Trigger |
|---|---|---|
| Worker 5xx rate | Cloudflare Worker analytics | Sustained rate above `[threshold]` |
| Authentication failures | Worker logs / auth metrics | Login or session failures above `[threshold]` |
| Media errors | Worker logs / R2 metrics | 404, 403, or 416 responses above `[threshold]` for known objects |
| D1 errors or latency | D1 analytics / Worker logs | Error rate or latency above `[threshold]` |
| Missing published content | Smoke tests / user reports | Any confirmed published work or chapter missing after cutover |
| Data corruption | D1 audit / user reports | Any confirmed corruption triggers immediate rollback |

A confirmed data-corruption signal does not require waiting for a threshold.

## 8. Rollback procedure

1. **Announce rollback.** Stop the rollout, notify the channels from section 5, and open an incident record.
2. **Restore traffic.** Revert the Cloudflare route/DNS record `[zone/record]` to the last known-good Flask Worker version recorded in section 4.
3. **Freeze Nuxt releases.** Keep the Nuxt Worker deployed but off-route; do not retry cutover during the same window without a new decision.
4. **Decide on database state.** The reference migrations are additive (`CREATE TABLE` / `ADD COLUMN`). If Nuxt wrote only to new tables, a full D1 restore may be unnecessary. If any legacy table was modified, restore the production D1 snapshot `[snapshot id]`. This decision requires owner and DB/Infra approval.
5. **Decide on media state.** If B5 retained the legacy Worker as media origin, no asset rollback is needed. Otherwise restore the prior media URLs or R2 snapshot `[snapshot id]`.
6. **Verify Flask.** Repeat the section 6 checks against the Flask Worker, adjusted for Flask URLs, and confirm published content, login, and media range requests work.
7. **Record the incident.** Capture timeline, signals, failed checks, and rollback result in the window ticket.

## 9. After cutover or rollback

- Update `docs/CUTOVER_READINESS.md` with the actual outcome and any newly discovered gaps.
- If cutover succeeded, mark B1–B6 closed only with their evidence and schedule the retirement of legacy-only paths.
- If rollback occurred, keep production read-only with respect to Nuxt writes until a new signed window is approved.
- Retain smoke-test output, snapshots, and monitoring exports with the window ticket.

## 10. Sign-off reference

Production work must not begin until all roles approve in `docs/CUTOVER_READINESS.md` §7.

| Role | Name | Date | Decision |
|---|---|---|---|
| Application owner |  |  | Approve / Reject |
| Infra / Cloudflare |  |  | Approve / Reject |
| Auth / Security |  |  | Approve / Reject |
| Release manager |  |  | Approve / Reject |

**Cutover approved:** ☐ Yes ☐ No  
**Approved deployment window / ticket:** ______________________
