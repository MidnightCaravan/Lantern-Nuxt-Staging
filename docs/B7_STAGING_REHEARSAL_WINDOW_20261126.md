# B7 staging-only Worker-version rehearsal window

**Record ID:** B7-STAGING-20261126-01
**Record date:** 2026-11-25
**Status:** EXPIRED — NOT EXECUTED. The approved window ended without a staging
Worker-version rehearsal. No activation, smoke check, or rollback was performed
under this record. Superseded by `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md`.
**Approved window:** 2026-11-26 09:00–12:00 Asia/Jakarta (UTC+07:00)
**UTC equivalent:** 2026-11-26 02:00–05:00 UTC

**Owner approval confirmed:** 2026-11-25T16:39:34+07:00 (Asia/Jakarta).

## Supersession

This record is retained as historical pre-execution evidence only. Its window
expired at 12:00 Asia/Jakarta on 2026-11-26 and was **not executed**. It is
superseded by record `B7-STAGING-20261126-02`, approved for 2026-11-26
15:10–18:10 Asia/Jakarta (08:10–11:10 UTC). No staging resource state changed
under this expired record.

## Owner-observed Cloudflare evidence (2026-11-25)

Source: owner-provided Cloudflare dashboard screenshots, observed
2026-11-25 approximately 23:02–23:12 Asia/Jakarta (UTC+07:00). Local
screenshot paths were not provided and are not invented here.

### `lantern-media-rehearsal`

- workers.dev: **OFF**
- Preview URLs: **OFF**
- Custom Domains: **0**
- Routes: **none**
- Bindings: exactly one R2 binding, `lantern_media` → `lantern-staging-media`
- Cron triggers: **none**
- Queue consumers: **none**
- Email routing rules: **none**
- Other trigger: `lantern-nuxt-rehearsal fetch()`

### `lantern-nuxt-rehearsal`

- workers.dev: **ON**
- Preview URLs: **OFF**
- Custom Domains: **none**
- Routes: **none**
- Cron triggers: **none**
- Queue consumers: **none**
- Email routing rules: **none**

## Read-only rehearsal source audit (2026-11-25)

`scripts/rehearsal-smoke-check.mjs:10-31` defines nine probes and issues each one
with `fetch(base + path)` and no `method`, so every request is HTTP GET. The
script has no cookie jar and sends no authenticated user credentials.

| Approved request | Relevant handler / operation | Result of audit |
|---|---|---|
| `GET /api/public/health` | `server/api/public/health.get.ts:7-15`; D1 `SELECT COUNT(*)` | Read-only |
| `GET /` | `app/pages/index.vue:2-4` SSR `useFetch('/api/public/works')`; global `app/middleware/auth.ts:8-42`, `app/layouts/default.vue:47`, and `app/composables/useLanternAuth.ts:33-64` resolve session identity with D1 `SELECT`; `server/api/public/works.get.ts:17-47` runs `SELECT` | Read-only |
| `GET /login` | `app/pages/login.vue:30-53` client-only config/CSRF GETs and `app/pages/login.vue:69` POST login are not executed by a non-browser fetch; global auth middleware uses D1 `SELECT` only | Read-only |
| `GET /discover` | `app/pages/discover.vue:13-18` SSR `useFetch('/api/public/works')`; same `SELECT`-only works handler and global auth middleware | Read-only |
| `GET /api/public/works` | `server/api/public/works.get.ts:17-47`; D1 `SELECT` | Read-only |
| `GET /api/auth/me` | `server/api/auth/me.get.ts:4-23`; D1 `SELECT` | Read-only |
| `GET /verify/invalid-smoke-token` | Nuxt page `app/pages/verify/[token].vue:9-16`; the verification API call is inside browser-only `onMounted`, so the smoke fetch does not invoke it | Read-only for this rehearsal fixture |
| `GET /logout` | `server/routes/logout.get.ts:5-8`; returns 405, no D1/R2 access | Read-only |
| `GET /media/smoke-missing-object` with `Range` | `server/routes/media/[...key].get.ts:101-103` forwards to `LANTERN_MEDIA_ORIGIN`; `lantern-media-rehearsal/src/media_worker.py:61-148` only calls R2 `head` / `get`; no `put`, `delete`, or write API is used | Read-only |

Cookie side effects were checked separately. An invalid session cookie can be
cleared by `server/utils/lantern-auth.ts:155-189`, and the browser-only login
CSRF path can set a cookie via `server/utils/lantern-auth.ts:67-80`. The smoke
script sends no cookies and does not execute client-side login code, so neither
side effect is part of the rehearsal sequence.

Strict fixture audit for `GET /media/a1-rehearsal/cover.png`,
`GET /media/smoke-missing-object`, and `GET /media/a1-rehearsal/video.mp4` with
`Range: bytes=2-5`: each follows the same forwarded media path and performs only
R2 `head` / `get`. No fixture upload, object overwrite, delete, D1 write, schema
change, or authenticated-user data access is part of the approved sequence.

