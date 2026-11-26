# Lantern cutover and rollback runbook

**Status:** A1 preparation only — NOT an execution authorization
**Related:** `docs/CUTOVER_READINESS.md`, `docs/A1_PRODUCTION_CUTOVER_PREP_20261124.md`, `docs/PARITY_HARNESS.md`, `docs/parity-route-map.json`, `docs/A1_STAGING_REHEARSAL_20261120.md`, `docs/RELEASE_READINESS_20261124.md`

This runbook records the approved A1 shape and the checks required before and
after a separately authorized production window. It is **not** a deployment
instruction and does **not** override `AGENTS.md`. No production database,
binding, route, Worker, secret, or traffic setting may be changed until the
gates below pass and sign-off is complete.

## 1. Gate status

| Gate | Status | Detail |
|---|---|---|
| G0 — Staging behavioral parity | PASS | 48 routes dispositioned; staging A1 evidence recorded |
| G1 — Operational readiness | BLOCKED | `lantern-media` deployment and binding metadata are verified; live privacy settings remain unverified, and Nuxt `LANTERN_MEDIA_ORIGIN` activation/runtime proof is outstanding |
| G2 — Release controls | BLOCKED | The 2026-11-26 record 02 staging Worker-version rehearsal technically passed; formal B7 closure is pending B7-T1 owner disposition, B7-T2 live-settings proof/disposition, independent review, and owner closure approval |
| G3 — Explicit sign-off | PENDING | section 11 must contain real approvals from the four roles in section 3 |

## 2. Approved A1 architecture

- Nuxt is deployed as a new version of the existing Worker `lantern`.
- `workers_dev: true` preserves `https://lantern.midnightcaravans.workers.dev`.
- `preview_urls: false` prevents pre-cutover Version URL exposure.
- The intended private Python Worker `lantern-media` serves Flask `/media/*` behavior; its live privacy/access settings require independent verification.
- `LANTERN_MEDIA_ORIGIN` binds `lantern` to `lantern-media`.
- The media Worker release template declares only R2 `lantern-media` bound
  as `lantern_media`, with no D1, secrets, routes, domains, or triggers. The
  live privacy/access settings still require independent verification.
- No DNS, custom domain, route, or `zone:edit` operation is part of A1.
- `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent.

## 3. Roles

| Role | Sign-off key | Responsibility | Assignee |
|---|---|---|---|
| Application owner | `applicationOwner` | Approves window, sign-off, and any production change | `[to be assigned]` |
| Infra / Cloudflare | `infraCloudflare` | Owns Worker deployments, bindings, and rollback evidence | `[to be assigned]` |
| Auth / security | `authSecurity` | Independently confirms auth/security evidence and gate conclusions | `[to be assigned]` |
| Release manager | `releaseManager` | Runs the window, smoke tests, monitoring, and rollback decision | `[to be assigned]` |

## 4. Pre-cutover checklist

All items are read-only until sign-off is complete.

- [ ] Record the exact commit to be released. It must match `docs/release-signoff.json` when `npm run release:check` runs.
- [ ] CI on that commit is green; locally rerun `npm run verify`.
- [ ] Route coverage shows 48 reviewed routes and `gap=0`.
- [ ] B1 evidence recorded: `lantern-media` deployment and R2 binding metadata are verified; independently verify its live privacy/access settings; then deploy `lantern` with `LANTERN_MEDIA_ORIGIN` and production D1/R2 and record runtime evidence `[evidence]`.
- [ ] B2 evidence recorded: production D1 schema inspection complete; no DDL required `[evidence]`.
- [ ] B3 verified parity recorded: signed-cookie sessions and durable rate limits match Flask `[evidence]`.
- [ ] B4 verified parity recorded: legacy `scrypt:` accounts are refused and routed to password reset, matching Flask `[evidence]`.
- [x] B5 approved 2026-11-24: Flask remains the temporary production media origin.
- [ ] B6 verified: `npm run release:check` reports all gates ready with a commit-matched sign-off `[evidence]`.
- [ ] B7 formally closed: the 2026-11-26 `B7-STAGING-20261126-02` staging
  Worker-version rehearsal technically passed and restored Version A at 100%
  (see `docs/REHEARSAL_RECORD.md` §11 and
  `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9). Before closure, record
  an explicit owner disposition of B7-T1 (Version B prompt deviation), fresh
  read-only evidence or an explicit owner disposition for B7-T2 (live workers.dev
  and Preview URL settings, custom domains, routes, cron triggers, queue
  consumers, and email routing rules; the verified binding metadata in record
  02 §9.1 is not part of the finding), an independent reviewer
  identity/date/result, and explicit project-owner closure approval `[evidence]`.
- [ ] Record the live `lantern` version immediately before deployment. The historic Flask rollback version is `93be1fa1-8ac2-49c7-adf3-2682b3be8365`; confirm it is still the intended target.
- [ ] Record D1 Time Travel bookmark and confirm the no-R2-restore decision under B5 `[decision]`.
- [ ] Confirm required secrets exist; do not print or store secret values.
- [ ] Confirm `preview_urls: false` and the absence of `LANTERN_ENABLE_PRODUCTION_WRITES`.

## 5. Prepared configuration

### B1 production Workers

