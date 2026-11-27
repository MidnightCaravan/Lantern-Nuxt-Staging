# Lantern cutover readiness report

**Status:** Phase A Nuxt production activation complete and G3 single-owner approval recorded for the pinned candidate; production writes remain disabled
**Scope:** approved A1 preparation; one-time 2026-11-27 Phase A activation evidence; local configuration, tests, documentation, and read-only Cloudflare deployment metadata audit
**Last documented:** 2026-11-27 owner-supplied Phase A evidence, owner-approved single-owner policy, and final owner G3 approval. The 2026-11-25 read-only Cloudflare audit remains historical. The final approval is documentation-only and authorizes no further production operation.
**Cutover runbook:** `docs/CUTOVER_RUNBOOK.md` (A1 staging Worker-version rollback technically passed under 2026-11-26 record 02; B7-T1 owner exception and B7-T2 Dashboard evidence recorded 2026-11-27; B7 closed by explicit owner acceptance)
**Production migration plan:** `docs/PRODUCTION_MIGRATION_PLAN.md` (read-only inspection complete; no migrations executed)
**Rehearsal records:** `docs/A1_STAGING_REHEARSAL_20261120.md` (November 20 staging evidence); `docs/REHEARSAL_RECORD.md` §11 and `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9 (November 26 record 02); `docs/REHEARSAL_RECORD.md` §12 and `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §12 (November 27 owner disposition and Dashboard evidence; §12.3 owner closure); `docs/REHEARSAL_RECORD.md` §10 (November 24 historical Worker-version rollback)
**A1 preparation record:** `docs/A1_PRODUCTION_CUTOVER_PREP_20261124.md`
**Release preparation:** `docs/RELEASE_READINESS_20261124.md`
**Targeted source audit:** `docs/PARITY_AUDIT_20261119.md` (confirmed gaps fixed; differences recorded)

## 1. Executive summary

The Flask → Nuxt migration has a green staging harness: all 48 inventoried Flask routes have an explicit disposition and behavior tests pass against in-memory D1/R2 doubles. Staging A1 also verified the media proxy, Range behavior, HEAD, headers, streaming, errors, and staging-preview authorization. This establishes **staging behavioral coverage**, not production readiness.

The owner approved A1:

- deploy Nuxt as a new version of the existing Worker `lantern`;
- retain `workers_dev: true` and `https://lantern.midnightcaravans.workers.dev`;
- use a private Flask Worker `lantern-media` as the `LANTERN_MEDIA_ORIGIN` Service Binding target;
- keep production writes disabled;
- preserve B5 (Flask remains the temporary media origin);
- require no DNS, custom domain, route, or `zone:edit` change.

The production media Worker `lantern-media` is deployed and its production R2 binding metadata was verified by read-only Cloudflare inspection. Its live privacy/trigger settings are documented from owner-supplied 2026-11-27 Dashboard screenshots, not from independent Wrangler verification of live UI settings. The A1 staging Worker-version rollback technically passed under 2026-11-26 record 02 and restored Version A at 100%. B7-T1 was accepted by the project owner on 2026-11-27 as a ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION for the single Version B staging activation only; the missing interactive confirmation must not be described as interactive and the exception does not waive future requirements or authorize production changes. B7-T2 now has fresh 2026-11-27 owner-supplied Cloudflare Dashboard evidence for live workers.dev and Preview URL settings, custom domains, routes, cron triggers, queue consumers, and email routing rules for both staging Workers; the fresh Wrangler binding metadata in record 02 §9.1 was already verified and was never missing. B7 is closed by explicit project-owner acceptance of that existing evidence in lieu of independent review; no independent human review was performed, and no reviewer identity, role, date/time, findings, signed conclusion, signature, or independent sign-off is recorded or invented. G2 passes on B7 closure only. The November 24 missed pre-execution record remains historical evidence, not the sole current blocker.

