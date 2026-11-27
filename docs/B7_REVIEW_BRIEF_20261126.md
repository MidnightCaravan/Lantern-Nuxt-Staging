# B7 evidence package and owner closure record — 2026-11-26, updated 2026-11-27

**Status:** CLOSED BY EXPLICIT PROJECT-OWNER ACCEPTANCE
**Purpose:** Record the existing B7 evidence and the project owner's explicit
acceptance of that evidence in lieu of independent review. This closes B7 and
passes G2 only. It does not pass G1 or G3, is not an independent sign-off, and
does not authorize a production change. The project owner's B7-T1 exception and
fresh B7-T2 evidence are recorded below as owner-supplied dispositions, not as
independent reviewer findings.
**Review status:** No independent human review was performed. No reviewer name,
role, review date/time, findings, signed conclusion, signature, or independent
sign-off is recorded or invented.
**Preparer status:** The documentation preparer was involved in the rehearsal and
evidence preparation and is not an independent reviewer.

## 1. Evidence to review

| Item | Value |
|---|---|
| Record | `B7-STAGING-20261126-02` |
| Approved window | 2026-11-26 15:10–18:10 Asia/Jakarta |
| Worker | `lantern-nuxt-rehearsal` |
| Hostname | `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev` |
| Version A / exact restore target | `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad` |
| Version B / activation test | `34625007-ff3d-4809-9e6e-95ad80e27def` |
| Version B deployment | `3360865e-1ea7-4fdc-8961-b806a0917833` |
| Version A restore deployment | `606250b3-72ca-4c5d-be6c-96b7b5f3cb53` |
| Final active state | Version A at 100%; confirmed by recorded Wrangler deployment-status JSON |
| Application checks | 9/9 passed at Version A baseline, Version B, and after Version A restoration |
| Strict media fixtures | 3/3 passed at Version A baseline, Version B, and after Version A restoration |
| Cover fixture | HTTP 200, `image/png`, 11 bytes, SHA-256 `2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c` |
| Missing fixture | HTTP 404, body `Media not found.` |
| Range fixture | HTTP 206, body `cdef`, `Content-Range: bytes 2-5/10` |
| Production isolation | No production Worker, D1, R2, secret, route, domain, DNS record, or traffic setting was changed, according to the execution record |
| Evidence publication | Evidence commit `72722110b5fc638379d4a3290ae6ce914bbbf416` was pushed to the PR #12 branch and merged into `main` by `f5931897af986c2ef56465218136b35ab5c4d4ea` |
| CI on reviewed merge | GitHub Actions Verify run #28 on `f5931897af986c2ef56465218136b35ab5c4d4ea` succeeded |

Authoritative evidence links:

