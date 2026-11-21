# lantern-media-rehearsal — local A1 prototype

**Status: deployed only as the private staging rehearsal Worker
`lantern-media-rehearsal`. No production Cloudflare resource was changed.**

This is the independent Flask media-origin Worker required by the A1
architecture. It supplies the target for the `LANTERN_MEDIA_ORIGIN` Service
Binding declared in `wrangler.rehearsal.jsonc`.

## What it is

- A Python Worker (`python_workers` compatibility flag) whose `/media/*` branch
  is copied **verbatim** from the original Flask Worker:
  `LANTERN_PARITY_SOURCE_BUNDLE_20261118-011830/original-flask/src/worker.py:1054-1199`.
- The verbatim block is guarded by `BEGIN/END VERBATIM FLASK MEDIA BRANCH`
  markers and checked against the original source by
  `tests/lantern-media-rehearsal.test.ts`.
- It does **not** import `app.py`. Therefore it does not register the Flask UI,
  auth, or upload routes and does not require `LANTERN_SECRET_KEY`.

## Least-privilege bindings

| Setting | Value | Reason |
|---|---|---|
| `name` | `lantern-media-rehearsal` | Separate Worker name; required for A1 |
| `workers_dev` | `false` | No public endpoint; reachable only by Service Binding |
| `routes` / `domains` / `triggers` | absent | No traffic switch, no DNS |
| R2 | `lantern_media` → `lantern-staging-media` | The media branch's only resource. Binding name kept so the verbatim code is unchanged; bucket is staging only. |
| D1 | **none** | See below |
| Secrets | **none** | The media branch reads no env secret |

### Does the Flask media Worker require D1? — No

Verified from source:

- The `/media/*` branch (`worker.py:1054-1199`) touches only
  `self.env.lantern_media` at lines 1082, 1147, 1155 and 1159.
- D1 is accessed only through `get_db()` in `lantern_database.py:93-102`, which
  raises if `lantern_db` is unavailable. `get_db()` is used by the Flask
  UI/auth/comment routes registered in `app.py`, not by the media branch.
- `LANTERN_SECRET_KEY` is required at import of `app.py:54-75`. This Worker
  never imports that module.

Therefore neither a staging nor a production D1 binding is added. If a future
decision requires this Worker to serve the full Flask UI, that would be a
different Worker with different bindings and must be approved separately.

## Scope boundary

The original Worker's fallback (`worker.py:1202-1206`) forwards every non-media
request to the full Flask WSGI app. That app is intentionally absent here. This
prototype returns `404 "Media origin only."` for non-media paths. In the A1
architecture the Nuxt proxy forwards only `/media/*`, so this boundary is not
reached in normal operation. It is documented rather than silently inherited.

## Deployment history

The staging-only Worker `lantern-media-rehearsal` was deployed once for A1 as
version `e0179b82-45b9-44e8-84cb-201e9b313995`. It remained private
(`workers_dev: false`, no routes/domains/triggers) and bound only
`lantern_media` → `lantern-staging-media`. See `docs/A1_STAGING_REHEARSAL_20261120.md`.
No production resource was changed.

A production deployment is **not** authorized. The command below is reference
only and must not be run without separate explicit authorization:

```bash
cd lantern-media-rehearsal
uv run pywrangler deploy          # target must exist before the caller is deployed
```

## B5 status

B5 (legacy Flask Worker remains the production media origin) remains **formally
pending clarification**. This prototype does not change, close, or reinterpret
B5. Whether the independent Flask copy satisfies the original decision is for
the project owner to decide.
