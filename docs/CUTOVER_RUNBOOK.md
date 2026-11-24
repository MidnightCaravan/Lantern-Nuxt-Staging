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
| G1 — Operational readiness | BLOCKED | B1 is prepared but not deployed or operationally verified |
| G2 — Release controls | BLOCKED | B7 A1 rollback rehearsal not executed |
| G3 — Explicit sign-off | PENDING | section 10 must contain real approvals |

## 2. Approved A1 architecture

- Nuxt is deployed as a new version of the existing Worker `lantern`.
- `workers_dev: true` preserves `https://lantern.midnightcaravans.workers.dev`.
- `preview_urls: false` prevents pre-cutover Version URL exposure.
- A private Python Worker `lantern-media` serves Flask `/media/*` behavior.
- `LANTERN_MEDIA_ORIGIN` binds `lantern` to `lantern-media`.
- The media Worker has only R2 `lantern-media` bound as `lantern_media`; no
  public endpoint, D1, secrets, routes, domains, or triggers.
- No DNS, custom domain, route, or `zone:edit` operation is part of A1.
- `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent.

## 3. Roles

| Role | Responsibility | Assignee |
|---|---|---|
| Application owner | Approves window, sign-off, and any production change | `[to be assigned]` |
| Infra / Cloudflare | Owns Worker deployments, bindings, and rollback evidence | `[to be assigned]` |
| Release manager | Runs the window, smoke tests, monitoring, and rollback decision | `[to be assigned]` |
| Verification owner | Independently confirms gate evidence | `[to be assigned]` |

## 4. Pre-cutover checklist

All items are read-only until sign-off is complete.

- [ ] Record the exact commit to be released. It must match `docs/release-signoff.json` when `npm run release:check` runs.
- [ ] CI on that commit is green; locally rerun `npm run verify`.
- [ ] Route coverage shows 48 reviewed routes and `gap=0`.
- [ ] B1 evidence recorded: `lantern-media` deployed with only production R2, then `lantern` deployed with `LANTERN_MEDIA_ORIGIN` and production D1/R2 `[evidence]`.
- [ ] B2 evidence recorded: production D1 schema inspection complete; no DDL required `[evidence]`.
- [ ] B3 verified parity recorded: signed-cookie sessions and durable rate limits match Flask `[evidence]`.
- [ ] B4 verified parity recorded: legacy `scrypt:` accounts are refused and routed to password reset, matching Flask `[evidence]`.
- [x] B5 approved 2026-11-24: Flask remains the temporary production media origin.
- [ ] B6 verified: `npm run release:check` reports all gates ready with a commit-matched sign-off `[evidence]`.
- [ ] B7 rehearsed: an A1-shaped Worker-version rollback was practiced without touching live production `[evidence]`.
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
`lantern-nuxt-rehearsal` and `lantern-media-rehearsal`; its bindings are
staging-only, `workers_dev: true`, and it declares no routes or domains. A
production-bound Worker must not be used for rehearsal.

## 6. Cutover sequence — requires separate authorization

1. Freeze unrelated releases and record pre-state with read-only commands.
2. Deploy `lantern-media` from the media release template.
3. Verify the private media Worker binding through metadata, not a public HTTP endpoint.
4. Deploy the Nuxt build from `wrangler.release.jsonc` as a new `lantern` version.
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
fails closed until real approvals are supplied.
