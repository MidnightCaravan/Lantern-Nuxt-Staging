# Lantern cutover and rollback runbook

**Status:** A1 preparation plus the one-time 2026-11-27 Phase A activation record — NOT general execution authorization; G3 sign-off and write enablement remain blocked
**Related:** `docs/CUTOVER_READINESS.md`, `docs/A1_PRODUCTION_CUTOVER_PREP_20261124.md`, `docs/PARITY_HARNESS.md`, `docs/parity-route-map.json`, `docs/A1_STAGING_REHEARSAL_20261120.md`, `docs/RELEASE_READINESS_20261124.md`, `docs/RELEASE_APPROVAL_POLICY.md`

This runbook records the approved A1 shape and the checks required before and
after a separately authorized production window. The 2026-11-27 Phase A
activation was a one-time owner exception recorded in §12; it is not a general
deployment authorization and does **not** override `AGENTS.md`. Future production
database, binding, route, Worker, secret, or traffic changes remain prohibited
without separate owner authorization, and final release sign-off remains pending.

## 1. Gate status

| Gate | Status | Detail |
|---|---|---|
| G0 — Staging behavioral parity | PASS | 48 routes dispositioned; staging A1 evidence recorded |
| G1 — Operational readiness | PASS | Closed on the 2026-11-27 owner-supplied Phase A activation, binding, bounded smoke, rollback-retention, and write-disable evidence in §12; live UI privacy/trigger settings are owner-supplied Dashboard evidence, not independently verified by Wrangler CLI |
| G2 — Release controls | PASS | The 2026-11-26 record 02 staging Worker-version rehearsal technically passed; B7-T1 owner exception and B7-T2 Dashboard evidence recorded 2026-11-27; B7 closed by explicit project-owner acceptance in lieu of independent review; no independent sign-off is claimed |
| G3 — Explicit sign-off | PENDING | `docs/release-signoff.json` remains absent; section 11 requires a real single-owner approval from `applicationOwner` only, bound to the pinned release commit. Phase A activation is not final release approval. |

## 2. Approved A1 architecture

- Nuxt is deployed as a new version of the existing Worker `lantern`.
- `workers_dev: true` preserves `https://lantern.midnightcaravans.workers.dev`.
- `preview_urls: false` prevents pre-cutover Version URL exposure.
- The private Python Worker `lantern-media` serves Flask `/media/*` behavior. Owner-supplied 2026-11-27 Dashboard screenshots show it private; Wrangler CLI did not independently verify live UI-only settings.
- `LANTERN_MEDIA_ORIGIN` binds `lantern` to `lantern-media`; the binding was present in the activated candidate and exercised once through the `lantern` Service Binding.
- The media Worker release template declares only R2 `lantern-media` bound
  as `lantern_media`, with no D1, secrets, routes, domains, or triggers. The
  owner-supplied report states its deployed version and binding stayed unchanged.
- No DNS, custom domain, route, or `zone:edit` operation is part of A1.
- `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent.

## 3. Current approval role

| Role | Sign-off key | Responsibility | Assignee |
|---|---|---|---|
| Application owner | `applicationOwner` | Sole approver for the combined application, infrastructure, security, and operational decision | `[to be assigned]` |

Under the owner-approved 2026-11-27 single-owner policy, no independent human
review is claimed. The former `infraCloudflare`, `authSecurity`, and
`releaseManager` roles are not accepted by the validator. See
`docs/RELEASE_APPROVAL_POLICY.md`.

## 4. Pre-cutover checklist

This checklist records preparation requirements. The 2026-11-27 Phase A
activation was a one-time owner exception documented in §12; future production
work remains read-only until genuine sign-off and separate authorization.

- [x] Record the exact candidate commit. Phase A candidate HEAD was `f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`; `docs/release-gates.json` now pins that full SHA as `sourceCommit`, replacing the earlier `962cd95` value. A commit-matched single-owner sign-off is still required.
- [x] CI on that candidate is green: owner-authorized `npm ci` and `npm run verify` passed in the isolated worktree, including Nuxt build complete.
- [x] Route coverage shows 48 reviewed routes and `gap=0`.
- [x] B1 evidence recorded from the owner-supplied 2026-11-27 Phase A report: candidate bindings, bounded smoke checks, retained rollback version, and write-disable boundary are in §12. Owner-supplied Dashboard evidence covers UI-only privacy/trigger settings not independently verified by Wrangler CLI.
- [x] B2 evidence recorded: production D1 schema inspection complete; no DDL required `[evidence]`.
- [x] B3 verified parity recorded: signed-cookie sessions and durable rate limits match Flask `[evidence]`.
- [x] B4 verified parity recorded: legacy `scrypt:` accounts are refused and routed to password reset, matching Flask `[evidence]`.
- [x] B5 approved 2026-11-24: Flask remains the temporary production media origin.
- [ ] B6 verified: `npm run release:check` reports all gates ready with a genuine single-owner commit-matched sign-off `[evidence]`. Currently blocked only by G3/sign-off.
- [x] B7 formally closed by explicit project-owner acceptance: the 2026-11-26
  `B7-STAGING-20261126-02` staging Worker-version rehearsal technically passed
  and restored Version A at 100% (see `docs/REHEARSAL_RECORD.md` §11 and
  `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9). The B7-T1 owner
  accepted a ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION, and B7-T2 fresh Dashboard
  evidence was recorded 2026-11-27 (both §12 records in `docs/CUTOVER_READINESS.md`); the verified binding
  metadata in record 02 §9.1 was already verified and was never missing. The
  project owner accepted that evidence and closed B7 in lieu of independent
  review on 2026-11-27 (record 02 §12.3). No independent human review was
  performed, and no reviewer identity, role, date/time, findings, signed
  conclusion, signature, or independent sign-off is recorded or invented. G2
  passes; B7 closure did not itself authorize production work, and §12 records
  the later one-time Phase A exception `[evidence]`.
