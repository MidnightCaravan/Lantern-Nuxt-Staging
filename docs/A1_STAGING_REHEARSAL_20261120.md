# A1 staging rehearsal record — 2026-11-20

**Status: executed under explicit staging-only authorization. NOT production cutover.**
Production Worker `lantern`, production D1/R2, secrets, DNS, routes and domains were not modified.
No commit was made. B5 remains formally pending owner clarification.

## Deployments

| Worker | Version ID | Created | Notes |
|---|---|---|---|
| `lantern-media-rehearsal` | `e0179b82-45b9-44e8-84cb-201e9b313995` | 2026-11-20T17:21:32.201Z | Python Flask media origin. Only binding: `env.lantern_media` → `lantern-staging-media` (R2). `workers_dev: false`, no routes/domains/triggers, no D1, no secrets. Deploy reported "No targets deployed". **Not redeployed during the HEAD repair.** |
| `lantern-nuxt-rehearsal` (initial) | `2e489458-4c15-4a83-99e7-cf026701ca3a` | 2026-11-20T17:21:xx | Bindings: `lantern_staging_db` (D1), `lantern_staging_media` (R2), `LANTERN_MEDIA_ORIGIN` → `lantern-media-rehearsal` (Worker), `ASSETS`. URL: `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev`. |
| `lantern-nuxt-rehearsal` (HEAD repair) | `3b0d9aaa-2af0-424b-8604-9d7eb2e83440` | 2026-11-20T18:10:xx | Same bindings. Adds the HEAD media route. Post-fix live HEAD tests below were run against this version. |
| `lantern-nuxt-rehearsal` (session secret — **current**) | `2fa09d9a-87bd-4267-b21c-ac3278784adb` | 2026-11-20T18:26:51.711Z | Same bindings. Created by provisioning `LANTERN_NUXT_SESSION_SECRET`. This is the version the authenticated staging-preview tests below were run against. |
| `lantern` (production) | `93be1fa1-8ac2-49c7-adf3-2682b3be8365` | 2026-10-26T22:30:19.670Z | **Unchanged.** Verified after all rehearsal deployments and secret provisioning. |

The media Worker has no public endpoint: `https://lantern-media-rehearsal.midnightcaravans.workers.dev/...` returns 404, and its deployment has no routes/domains. It is reachable only through the Nuxt Service Binding.

## Test fixtures (staging R2 only)

Created under prefix `a1-rehearsal/` in `lantern-staging-media`:
- `cover.png` — 11 bytes `image-bytes`, uploaded with deliberately wrong metadata `Content-Type: application/x-wrong`.
- `video.mp4` — 10 bytes `abcdefghij`.
- `large.mp4` — 2,097,150 bytes (`abcdefghij` × 209,715).

These remain in staging so the matrix can be re-run. They are outside any production bucket.

### Staging D1 fixture (authenticated preview test)

No existing staging work referenced the `a1-rehearsal/` objects, so one minimal row was inserted
into `lantern-staging-db` (remote, staging only):

| id | creator_id | title | type | status | cover | video_path |
|---|---|---|---|---|---|---|
| 4 | 5 (existing `parityauth` user) | A1 staging media parity fixture | Video | `draft` | `/media/a1-rehearsal/cover.png` | `/media/a1-rehearsal/video.mp4` |

`draft` status was chosen deliberately so the ownership check (`creator_id` match) is exercised
rather than the `status='published'` shortcut. The insert was guarded by `NOT EXISTS` and is
idempotent. No production D1 row was read or written.

## Live response matrix (actual Cloudflare responses)

All requests to `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev/media/...` unless noted.

