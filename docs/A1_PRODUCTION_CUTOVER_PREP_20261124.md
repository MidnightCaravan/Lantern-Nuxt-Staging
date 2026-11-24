# A1 production cutover preparation — 2026-11-24

**Status: APPROVED ARCHITECTURE; PREPARATION ONLY. NOT READY OR AUTHORIZED TO DEPLOY.**
No production Worker, D1, R2 object, secret, route, domain, DNS record, or traffic
setting was modified. No commit, push, or merge was made.

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

## Deployment order when separately authorized

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

No command in this document was executed.

## Gates that remain open

- B1 is **not closed**: prepared configuration is not deployed or operationally verified.
- B7 is **not closed**: no A1 production worker-version rollback rehearsal was executed.
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

### Current A1 stage state

- **A. Private media Worker deployment — COMPLETE AND VERIFIED.** Cloudflare
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
because the private media Worker and production R2 binding are already
deployed.

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

B7 remains closed and G2 remains passed; neither status authorizes B1 activation
or production cutover.
