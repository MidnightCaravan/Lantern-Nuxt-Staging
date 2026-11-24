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