| # | Case | Expected (Flask) | Actual | Result |
|---|---|---|---|---|
| 1 | Image GET | 200, `image/png`, `Cache-Control: public, max-age=31536000`, no range headers, body `image-bytes` | matched exactly; R2 metadata `application/x-wrong` correctly ignored | PASS |
| 2 | Video GET | 200, `video/mp4`, `Accept-Ranges: bytes`, `Content-Length: 10`, body `abcdefghij` | matched exactly | PASS |
| 3 | Image HEAD | 200 + headers, no body | Initially 404 Nuxt HTML; **after HEAD repair: 200, `image/png`, `public, max-age=31536000`, no range headers, no body** | **FIXED — PASS** |
| 4 | Video HEAD | 200 + headers, no body | Initially 404 Nuxt HTML; **after HEAD repair: 200, `video/mp4`, `Accept-Ranges: bytes`, no body** | **FIXED — PASS** |
| 5 | Range `bytes=2-5` | 206, `cdef`, `Content-Range: bytes 2-5/10`, len 4 | matched exactly | PASS |
| 6 | Range `bytes=-4` | 206, `ghij`, `Content-Range: bytes 6-9/10`, len 4 | matched exactly | PASS |
| 7 | Range `bytes=abc` | 416, `Invalid byte range.`, `Content-Range: bytes */10` | matched exactly | PASS |
| 8 | Range `bytes=20-` | 416, `Range not satisfiable.`, `Content-Range: bytes */10` | matched exactly | PASS |
| 9 | Missing object | 404, `Media not found.` | matched exactly | PASS |
| 10 | Image with Range | 200 full body, no `Content-Range` (Flask ignores range for non-video) | matched exactly | PASS |
| 11 | Traversal key | Nuxt 404 before origin (documented divergence) | Nuxt 404, origin not called | PASS (documented) |
| 12 | Large video GET | 200, `Content-Length: 2097150`, full stream | 2,097,150 bytes received | PASS |
| 13 | Large tail range | 206, `bytes 2097140-2097149/2097150`, `abcdefghij` | matched exactly | PASS |
| 14 | Abort mid-stream | Client can cancel; Worker stays healthy | curl exit 28 at 236,148/2,097,150 bytes; subsequent GET 200 | PASS |
| 15 | 502 on R2 failure | `502 Media unavailable.` / `502 Video size unavailable.` | Not reachable via normal staging traffic; covered by automated regression test with injected R2 failure | UNABLE TO VERIFY LIVE |

No `ETag`, `Last-Modified`, `Vary` or `Content-Disposition` was introduced by the proxy.

## HEAD discrepancy — repaired

Root cause was that `server/routes/media/[...key].get.ts` is registered by Nitro as `method:"get"`
only, so HEAD fell through to Nuxt's generic 404 page. The original Flask Worker has no method
check in its `/media/*` branch (`worker.py:1054-1199`), so HEAD is served with the same
status/headers and the body stripped by the runtime. This was a pre-existing Nuxt gap, not
introduced by the proxy change.

**Fix applied:** added `server/routes/media/[...key].head.ts`, which re-exports the GET handler
verbatim (`export { default } from './[...key].get'`) so there is one implementation for both
methods. Nitro now registers two route entries, `method:"get"` and `method:"head"` (confirmed in
the built `nitro.mjs`). All existing media behavior, Range handling, error responses, Service
Binding proxy, key validation and staging-preview logic are unchanged. The incoming method is
carried through to the Flask origin.

### Post-fix live HEAD matrix (version `3b0d9aaa…`)

| # | Case | Expected | Actual | Result |
|---|---|---|---|---|
| H1 | Image HEAD | 200, `image/png`, `Cache-Control: public, max-age=31536000`, no range headers, no body | matched; no `x-powered-by` | PASS |
| H2 | Video HEAD | 200, `video/mp4`, `Accept-Ranges: bytes`, no body | matched | PASS |
| H3 | Video HEAD + `bytes=2-5` | 206, `Content-Range: bytes 2-5/10` | matched | PASS |
| H4 | Video HEAD + `bytes=-4` | 206, `Content-Range: bytes 6-9/10` | matched | PASS |
| H5 | Image HEAD + invalid Range | 200 full-object headers, no `Content-Range` | matched | PASS |
| H6 | Video HEAD + `bytes=abc` | 416, `Content-Range: bytes */10` | matched | PASS |
| H7 | Video HEAD + `bytes=20-` | 416, `Content-Range: bytes */10` | matched | PASS |
| H8 | Missing object HEAD | 404, no body | matched | PASS |
| H9 | Large video HEAD | 200, `video/mp4`, `Accept-Ranges: bytes` | matched | PASS |
| H10 | HEAD body | empty | `downloaded_body=0` | PASS |