- [x] Recorded the live `lantern` version immediately before deployment: deployment `472f489c-b597-44d8-87a6-f3b59b80adbb` with Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100%; that version remains the intended rollback target.
- [x] Recorded D1 Time Travel bookmark `0000026a-00000002-00005130-3d4a1e61fb6b3b72c42e865aaa644439`; Wrangler exposed no timestamp/database-version fields and no restore was attempted under B5 `[decision]`.
- [x] Confirmed required secret names existed in the candidate, including `LANTERN_NUXT_SESSION_SECRET`; no value, generated byte, or temporary secret-file detail is recorded.
- [x] Confirmed `preview_urls: false` in the release template and `LANTERN_ENABLE_PRODUCTION_WRITES` absent from the active candidate; production writes stayed disabled.

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
`LANTERN_MEDIA_ORIGIN` target, and the media Worker's staging R2 binding; that
binding evidence was never missing. The 2026-11-25 owner-observed dashboard
inventory is historical evidence only. Fresh owner-supplied Cloudflare Dashboard
screenshots from 2026-11-27 at 02:35/02:38 for `lantern-nuxt-rehearsal` and
02:39/02:40 for `lantern-media-rehearsal` record workers.dev and Preview / Version
URL settings, no custom domains or routes, no Cron triggers, no Queue consumers,
and no Email routing rules. The `lantern-nuxt-rehearsal (production) fetch()`
entry is the expected internal Service Binding invocation between rehearsal
Workers, not a public endpoint or trigger; the Dashboard's `Production` label is
the selected environment within the named rehearsal Worker and does not make it
the production application Worker. A production-bound Worker must not be used for
rehearsal. The A1 staging Worker-version activation and exact Version A
restoration was technically completed under `B7-STAGING-20261126-02` on
2026-11-26; see `docs/REHEARSAL_RECORD.md` §11 and
`docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9. The 2026-11-24 exercise in
`docs/REHEARSAL_RECORD.md` §10 is retained as historical evidence. B7-T1 owner
exception and B7-T2 Dashboard evidence were recorded 2026-11-27; the project
owner then closed B7 by explicit acceptance of that evidence in lieu of
independent review (record 02 §12.3). No independent sign-off is claimed. A1 does
not require a DNS/route flip or revert.

## 6. Cutover sequence — requires separate authorization

This sequence remains the rule for future windows. The one-time Phase A
execution was recorded after the fact from the owner-supplied 2026-11-27 report
in §12; it does not make this section an authorization by itself.

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
| `GET /` | 200 with Nuxt-rendered Lantern markup |
| `GET /login` | 200 with login form and password field; this is page availability, not an authenticated login test |
| Login/session behavior | Phase A performed no login POST, registration, credential test, or session write. Any account-path test requires separate authorization; no credential value is logged |
| Media delivery | Phase A fetched exactly one existing published object through `LANTERN_MEDIA_ORIGIN` via the `lantern` Service Binding; 200, `image/png`, `Content-Length: 2332318`, valid PNG signature, no public media-worker endpoint |
| Verification alias | `GET /verify/invalid-smoke-token` returned 200 as an allowed legacy-alias status; `docs/parity-route-map.json` remains the alias reference |
| Production writes | remained disabled; `LANTERN_ENABLE_PRODUCTION_WRITES` absent from the active version |

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

- The 2026-11-27 Phase A cutover succeeded under a one-time owner exception and B1 was closed with deployment and bounded smoke evidence recorded in §12. Do not mark G3 complete from cutover success.
- If rollback occurred, keep production writes disabled until a new signed window is approved.
- B5 remains in force until the owner separately approves a later media-origin change.
- A DNS/route rollback is not part of A1 and must not be invented.

## 11. Sign-off

No sign-off is recorded here. `docs/release-signoff.json` remains absent. G3
fails closed until a real single-owner approval is supplied. The only accepted
role key is `applicationOwner`, with `approved: true`, a real owner name, a
valid ISO `YYYY-MM-DD` date, `noIndependentHumanReview: true`, and
`acceptsInfrastructureAndSecurityRisk: true`. The sign-off must use the pinned
`sourceCommit` from `docs/release-gates.json`. This matches
`docs/release-signoff.template.json`, `docs/RELEASE_APPROVAL_POLICY.md`, and the
gate validator; no approval is invented.

## 12. Dated Phase A production activation addendum — 2026-11-27

This addendum records the owner-supplied 2026-11-27 Phase A execution report. It is a historical execution record and a one-time exception to the normal “all gates first” sequence solely for B1 evidence. It does not create G3 sign-off, enable writes, or authorize further production work.

- Activation used interactive `npx wrangler versions deploy --name lantern`; captured assertions were Worker `lantern`, exact candidate `de1a66c6-d26f-46af-988f-ecb6ba3c520d` (version 53), exactly one selected version, and 100% traffic.
- Before activation: deployment `472f489c-b597-44d8-87a6-f3b59b80adbb` with Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100%.
- After activation: deployment `053ded69-4ea0-478b-9f0f-aec14e091876` with the candidate at 100%. The prior Flask version remains the retained rollback target; no automatic rollback occurred.
- Candidate inspection recorded `ASSETS`, D1 `lantern_db` → `bf50e1be-81d7-4cd1-b082-8aa03a784860`, R2 `lantern_media` → `lantern-media`, `LANTERN_MEDIA_ORIGIN` → `lantern-media`, both database selector variables set to `production`, required secret names present including `LANTERN_NUXT_SESSION_SECRET`, `LANTERN_ENABLE_PRODUCTION_WRITES` absent, and no staging bindings or Worker targets. No secret value, generated byte, or temporary secret-file detail is recorded.
- One-time smoke evidence: `GET /` 200 Nuxt-rendered Lantern markup; `GET /login` 200 form and password field as a page GET only; `GET /verify/invalid-smoke-token` 200 allowed legacy-alias status; `GET /media/uploads/covers/10/cover.png` via the `lantern` Service Binding 200 `image/png`, `Content-Length: 2332318`, valid PNG signature. Exactly one published media object was fetched through the Service Binding; no public `lantern-media` hostname was used.
- No login POST, registration, account/content mutation, write-path test, D1 SQL/restore/migration, direct R2 object operation, DNS/route/domain/trigger change, or `lantern-media` deployment was performed. The write flag remained absent.
- Owner-supplied production `lantern` Trigger Events screenshot dated 2026-11-27 approximately 13:11 showed no Cron/Queue/Email triggers. Owner-supplied production `lantern-media` Dashboard screenshots dated 2026-11-27 showed `workers.dev` OFF, Preview/Version URLs OFF, no custom domains/routes, and no triggers; Wrangler CLI did not independently verify these live UI-only settings. The report states `lantern-media` deployment, version, and binding stayed unchanged.
- D1 Time Travel bookmark `0000026a-00000002-00005130-3d4a1e61fb6b3b72c42e865aaa644439` was captured before activation; Wrangler exposed no timestamp/database-version fields and no restore was attempted.
- Owner-authorized `npm ci` and `npm run verify` passed in the isolated worktree before activation: 48 routes with `gap=0`, 48 test files / 532 tests, and Nuxt build complete. The candidate was built/uploaded from worktree HEAD `f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`; `sourceCommit` remains `962cd95`.
- Resulting gate record: `B1.closed=true`, `G1.pass=true`, `G1.blockers=[]`, G2/B7 unchanged, and `G3.pass=false` with sign-off still absent. G3 and write enablement remain blocked.

## 13. Dated single-owner release approval policy note — 2026-11-27

This later policy note supersedes the earlier four-role sign-off instructions;
the Phase A execution addendum above remains a dated historical record. The
owner approved `applicationOwner` as the sole human approver for the combined
application, infrastructure, security, and operational decision. No independent
human review is claimed. A genuine sign-off must contain only that role,
`approved: true`, a real owner name, a valid ISO `YYYY-MM-DD` date,
`noIndependentHumanReview: true`, and
`acceptsInfrastructureAndSecurityRisk: true`.

`docs/release-gates.json` pins `"approvalModel": "single-owner"` and
`"sourceCommit": "f62b0abada1ee5b3ba1b0397ae9bfead1245e9de"`.
`npm run release:check` evaluates that immutable candidate SHA and must not use
the current `git HEAD`. `docs/release-signoff.json` remains absent, the template
remains unapproved with both acknowledgements false, and `G3.pass=false`.
Approval of this policy is not final release approval and does not enable
production writes, make `npm run deploy` executable, or authorize further
production operations.