The owner separately authorized Phase A production activation, recorded from the owner-supplied 2026-11-27 execution report in §9. Nuxt candidate `de1a66c6-d26f-46af-988f-ecb6ba3c520d` is active on production `lantern` at 100%, with the prior Flask version retained as rollback target. B1 is closed and G1 passes on that bounded evidence. The owner subsequently recorded G3 single-owner approval for the pinned candidate in `docs/release-signoff.json`; G3 now passes. Production writes remain disabled, and this approval does not authorize further production operations.

## 2. Evidence summary

| Area | Evidence | Result |
|---|---|---|
| Route coverage | `npm run parity:routes`, `docs/parity-route-map.json` | 48 routes reviewed; `vendor=2`, `api=29`, `covered=11`, `alias=4`, `embedded=2`, `gap=0` |
| Staging behavior | `npm run verify` in staging A1 evidence | Historic A1 run: 29 test files / 253 tests, build green |
| Media semantics | `tests/media-origin-proxy.test.ts`, `tests/media-head-parity.test.ts`, `tests/media-range-parity.test.ts`, media Worker source comparison; owner-supplied Dashboard evidence; §9 | Staging behavior verified; production media Worker deployment/R2 binding metadata verified; live UI privacy/trigger settings documented from owner screenshots, not independently verified by Wrangler CLI; one media object fetched through the `lantern` Service Binding |
| Release shape | `tests/release-config.test.ts`, `tests/environment-configs.test.ts`, `tests/media-release-config.test.ts` | Focused local assertions added/updated for approved A1 |
| Release gate check | `npm run release:check`, `docs/release-gates.json`, `docs/release-signoff.json` | READY for the pinned Phase A candidate after owner approval; this gate evaluation does not deploy or enable production writes |
| Phase A activation | Owner-supplied 2026-11-27 execution report; §9 | One-time authorized Nuxt activation on production `lantern`; exact candidate/deployment and bounded smoke evidence recorded; no further production operation by this documentation task |

Covered behavior domains: login/registration/token flows, profile and work creation, work ownership/deletion, novel chapters, comic pages/episodes, discussions, publishing, public discovery/readers, video upload, media serving, thumbnails, and staging/production isolation.

## 3. A1 release architecture

| Property | Prepared value | Evidence |
|---|---|---|
| Nuxt Worker name | `lantern` | `wrangler.release.jsonc`, `tests/release-config.test.ts` |
| Public hostname | `https://lantern.midnightcaravans.workers.dev` | Inherent to `lantern` + `workers_dev: true`; no route/domain declared |
| `workers_dev` / `preview_urls` | `true` / `false` | `wrangler.release.jsonc`, focused tests |
| Media origin | `lantern-media` via `LANTERN_MEDIA_ORIGIN` | `wrangler.release.jsonc`, `wrangler.media-release.jsonc` |
| Media Worker endpoint | owner-supplied 2026-11-27 Dashboard screenshots show workers.dev OFF, Preview/Version URLs OFF, no custom domains/routes, and no Cron/Queue/Email triggers | Owner-supplied Dashboard evidence; `workers_dev: false`, `preview_urls: false`, and no routes/domains/triggers in `wrangler.media-release.jsonc`; Wrangler CLI did not independently verify live Dashboard-only settings |
| Production writes | disabled | `LANTERN_ENABLE_PRODUCTION_WRITES` intentionally absent from the candidate and active production version; no write path was tested |
| B5 media origin | Flask | Private `lantern-media` Worker uses the verbatim Flask media branch |

## 4. Blocker status

