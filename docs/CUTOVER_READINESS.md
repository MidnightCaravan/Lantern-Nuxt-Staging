# Lantern cutover readiness report

**Status:** NOT READY for production cutover
**Scope:** approved A1 preparation; local configuration, tests, documentation, and read-only Cloudflare deployment metadata audit
**Last verified:** 2026-11-25 read-only Cloudflare audit and documentation review; production `lantern-media` is deployed, while Nuxt production activation and runtime proof remain outstanding
**Cutover runbook:** `docs/CUTOVER_RUNBOOK.md` (A1 staging Worker-version rollback technically passed; formal B7 closure pending the incident/window-record precondition)
**Production migration plan:** `docs/PRODUCTION_MIGRATION_PLAN.md` (read-only inspection complete; no migrations executed)
**Rehearsal records:** `docs/A1_STAGING_REHEARSAL_20261120.md` (November 20 staging evidence); `docs/REHEARSAL_RECORD.md` §10 (November 24 Worker-version rollback; formal B7 closure pending)
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

The production media Worker `lantern-media` is deployed and its R2 binding metadata is verified, but its live privacy/access settings still require independent verification. The Nuxt `lantern` production Service Binding has not been activated and runtime proof is outstanding, so B1 remains open. The A1 staging Worker-version rollback technically passed, but B7 remains formally open because the pre-execution incident/window-record precondition was not met. G3 remains open. This document does not authorize a Nuxt deployment, secret change, traffic change, or production write.

## 2. Evidence summary

| Area | Evidence | Result |
|---|---|---|
| Route coverage | `npm run parity:routes`, `docs/parity-route-map.json` | 48 routes reviewed; `vendor=2`, `api=29`, `covered=11`, `alias=4`, `embedded=2`, `gap=0` |
| Staging behavior | `npm run verify` in staging A1 evidence | Historic A1 run: 29 test files / 253 tests, build green |
| Media semantics | `tests/media-origin-proxy.test.ts`, `tests/media-head-parity.test.ts`, `tests/media-range-parity.test.ts`, media Worker source comparison | Staging behavior verified; production media Worker deployment and R2 binding metadata verified; live privacy/access settings remain unverified |
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
| B1 | **Partially complete; Nuxt activation outstanding** | `lantern-media` is deployed and its production R2 binding metadata is verified. Independently verify live privacy/access settings, then deploy `lantern` with `LANTERN_MEDIA_ORIGIN` and record runtime evidence. Do not close from local tests or template metadata alone. |
| B7 | **Technical rehearsal passed; formal closure pending** | The 2026-11-24 staging A1 Worker-version rollback passed technically. The pre-execution incident/window-record checklist precondition was not met; record an explicit owner-approved exception or run a new rehearsal under a properly opened window record. DNS/route switching is not part of A1. |
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
| G1 — Operational readiness | **BLOCKED** | Media Worker deployment/binding metadata verified, but live privacy settings and Nuxt Service Binding activation/runtime proof remain outstanding |
| G2 — Release controls | **BLOCKED** | Staging rollback technically passed; formal B7 closure is pending the incident/window-record precondition; B6 is the `npm run release:check` gate |
| G3 — Explicit sign-off | **PENDING** | Required before any production mutation or deploy enablement |

## 7. Required owner/release actions

1. Keep production read-only until B1, B7, G3, and any secret requirements are resolved.
2. Separately authorize deployment of `lantern-media` and `lantern`.
3. Verify the exact rollback procedure and version before the window.
4. Create genuine sign-off evidence.
5. Run `npm run release:check` after all gates are genuinely satisfied.

Local preparation does not grant deployment authority.
