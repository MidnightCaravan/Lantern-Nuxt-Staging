# Lantern cutover and rollback runbook

**Status:** DRAFT — this document does not authorize production work  
**Owner:** Release manager (to be assigned)  
**Related:** `docs/CUTOVER_READINESS.md`, `docs/PARITY_HARNESS.md`, `docs/parity-route-map.json`, `docs/REHEARSAL_RECORD.md`, `docs/RELEASE_READINESS_20261124.md`  
**Last verified:** post-merge CI at `962cd95`, read-only production D1 inspection, production-only config review

## 1. Purpose and limits

This runbook defines the controlled process for moving Lantern traffic from the legacy Flask Worker to the Nuxt Worker, and for returning traffic to Flask if cutover fails.

It is **not** a deployment instruction and does **not** override the production restrictions in `AGENTS.md`. No production database, binding, route, or deployment may be changed until every gate in `docs/CUTOVER_READINESS.md` passes and the sign-off in section 10 is complete.

Current verified state:

- Staging behavioral coverage: **PASS** (`npm run verify` passed in post-merge CI at `962cd95`).
- Operational readiness: **BLOCKED** (B1; B2–B5 are closed, and B5 is now approved for the first cutover).
- Release controls: **BLOCKED** (B7 traffic rollback rehearsal remains; B6 is the `npm run release:check` gate, not a deploy command).
- Explicit sign-off: **PENDING**.

No cutover step below has been executed.

## 2. Preconditions

| Gate | Current status | Required before cutover |
|---|---|---|
| G0 — Staging behavioral parity | PASS | Post-merge CI passed at `962cd95`; rerun `npm run verify` immediately before the window. |
| G1 — Operational readiness | BLOCKED | B1 production R2 binding is the only open blocker. B2–B4 are closed. B5 is approved: the Flask Worker remains the temporary production media origin. |
| G2 — Release controls | BLOCKED | B6 is the `npm run release:check` gate; section 6 smoke rehearsal passed (`docs/REHEARSAL_RECORD.md`). Rehearse the selected traffic rollback below and record the result. |
| G3 — Explicit sign-off | PENDING | Complete the table in section 10. |

Open blockers are tracked in `docs/CUTOVER_READINESS.md` §4 and `docs/RELEASE_READINESS_20261124.md`. This runbook is the written artifact for B7; it does not close B7 until a traffic rollback rehearsal is recorded. The section 6 smoke checklist was rehearsed locally and passed; see `docs/REHEARSAL_RECORD.md`.

## 3. Roles

| Role | Responsibility | Name / contact |
|---|---|---|
| Application owner | Confirms functional acceptance and approves product-visible risk | `[to be assigned]` |
| Infra / Cloudflare | Owns bindings, D1/R2 snapshots, route or DNS changes | `[to be assigned]` |
| Auth / Security | Confirms sessions, rate limits, and legacy-account handling | `[to be assigned]` |
| Release manager | Runs the window, smoke tests, monitoring, and rollback decision | `[to be assigned]` |

## 4. Pre-cutover checklist

All items are read-only until sign-off is complete.

- [ ] Record the exact commit to be released: `[commit]`. It must match `docs/release-signoff.json` when `npm run release:check` runs.
- [ ] CI on that commit is green; locally rerun `npm run verify`
- [ ] Route coverage shows 48 reviewed routes and `gap=0`
- [ ] B1 decision recorded: production R2 bound as `lantern_media` `[ticket/binding]`
- [ ] B2 decision recorded: read-only production D1 inspection complete; no DDL required for this release `[ticket/plan]`
- [ ] B3 verified parity recorded: signed-cookie sessions match Flask; rate limits are durable in D1 with Flask's five policies `[evidence]`
- [ ] B4 verified parity recorded: legacy `scrypt:` accounts are refused at login and routed to password reset, matching Flask (no code change) `[evidence]`
- [x] B5 approved 2026-11-24: the Flask Worker remains the temporary production media origin
- [ ] B6 verified: `npm run release:check` reports all gates ready with a commit-matched sign-off `[evidence]`
- [ ] Production D1 Time Travel bookmark recorded and restore procedure approved `[bookmark]`
- [ ] R2 snapshot decision recorded: none required while B5 holds `[decision]`
- [ ] Last known-good Flask Worker (`lantern`) version and rollback artifact recorded `[worker version]`; record the deployed Nuxt Worker (`lantern-nuxt`) version separately after B1 deploy
- [ ] Public hostname, traffic-switch mechanism, and exact revert step identified `[zone/record or mechanism]`
- [ ] Monitoring dashboard and alert channels identified `[dashboard/channel]`
- [ ] Deployment window and ticket recorded `[window/ticket]`
- [ ] Sign-off table in section 10 completed

