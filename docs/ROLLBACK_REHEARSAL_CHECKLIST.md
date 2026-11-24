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
- [ ] Rehearsal Worker name and owner authorization recorded.
- [ ] Staging fixture versions and bindings recorded.
- [ ] Test plan distinguishes Worker-version rollback from traffic activation. No DNS/route flip is involved.
- [ ] Incident/window record opened.

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

B7 stays open until the rehearsal is actually executed, evidence is appended to
the window record, `B7.closed` is set to `true` with that evidence, and
`npm run release:check` is rerun. This checklist alone does not close B7.