**Content-Length nuance:** on HEAD responses the runtime omits `Content-Length` (it is present on
the corresponding GET, e.g. `10` / `2097150`). This is standard HEAD behavior of the HTTP layer,
not a change introduced by the proxy — Flask sets the header on the Response and the runtime
strips body-derived framing for HEAD. No production probe was performed to compare the original
Flask Worker's direct HEAD framing, because the authorization is limited to the two staging
Workers; recorded here as an observation, not a claimed gap.

Automated coverage: `tests/media-head-parity.test.ts` (14 tests) asserts the HEAD and GET routes
share the identical handler, plus HEAD GET/Range/416/404/502 status and headers, empty bodies,
staging-preview preservation, and key-validation divergence.

#### HEAD test correction (2026-11-21)

The original test suite used only `tests/helpers/handler.ts`, which calls the handler through
h3's `toWebHandler`. That adapter strips the HEAD body but preserves handler-set headers, so the
old assertions (`Content-Length: 10` on a video HEAD) described **handler-level** behavior, not the
final Workers response. No application code was changed to match those assertions.

The test file now separates the two layers:

- **Handler-level suite** — keeps the existing coverage through `callHandler`, with test names
  explicitly marked `Handler-level`. It proves the HEAD route re-exports the GET handler and that
  the handler still sets status, `Content-Type`, `Accept-Ranges`, `Content-Range`, and its own
  `Content-Length` before the final adapter runs.
- **Final deployed suite** — calls the handler through `node-mock-http`'s
  `fetchNodeRequestHandler`, the same adapter Nitro uses in its Cloudflare runtime
  (`node_modules/nitropack/dist/runtime/internal/app.mjs`). That adapter deletes `Content-Length`
  for every HEAD method, matching the live rehearsal response. Four explicit regression assertions
  now verify a null `Content-Length` and an empty body for video, ranged video, image, and 404 HEAD
  responses, while status and the other headers remain intact.

This correction distinguishes handler output from deployed transport framing without weakening
either layer of HEAD coverage.

## Authenticated staging-preview media test (version `2fa09d9a…`)

### Secret provisioning

| Item | Value |
|---|---|
| Secret **name** | `LANTERN_NUXT_SESSION_SECRET` |
| Secret **value** | **Never displayed, logged, committed, or written to any file.** Generated locally as 32 cryptographically secure bytes (`crypto.randomBytes(32)`), hex-encoded to 64 characters. The hex text was piped directly into `wrangler secret put ... --name lantern-nuxt-rehearsal` stdin by a one-shot Node process. |
| Command target | `lantern-nuxt-rehearsal` only. No Brevo/email/Flask or any other secret was provisioned. |
| Confirmation | `wrangler secret list --name lantern-nuxt-rehearsal` reports exactly one entry: `LANTERN_NUXT_SESSION_SECRET` (`secret_text`). The value was not echoed by Wrangler. |
| Session construction | Test sessions were signed locally in the same one-shot process using the identical algorithm as `createLanternSession` in `server/utils/lantern-auth.ts` (base64url payload `{v:1,uid,db:'staging',iat,exp}` + HMAC-SHA256 signature). No password, login endpoint, or extra secret was used. The session cookie value was never printed. |

### Authentication and ownership requirements inspected

`server/routes/media/[...key].get.ts:41-58` grants the staging-preview path only when the session
identity is `database === 'staging'` and a staging D1 `works`/`comic_pages` row references the key
with `creator_id = userId` **or** `status = 'published'`. Only then is `lantern_staging_media`
used and `Cache-Control: private, no-store` applied. Otherwise the request is forwarded to
`LANTERN_MEDIA_ORIGIN` (`server/routes/media/[...key].get.ts:65-67`). `getLanternSessionIdentity`
(`server/utils/lantern-auth.ts:153-180`) requires `LANTERN_NUXT_SESSION_SECRET` for any request that
presents a cookie; `getSessionSecret` rejects a value shorter than 32 characters
(`lantern-auth.ts:34-40`).

### Live results (staging Service Binding version `2fa09d9a…`)