### B1 release configuration

`wrangler.release.jsonc` is now a production-only template. It is not
referenced by any npm script; `npm run deploy` still fails closed. The current
evidence and remaining owner decisions are recorded in
`docs/RELEASE_READINESS_20261124.md`.

1. The production bucket name is **verified** as `lantern-media` (Flask Worker
   config and `wrangler r2 bucket list`). The release Worker name is
   **proposed** as `lantern-nuxt`; confirm it with the release manager.
2. The config binds only production D1 (`lantern_db`) and production R2
   (`lantern_media`). Staging bindings were removed because production
   selectors are explicit and staging sessions must not be valid on this
   Worker. `LANTERN_ANONYMOUS_WRITE_DATABASE=production` and
   `LANTERN_PUBLIC_READ_DATABASE=production` are set; the production-write flag
   is absent.
3. The config explicitly sets `workers_dev: false`, sets `preview_urls: false`,
   and declares no routes, custom domains, triggers, or media Service Binding.
   Deploying it cannot move production traffic or create a public preview
   endpoint. Under the approved B5 decision, public media URLs continue to use
   the Flask Worker origin. Do not enable `workers_dev`, add a route/domain, or
   enable Version URLs merely to test this Worker: Version URLs use the
   Worker's production D1/R2 bindings and are public unless Cloudflare Access
   is configured.
4. Validate locally with `npx vitest run tests/environment-configs.test.ts
   tests/release-config.test.ts`. An operator with permission may also run
   `npx wrangler deploy --dry-run --config wrangler.release.jsonc --outdir <local temp dir>`.
   Never remove `--dry-run` for that validation. Before cutover, run HTTP smoke
   checks only against local Wrangler dev with local bindings or the separately
   deployed `lantern-nuxt-rehearsal` Worker, which uses staging-only D1/R2. Do
   not invoke the production-bound `lantern-nuxt` Worker through a preview URL,
   Version URL, `workers.dev` URL, route, or custom domain while it is off
   production traffic. Any production-bound preview endpoint requires a
   separate owner decision and Cloudflare configuration change.
5. Only after explicit approval, an authorized operator deploys the release
   config with `npx wrangler deploy --config wrangler.release.jsonc`. Record
   the deploy evidence in the B1 row of `docs/CUTOVER_READINESS.md`, then set
   `B1.closed: true` in `docs/release-gates.json`.
6. Provision `LANTERN_NUXT_SESSION_SECRET`, `LANTERN_BREVO_API_KEY`, and
   `LANTERN_MAIL_FROM` privately on the release Worker. Do not put them in the
   config or the repository. Do not repeat the already-successful staging
   email test.

### B7 staging rehearsal configuration

`wrangler.rehearsal.jsonc` deploys a **separate** Worker named
`lantern-nuxt-rehearsal`. It binds only `lantern_staging_db` and
`lantern_staging_media`, has no production resource ids or binding names, and
declares no routes or domains. `workers_dev: true` gives it a safe, separate
test URL. Production-backed endpoints return 503 there by design; use
`node scripts/rehearsal-smoke-check.mjs <workers.dev URL>` and treat those 503s
as expected. The full production-shaped smoke run remains the locally seeded
rehearsal in `docs/REHEARSAL_RECORD.md`.

`tests/environment-configs.test.ts` proves the two configs cannot accidentally
share production bindings. Neither config is referenced by npm scripts, and
`npm run deploy` still fails closed.

Preparing either config does not authorize a deploy. That still requires all
gates to pass (`npm run release:check` → READY) and the section 10 sign-off.

## 5. Cutover procedure

**Do not execute any step below until section 4 is complete and sign-off is recorded.**

