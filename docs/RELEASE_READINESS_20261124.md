# Release readiness — A1 preparation, 2026-11-24

**Historical status (2026-11-24 preparation snapshot):** NOT READY. Preparation only.
**Approved architecture:** same-name A1 with a Flask media Worker.
**Current status pointer (2026-11-27):** Phase A Nuxt production activation complete under a one-time owner authorization; final release sign-off and write enablement remain blocked. See the dated Phase A addendum below.
**Scope note:** The opening statement describes the preparation actions in this record, not the full current production state. The production `lantern-media` deployment is documented in the dated status update below. The dated preparation sections do not document Nuxt production activation, production D1/R2 object mutation, secret provisioning, write enablement, DNS/route/domain change, or a production traffic switch; the later one-time Phase A activation is recorded in the addendum below. No commit, push, or merge was made by the preparation steps.

## Owner decisions recorded

- **A1:** approved. Deploy Nuxt as a new version of `lantern` and retain the
  workers.dev hostname `https://lantern.midnightcaravans.workers.dev`.
- **Media:** approved private `lantern-media` Worker using the verbatim Flask
  media implementation and bound only to production R2 `lantern-media`.
- **B5:** approved. Flask remains the temporary production media origin.
- **Production writes:** remain disabled. `LANTERN_ENABLE_PRODUCTION_WRITES`
  is intentionally absent.
- **DNS/routes/domains:** not used or required for A1. The earlier proposed
  `lantern-nuxt` name is superseded.

## Prepared release shape

| Property | Value | Source |
|---|---|---|
| Nuxt Worker | `lantern` | `wrangler.release.jsonc` |
| workers.dev | enabled | `wrangler.release.jsonc` |
| Version URLs | disabled | `preview_urls: false` |
| Media origin binding | `LANTERN_MEDIA_ORIGIN` → `lantern-media` | `wrangler.release.jsonc` |
| Media Worker | private `lantern-media`; R2-only | `wrangler.media-release.jsonc` |
| Media implementation | verbatim staging Flask media Worker | `lantern-media-release/src/media_worker.py` |
| D1 | production only in Nuxt Worker | `wrangler.release.jsonc` |
| Production write flag | absent | `wrangler.release.jsonc` |
| Routes/domains/triggers | none in either release config | release templates |

## Media behavior at the 2026-11-24 preparation point

The Nuxt media route forwards non-staging `/media/*` requests through
`LANTERN_MEDIA_ORIGIN` when that binding exists
(`server/routes/media/[...key].get.ts`). The intended private-media configuration uses the Service Binding, with
`workers_dev: false`, `preview_urls: false`, and no routes, domains, or
triggers declared in the release template. These declarations do not
independently establish the live production privacy/access settings, which
remain unverified.

Public media URLs remain unchanged under B5. The R2 binding in the Nuxt Worker
is preserved for B1; it does not independently change public URL behavior.

## Verification performed locally

Focused tests were added or updated for:

- release Worker name and workers.dev retention;
- preview URL suppression;
- media Service Binding target;
- production D1/R2 selectors and absence of the write flag;
- media Worker privacy, R2-only binding, and lack of D1/secrets/routes/domains/triggers;
- absence of staging identifiers in production templates;
- verbatim media Worker implementation;
- preserved Flask media proxy semantics in existing media tests.

Full verification results belong in the final preparation report after the
authorized verification commands are run. Passing local tests does not close
B1, B7, or G3.

## Backup and rollback

The approved A1 rollback is a Worker-version rollback on the same `lantern`
Worker:

```sh
npx wrangler rollback 93be1fa1-8ac2-49c7-adf3-2682b3be8365 --name lantern
```

No DNS or route revert applies. Under B5, no R2 snapshot or asset rollback is
planned. The rollback command has not been executed and requires separate
authorization.

## Remaining requirements

| Item | Status |
|---|---|
| Worker name `lantern` / workers.dev hostname | Resolved by owner A1 approval |
| B1 Nuxt production Service Binding activation and operational evidence | Required; not performed. Media Worker deployment/binding metadata is verified; live privacy/access settings still require independent verification. |
| B7 formal closure | At the 2026-11-24 snapshot: staging technical rollback passed; formal closure pending because the pre-execution incident/window-record precondition was not met. Later closed 2026-11-27 by explicit owner acceptance; see dated addendum below. |
| G3 commit-matched four-role sign-off | Required; `docs/release-signoff.json` absent |
| Secret sufficiency | Owner/release-manager verification required |
| Secrets values | Must never be generated, displayed, or stored by the agent |

