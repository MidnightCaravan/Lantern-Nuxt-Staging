# Release readiness — A1 preparation, 2026-11-24

**Historical status (2026-11-24 preparation snapshot):** NOT READY. Preparation only.
**Approved architecture:** same-name A1 with a Flask media Worker.
**Scope note:** The opening statement describes the preparation actions in this record, not the full current production state. The production `lantern-media` deployment is documented in the dated status update below. This record does not document Nuxt production activation, production D1/R2 object mutation, secret provisioning, write enablement, DNS/route/domain change, or a production traffic switch. No commit, push, or merge was made by the preparation steps.

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

## Media behavior

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
- preserved Flask media proxy semantics in existing media tests;
- provenance validation, release build, artifact preflight, and fail-closed deployment handoff;
- explicit full-SHA/immutable-ref gate validation and evidence references;
- real POST handler write-guard behavior with mocked D1/R2 and no side effects;
- GET-only smoke labels that no longer claim POST protection.

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
| Full source SHA and immutable tag ref | Required; not selected or guessed. The short SHA `962cd95` is historical evidence only. |
| Release build and artifact preflight evidence | Required; controls are prepared, but no candidate artifact has been built or retained for a selected release. |
| B1 Nuxt production Service Binding activation and operational evidence | Required; not performed. Media Worker deployment/binding metadata is verified; live privacy/access settings still require independent verification. |
| B7 formal closure | Staging technical rollback passed on 2026-11-24; formal closure pending because the pre-execution incident/window-record precondition was not met. |
| G3 commit-matched four-role sign-off | Required; `docs/release-signoff.json` absent |
| Secret sufficiency | Owner/release-manager verification required |
| Secrets values | Must never be generated, displayed, or stored by the agent |

## Final readiness

**NOT READY for launch.** The production media Worker deployment is recorded
below, but Nuxt has not been deployed to `lantern`, its production Service
Binding has not been activated, and no production runtime smoke test has been
performed. The staging technical rollback exercise passed, but formal B7
closure is pending the missing pre-execution incident/window record. Secret
provisioning and commit-matched sign-off remain outstanding. Separate explicit
authorization is required for every production action.

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
B7 remains formally open and G2 remains blocked because the pre-execution
incident/window-record precondition was not met during the staging rehearsal;
see `docs/REHEARSAL_RECORD.md` §10.6. The technical rollback success does not
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

**Current readiness: NOT READY for launch.** The production media Worker
deployment and R2 binding metadata have moved from prepared to verified; its
live privacy/access settings remain unverified. Nuxt production Service Binding
activation and runtime proof remain required before B1 can close.
