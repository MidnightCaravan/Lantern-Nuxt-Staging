# A1 production cutover preparation — 2026-11-24

**Historical preparation status (2026-11-24): APPROVED ARCHITECTURE; PREPARATION ONLY. NOT READY OR AUTHORIZED TO DEPLOY.**
**Current status pointer (2026-11-27):** Phase A Nuxt production activation complete under a one-time owner authorization; final release sign-off and write enablement remain blocked. G3 now uses the owner-approved single-owner policy; see the dated policy note below.
This opening note describes the scope of the preparation steps in this record,
not the complete production state. The separately deployed production media
Worker is documented in the dated status update below. The dated preparation
sections do not document a Nuxt production activation, production secret change,
D1/R2 object mutation, route/domain/DNS change, or production traffic switch;
the later one-time Phase A activation is recorded in the addendum below.

## Owner-approved A1 decision

The project owner approved same-name A1 cutover:

1. Deploy the Nuxt build as a new version of the existing Worker `lantern`.
2. Keep `workers_dev: true` so the canonical public hostname remains
   `https://lantern.midnightcaravans.workers.dev`.
3. Deploy a separate, private Flask media Worker named `lantern-media`.
4. Bind `/media/*` through `LANTERN_MEDIA_ORIGIN` from `lantern` to
   `lantern-media`.
5. Keep `LANTERN_ENABLE_PRODUCTION_WRITES` absent.
6. B5 remains approved: Flask is the temporary production media origin.
7. Do not add DNS, custom domains, routes, or `zone:edit` requirements.

The previously proposed name `lantern-nuxt` is superseded. No new public
hostname is introduced.

## Prepared files

| File | Purpose |
|---|---|
| `wrangler.release.jsonc` | Production Nuxt Worker `lantern`; production D1/R2, A1 Service Binding, `workers_dev: true`, `preview_urls: false`, no production-write flag. |
| `wrangler.media-release.jsonc` | Private media Worker `lantern-media`; only R2 `lantern-media` as `lantern_media`; no D1, secrets, routes, domains, triggers, public endpoint, or Version URLs. |
| `lantern-media-release/src/media_worker.py` | Verbatim copy of the verified media-only Flask implementation from `lantern-media-rehearsal/src/media_worker.py`. |
| `tests/media-release-config.test.ts` | Focused A1 release-shape, isolation, binding, and verbatim-source assertions. |
| `tests/release-config.test.ts` | Updated release Worker name, workers.dev retention, media Service Binding, and staging-leak assertions. |
| `tests/environment-configs.test.ts` | Updated production/rehearsal separation and release-config wiring tests. |

## Binding shape

```jsonc
// wrangler.release.jsonc
"name": "lantern",
"workers_dev": true,
"preview_urls": false,
"services": [
  { "binding": "LANTERN_MEDIA_ORIGIN", "service": "lantern-media" }
]
```

```jsonc
// wrangler.media-release.jsonc
"name": "lantern-media",
"workers_dev": false,
"preview_urls": false,
"r2_buckets": [
  { "binding": "lantern_media", "bucket_name": "lantern-media", "remote": true }
]
```

## Historical deployment order — 2026-11-24 preparation

The sequence below records the original preparation plan. The production
`lantern-media` deployment has since been completed and its binding metadata
verified, as recorded in the dated status update below. For the current
execution sequence, use `docs/CUTOVER_RUNBOOK.md` §6; do not redeploy
`lantern-media` merely because it appears in this historical plan.

1. Deploy the private media Worker from `wrangler.media-release.jsonc` and
   verify the binding without invoking a public endpoint.
2. Deploy the Nuxt build from `wrangler.release.jsonc` as a new `lantern`
   version. This replaces the active Flask version at the same workers.dev
   hostname.
3. Run the approved read-only smoke checks once.
4. If rollback is needed, use the exact recorded Flask version:

   ```sh
   npx wrangler rollback 93be1fa1-8ac2-49c7-adf3-2682b3be8365 --name lantern
   ```

No command in the 2026-11-24 preparation steps was executed as part of
that preparation. The later production `lantern-media` deployment is recorded
in the dated status update below.

## Gates that remained open at the 2026-11-24 preparation point

- B1 is **not closed**: the production `lantern-media` deployment and R2 binding metadata are verified, but live privacy/access settings remain unverified and Nuxt `LANTERN_MEDIA_ORIGIN` activation/runtime proof are outstanding.
- B7 was **formally open at the 2026-11-24 preparation point**: the 2026-11-24 staging A1 Worker-version rollback technically passed, but the pre-execution incident/window-record precondition was not met; see `docs/REHEARSAL_RECORD.md` §10.6. Later closure is recorded in the dated addenda below.
- G3 is **not closed**: no `docs/release-signoff.json` was created.
- Production writes remain disabled by omission of the write flag.
- Secret sufficiency remains to be verified by the owner/release manager.

The A1 staging evidence remains historic evidence from
`docs/A1_STAGING_REHEARSAL_20261120.md`; it is not production cutover evidence.

## Dated status update — 2026-11-25