Write-capable path excluded from this rehearsal: `server/api/auth/verify.get.ts:7-10`
and `server/utils/lantern-email-verification.ts:41-57` can UPDATE `users` and
`email_tokens` when called with a valid verification token. The approved smoke
fixture requests only the page shell at `/verify/invalid-smoke-token`; it does
not call `/api/auth/verify`. Do not substitute a real verification token or use
a browser-driven verification during B7.

A1 rollback procedure audit: `docs/CUTOVER_RUNBOOK.md` §9 (lines 123-145)
contains the production `npx wrangler rollback ... --name lantern` version
activation. That command is mutating and remains separately authorized; it is
not part of this rehearsal. The rehearsal uses only the staging version
activations in §6 below, with interactive confirmation and no `--yes` / `-y`.
The production emergency rollback instructions are preserved unchanged.

## Final staging snapshot decision (owner-delegated)

For B7-STAGING-20261126-01 only:

- **NO staging D1 Time Travel bookmark is required.**
- **NO staging R2 snapshot is required.**

Rationale: the rehearsal changes Worker versions only, and the source audit above
confirms the entire approved test sequence is read-only. No fixture uploads,
database writes, schema changes, or storage mutations are authorized. This
decision does not alter production rollback planning recorded in
`docs/ROLLBACK_REHEARSAL_CHECKLIST.md`; it applies only to the staging
D1/R2 resources named in §2.

**Purpose:** Satisfy the rollback checklist's pre-execution incident/window-record precondition for a new staging-only B7 rehearsal.

## 1. Authorization and boundary

The project owner explicitly authorized the staging-only B7 completion plan, including a separate clean worktree, a pre-execution window record, and a new staging Worker-version activation/rollback rehearsal.

This authorization is limited to the staging resources listed below. It does **not** authorize production deployment, production rollback, production database or bucket access, secret changes, route/domain/DNS changes, production traffic changes, production writes, or production cutover. Opening this record does not close B1, G1, G2, or G3.

## 2. Scope

| Resource | Exact target | Allowed activity |
|---|---|---|
| Nuxt rehearsal Worker | `lantern-nuxt-rehearsal` | Read version/deployment metadata; activate only the verified staging versions below; verify; restore Version A |
| Rehearsal hostname | `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev` | Application and media smoke requests only |
| D1 | `lantern-staging-db` (`5ce6be03-45c1-465e-a461-20e40148404e`) | Exercise staging behavior through the Worker only; no schema changes or direct mutations |
| R2 | `lantern-staging-media` | Read-only media fixture requests; no object writes or deletes |
| Media Service Binding | `LANTERN_MEDIA_ORIGIN` → `lantern-media-rehearsal` | Verify target and media response behavior; do not redeploy or reconfigure the media Worker |

No other Worker is in scope. In particular, do not use production Workers `lantern` or `lantern-media`.

## 3. Candidate versions — revalidate before use

These IDs come from the November 24 rehearsal evidence. They are **candidates**, not assumed current state. Before any activation, confirm both still exist, belong to `lantern-nuxt-rehearsal`, have the expected staging-only bindings, and are compatible with the currently active staging media Worker.

| Label | Candidate version ID | Intended role |
|---|---|---|
| Version A | `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad` | Known-good baseline and exact rollback target |
| Version B | `34625007-ff3d-4809-9e6e-95ad80e27def` | Second staging version for activation test |

**Hard preconditions:**

- The active deployment for `lantern-nuxt-rehearsal` must show Version A at 100%. If it does not, stop without deploying; do not silently choose a different baseline.
- Both candidate versions must still exist and be deployable on that same rehearsal Worker.
- Version metadata/configuration must show staging-only D1/R2 and the `LANTERN_MEDIA_ORIGIN` binding to `lantern-media-rehearsal`.
- The media rehearsal Worker must remain bound only to `lantern-staging-media`.
- Neither rehearsal Worker may have production routes, custom domains, or triggers.
- If a version, Worker identity, binding, hostname, or permission cannot be established, stop and request a revised window. Do not upload or create replacement versions under this record.

## 4. Clean-worktree handling

The original local checkout is known to contain valuable dirty and untracked work and to be behind the remote. It must remain untouched.

Use a separate detached worktree from `docs/b1-production-media-readiness`. Do not pull, reset, clean, stash, switch branches in, or run install/build commands inside the original dirty checkout. Record the new worktree path, HEAD, and clean status before any remote operation.

The branch head last inspected for this record was `471b63fbba0bdaf922c1bd0de8c056683f935f0a`. If the branch moves, stop and review the new diff before proceeding rather than silently using a different tree.

## 5. Preflight — read-only

Run from the separate worktree after confirming its clean status and the project instructions:

