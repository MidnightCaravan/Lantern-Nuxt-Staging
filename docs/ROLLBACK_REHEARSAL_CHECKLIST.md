# B7 — A1 Worker-version rollback rehearsal checklist

This is a fill-in record for the **non-production** rehearsal required to close
B7 for the approved A1 architecture. It does not authorize a production
cutover, deployment, or rollback. The authoritative production procedure is
`docs/CUTOVER_RUNBOOK.md` §9.

## A1 architecture decision

The owner approved same-name A1 deployment on `lantern` with a private
`lantern-media` Service Binding target. The canonical hostname remains
`https://lantern.midnightcaravans.workers.dev` through workers.dev. There is no
DNS record, route, custom domain, or `zone:edit` operation to flip. Earlier
DNS/route-based steps were historical and are superseded.

## Rollback target

| Item | Value / status |
|---|---|
| Production Worker | `lantern` |
| Historic Flask version | `93be1fa1-8ac2-49c7-adf3-2682b3be8365` |
| Production rollback command when separately authorized | `npx wrangler rollback 93be1fa1-8ac2-49c7-adf3-2682b3be8365 --name lantern` |
| Rehearsal target | A non-production Worker name only; never live `lantern` |
| D1 snapshot | Record Time Travel bookmark before any production window; no restore in rehearsal |
| R2 snapshot | None required under B5; no object rollback in rehearsal |

The D1/R2 entries above describe production rollback planning. The owner-delegated
staging rehearsal snapshot decision is recorded below and does not change those
production instructions.

## Preconditions

- [x] A1 architecture selected by owner: same Worker name, workers.dev, private media Worker.
- [x] Release and media Worker templates prepared locally.
- [x] Historic production rollback version recorded.
- [x] Rehearsal Worker name and owner authorization recorded (see `docs/REHEARSAL_RECORD.md` §10.1 and §10.6).
- [x] Staging fixture versions and bindings recorded (see `docs/REHEARSAL_RECORD.md` §10.1–§10.3).
- [x] Test plan distinguishes Worker-version rollback from traffic activation. No DNS/route flip is involved under A1.
- [x] Incident/window record opened before execution (see `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md`; record 01 expired and was not executed).

## Owner-observed Cloudflare evidence (2026-11-25)

Recorded from owner-provided Cloudflare dashboard screenshots, observed
2026-11-25 approximately 23:02–23:12 Asia/Jakarta (UTC+07:00). The complete
non-secret inventory is carried forward in
`docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md` (and originally recorded in
record 01) under "Owner-observed Cloudflare evidence":

- `lantern-media-rehearsal`: workers.dev OFF, Preview URLs OFF, 0 custom domains,
  no routes, no Cron triggers, no queue consumers, no email routing rules, and
  exactly one R2 binding `lantern_media` → `lantern-staging-media`. The listed
  other trigger is `lantern-nuxt-rehearsal fetch()`.
- `lantern-nuxt-rehearsal`: workers.dev ON, Preview URLs OFF, no custom domains,
  no routes, no Cron triggers, no queue consumers, and no email routing rules.

## Nov 26, 2026 execution preparation

- Active window record: `docs/B7_STAGING_REHEARSAL_WINDOW_20261126_02.md`
  (`B7-STAGING-20261126-02`).
- Approved window: **2026-11-26 15:10–18:10 Asia/Jakarta** (08:10–11:10 UTC).
- Previous record `B7-STAGING-20261126-01` (09:00–12:00 Asia/Jakarta) is
  **EXPIRED — NOT EXECUTED**. No staging version activation, smoke check, or
  rollback was performed under it.
- Version A / exact rollback target: `23f0ed07-d9a8-4e08-9b6e-0b4d814280ad`.
- Version B / activation test: `34625007-ff3d-4809-9e6e-95ad80e27def`.
- Candidate IDs must still be revalidated before activation under the window
  record's hard preconditions.