The preparation record above remains the 2026-11-24 historical statement. This
update records the current deployment state from the read-only Cloudflare audit
and local documentation/configuration review. It does not authorize deployment,
secret provisioning, write enablement, or cutover.

### A1 stage state at the 2026-11-25 snapshot

- **A. Production media Worker deployment and binding metadata — DEPLOYED / VERIFIED; live privacy settings UNVERIFIED.** Cloudflare
  read-only `deployments list`, `versions view`, and `secret list` for
  `lantern-media` showed version
  `0b49a4af-8ad8-447d-b29b-2358ebe2e3af`, deployment
  `179c3f11-c97b-4ab0-bfa0-007225156ac9`, created
  `2026-11-24T11:48:36.941204Z`, at 100% traffic. Its only binding is
  `lantern_media` → production R2 bucket `lantern-media`; it has no D1 binding
  and no secrets. The local implementation SHA-256 is
  `c422792e97527bb298a885f9ad38a75fd5237047733c14aee3257ae5b27c86d6`, matching
  the staging rehearsal copy byte-for-byte.
- **B. Nuxt production Service Binding declaration — PREPARED ONLY.**
  `wrangler.release.jsonc` declares `LANTERN_MEDIA_ORIGIN` → `lantern-media`,
  but this remains a production-only template and is not an active production
  binding.
- **C. Nuxt production activation and runtime verification — OUTSTANDING.**
  Nuxt has not been deployed to production `lantern`. The active Worker is
  still the Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100%, and
  that active version does not contain `LANTERN_MEDIA_ORIGIN`. No approved
  production Nuxt media smoke request has been performed.

Therefore B1 remains **OPEN** under the corrected title
`A1 Nuxt production media Service Binding activation and runtime verification`.
The previous shorthand "production R2 binding not deployed" is no longer used
because the production media Worker deployment and production R2 binding
metadata are verified, while the live public-access/privacy settings remain
unverified.

### Provenance and privacy limits

The operator's deployment record describes a PyWrangler deployment from
`lantern-media-release`. Cloudflare version metadata reports
`last_deployed_from: wrangler`; that generic field is not proof of a direct
Wrangler command, and the missing provenance detail is not invented here.

Live public-endpoint privacy settings were not independently verified. The
release templates declare `workers_dev: false` and `preview_urls: false`, but a
template is not proof of live settings, and no public media endpoint was
invoked during the read-only audit.

### Outstanding prerequisites

- `LANTERN_NUXT_SESSION_SECRET` was not found in the production secret-name
  inventory. It is a separate pre-deployment requirement, not part of the media
  Worker deployment. Its value must never be requested, printed, or stored in
  documentation. Provisioning was not authorized and has not happened.