## Final readiness at the 2026-11-24 preparation point

**NOT READY for launch.** The production media Worker deployment is recorded
below, but Nuxt has not been deployed to `lantern`, its production Service
Binding has not been activated, and no production runtime smoke test has been
performed. The staging technical rollback exercise passed; at the time of this
2026-11-24 snapshot, formal B7 closure was pending the missing pre-execution
incident/window record. The later owner closure is recorded in the dated addendum
below. Secret provisioning and commit-matched sign-off remain outstanding.
Separate explicit authorization is required for every production action.

## Dated status update — 2026-11-25

This section records the current B1 production media readiness status after the
read-only Cloudflare audit. The report above remains the historical record of
what was prepared and known on 2026-11-24. No production deploy, secret
operation, write enablement, DNS/route/domain change, database change, R2
object access, or production HTTP request was performed for this update.

### Stage A — production media Worker deployment and binding metadata verified; live privacy posture unverified

Cloudflare read-only metadata confirms the production media Worker deployment
and its R2 binding shape. This does not independently verify the live public-
access/privacy settings:

| Fact | Verified value |
|---|---|
| Evidence source | 2026-11-25 read-only `npx wrangler deployments list --name lantern-media --json`, `npx wrangler versions view 0b49a4af-8ad8-447d-b29b-2358ebe2e3af --name lantern-media --json`, and `npx wrangler secret list --name lantern-media` |
| Worker | `lantern-media` |
| Version | `0b49a4af-8ad8-447d-b29b-2358ebe2e3af` |
| Deployment ID | `179c3f11-c97b-4ab0-bfa0-007225156ac9` |
| Cloudflare `created_on` | `2026-11-24T11:48:36.941204Z` |
| Active traffic | 100% |
| Only binding | `lantern_media` → production R2 bucket `lantern-media` |
| D1 binding | None |
| Secrets | None; secret-name inventory returned `[]` |
| Implementation SHA-256 | `c422792e97527bb298a885f9ad38a75fd5237047733c14aee3257ae5b27c86d6` |

The implementation hash was verified locally by `shasum -a 256` and `cmp`
against `lantern-media-rehearsal/src/media_worker.py`; the production packaging
copy and the staging rehearsal copy are byte-identical.

Deployment provenance is recorded accurately: the operator's deployment record
describes the PyWrangler deployment from `lantern-media-release`. Cloudflare
version metadata reports `last_deployed_from: wrangler`. That generic metadata
field is not proof of a direct Wrangler command, and no missing provenance is
invented here.

Live public-endpoint privacy settings were not independently verified in the
read-only audit. Both release templates declare `workers_dev: false` and
`preview_urls: false`, but a template is not proof of live settings. No public
media endpoint was invoked.

### Corrected B1 definition

The earlier shorthand that B1 meant "production R2 binding not deployed" is
misleading. The production media Worker and production R2 binding are already
deployed. Under the approved A1 architecture, B1 has three distinct stages:

- **A. Media Worker deployment and binding metadata — DEPLOYED / VERIFIED.**
  `lantern-media` is deployed and bound to production R2 `lantern-media`, as
  verified by Cloudflare version metadata. Its live public-access/privacy
  settings remain independently unverified.
- **B. Nuxt production Service Binding declaration — PREPARED ONLY.**
  `wrangler.release.jsonc` declares `LANTERN_MEDIA_ORIGIN` → `lantern-media`.
  This is configuration only; it is not an active production binding.
- **C. Nuxt production activation and runtime verification — OUTSTANDING.**
  Nuxt has not been deployed to production `lantern`. The active production
  Worker remains the Flask version
  `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100%, its active version does not
  contain `LANTERN_MEDIA_ORIGIN`, and no approved production Nuxt media smoke
  request has been performed.

Therefore **B1 remains OPEN**, and the gate title is now
`A1 Nuxt production media Service Binding activation and runtime verification`.
G1 remains false because stage C and its operational evidence are outstanding.
At the 2026-11-25 status snapshot, B7 remained formally open and G2 remained
blocked because the pre-execution incident/window-record precondition had not
been met during the staging rehearsal; see `docs/REHEARSAL_RECORD.md` §10.6. The
later owner closure is recorded below. The technical rollback success does not
authorize production activation.

### Outstanding prerequisites

- Production secret `LANTERN_NUXT_SESSION_SECRET` was not found in the
  production secret-name inventory. It is a separate pre-deployment
  requirement, not part of the media Worker deployment. Its value must never be
  requested, printed, or stored in documentation. Provisioning was not
  authorized and has not happened.
- Production `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent and must stay
  absent during initial cutover.