| Gate | Status | Required resolution |
|---|---|---|
| B1 | **Closed by owner-supplied Phase A evidence; G1 passes** | The one-time 2026-11-27 Phase A activation, candidate inspection, bounded smoke checks, retained rollback version, and write-disable boundary are recorded in §9. B1 closure does not create G3 sign-off, enable writes, or authorize further production work. |
| B7 | **Closed by explicit owner acceptance; G2 passes** | The 2026-11-26 `B7-STAGING-20261126-02` staging A1 Worker-version rehearsal passed technically and restored Version A at 100% (`docs/REHEARSAL_RECORD.md` §11; `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9). B7-T1 owner exception and B7-T2 fresh Dashboard evidence were recorded 2026-11-27 (both §12 records); the binding metadata was already verified and was never missing. The project owner explicitly accepted that evidence and closed B7 in lieu of independent review; no independent reviewer identity, date/time, findings, signed conclusion, signature, or independent sign-off is recorded or invented. The 2026-11-24 missed pre-execution record is historical evidence. DNS/route switching is not part of A1. |
| G3 | **Passed** | The owner sign-off is recorded in `docs/release-signoff.json`, bound to the pinned source commit, with the real owner name/date and both explicit risk acknowledgements. No independent human review is claimed. This approval does not enable production writes or authorize further production operations. |

## 5. Production data and media

- Production D1 was read-only inspected on 2026-11-24: all four migrations are recorded and no DDL was executed. The Time Travel bookmark `0000026a-00000002-00005130-3d4a1e61fb6b3b72c42e865aaa644439` was captured before the 2026-11-27 Phase A activation; Wrangler did not expose timestamp or database-version fields, and no restore was attempted.
- Production R2 `lantern-media` is the media Worker binding. Under Phase A, exactly one existing published object was fetched through `LANTERN_MEDIA_ORIGIN`; no direct R2 object read, list, write, or delete was performed and no public `lantern-media` hostname was used.
- `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent from the active version. No login POST, registration, account/content mutation, or write-path test was performed; page GET availability is not an authenticated login test.
- No media URL constant was changed. B5 remains preserved.

## 6. Gate summary

| Gate | Status | Detail |
|---|---|---|
| G0 — Staging behavioral parity | **PASS** | 48 routes dispositioned; A1 staging evidence recorded; Phase A worktree verification passed 48 test files / 532 tests and build |
| G1 — Operational readiness | **PASS** | Closed on the 2026-11-27 owner-supplied Phase A activation, binding, smoke, rollback-retention, and write-disable evidence in §9; owner-supplied Dashboard evidence covers live UI settings not verified by Wrangler CLI |
| G2 — Release controls | **PASS** | 2026-11-26 record 02 staging rehearsal technically passed; B7-T1 owner exception and B7-T2 Dashboard evidence recorded 2026-11-27; B7 closed by explicit project-owner acceptance in lieu of independent review; no independent sign-off is claimed; B6 is the `npm run release:check` gate |
| G3 — Explicit sign-off | **PASS** | Owner sign-off for the pinned Phase A candidate is recorded in `docs/release-signoff.json`; production writes remain disabled and further production operations require separate authorization. |

## 7. Required owner/release actions

1. Preserve the commit-matched owner sign-off in `docs/release-signoff.json`. Any new application/build candidate requires a new full sourceCommit pin and a fresh owner approval.
2. Keep production writes disabled. The write flag remains absent and no login POST, registration, content mutation, write-path test, D1 SQL/restore/migration, direct R2 operation, DNS/route/domain/trigger change, or `lantern-media` deployment is authorized by Phase A.
3. Retain Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` as the rollback target; any future rollback or other production operation requires a separate owner decision.
4. Run `npm run release:check` after genuine sign-off; the current expected blocker is G3/sign-off only.

The one-time Phase A activation does not grant final release approval or authority for further production work.

## 8. Dated B7 disposition addendum — 2026-11-27

This addendum updates only the current B7 status; it does not rewrite the
2026-11-26 rehearsal record or the 2026-11-25 readiness snapshot.

- **B7-T1:** the project owner accepted the Version B missing interactive
  confirmation as a ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION for Worker
  `lantern-nuxt-rehearsal`, window `B7-STAGING-20261126-02`, Version B deployment
  `3360865e-1ea7-4fdc-8961-b806a0917833`, and that single staging activation
  only. Decision date 2026-11-27 Asia/Jakarta; exact minute not preserved. It is
  not interactive confirmation, not a future waiver, and not production
  authorization.
- **B7-T2:** owner-supplied Cloudflare Dashboard screenshots from 2026-11-27 at
  02:35/02:38 for `lantern-nuxt-rehearsal` and 02:39/02:40 for
  `lantern-media-rehearsal` verify workers.dev and Preview / Version URL status,
  no custom domains or routes, no Cron triggers, no Queue consumers, and no
  Email routing rules. The `lantern-nuxt-rehearsal (production) fetch()` entry is
  the expected internal Service Binding invocation between rehearsal Workers;
  `Production` is only the selected environment within a rehearsal Worker. The
  2026-11-26 Wrangler binding metadata was already verified and was never
  missing.
- B7 was still open at the time of that disposition entry. The project owner
  subsequently accepted the existing evidence and closed B7 in lieu of
  independent review on 2026-11-27. `B7.closed=true`, `G2.pass=true`, and
  `G2.blockers=[]`; at that disposition point `G1.pass=false`,
  `G3.pass=false`, and `B1.closed=false` remained unchanged, while
  `sourceCommit=962cd95` remains unchanged. The later Phase A addendum in §9
  supersedes the current B1/G1 status. No independent human review was
  performed, and no reviewer identity, role, date/time, findings, signed
  conclusion, signature, or independent sign-off is recorded or invented. This
  owner acceptance does not authorize production work.

## 9. Dated Phase A production activation/evidence addendum — 2026-11-27

The B7 disposition addendum above remains a dated snapshot. This addendum records the owner-supplied 2026-11-27 Phase A execution report and the bounded evidence accompanying it. It does not claim that this documentation task performed the production operations, and it does not authorize further production work.

### Activation record from the owner-supplied report

The owner authorized a one-time Phase A exception solely for B1 evidence. Activation used interactive `npx wrangler versions deploy --name lantern`; the captured assertions were Worker `lantern`, the exact candidate version, exactly one selected version, and 100% traffic.

| Fact | Recorded value |
|---|---|
| Worker | `lantern` |
| Previous deployment | `472f489c-b597-44d8-87a6-f3b59b80adbb` |
| Previous active Flask version | `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100% |
| Activated candidate | `de1a66c6-d26f-46af-988f-ecb6ba3c520d`, version 53 |
| New active deployment | `053ded69-4ea0-478b-9f0f-aec14e091876` |
| Traffic | Candidate at 100% |
| Rollback target | Prior Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` retained; no automatic rollback occurred |

### Candidate inspection recorded before activation

- `ASSETS` asset binding.
- D1 `lantern_db` → production database `bf50e1be-81d7-4cd1-b082-8aa03a784860`.
- R2 `lantern_media` → bucket `lantern-media`.
- Service Binding `LANTERN_MEDIA_ORIGIN` → Worker `lantern-media`.
- `LANTERN_ANONYMOUS_WRITE_DATABASE=production` and `LANTERN_PUBLIC_READ_DATABASE=production`.
- Required secret names were present, including `LANTERN_NUXT_SESSION_SECRET`. No secret value, generated byte, or temporary secret-file detail is recorded here.
- `LANTERN_ENABLE_PRODUCTION_WRITES` was absent.
- No staging binding or staging Worker target was present in the candidate.

### Bounded one-time smoke evidence

| Check | Recorded result |
|---|---|
| `GET /` | 200 with Nuxt-rendered Lantern markup |
| `GET /login` | 200 with login form and password field; page GET only, not an authenticated login test |
| `GET /verify/invalid-smoke-token` | 200, an allowed legacy-alias status |
| `GET /media/uploads/covers/10/cover.png` via the `lantern` Service Binding | 200, `image/png`, `Content-Length: 2332318`, valid PNG signature |

Exactly one existing published media object was fetched through the `lantern` Service Binding. No public `lantern-media` hostname was used. Production writes remained disabled and the write flag was absent from the active version. No login POST, registration, account/content mutation, write-path test, D1 SQL, D1 restore/migration, direct R2 object operation, DNS/route/domain/trigger change, or `lantern-media` deployment was performed.

### Owner-supplied Dashboard and production metadata evidence

- An owner-supplied production `lantern` Trigger Events screenshot dated 2026-11-27 at approximately 13:11 showed no Cron triggers, Queue consumers, or Email routing rules.
- Owner-supplied production `lantern-media` Dashboard screenshots dated 2026-11-27 showed `workers.dev` OFF, Preview/Version URLs OFF, no custom domains or routes, and no Cron/Queue/Email triggers. These are owner-supplied Dashboard observations; Wrangler CLI did not independently verify these live UI-only settings.
- The owner-supplied report states that the production `lantern-media` deployment, version, and binding stayed unchanged.
- Production D1 Time Travel bookmark `0000026a-00000002-00005130-3d4a1e61fb6b3b72c42e865aaa644439` was captured before activation. Wrangler did not expose timestamp or database-version fields; no restore was attempted.

### Preflight and validation evidence

- `npm ci` was owner-authorized and completed in the isolated worktree.
- `npm run verify` passed: 48 routes with `gap=0`, 48 test files / 532 tests, and Nuxt build complete.
- `npm run release:check` was intentionally NOT READY during Phase A. After the gate updates recorded here, the expected remaining blocker is G3/sign-off only.
- The Phase A candidate was built/uploaded from worktree HEAD `f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`; `docs/release-gates.json` retains `sourceCommit=962cd95` as required.

### Gate effect and limits

`B1.closed=true`, `G1.pass=true`, and `G1.blockers=[]`. G2 and B7 remain closed/passing as previously recorded. G3 remains false because `docs/release-signoff.json` is absent; at the time this Phase A paragraph was recorded, the four genuine sign-off roles remained unapproved/unassigned. The later single-owner policy in §10 supersedes that four-role requirement, and the current single-owner `applicationOwner` approval remains pending. This one-time activation does not grant production-write authority, does not create final release approval, and does not authorize any further Cloudflare or production operation.

## 10. Dated single-owner release approval policy note — 2026-11-27

This later policy note supersedes earlier four-role policy language; the dated
B7 and Phase A evidence above is preserved as written. The project owner
approved a single-owner G3 model: `applicationOwner` is the sole approver and
accepts the combined application, infrastructure, security, and operational
decision. No independent human review is claimed. A genuine sign-off must also
state `noIndependentHumanReview: true` and
`acceptsInfrastructureAndSecurityRisk: true`, with a real owner name, valid ISO
date, and `approved: true`.

`docs/release-gates.json` now records `"approvalModel": "single-owner"` and
pins `"sourceCommit": "f62b0abada1ee5b3ba1b0397ae9bfead1245e9de"`, the Phase A
candidate built and uploaded from the isolated worktree. `npm run release:check`
uses that immutable pin, not the current `git HEAD`. The policy is recorded in
`docs/RELEASE_APPROVAL_POLICY.md`.

`docs/release-signoff.json` remains absent, the template remains unapproved
with both acknowledgements false, and `G3.pass=false`. Approval of this policy
is not final release approval. It does not enable production writes, make
`npm run deploy` executable, or authorize further production operations.


## 11. Dated final single-owner G3 approval addendum — 2026-11-27

The project owner, Christian Tarigan, explicitly approved the pinned Phase A
Nuxt production candidate on 2026-11-27. The named owner approval is recorded
in `docs/release-signoff.json`, bound to source commit
`f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`. The required acknowledgements are true: no independent human
review was performed, and the owner accepts responsibility for the combined
infrastructure and security risk. `G3.pass=true`; G0, G1, G2 and blockers B1–B7
remain passing/closed as recorded in `docs/release-gates.json`.

The approval does not enable production writes or authorize further production
operations. `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent,
`npm run deploy` remains fail-closed, and any future production change still
requires separate explicit owner authorization.