1. **Announce the window.** Notify the owner, infra, auth/security, and release channels. Freeze unrelated deploys.
2. **Snapshot production state.** Capture production D1 and R2 using the identifiers recorded in section 4. Verify the snapshots are restorable.
3. **Confirm migrations.** A read-only inspection at `962cd95` found all four required migrations in `d1_migrations` and all required tables/indexes present. Do not replay DDL. If this has changed, stop and obtain a revised, separately approved migration plan. `scripts/migrate.mjs` still refuses production and must not be bypassed.
4. **Deploy the Nuxt Worker.** After explicit approval, run `npx wrangler deploy --config wrangler.release.jsonc`. There is no npm deploy command that replaces `scripts/deploy-guard.mjs`; that guard remains intentionally failing closed. Confirm the deployed version matches the commit recorded in section 4.
5. **Shift traffic.** Use only the owner-approved hostname and traffic mechanism recorded in section 4. No route, DNS, custom domain, or Worker-name change is authorized by this runbook alone. Prefer a canary or gradual rollout if the selected mechanism supports it.
6. **Run smoke tests.** Execute section 6 immediately and record results in the window ticket.
7. **Observe.** Watch section 7 signals for the agreed observation period `[duration]`.
8. **Close or roll back.** If all checks pass, record cutover complete. If any rollback trigger fires, execute section 8.

## 6. Smoke tests

Read-only checks only. Do not exercise upload, publish, edit, or delete handlers against production during smoke testing; those behaviors are covered by the staging harness in `docs/PARITY_HARNESS.md`.

Before the traffic switch, section 6 checks are run against `lantern-nuxt-rehearsal` or local dev, not against the production-bound release Worker. The release Worker has no approved HTTP endpoint while off-route. After the owner-approved traffic switch, run each check once against the production hostname.

| Check | Request | Expected result |
|---|---|---|
| Worker health | `GET /api/public/health` | 200 with a healthy response |
| Application shell | `GET /` | 200, Nuxt-rendered Lantern home page |
| Login page | `GET /login` | 200, Flask-equivalent login form |
| Discovery page | `GET /discover` | 200, published works visible |
| Public works API | `GET /api/public/works` | 200, published-only results |
| Public work detail | `GET /api/public/works/:id` for a known published id | 200 with expected title and media fields |
| Session state | `GET /api/auth/me` | 200 with current session payload, or 401 for anonymous requests as designed |
| Media delivery | One pre-approved `GET /media/:key` check against the legacy Flask origin under B5 | 200/206 with expected headers; do not run repeated or bulk media checks |
| Verification alias | `GET /verify/:token` | Legacy alias redirects or resolves to the canonical Nuxt route per `docs/parity-route-map.json` |
| Logout parity | `GET /logout` | 405, matching Flask behavior |

Record pass/fail for each check in the window ticket. `node scripts/smoke-check.mjs <base-url>` executes the non-data-dependent checks in this table; `npm run db:seed:local` prepares a local rehearsal database.

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
2. **Classify the rollback.** Record whether production traffic has already been switched. Rolling back the `lantern-nuxt` Worker deployment and returning production traffic to the Flask Worker `lantern` are separate operations. Do not use a Worker version rollback as a substitute for a hostname/route change.
3. **Restore traffic if traffic was switched.** Revert the owner-approved production hostname/route/traffic mechanism to the Flask Worker `lantern`, or to the recorded last-known-good Flask version if the selected mechanism targets a version. Use only the exact step recorded in section 4. No traffic-switch command is specified here because the mechanism has not been approved; do not invent one.
4. **Roll back a Worker deployment only when that deployment is the failure.** If the Nuxt Worker deployment is bad and a prior good version exists, the Worker-version rollback form is `npx wrangler rollback <last-known-good-nuxt-version> --name lantern-nuxt`; this does not move production traffic. If the Flask Worker's own deployment is bad, and only with separate approval, the recorded form is `npx wrangler rollback <last-known-good-flask-version> --name lantern`; this also does not move traffic.
5. **Freeze Nuxt releases.** Keep the Nuxt Worker deployed but off-route; do not retry cutover during the same window without a new decision. Verify traffic no longer reaches `lantern-nuxt`.
6. **Decide on database state.** All four migrations are already applied and production writes are disabled for the initial release. Do not restore D1 if Nuxt only touched new tables or if no corruption occurred. If a legacy table was modified or corruption is confirmed, restore only the approved Time Travel bookmark with owner and DB/Infra approval: `npx wrangler d1 time-travel restore lantern-db --bookmark <approved-bookmark>`. This is destructive and was not rehearsed in this preparation pass.
7. **Decide on media state.** B5 is approved for the initial cutover, so no R2 asset rollback is needed. Any move away from the Flask media origin requires a separate decision and snapshot procedure.
8. **Verify Flask.** Repeat the section 6 checks against the Flask Worker, adjusted for Flask URLs, and confirm published content, login, and media range requests work.
9. **Record the incident.** Capture timeline, signals, failed checks, and rollback result in the window ticket.

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