- The live privacy settings of `lantern-media` still require independent
  verification.
- The original Flask Worker must remain available as the production rollback
  candidate.
- No production Nuxt deployment or runtime smoke test has occurred.
- G3 remains false because `docs/release-signoff.json` is absent and no
  commit-matched four-role sign-off exists.

**2026-11-25 snapshot readiness: NOT READY for launch.** The production media Worker
deployment and R2 binding metadata have moved from prepared to verified; its
live privacy/access settings remain unverified. Nuxt production Service Binding
activation and runtime proof remain required before B1 can close.

## Dated status addendum — 2026-11-26

The 2026-11-24 preparation snapshot and the 2026-11-25 status update above remain
historical statements and are not rewritten here. This addendum records the
later B7 staging result and current disposition only.

Under `B7-STAGING-20261126-02` (approved 2026-11-26 15:10–18:10 Asia/Jakarta),
the staging Worker `lantern-nuxt-rehearsal` technically completed an A1
Worker-version rehearsal. Version A `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad` and
Version B `34625007-ff3d-4809-9e6e-95ad80e27def` each passed 9/9 application
smoke checks and 3/3 strict media fixtures at A baseline, B, and after restore.
Version B was deployed as `3360865e-1ea7-4fdc-8961-b806a0917833`; exact Version
A was restored as `606250b3-72ca-4c5d-be6c-96b7b5f3cb53` and confirmed at 100%.
Evidence is in `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9 and
`docs/REHEARSAL_RECORD.md` §11. According to the execution record, no production
Worker, D1 database, R2 object, secret, route, domain, DNS record, or traffic
setting was changed.

At the time of this 2026-11-26 addendum, B7 remained formally open. B7-T1 was a
confirmed procedural deviation: the Version B activation used a fully specified
Wrangler command with no confirmation prompt, and an explicit owner decision was
pending. B7-T2 was unable to verify from the published evidence at that point:
fresh same-day read-only proof for both staging Workers' live workers.dev and
Preview URL settings, custom domains, routes, cron triggers, queue consumers,
and email routing rules was absent, or an explicit owner disposition had to be
recorded. The fresh Wrangler binding metadata in record 02 §9.1 (staging D1/R2
identifiers, `LANTERN_MEDIA_ORIGIN` target, and media Worker staging R2 binding)
was verified and was not part of that finding; the dashboard settings carried
forward from 2026-11-25 remained historical. Independent review and explicit
owner closure approval had not yet been recorded at that point. This historical
addendum did not change `B7.closed`, `G2.pass`, or any other release gate, and
did not authorize production deployment or cutover. The later owner closure is
recorded in the 2026-11-27 addendum below.

## Dated status addendum — 2026-11-27

The 2026-11-26 addendum remains a dated snapshot. This addendum records the
later B7 disposition and the explicit owner closure; it does not authorize any
production action.

- **B7-T1:** the project owner accepted the Version B activation's missing
  interactive confirmation as a ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION for
  Worker `lantern-nuxt-rehearsal`, window `B7-STAGING-20261126-02`, Version B
  deployment `3360865e-1ea7-4fdc-8961-b806a0917833`, and that single staging
  activation only. Decision date 2026-11-27 Asia/Jakarta; exact minute not
  preserved. Do not describe the activation as interactive; the exception does
  not waive future confirmation and does not authorize production changes.
- **B7-T2:** fresh owner-supplied Cloudflare Dashboard screenshots from
  2026-11-27 at 02:35/02:38 for `lantern-nuxt-rehearsal` and 02:39/02:40 for
  `lantern-media-rehearsal` verify workers.dev and Preview / Version URL status,
  no custom domains or routes, no Cron triggers, no Queue consumers, and no
  Email routing rules. The `lantern-nuxt-rehearsal (production) fetch()` entry is
  the expected internal Service Binding invocation between rehearsal Workers;
  `Production` is the selected environment within a rehearsal Worker, not the
  production application Worker. The 2026-11-26 Wrangler binding metadata was
  already verified and was never missing.
- B7 was still open at the time of that disposition entry. The project owner
  subsequently accepted the existing evidence and closed B7 in lieu of
  independent review on 2026-11-27. `B7.closed=true`, `G2.pass=true`, and
  `G2.blockers=[]`; at that disposition point `G1.pass=false`, `G3.pass=false`,
  and `B1.closed=false` remained unchanged, while `sourceCommit=962cd95`
  remains unchanged. The later Phase A addendum below supersedes the current
  readiness state. No independent human review was
  performed, and no reviewer identity, role, date/time, findings, signed
  conclusion, signature, or independent sign-off is recorded or invented. This
  owner acceptance does not authorize production deployment, activation,
  rollback, secret change, write enablement, traffic change, or cutover.

## Dated status addendum — 2026-11-27 Phase A production activation

The 2026-11-24 and 2026-11-25 snapshots and the earlier 2026-11-27 B7 addendum
remain historical statements. This addendum records the owner-supplied
2026-11-27 Phase A execution report. It is a one-time owner exception solely
for B1 evidence; it does not create final release approval or write authority and
does not authorize further production operations.

**Current readiness:** Phase A Nuxt production activation is complete; final
G3 release sign-off and production write enablement remain blocked.

- **Activation:** interactive `npx wrangler versions deploy --name lantern` with captured assertions of Worker `lantern`, exact candidate `de1a66c6-d26f-46af-988f-ecb6ba3c520d` (version 53), one selected version, and 100% traffic.
- **Before/after:** deployment `472f489c-b597-44d8-87a6-f3b59b80adbb` had Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100%. Activation created deployment `053ded69-4ea0-478b-9f0f-aec14e091876` with the candidate at 100%. The prior Flask version remains the retained rollback target; no automatic rollback occurred.
- **Candidate shape:** `ASSETS`; D1 `lantern_db` → `bf50e1be-81d7-4cd1-b082-8aa03a784860`; R2 `lantern_media` → `lantern-media`; `LANTERN_MEDIA_ORIGIN` → `lantern-media`; `LANTERN_ANONYMOUS_WRITE_DATABASE=production`; `LANTERN_PUBLIC_READ_DATABASE=production`; required secret names present including `LANTERN_NUXT_SESSION_SECRET`; `LANTERN_ENABLE_PRODUCTION_WRITES` absent; no staging bindings or Worker targets. Secret values, generated bytes, and temporary secret-file details are not recorded.
- **Bounded smoke evidence:** `GET /` 200 Nuxt-rendered Lantern markup; `GET /login` 200 form/password field as a page GET only, not an authenticated login test; `GET /verify/invalid-smoke-token` 200 allowed legacy-alias status; `GET /media/uploads/covers/10/cover.png` via the `lantern` Service Binding 200 `image/png`, `Content-Length: 2332318`, valid PNG signature. Exactly one existing published media object was fetched through the Service Binding and no public `lantern-media` hostname was used.
- **Boundary:** no login POST, registration, account/content mutation, write-path test, D1 SQL/restore/migration, direct R2 object operation, DNS/route/domain/trigger change, or `lantern-media` deployment was performed. The write flag remained absent from the active version.
- **Owner-supplied Dashboard evidence:** `lantern` Trigger Events screenshot dated 2026-11-27 approximately 13:11 showed no Cron/Queue/Email triggers. `lantern-media` Dashboard screenshots dated 2026-11-27 showed `workers.dev` OFF, Preview/Version URLs OFF, no custom domains/routes, and no triggers. These are owner-supplied Dashboard observations; Wrangler CLI did not independently verify live UI-only settings. The report states `lantern-media` deployment, version, and binding stayed unchanged.
- **Production data evidence:** Time Travel bookmark `0000026a-00000002-00005130-3d4a1e61fb6b3b72c42e865aaa644439` was captured before activation; Wrangler did not expose timestamp/database-version fields and no restore was attempted.
- **Supporting verification:** owner-authorized `npm ci` and `npm run verify` passed in the isolated worktree: 48 routes with `gap=0`, 48 test files / 532 tests, and build complete. The candidate was built/uploaded from worktree HEAD `f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`; `sourceCommit` remains `962cd95`.
- **Gate effect:** `B1.closed=true`, `G1.pass=true`, `G1.blockers=[]`; G2/B7 remain as previously recorded; `G3.pass=false` with `docs/release-signoff.json` absent and the four genuine roles unapproved/unassigned. Phase A activation is not final release approval and does not enable production writes.
