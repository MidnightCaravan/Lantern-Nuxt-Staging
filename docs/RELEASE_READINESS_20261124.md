# Release readiness — A1 preparation, 2026-11-24

**Status:** NOT READY. Preparation only.
**Approved architecture:** same-name A1 with a private Flask media Worker.
**Production mutation:** none. No deploy, DNS/route change, secret provisioning, write enablement, migration, R2 object access, or Flask/DNS Worker change was performed. No commit, push, or merge was made.

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
(`server/routes/media/[...key].get.ts`). The private media Worker is reachable
only through the Service Binding: `workers_dev: false`, `preview_urls: false`,
and no routes, domains, or triggers.

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
| B1 deployment and operational evidence | Required; not performed |
| B7 A1 Worker-version rollback rehearsal | Required; not performed |
| G3 commit-matched four-role sign-off | Required; `docs/release-signoff.json` absent |
| Secret sufficiency | Owner/release-manager verification required |
| Secrets values | Must never be generated, displayed, or stored by the agent |

## Final readiness

**NOT READY for launch.** The approved A1 templates are prepared, but no
deployment, secret, rollback rehearsal, or sign-off evidence exists. Separate
explicit authorization is required for every production action.