| # | Case | Authorization expectation | Actual | Result |
|---|---|---|---|---|
| S1 | Unauthenticated GET `a1-rehearsal/cover.png` (no cookie) | **Staging-preview DENIED**: no `private, no-store`, no ownership grant | 200, `image/png` (extension-derived), `Cache-Control: public, max-age=31536000`, body `image-bytes` — served by the public Flask origin | PASS — authorization gate denies staging preview |
| S2 | Unauthenticated GET `a1-rehearsal/video.mp4` | Staging-preview DENIED | 200, `video/mp4`, `public, max-age=31536000`, `Accept-Ranges: bytes`, body `abcdefghij` | PASS |
| S3 | Authorized staging owner (uid 5) GET `a1-rehearsal/cover.png` | **GRANTED**: staging R2, `private, no-store` | 200, `application/x-wrong` (R2 metadata, proving the staging bucket path), `private, no-store`, `Content-Length: 11`, body `image-bytes` | PASS |
| S4 | Authorized staging owner GET `a1-rehearsal/video.mp4` | GRANTED: staging R2, private | 200, `video/mp4`, `private, no-store`, `Accept-Ranges: bytes`, `Content-Length: 10`, body `abcdefghij` | PASS |
| S5 | Authorized staging owner + `Range: bytes=2-5` | GRANTED: local range handling preserved | 206, `Content-Range: bytes 2-5/10`, `Content-Length: 4`, `private, no-store`, body `cdef` | PASS |
| S6 | Authorized staging owner HEAD `cover.png` | GRANTED, HEAD parity preserved on private path | 200, `application/x-wrong`, `private, no-store`, empty body, no `Content-Length` | PASS |
| S7 | Authorized staging owner, missing object | 404 from staging R2 | 404, `Media not found.`, `Content-Length: 16` | PASS |
| X1 | Staging session for **non-owner** (uid 4) GET cover | Staging-preview DENIED by ownership | 200, `image/png`, `public, max-age=31536000` — public origin path | PASS |
| X2 | Production-database session (uid 5, `db=production`) | Staging-preview DENIED | 200, `image/png`, `public, max-age=31536000` — public origin path | PASS |
| X3 | Invalid cookie (`invalid.token`) | Staging-preview DENIED | 200, `image/png`, `public, max-age=31536000` — public origin path | PASS |

The authorized responses differ from the unauthorized ones in exactly the expected ways:
`Cache-Control: private, no-store` and R2-metadata `Content-Type: application/x-wrong` appear only
for the owning staging session, while unauthorized/production/invalid-cookie requests receive the
Flask origin's `public, max-age=31536000` and extension-derived `image/png`. This confirms the
staging-preview ownership gate is active and that the Service Binding fallback is not taken for
authorized staging objects.

### Limitation identified — not a silent behavior change

The unauthenticated cases return **200 with the public media bytes**, not an HTTP 403/404. This is
the implemented A1 behavior: when staging-preview is denied, the request falls through to
`LANTERN_MEDIA_ORIGIN`, and the Flask media Worker has the same `lantern-staging-media` bucket
bound as `lantern_media`. Consequently the staging test objects remain publicly readable through
the rehearsal Worker URL when no staging session is presented. This matches Flask's own unauthenticated
`/media/*` behavior (Flask applies no ownership check), and the Nuxt staging-private preview is a
separate dev-only feature. It is recorded here as a limitation of the A1 prototype for owner review;
no code was changed to alter it.

## Other limitations / risks

- **Staging-preview media live test — completed** after `LANTERN_NUXT_SESSION_SECRET` was
  provisioned and staging work id 4 was added. The authorized and unauthorized paths are recorded
  above. The secret value is not stored in this repository. The staging D1 fixture row and the
  `a1-rehearsal/` R2 objects remain in staging for re-runs.
- **502 live path untriggerable** without injecting an R2 fault; automated test covers it.
- **Cancellation propagation** to the origin is proven by the automated stream test, not directly
  observable from outside the live Worker; live abort showed a healthy Worker afterward.