```sh
git status --short --branch
git rev-parse HEAD
npx wrangler --version
npx wrangler versions list --name lantern-nuxt-rehearsal --json
npx wrangler deployments list --name lantern-nuxt-rehearsal --json
npx wrangler versions view 23f0ed07-d9a8-4e08-9b6e-0b4d814280ad --name lantern-nuxt-rehearsal --json
npx wrangler versions view 34625007-ff3d-4809-9e6e-95ad80e27def --name lantern-nuxt-rehearsal --json
npx wrangler versions list --name lantern-media-rehearsal --json
npx wrangler deployments list --name lantern-media-rehearsal --json
```

Confirm from current version/deployment metadata and `wrangler.rehearsal.jsonc` that the Nuxt rehearsal Worker has only staging D1/R2 bindings, the `LANTERN_MEDIA_ORIGIN` Service Binding points to `lantern-media-rehearsal`, and the media rehearsal Worker uses only `lantern-staging-media`. Confirm no routes, custom domains, or triggers are attached to either rehearsal Worker. Do not inspect or print credential files or secret values.

Record the operator/account, start timestamp, active deployment/version, candidate version metadata, media Worker active version, and observed binding identifiers before the first deployment command.

## 6. Execution sequence

Use Wrangler's interactive confirmation. **Do not add `--yes` / `-y`.** Run each deployment command separately, inspect the prompt, and confirm only after verifying that the target is `lantern-nuxt-rehearsal`.

1. With Version A confirmed active at 100%, run the smoke checks in §7 and record the baseline result. Do not deploy a different version to establish the baseline.
2. Activate Version B at 100% on the staging rehearsal Worker:

   ```sh
   npx wrangler versions deploy 34625007-ff3d-4809-9e6e-95ad80e27def@100% --name lantern-nuxt-rehearsal --message "B7-STAGING-20261126-01: activate Version B"
   ```

3. Confirm the deployment list reports Version B at 100%. Run all application and strict media checks in §7.
4. Restore exact Version A at 100%:

   ```sh
   npx wrangler versions deploy 23f0ed07-d9a8-4e08-9b6e-0b4d814280ad@100% --name lantern-nuxt-rehearsal --message "B7-STAGING-20261126-01: restore exact Version A"
   ```

5. Confirm Version A is again at 100%. Run all application and strict media checks one final time. Capture deployment IDs and end timestamp.

## 7. Required verification at A, B, and after rollback

Run the repository's staging smoke script each time:

```sh
node scripts/rehearsal-smoke-check.mjs https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev
```

All required checks must pass, including health/public API responses identifying `source: "staging"`, application shell, login, discovery, anonymous session, verification alias, logout parity, and media origin.

Additionally verify these fixture responses each time:

| Request | Expected result |
|---|---|
| `GET /media/a1-rehearsal/cover.png` | HTTP 200; `Content-Type: image/png`; 11 bytes; SHA-256 `2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c` |
| `GET /media/smoke-missing-object` | HTTP 404; body `Media not found.` |
| `GET /media/a1-rehearsal/video.mp4` with `Range: bytes=2-5` | HTTP 206; body `cdef`; `Content-Range: bytes 2-5/10` |

No strict media check may return HTTP 503. Do not use authenticated user data or real user media.

## 8. Stop and rollback rules

- Any unexpected production identifier, binding, route, custom domain, trigger, deployment target, or prompt: stop; do not confirm.
- If a smoke or strict media check fails after Version B activation: immediately restore Version A using the command in §6, verify Version A at 100%, rerun all checks, and record the failure. Do not continue.
- If Version A cannot be restored or post-rollback verification fails: stop further changes and escalate to the project owner. Do not touch production.
- If the approved window expires before completion: stop. Do not continue under this record; open a new pre-execution window.
- Do not use production rollback commands. Do not make changes to `lantern`, `lantern-media`, production D1/R2, secrets, DNS, routes, domains, or production traffic.

## 9. Closure record — fill only after execution

| Field | Result |
|---|---|
| Operator/account | NOT RECORDED |
| Actual start / end (Asia/Jakarta and UTC) | NOT EXECUTED |
| Worktree path / HEAD / clean status | NOT RECORDED |
| Preflight active deployment and bindings | NOT RECORDED |
| Version A baseline smoke checks | NOT EXECUTED |
| Version B activation deployment ID / result | NOT EXECUTED |
| Version A restore deployment ID / result | NOT EXECUTED |
| Smoke checks at B and after rollback | NOT EXECUTED |
| Strict media checks at A / B / after rollback | NOT EXECUTED |
| Production resources changed | NO — no production action is in scope |
| Errors / deviations | NOT RECORDED |
| Window disposition | EXPIRED — NOT EXECUTED; superseded by B7-STAGING-20261126-02 |

B7 remains **FORMALLY OPEN** until the execution evidence above is complete and independently reviewed. Opening this record does not itself pass B7 or G2. Do not update release-gate flags to PASS merely because this record exists.