- `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent and must stay absent during
  initial cutover.
- Independent verification of the live `lantern-media` privacy settings is
  still required.
- The original Flask Worker must remain available as the production rollback
  candidate.
- No production Nuxt deployment or runtime smoke test has occurred.
- G3 remains false because `docs/release-signoff.json` is absent and no
  commit-matched four-role sign-off exists.

At the 2026-11-25 status point, B7 remained formally open and G2 remained blocked
because the pre-execution incident/window-record precondition had not been met.
Later closure is recorded in the dated addenda below. Neither the staging
technical rehearsal nor the media Worker deployment authorizes Nuxt production
activation or production cutover.

## Dated status addendum — 2026-11-26

The 2026-11-24 preparation statement and the 2026-11-25 status update above
remain historical snapshots and are not rewritten here. This addendum records
the later B7 staging result and current disposition only.

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

The 2026-11-24 missed pre-execution record is retained as historical evidence;
it was no longer the sole current B7 blocker at that point. As of this
2026-11-26 addendum, B7 remained formally open because B7-T1 required an
explicit owner disposition of the Version B interactive-confirmation deviation
and B7-T2 required fresh read-only evidence or explicit owner disposition for the
incomplete same-day proof of live workers.dev and Preview URL settings, custom
domains, routes, cron triggers, queue consumers, and email routing rules. The
fresh Wrangler binding metadata in record 02 §9.1 verified the staging D1/R2
identifiers, `LANTERN_MEDIA_ORIGIN` target, and media Worker staging R2 binding;
those identifiers were not missing. The dashboard settings carried forward from
2026-11-25 remained historical. Independent review and explicit owner closure
approval had not yet been recorded at that point. This historical addendum did
not change `B7.closed`, `G2.pass`, or any other release gate, and did not authorize production
deployment, secret provisioning, write enablement, or cutover. The later owner
closure is recorded in the next addendum.

## Dated status addendum — 2026-11-27

The 2026-11-26 addendum remains a dated snapshot. This addendum records the
later B7 disposition and explicit owner closure; it does not authorize any
production action.

- **B7-T1:** the project owner accepted the Version B activation's missing
  interactive confirmation as a ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION for
  Worker `lantern-nuxt-rehearsal`, window `B7-STAGING-20261126-02`, Version B
  deployment `3360865e-1ea7-4fdc-8961-b806a0917833`, and this single staging
  activation only. Decision date 2026-11-27 Asia/Jakarta; exact minute not
  preserved. It is not interactive confirmation, not a future waiver, and not
  production authorization.
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
  B1/G1 status. No independent human review was
  performed, and no reviewer identity, role, date/time, findings, signed
  conclusion, signature, or independent sign-off is recorded or invented. This
  owner acceptance does not authorize production deployment, activation,
  rollback, secret change, write enablement, traffic change, or cutover.

## Dated status addendum — 2026-11-27 Phase A production activation

The 2026-11-24, 2026-11-25, 2026-11-26, and B7-disposition 2026-11-27 sections
above remain historical snapshots. This addendum records the owner-supplied
2026-11-27 Phase A execution report. It is a one-time owner exception solely
for B1 evidence and does not authorize final release, production writes, or any
further production operation.

- **Activation:** interactive `npx wrangler versions deploy --name lantern` with captured assertions of Worker `lantern`, exact candidate `de1a66c6-d26f-46af-988f-ecb6ba3c520d` (version 53), one selected version, and 100% traffic.
- **Before/after:** deployment `472f489c-b597-44d8-87a6-f3b59b80adbb` had Flask version `93be1fa1-8ac2-49c7-adf3-2682b3be8365` at 100%. Activation created deployment `053ded69-4ea0-478b-9f0f-aec14e091876` with the candidate at 100%. The prior Flask version remains the rollback target; no automatic rollback occurred.
- **Candidate shape:** `ASSETS`; D1 `lantern_db` → `bf50e1be-81d7-4cd1-b082-8aa03a784860`; R2 `lantern_media` → `lantern-media`; `LANTERN_MEDIA_ORIGIN` → `lantern-media`; `LANTERN_ANONYMOUS_WRITE_DATABASE=production`; `LANTERN_PUBLIC_READ_DATABASE=production`; required secret names present including `LANTERN_NUXT_SESSION_SECRET`; `LANTERN_ENABLE_PRODUCTION_WRITES` absent; no staging bindings or Worker targets. Secret values, generated bytes, and temporary secret-file details are not recorded.
- **Bounded smoke evidence:** `GET /` 200 Nuxt-rendered Lantern markup; `GET /login` 200 form/password field as a page GET only, not an authenticated login test; `GET /verify/invalid-smoke-token` 200 allowed legacy-alias status; `GET /media/uploads/covers/10/cover.png` via the `lantern` Service Binding 200 `image/png`, `Content-Length: 2332318`, valid PNG signature. Exactly one published media object was fetched through the Service Binding and no public `lantern-media` hostname was used.
- **Boundary:** no login POST, registration, account/content mutation, write-path test, D1 SQL/restore/migration, direct R2 object operation, DNS/route/domain/trigger change, or `lantern-media` deployment was performed. The write flag remained absent from the active version.
- **Owner-supplied Dashboard evidence:** `lantern` Trigger Events screenshot dated 2026-11-27 approximately 13:11 showed no Cron/Queue/Email triggers. `lantern-media` Dashboard screenshots dated 2026-11-27 showed `workers.dev` OFF, Preview/Version URLs OFF, no custom domains/routes, and no triggers. These are owner-supplied Dashboard observations; Wrangler CLI did not independently verify live UI-only settings. The report states `lantern-media` deployment, version, and binding stayed unchanged.
- **Production data evidence:** Time Travel bookmark `0000026a-00000002-00005130-3d4a1e61fb6b3b72c42e865aaa644439` was captured before activation; Wrangler did not expose timestamp/database-version fields and no restore was attempted.
- **Supporting verification:** owner-authorized `npm ci` and `npm run verify` passed in the isolated worktree: 48 routes with `gap=0`, 48 test files / 532 tests, and build complete. Candidate HEAD was `f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`; `sourceCommit` remains `962cd95`.
- **Gate effect:** `B1.closed=true`, `G1.pass=true`, `G1.blockers=[]`; G2/B7 remain as previously recorded; `G3.pass=false` with `docs/release-signoff.json` absent and four genuine roles unapproved/unassigned. This activation is not final release approval and does not enable production writes.

## Dated policy note — 2026-11-27 single-owner approval

The 2026-11-24 preparation statement, its dated updates, and the Phase A
addendum above remain historical statements and are not rewritten here. The
project owner subsequently approved a single-owner G3 model:
`applicationOwner` is the sole approver for the combined application,
infrastructure, security, and operational decision, with no independent human
review claimed. Legacy `infraCloudflare`, `authSecurity`, and `releaseManager`
approvals are rejected.

Current gate state records `"approvalModel": "single-owner"` and pins
`"sourceCommit": "f62b0abada1ee5b3ba1b0397ae9bfead1245e9de"`.
`npm run release:check` uses that immutable candidate SHA rather than a later
`git HEAD`. `docs/release-signoff.json` remains absent, the template remains
unapproved with both acknowledgements false, and `G3.pass=false`. This policy
approval is not final release approval and does not enable production writes or
further production operations. See `docs/RELEASE_APPROVAL_POLICY.md`.
