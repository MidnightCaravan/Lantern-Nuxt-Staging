# B7 — Route/DNS rollback rehearsal checklist

This is a fill-in record for the **staging** rehearsal required to close B7. It
does not authorize a production cutover. The authoritative procedure is
`docs/CUTOVER_RUNBOOK.md` §8; this checklist turns it into evidence that can be
recorded in `docs/REHEARSAL_RECORD.md`.

**Architecture note (2026-11-20):** the original checklist assumes a DNS/route
switch of `[zone/record]`. Read-only inspection found no such record — production
is served directly at `https://lantern.midnightcaravans.workers.dev`. The
DNS-based steps below are therefore **historical/unresolved**, not the assumed
cutover mechanism. A read-only assessment of the three viable architectures is
in `docs/RELEASE_PREPARATION_20261120.md` §8. No option is selected and B7 is
not closed pending the owner's decision.

## Placeholders to fill before starting

| Placeholder | Meaning | Status (2026-11-20 preparation) |
|---|---|---|
| `[zone/record]` | Cloudflare zone and route/DNS record that points traffic at the Worker | **UNRESOLVED — blocking.** The app is served at `https://lantern.midnightcaravans.workers.dev` (a workers.dev URL); the legacy Worker config declares no `routes` or custom domains, `lantern.midnightcaravans.com` has no DNS record, and `midnightcaravans.com` resolves to a Namecheap parking address. No Cloudflare zone/route for Lantern was found. Owner must supply the real switch mechanism. |
| `[worker version]` | Last known-good Flask Worker version / rollback artifact | **CONFIRMED LIVE:** Worker `lantern`, version `93be1fa1-8ac2-49c7-adf3-2682b3be8365`, deployment created `2026-10-26T22:30:22.060Z` (`npx wrangler deployments status --name lantern`). |
| `[snapshot id]` | Production D1 snapshot identifier (and R2 snapshot id if B5 is ever reversed) | **D1 READ ONLY QUERY:** current `lantern-db` Time Travel bookmark `0000025e-00000000-00005129-a71dc0fb6b86f5c41ef6c23cd7a87ddf` (`npx wrangler d1 time-travel info lantern-db`). No restore was performed. R2 snapshot not required while B5 holds. |
| `[window ticket]` | Incident/change record used for the rehearsal | **MISSING** — must be opened by the release manager. |

## Preconditions

- [x] The Nuxt Worker is **deployed** to the staging Cloudflare account: `lantern-nuxt-rehearsal`, version `4919d5b5-88fd-446e-9293-3a54c35b1d13`, nine smoke checks passed (section 9 of `docs/REHEARSAL_RECORD.md`).
- [ ] `[zone/record]` and `[worker version]` are recorded in `docs/CUTOVER_RUNBOOK.md` §4. **Partial:** `[worker version]` confirmed live; `[zone/record]` still unresolved.
- [ ] `[snapshot id]` is recorded and verified restorable. **Partial:** `lantern-db` Time Travel bookmark read-only; no restore test performed. Rehearsal decision must be "do not restore production D1".
- [x] Local parity gate passes: `npm run verify` → 48 routes, gap=0, 26 files / 228 tests green, build OK.
- [x] `wrangler.rehearsal.jsonc` has been reviewed: Worker `lantern-nuxt-rehearsal`, staging-only D1/R2 bindings, no production resource ids or binding names, no routes/domains, `workers_dev: true`; config tests pass (6/6).
- [ ] Required secrets are configured for the rehearsal Worker (local `.dev.vars` values are not deployed with the config). **Not verified.** The rehearsal smoke does not exercise auth/email flows; see `docs/RELEASE_PREPARATION_20261120.md` §7.5 for the determination.
- [x] `npm run release:check` is run and its output retained: still **NOT READY** (B1, B7, G3), as expected.

### Preparation findings (2026-11-20)

Read-only inspection results, the checklist-to-resource mapping, secret
determination, and exact command templates are recorded in
`docs/RELEASE_PREPARATION_20261120.md` §7. No routing change, DNS edit, deploy,
or production mutation was performed during preparation.

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
