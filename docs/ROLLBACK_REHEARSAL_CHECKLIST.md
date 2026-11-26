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

## Preconditions

- [x] A1 architecture selected by owner: same Worker name, workers.dev, private media Worker.
- [x] Release and media Worker templates prepared locally.
- [x] Historic production rollback version recorded.
- [x] Rehearsal Worker name and owner authorization recorded (see `docs/REHEARSAL_RECORD.md` §10.1 and §10.6).
- [x] Staging fixture versions and bindings recorded (see `docs/REHEARSAL_RECORD.md` §10.1–§10.3).
- [x] Test plan distinguishes Worker-version rollback from traffic activation. No DNS/route flip is involved under A1.
- [ ] Incident/window record opened before execution.

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