- `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §9 — execution evidence,
  deployment IDs, smoke and strict-media results, and deviations.
- `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` §12 — 2026-11-27 owner
  disposition for B7-T1, fresh Dashboard evidence for B7-T2, and §12.3 owner
  closure.
- `docs/REHEARSAL_RECORD.md` §11 — November 26 technical summary and findings;
  §12 records the 2026-11-27 update and owner closure.
- `docs/REHEARSAL_RECORD.md` §10 — retained November 24 historical evidence; it
  is not rewritten by this package.
- `docs/ROLLBACK_REHEARSAL_CHECKLIST.md` — “Closing B7” status.
- `docs/release-gates.json` — `B7.closed=true`, `G2.pass=true`, and
  `G2.blockers=[]`; `G1.pass=false`, `G3.pass=false`, and `B1.closed=false`
  remain unchanged.

## 2. Findings and owner dispositions

### B7-T1 — Confirmed procedural deviation; owner exception recorded

The Version B activation used a fully specified Wrangler command during prompt
inspection. Wrangler presented no confirmation prompt, so the intended
interactive-only confirmation was not achieved for that activation. Deployment
`3360865e-1ea7-4fdc-8961-b806a0917833` completed on `lantern-nuxt-rehearsal` at
100%, and the subsequent 9/9 application and 3/3 strict-media checks passed.
Exact Version A restoration later completed manually under deployment
`606250b3-72ca-4c5d-be6c-96b7b5f3cb53` at 100%.

**Project-owner disposition, 2026-11-27 Asia/Jakarta:** the project owner
explicitly accepted the missing interactive confirmation as a **ONE-TIME
STAGING-ONLY PROCEDURAL EXCEPTION**.

| Field | Recorded value |
|---|---|
| Worker | `lantern-nuxt-rehearsal` |
| Window | `B7-STAGING-20261126-02` |
| Version B deployment | `3360865e-1ea7-4fdc-8961-b806a0917833` |
| Accepted scope | This single staging activation only |
| Decision date | 2026-11-27, Asia/Jakarta |
| Approval minute | Not available in the preserved evidence; not invented here |

Do not describe the activation as interactive. This exception does not waive
interactive confirmation for future operations and does not authorize production
changes.

### B7-T2 — Fresh Dashboard evidence recorded

The window record carries forward Cloudflare dashboard settings observed on
2026-11-25. Those dashboard settings are historical evidence only. Fresh
2026-11-26 Wrangler metadata in record 02 §9.1 verified the staging D1
identifier `5ce6be03-45c1-465e-a461-20e40148404e`, the staging R2 bucket
`lantern-staging-media`, the `LANTERN_MEDIA_ORIGIN` Service Binding target
`lantern-media-rehearsal`, and the media Worker's `lantern_media` →
`lantern-staging-media` binding. Those binding identifiers are verified and were
never missing from the evidence.

Fresh owner-supplied Cloudflare Dashboard screenshots provide the remaining
B7-T2 evidence. Their macOS menu-bar timestamps are 2026-11-27, Asia/Jakarta.

| Worker | Dashboard view | Menu-bar time | Observed result |
|---|---|---|---|
| `lantern-nuxt-rehearsal` | Domains | 02:35 | workers.dev ON; Preview / Version URLs OFF; no custom domains; no custom routes |
| `lantern-nuxt-rehearsal` | Settings → Trigger events | 02:38 | no Cron triggers; no Queue consumers; no Email routing rules |
| `lantern-media-rehearsal` | Domains | 02:39 | workers.dev OFF; Preview / Version URLs OFF; no custom domains; no custom routes |
| `lantern-media-rehearsal` | Settings → Trigger events | 02:40 | no Cron triggers; no Queue consumers; no Email routing rules; Other triggers shows `lantern-nuxt-rehearsal (production) fetch()` |

The `lantern-nuxt-rehearsal (production) fetch()` entry is the expected internal
Service Binding invocation between the rehearsal Workers, not a public domain,
custom route, Cron trigger, Queue consumer, or Email routing rule. The
Dashboard's `Production` label is the selected environment within the named
rehearsal Worker; it does not turn `lantern-media-rehearsal` into the production
application Worker. No independent human review was performed; the project owner
explicitly accepted this evidence for B7 closure.

## 3. Owner acceptance and closure

The project owner explicitly accepted the existing evidence in this package on
2026-11-27 and explicitly authorized B7 closure in lieu of independent review.

| Item | Recorded value |
|---|---|
| Existing evidence accepted | §9 execution record; §12.1 B7-T1 owner exception; §12.2 B7-T2 Dashboard evidence; verified Wrangler binding metadata |
| Owner decision | Explicit acceptance of existing evidence and closure of B7, 2026-11-27 |
| Approval minute | Not preserved and not invented here |
| Independent review | Not performed; no reviewer identity, role, review date/time, findings, signed conclusion, signature, or independent sign-off is recorded or invented |
| Gate effect | `B7.closed=true`; `G2.pass=true`; `G2.blockers=[]` |
| Unchanged gates | `G1.pass=false`; `G3.pass=false`; `B1.closed=false`; `sourceCommit=962cd95` |
| Production effect | No production deployment, activation, rollback, secret change, write enablement, traffic change, or cutover is authorized |

This is owner acceptance, not an independent reviewer conclusion. It closes B7
only. G1/B1 and G3 remain blocked.

## 4. Disposition and closure record

**Project-owner decision on B7-T1:** RECORDED 2026-11-27 Asia/Jakarta — project
owner accepted a ONE-TIME STAGING-ONLY PROCEDURAL EXCEPTION for Worker
`lantern-nuxt-rehearsal`, window `B7-STAGING-20261126-02`, Version B deployment
`3360865e-1ea7-4fdc-8961-b806a0917833`, single staging activation only; exact
approval minute not preserved.

**Project-owner disposition for B7-T2:** RECORDED 2026-11-27 Asia/Jakarta —
owner-supplied Cloudflare Dashboard screenshots at 02:35, 02:38, 02:39, and
02:40 provide the fresh live-settings evidence for both rehearsal Workers; the
2026-11-26 Wrangler binding metadata was already verified and was never missing.

**Project-owner closure of B7:** RECORDED 2026-11-27 — explicit owner acceptance
of the existing evidence in lieu of independent review. No reviewer identity,
role, review date/time, findings, signed conclusion, signature, or independent
sign-off exists or is invented. This closes B7 and passes G2 only; G1, G3, and
B1 remain blocked, and no production action is authorized.
