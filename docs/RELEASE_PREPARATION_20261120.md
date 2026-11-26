# Release preparation record — A1 alignment, 2026-11-24

This document previously recorded unresolved architecture options for B1/B7/G3.
The owner has now approved A1, so that architecture decision is superseded. The
historical read-only Cloudflare evidence below remains useful context, but any
statement proposing `lantern-nuxt`, a DNS switch, custom domain, route, or
`zone:edit` is no longer the release plan.

**No production resource was changed in this preparation. No deploy, DNS/route
change, secret operation, sign-off, commit, push, or merge was performed.**

## 1. Approved A1 decision

- Deploy Nuxt as a new version of the existing Worker `lantern`.
- Keep `workers_dev: true` and the canonical hostname
  `https://lantern.midnightcaravans.workers.dev`.
- Deploy a separate private Python Worker `lantern-media` as the media origin.
- Bind `LANTERN_MEDIA_ORIGIN` from `lantern` to `lantern-media`.
- Keep production writes disabled by omitting `LANTERN_ENABLE_PRODUCTION_WRITES`.
- Preserve B5: Flask is the temporary production media origin.
- Do not use DNS, custom domains, routes, or `zone:edit`.

## 2. Prepared configuration

| Concern | Nuxt release Worker | Private media Worker |
|---|---|---|
| Config | `wrangler.release.jsonc` | `wrangler.media-release.jsonc` |
| Name | `lantern` | `lantern-media` |
| Public endpoint | workers.dev retained | none |
| Version URLs | disabled | disabled |
| D1 | production `lantern_db` | none |
| R2 | production `lantern_media` | production `lantern_media` only |
| Service Binding | to `lantern-media` | none |
| Routes/domains/triggers | none | none |
| Secrets | not introduced by config | none |
| Write flag | absent | not applicable |

`lantern-media-release/src/media_worker.py` is a verbatim copy of
`lantern-media-rehearsal/src/media_worker.py`, the verified media-only Flask
implementation.

## 3. Historical read-only evidence retained

Previous investigation established:

- production app is served from a workers.dev URL, not a Cloudflare DNS record
  or custom domain;
- legacy Flask Worker `lantern` had active version
  `93be1fa1-8ac2-49c7-adf3-2682b3be8365`;
- no `zone:edit` / DNS write capability was available to the agent;
- production R2 bucket `lantern-media` exists and is bound by the Flask Worker as
  `lantern_media`;
- staging A1 used `lantern-nuxt-rehearsal` and `lantern-media-rehearsal` with
  staging-only bindings and no routes/domains;
- staging media behavior, Range handling, HEAD, headers, streaming, errors, and
  preview authorization were verified.

These facts support the A1 choice. The old “no selected option” language is
superseded by the owner approval above.

## 4. B1 — remaining deployment work

B1 stays open until all of the following have real evidence:

1. Deploy `lantern-media` from the private template.
2. Confirm binding metadata without invoking a public media endpoint.
3. Deploy the Nuxt build from `wrangler.release.jsonc` as a new `lantern` version.
4. Verify canonical workers.dev serving and one approved media request.
5. Attach evidence to the gate file.

Local templates and tests do not deploy or close B1.

## 5. B7 — remaining rollback rehearsal work

B7 stays open. Rehearse an A1-shaped Worker-version rollback against a
non-production Worker. Do not perform a DNS/route flip; A1 has none. Record
before/after versions, smoke output, timing, and proof that no production
resource changed. The production rollback command, if separately authorized,
is:

```sh
npx wrangler rollback 93be1fa1-8ac2-49c7-adf3-2682b3be8365 --name lantern
```

## 6. G3 — remaining sign-off work

G3 stays open. A real commit-matched four-role `docs/release-signoff.json`
must be created by the appropriate people. Do not fabricate approval.

## 7. Release controls added 2026-11-26

The release-control work is prepared but does not select a candidate:

- `scripts/release-provenance.mjs` requires a full 40-character lowercase source
  commit SHA, an immutable `refs/tags/...` release ref, genuine four-role
  approval, and evidence references for every passed gate and closed blocker.
  The short SHA `962cd95` is historical evidence only and is not a candidate.
- `npm run release:build` builds from the recorded source tree and rechecks
  that tracked source stayed unchanged after install and verify.
  `npm run release:record-artifact` commits only the generated control
  manifest, after which `npm run release:preflight` verifies the source,
  artifact manifest, and approved A1 configuration before any handoff.
  `scripts/release-deploy.mjs` re-runs complete preflight immediately before
  its fail-closed artifact-verified Wrangler wrapper; `npm run deploy` still
  runs `scripts/deploy-guard.mjs` and fails closed.
- `.github/workflows/release-build.yml` checks out the release-control revision
  separately from the recorded source SHA and performs no deployment.
- `docs/release-signoff.json`, `docs/release-artifact.json`, a candidate tag,
  and deployment evidence were not created or guessed.

These controls support the existing gates; they do not close B1, B7, or G3.

## 8. Authorization boundary

No action in this document authorizes `wrangler deploy`, `wrangler rollback`,
secret changes, DNS/route/domain changes, production data access, production
HTTP testing, or a production write. Each requires separate explicit approval.
