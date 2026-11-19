# B7 — Route/DNS rollback rehearsal checklist

This is a fill-in record for the **staging** rehearsal required to close B7. It
does not authorize a production cutover. The authoritative procedure is
`docs/CUTOVER_RUNBOOK.md` §8; this checklist turns it into evidence that can be
recorded in `docs/REHEARSAL_RECORD.md`.

## Placeholders to fill before starting

| Placeholder | Meaning |
|---|---|
| `[zone/record]` | Cloudflare zone and route/DNS record that points traffic at the Worker |
| `[worker version]` | Last known-good Flask Worker version / rollback artifact |
| `[snapshot id]` | Production D1 snapshot identifier (and R2 snapshot id if B5 is ever reversed) |
| `[window ticket]` | Incident/change record used for the rehearsal |

## Preconditions

- [ ] The Nuxt Worker is **deployed** to the staging Cloudflare account (rehearsal needs a real route to flip).
- [ ] `[zone/record]` and `[worker version]` are recorded in `docs/CUTOVER_RUNBOOK.md` §4.
- [ ] `[snapshot id]` is recorded and verified restorable.
- [ ] Local parity gate passes: `npm run verify` → 48 routes, gap=0, all tests green, build OK.
- [ ] `wrangler.rehearsal.jsonc` has been reviewed: Worker `lantern-nuxt-rehearsal`, staging-only D1/R2 bindings, no production resource ids or binding names, no routes/domains, `workers_dev: true`
- [ ] Required secrets are configured for the rehearsal Worker (local `.dev.vars` values are not deployed with the config)
- [ ] `npm run release:check` is run and its output retained (expected NOT READY until B1/B7/G3 close).

## Rehearsal steps (runbook §8)

| # | Step | Evidence to capture |
|---|---|---|
| 1 | Announce the rehearsal and open `[window ticket]` | Ticket id, participants, start time |
| 2 | Route `[zone/record]` to the Nuxt Worker; confirm the Nuxt build is live | HTTP status + a distinguishing response header/body sample |
| 3 | Run `node scripts/smoke-check.mjs <workers.dev URL>` for the production-shaped local Worker and `node scripts/rehearsal-smoke-check.mjs <rehearsal workers.dev URL>` for the staged Worker | Pass/fail per check; retain raw output. The latter expects 503 on production-backed endpoints |
| 4 | Revert `[zone/record]` to `[worker version]` | Before/after record values; propagation time |
| 5 | Keep the Nuxt Worker deployed but off-route | Confirm traffic no longer reaches Nuxt |
| 6 | Decide the database state per runbook §8 step 4 — for a rehearsal, **do not restore production D1**; record the decision only | Written decision + approver |
| 7 | Media state: B5 is confirmed for the first cutover, so **no asset rollback is needed** | Note referencing the B5 decision in `docs/CUTOVER_READINESS.md` §6 |
| 8 | Repeat runbook §6 checks against the restored Flask Worker | Pass/fail per check; retain raw output |
| 9 | Record the timeline, signals, failed checks and result in `[window ticket]` | Ticket link |

## Pass criteria

- Traffic was successfully moved to Nuxt **and** restored to `[worker version]`.
- All runbook §6 checks passed on both sides (or any differences are recorded as findings).
- The rollback completed within the planned window with no production D1 or R2 writes.

## Closing B7

Append the result to `docs/REHEARSAL_RECORD.md`, then set `B7.closed` to `true`
in `docs/release-gates.json` with the ticket link as evidence, and update
`docs/CUTOVER_READINESS.md` §4–§6. Run `npm run release:check` again to confirm
G2 clears. **Do not deploy as part of the rehearsal.**
