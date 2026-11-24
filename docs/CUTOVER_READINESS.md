# Lantern cutover readiness report

**Status:** NOT READY for production cutover
**Scope:** approved A1 preparation; local configuration, tests, and documentation only
**Last verified:** new worktree at `439caf3` with local A1 preparation; no Cloudflare mutation
**Cutover runbook:** `docs/CUTOVER_RUNBOOK.md` (prepared; traffic rollback not rehearsed)
**Production migration plan:** `docs/PRODUCTION_MIGRATION_PLAN.md` (read-only inspection complete; no migrations executed)
**Rehearsal record:** `docs/A1_STAGING_REHEARSAL_20261120.md` (staging A1 evidence only)
**A1 preparation record:** `docs/A1_PRODUCTION_CUTOVER_PREP_20261124.md`
**Release preparation:** `docs/RELEASE_READINESS_20261124.md`
**Targeted source audit:** `docs/PARITY_AUDIT_20261119.md` (confirmed gaps fixed; differences recorded)

## 1. Executive summary

The Flask → Nuxt migration has a green staging harness: all 48 inventoried Flask routes have an explicit disposition and behavior tests pass against in-memory D1/R2 doubles. Staging A1 also verified the media proxy, Range behavior, HEAD, headers, streaming, errors, and staging-preview authorization. This establishes **staging behavioral coverage**, not production readiness.

The owner approved A1:

- deploy Nuxt as a new version of the existing Worker `lantern`;
- retain `workers_dev: true` and `https://lantern.midnightcaravans.workers.dev`;
- use a private Flask Worker `lantern-media` as the `LANTERN_MEDIA_ORIGIN` Service Binding target;
- keep production writes disabled;
- preserve B5 (Flask remains the temporary media origin);
- require no DNS, custom domain, route, or `zone:edit` change.

The release and media Worker templates are prepared locally, but B1, B7, and G3 remain open. No deploy, secret change, traffic change, or production write is authorized by this document.

## 2. Evidence summary

| Area | Evidence | Result |
|---|---|---|
| Route coverage | `npm run parity:routes`, `docs/parity-route-map.json` | 48 routes reviewed; `vendor=2`, `api=29`, `covered=11`, `alias=4`, `embedded=2`, `gap=0` |
| Staging behavior | `npm run verify` in staging A1 evidence | Historic A1 run: 29 test files / 253 tests, build green |
| Media semantics | `tests/media-origin-proxy.test.ts`, `tests/media-head-parity.test.ts`, `tests/media-range-parity.test.ts`, private media Worker source comparison | Staging behavior verified; production media Worker source is a verbatim copy |
| Release shape | `tests/release-config.test.ts`, `tests/environment-configs.test.ts`, `tests/media-release-config.test.ts` | Focused local assertions added/updated for approved A1 |
| Release gate check | `npm run release:check`, `docs/release-gates.json` | NOT READY because B1, B7, and G3 are open |

Covered behavior domains: login/registration/token flows, profile and work creation, work ownership/deletion, novel chapters, comic pages/episodes, discussions, publishing, public discovery/readers, video upload, media serving, thumbnails, and staging/production isolation.

## 3. A1 release architecture

| Property | Prepared value | Evidence |
|---|---|---|
| Nuxt Worker name | `lantern` | `wrangler.release.jsonc`, `tests/release-config.test.ts` |
| Public hostname | `https://lantern.midnightcaravans.workers.dev` | Inherent to `lantern` + `workers_dev: true`; no route/domain declared |
| `workers_dev` / `preview_urls` | `true` / `false` | `wrangler.release.jsonc`, focused tests |
| Media origin | `lantern-media` via `LANTERN_MEDIA_ORIGIN` | `wrangler.release.jsonc`, `wrangler.media-release.jsonc` |
| Media Worker endpoint | private; Service Binding only | `workers_dev: false`, `preview_urls: false`, no routes/domains/triggers |
| Production writes | disabled | `LANTERN_ENABLE_PRODUCTION_WRITES` intentionally absent |
| B5 media origin | Flask | Private `lantern-media` Worker uses the verbatim Flask media branch |

## 4. Open blockers

| Gate | Status | Required resolution |
|---|---|---|
| B1 | **Prepared, not deployed or verified** | Deploy private `lantern-media`, then deploy `lantern` with the approved template, and attach operational evidence. Do not close from local tests alone. |
| B7 | **Not rehearsed for A1** | Rehearse the exact `lantern` Worker-version rollback path with an approved non-production target. The historic Flask version is `93be1fa1-8ac2-49c7-adf3-2682b3be8365`. Do not close from documentation alone. |
| G3 | **Pending** | Create a real commit-matched four-role `docs/release-signoff.json`. Do not fabricate approval. |

## 5. Production data and media

- Production D1 was read-only inspected on 2026-11-24: all four migrations are recorded and no DDL was executed. No production data was written.
- Production R2 `lantern-media` is the intended media Worker binding. No object was read, listed, written, or deleted during this preparation.
- `LANTERN_ENABLE_PRODUCTION_WRITES` remains absent; production login and mutations fail closed until separately enabled.
- No media URL constant was changed. B5 remains preserved.

## 6. Gate summary

| Gate | Status | Detail |
|---|---|---|
| G0 — Staging behavioral parity | **PASS** | 48 routes dispositioned; A1 staging evidence recorded |
| G1 — Operational readiness | **BLOCKED** | B1 prepared but not deployed or operationally verified |
| G2 — Release controls | **BLOCKED** | B7 A1 rollback rehearsal not executed; B6 is the `npm run release:check` gate |
| G3 — Explicit sign-off | **PENDING** | Required before any production mutation or deploy enablement |

## 7. Required owner/release actions

1. Keep production read-only until B1, B7, G3, and any secret requirements are resolved.
2. Separately authorize deployment of `lantern-media` and `lantern`.
3. Verify the exact rollback procedure and version before the window.
4. Create genuine sign-off evidence.
5. Run `npm run release:check` after all gates are genuinely satisfied.

Local preparation does not grant deployment authority.