| Property | `lantern` (Nuxt) | `lantern-media` (Flask media) |
|---|---|---|
| Config | `wrangler.release.jsonc` | `wrangler.media-release.jsonc` |
| Public endpoint | workers.dev retained | none |
| `workers_dev` | `true` | `false` |
| `preview_urls` | `false` | `false` |
| D1 | production `lantern_db` | none |
| R2 | production `lantern_media` | production `lantern_media` |
| Service Binding | `LANTERN_MEDIA_ORIGIN` → `lantern-media` | none |
| Routes/domains/triggers | none | none |

`lantern-media-release/src/media_worker.py` is a verbatim copy of the verified
staging media Worker source. Do not modify it as part of cutover.

### B7 rollback rehearsal configuration

Use staging-shaped Workers only. The existing pair is
`lantern-nuxt-rehearsal` and `lantern-media-rehearsal`. Fresh 2026-11-26 Wrangler
metadata in record 02 §9.1 verified the staging D1/R2 identifiers, the
`LANTERN_MEDIA_ORIGIN` target, and the media Worker's staging R2 binding; those
binding identifiers are not missing. The 2026-11-25 owner-observed dashboard
inventory is historical evidence only. B7-T2 is limited to fresh same-day proof
of live workers.dev and Preview URL settings, custom domains, routes, cron
triggers, queue consumers, and email routing rules, which the Wrangler metadata
did not establish. A production-bound Worker must not be used for rehearsal. The A1 staging Worker-version activation and exact
Version A restoration was technically completed under `B7-STAGING-20261126-02`
on 2026-11-26; see `docs/REHEARSAL_RECORD.md` §11 and
`docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9. The 2026-11-24 exercise in
`docs/REHEARSAL_RECORD.md` §10 is retained as historical evidence. Formal B7
closure remains pending B7-T1 and B7-T2 disposition, independent review, and
owner closure approval. A1 does not require a DNS/route flip or revert.

## 6. Cutover sequence — requires separate authorization

1. Freeze unrelated releases and record pre-state with read-only commands.
2. Verify the existing `lantern-media` deployment and R2 binding metadata; independently confirm its live privacy/access settings. Do not redeploy it merely because this runbook is being executed.
3. Deploy the Nuxt build from `wrangler.release.jsonc` as a new `lantern` version.
4. Verify the active `lantern` version has `LANTERN_MEDIA_ORIGIN` bound to `lantern-media`; then perform the approved private-path verification without invoking a public media endpoint.
5. Confirm `lantern` still serves the canonical workers.dev hostname.
6. Run the smoke checks below once each.
7. Close or roll back. Record the result in the window ticket.

## 7. Smoke checks after authorized activation

| Check | Expected result |
|---|---|
| `GET /` | 200 with Nuxt-rendered Flask-equivalent content |
| `GET /login` | 200 with Flask-equivalent login markup |
| Login/session behavior | Owner-approved account only; no credential values logged |
| Media delivery | `GET /media/:key` through `LANTERN_MEDIA_ORIGIN`; 200/206 with expected headers and no public media-worker endpoint |
| Verification alias | `GET /verify/:token` redirects or resolves per `docs/parity-route-map.json` |
| Production writes | remain disabled unless separately authorized |

Do not run repeated or bulk production media checks. Do not expose secrets.

## 8. Monitoring and rollback triggers

| Signal | Source | Trigger |
|---|---|---|
| Error rate | Worker observability | Sustained increase above agreed baseline |
| Auth failures | Smoke check / user reports | Any unexpected production login/session regression |
| Media failures | Single smoke check / user reports | Any failed or incorrect `/media/*` response |
| Data corruption | D1 audit / user reports | Any confirmed corruption triggers immediate rollback |

## 9. A1 rollback — requires separate authorization

1. **Announce rollback.** Stop the rollout, notify the channels from section 3, and open an incident record.
2. **Classify the rollback.** Record whether activation has completed.
3. **Restore the previous `lantern` version.** With the confirmed historic target:

   ```sh
   npx wrangler rollback 93be1fa1-8ac2-49c7-adf3-2682b3be8365 --name lantern
   ```

   Because A1 replaces the version on the same Worker, this restores the
   Flask Worker and its workers.dev hostname. It does not require DNS, route,
   or domain changes.
4. **Verify rollback.** Confirm the active `lantern` version and canonical
   hostname, then rerun approved read-only smoke checks.
5. **Keep `lantern-media` deployed but unreferenced.** Do not delete it during
   an urgent rollback. Do not invoke it publicly.
6. **Freeze Nuxt releases.** Do not retry cutover in the same window without a
   new decision.
7. **Decide on media state.** B5 is approved for the initial cutover, so no R2
   asset rollback is needed.
8. **Record the incident.** Capture timeline, signals, failed checks, active
   version before/after, and rollback result.

## 10. After cutover or rollback

- If cutover succeeded, close B1 only with deployment and smoke evidence. Do not mark B7 or G3 complete from cutover success.
- If rollback occurred, keep production writes disabled until a new signed window is approved.
- B5 remains in force until the owner separately approves a later media-origin change.
- A DNS/route rollback is not part of A1 and must not be invented.

## 11. Sign-off

No sign-off is recorded here. `docs/release-signoff.json` remains absent. G3
fails closed until real approvals are supplied. The required approval keys are
`applicationOwner`, `infraCloudflare`, `authSecurity`, and `releaseManager`,
matching `docs/release-signoff.template.json` and the gate validator; the role
names and responsibilities are listed in section 3.
