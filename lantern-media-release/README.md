# lantern-media-release — production packaging

**Status: packaging prepared only. No production resource was deployed or modified.**

This directory contains the supported PyWrangler packaging for the approved
private production media Worker `lantern-media`. The media implementation in
`src/media_worker.py` is unchanged.

## Why these files are needed

The failed deployment used Wrangler directly from the repository root with
`wrangler.media-release.jsonc`. Wrangler 4.167.0 runs Python Workers in external
SDK mode: it expects the `workers` runtime module to already be present in the
upload. Direct Wrangler deployment does not run PyWrangler's `sync` step, so no
`python_modules/workers` package was produced. The runtime therefore reported:

```text
ModuleNotFoundError: No module named 'workers'
You need to update to workers-py >= 1.9 or pass disable_python_external_sdk.
```

The supported fix is to bundle the SDK, not to disable it. This directory now
contains:

| File | Purpose |
|---|---|
| `pyproject.toml` | Pins `workers-py` and `workers-runtime-sdk` (the source of the `workers` module). |
| `pylock.toml` | uv-generated lock for the Pyodide-targeted runtime SDK wheel. |
| `wrangler.jsonc` | Local PyWrangler project config with a project-relative entrypoint. |
| `.gitignore` | Ignores uv/PyWrangler-generated `.venv`, `.venv-workers`, `python_modules`, and `uv.lock`. |

`pywrangler sync` vendors `workers-runtime-sdk` into `python_modules/`.
`pywrangler deploy` then includes those modules in the same Worker upload.

`disable_python_external_sdk` is intentionally not used. Cloudflare's current
Python Workers documentation and the `workers-py` CLI do not present it as the
supported packaging path.

## Config relationship

`wrangler.jsonc` is the local PyWrangler mirror of the approved
`../wrangler.media-release.jsonc`. It differs only in:

- `$schema`: local path for editor validation.
- `main`: `src/media_worker.py` instead of `lantern-media-release/src/media_worker.py`.

All Worker settings and bindings are identical. In particular, both configs
declare only the R2 binding `lantern_media` → `lantern-media`, with no D1, no
secrets, no vars, no routes, no domains, no triggers, `workers_dev: false`, and
`preview_urls: false`. `tests/media-release-config.test.ts` enforces this.

## Supported workflow

Tooling requirements:

- `uv >= 0.13.4` (required by current `workers-py` for Python 3.14 targeting)
- `wrangler >= 4.127.1` (both the repository's locked 4.162.0 and the failed deployment's 4.167.0 were dry-run validated)

Local validation, which does not deploy:

```bash
cd lantern-media-release
uv run pywrangler sync --force
uv run pywrangler deploy --dry-run --outdir /tmp/lantern-media-release-dry-run
```

A successful dry run attaches the vendored modules and reports only:

```text
env.lantern_media (lantern-media)  R2 Bucket
```

Production deployment is a separate explicitly authorized action and is not
performed by these instructions. The reference command, recorded here only so
the cutover runbook remains actionable, is:

```bash
cd lantern-media-release
uv run pywrangler deploy
```