- **Key-validation divergence** remains as documented: Nuxt rejects `..`/`\` keys before the
  origin; Flask does not. Kept unchanged per instruction.
- Production cutover version retention (Flask version dated 2026-10-26) must be re-verified before
  any real cutover; not relevant to this staging rehearsal.

## Verification

Initial rehearsal: EXIT 0; 48 Flask routes, gap 0; 28 test files / 243 tests passed; Nuxt build
complete.

After the HEAD repair: `npm run verify` EXIT 0; 48 Flask routes, gap 0; **29 test files / 253 tests
passed**; Nuxt build complete; built route table contains `method:"get"` and `method:"head"` for
`/media/**:key`.

The secret-provisioning round changed no application source files, so no new build/test run was
required; the rehearsal Worker ran the already-verified `3b0d9aaa` build with the added secret.

## A1 remaining-parity audit — 2026-11-21

Read-only review of the current Nuxt implementation against the authoritative Flask source
(`LANTERN_PARITY_SOURCE_BUNDLE_20261118-011830/original-flask/src/worker.py:1054-1199`). No
application code, deployment, secret or production resource was changed for this audit.

| # | Item | Observed behavior (staging + code) | Original Flask behavior | Classification | Risk | Recommended disposition |
|---|---|---|---|---|---|---|
| 1 | HEAD `Content-Length` | GET includes it (image `11`, video `10`, large video `2097150`); HEAD on both image and video omits it while preserving status, `Content-Type`, `Cache-Control`, `Accept-Ranges`, `Content-Range` and an empty body | No method check; HEAD enters the same branch. `worker.py:1180,1187` sets `Content-Length` for video (not image). Body is stripped by the runtime for HEAD | **Known difference — runtime/framework**, not a proxy defect | Low. HTTP permits omitting `Content-Length` on HEAD; no GET/range impact. Clients relying on it would see a difference | Accept and document. No code change. Do not probe production |
| 2 | Key validation | Nuxt rejects keys with `.`/`..`/`\` segments or empty segments (`[...key].get.ts:36-40`) with 404 before R2 or origin. Live traversal case confirmed origin not called | `worker.py:1055` takes the raw path slice with no filter; R2 keys are opaque strings, so `..` is not filesystem traversal. Such an object would be served if it existed | **Known difference — deliberate protective difference**, pre-existing in Nuxt and preserved | Low. All generated keys use `uploads/{covers,videos,comics}/...` and contain none of these patterns. Only non-canonical keys differ | Accept, keep unchanged, retain owner-review note in `tests/media-origin-proxy.test.ts:205-212` |
| 3 | Authenticated staging-preview `Content-Type` | Owning staging session returns R2 metadata (`application/x-wrong` on the deliberately mislabeled fixture) with `private, no-store`; public requests return extension-derived `image/png` with `public, max-age=31536000` | `worker.py:1058-1071,1168-1171` always derives `Content-Type` from the extension and never reads R2 metadata. Flask has no staging-preview mode | **Known difference — development-only path; PASS for public media** | Low. Preview path is gated by staging identity + D1 ownership (`[...key].get.ts:41-58`) and `lantern-studio.ts:67-79`; normal public requests are proxied to Flask and unaffected | Accept and document. No code change |
| 4 | Unauthenticated staging-preview fallback | No cookie → identity `null` → ownership branch skipped → `stagingObject=false` → Service Binding (`[...key].get.ts:65-67`) → Flask origin serves the object (live S1/S2, 200, public headers) when the key is known | `worker.py:1054-1199` has no authentication check at all; any object in `lantern_media` is served publicly | **PASS for Flask parity; known architectural consequence for staging isolation** | Medium **in the rehearsal only**: staging objects are publicly readable through the rehearsal URL. No production data is exposed. A production A1 origin would read the production bucket, matching Flask | Accept and document. No access restrictions added, per instruction |
| 5 | 502 failure path | No live 502 observed. Automated injected R2 `head()` failure produces `502 Media unavailable.` (`tests/media-origin-proxy.test.ts:121-133`); the TS oracle also implements `Video size unavailable.` | `worker.py:1088` → `502 Video size unavailable.` when R2 metadata size is absent; `worker.py:1161-1163` → `502 Media unavailable.` on any R2 exception | **Unresolved live / technically covered by fault injection** | Low. Both branches are verbatim Flask code; R2 always supplies `size`, so branch 1 is not reachable with real objects | Leave live testing unperformed. No safe controlled induction exists without changing code/config or damaging fixtures |
| 6 | B5 architecture decision | A1 uses an independent private `lantern-media-rehearsal` Worker bound to `lantern-staging-media`. No owner decision records this as satisfying B5 | N/A — governance decision, not a Flask behavior | **Unresolved — owner decision pending** | Architectural/governance: treating A1 as B5 acceptance would be an unauthorized assumption | Keep B5 formally open. Owner must decide explicitly; no config or production change |

### Evidence notes

**1. HEAD `Content-Length`.** Flask sets the header only for videos and only inside the shared
`/media/*` branch (`worker.py:1174-1188`), with no method check, so HEAD should carry identical
headers with the body stripped. The live image GET `Content-Length: 11` is supplied by the
runtime/R2 body size, not by Flask application code. The deployed Nitro bundle explicitly removes
the header on HEAD: `.output/server/chunks/nitro/nitro.mjs` contains
`("HEAD"===r.method.toUpperCase())&&(c=null,delete s._headers["content-length"])`. This runs after
the proxy returns the origin `Response`, so even the video's explicit header is removed. The
source of that deletion is `node-mock-http`'s `fetchNodeRequestHandler`
(`node_modules/node-mock-http/dist/index.mjs`), which Nitro calls from
`node_modules/nitropack/dist/runtime/internal/app.mjs`. `tests/media-head-parity.test.ts` now
asserts both layers: the handler-level suite still preserves `Content-Length: 10`, while the
deployed-adapter suite asserts that the final HEAD response has no `Content-Length`. The live
rehearsal result remains the authoritative observation; no production probe was performed.

**2. Key validation.** No media key produced by this codebase contains `.`/`..`/`\` or empty
segments: thumbnail/video/comic writers use `uploads/covers/<id>/cover.<ext>`,
`uploads/videos/<id>/...`, `uploads/comics/<id>/...` (e.g.
`server/api/dashboard/works/[id]/thumbnail.put.ts:65`,
`server/api/studio/works/[id]/video-direct.put.ts:18`, `server/utils/lantern-comic.ts:80`). R2 keys
are opaque, so Flask's lack of a filter is not a filesystem traversal vulnerability; Nuxt's filter is
stricter and was deliberately kept.

**3. Staging preview is development-only.** `server/utils/lantern-studio.ts:67-79` throws 404
`This staging preview is not available.` unless the session database is `staging`;
`studioPublicMediaUrl` (`lantern-studio.ts:81-88`) emits bare `/media/<key>` only in staging and the
legacy Flask URL otherwise. The preview branch requires both a staging session and a staging D1
ownership/publication match (`[...key].get.ts:41-58`), then reads `lantern_staging_media` and applies
`Cache-Control: private, no-store`. Public requests never enter it when the Service Binding is
present.

**4. Fallback control flow.** `getLanternSessionIdentity` returns `null` for a request without a
cookie before consulting the secret (`lantern-auth.ts:153-156`). The ownership branch at
`[...key].get.ts:46-58` is then skipped and the proxy branch at `:65-67` forwards the request
unchanged. The Flask media Worker binds `lantern_media` to `lantern-staging-media`, so a known key
retrieves the object. This is identical to Flask's public `/media/*` rule; only the rehearsal's
choice of bucket makes staging objects visible.

**5. 502.** With real R2 objects `metadata.size` is always present, so `Video size unavailable.`
cannot be induced. `Media unavailable.` requires an R2 exception; triggering one would need a
binding/config change, injected fault, or mutation/deletion of fixtures — all outside this
read-only task. The verbatim Flask block plus the injected-failure regression test are therefore
the available evidence.

**6. B5.** `docs/CUTOVER_READINESS.md:71` records B5 as "Decision recorded — legacy Worker remains
media origin" with exit criteria requiring a bound `lantern_media` and owner approval of a
`lanternMediaUrl` switch; `:90` notes the owner's 2026-11-19 confirmation that the legacy Worker stays
the origin for the first cutover. No decision record accepts the independent A1 Flask media Worker
as satisfying B5. It remains pending and is not implied by these staging tests.

### Readiness recommendation

- **Technical:** A1 media behavior is verified for the tested matrix; the HEAD route gap and secret
  are fixed; automated coverage exists for the documented differences. No production resource was
  touched. The staging prototype is technically ready for a **local, non-production commit** if the
  owner authorizes one.
- **Owner decisions required, separate from technical findings:** B5 disposition; acceptance of the
  four documented behavioral differences (items 1–4); whether to retain the staging D1 fixture,
  `a1-rehearsal/` R2 objects, and the staging session secret; and explicit commit authorization.
- **Production cutover:** **not ready.** B5 remains open, G3 sign-off is pending, and
  `wrangler.release.jsonc` has not been deployed or approved for deployment.