- Use interactive Wrangler confirmation only; never add `--yes` / `-y`.
- Execution timestamps, deployment IDs, operator details, smoke results, and
  closure evidence remain unrecorded until the rehearsal is executed under the
  active window. Do not execute outside 15:10–18:10 Asia/Jakarta.

## Read-only source audit and staging snapshot decision

The approved rehearsal sequence was audited from source on 2026-11-25. All nine
checks in `scripts/rehearsal-smoke-check.mjs:10-31` are HTTP GETs, including the
direct `/api/public/works` check. The relevant handlers perform D1 `SELECT`
statements (`server/api/public/health.get.ts:7-15`,
`server/api/public/works.get.ts:17-47`, `server/api/auth/me.get.ts:4-23`, plus
global auth middleware `app/middleware/auth.ts:8-42`) and R2 `head` / `get`
through the staging media Service Binding
(`server/routes/media/[...key].get.ts:101-151`,
`lantern-media-rehearsal/src/media_worker.py:61-148`). The script sends no
cookies and does not execute the browser-only cookie-setting login path. No
`put`, `delete`, schema change, fixture upload, POST/PUT/PATCH/DELETE, or
authenticated-user data access is part of the approved sequence.

The write-capable `/api/auth/verify` path
(`server/utils/lantern-email-verification.ts:41-57`) is excluded: the smoke
script fetches only the `/verify/invalid-smoke-token` page shell, and the
verification API call in `app/pages/verify/[token].vue:9-16` is browser-only
`onMounted` code that a non-browser fetch does not execute. Do not substitute a
real verification token or use browser-driven verification during B7.

Final owner-delegated decision for this staging rehearsal only:

- **NO staging D1 Time Travel bookmark required.**
- **NO staging R2 snapshot required.**

Rationale: the rehearsal changes Worker versions only, and the source audit
confirms the entire approved test sequence is read-only. No fixture uploads,
database writes, schema changes, or storage mutations are authorized. This does
not change the production rollback command or snapshot planning above.

The A1 production rollback command in `docs/CUTOVER_RUNBOOK.md` §9 is a mutating
version activation that remains separately authorized. Those emergency rollback
instructions are preserved unchanged and are not executed by this rehearsal.

**2026-11-24 outcome:** the staging technical rehearsal was completed and is
recorded in `docs/REHEARSAL_RECORD.md` §10. The incident/window-record
precondition was not met before execution; the retrospective evidence in §10
is not a substitute for a pre-execution record. B7 therefore remains formally
open pending an explicitly recorded owner exception or a new rehearsal under a
properly opened window record.

## Rehearsal steps

Perform against a non-production Worker whose bindings are staging-only.

| Step | Action | Evidence |
|---|---|---|
| 1 | Record active rehearsal version and binding metadata | `[before version / bindings]` |
| 2 | Deploy a known-good rehearsal version | `[version A]` |
| 3 | Run approved staging smoke checks, including one `/media/*` check | `[smoke output]` |
| 4 | Deploy a second rehearsal version representing the Nuxt build | `[version B]` |
| 5 | Confirm rehearsal hostname and media Service Binding still resolve | `[checks]` |
| 6 | Roll back the rehearsal Worker to version A | `[rollback command/output]` |
| 7 | Confirm active version, hostname, and smoke checks after rollback | `[after version / smoke output]` |
| 8 | Record timing and any errors | `[timeline]` |

## Completion criteria

- The rollback restored the exact previously active rehearsal version.
- The rehearsal hostname remained unchanged.
- Media requests through the staging Service Binding continued to behave correctly after rollback.
- No production Worker, D1, R2 object, secret, route, domain, DNS record, or traffic setting was changed.

## Closing B7

The 2026-11-24 technical rehearsal is complete, but B7 remains formally open
because the pre-execution incident/window-record precondition was not met.
Close B7 only after the owner explicitly approves and documents an exception
to that missed precondition, or a new A1 staging rehearsal is run under a
properly opened window record. Then update `B7.closed`, set G2 to pass only when
all required criteria are satisfied, and rerun `npm run release:check`. A1 has
no DNS/route rollback step; that is not the outstanding B7 item.
