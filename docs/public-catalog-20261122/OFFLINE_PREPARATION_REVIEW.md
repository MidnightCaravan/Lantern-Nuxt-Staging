# Offline preparation review — 2026-11-22 (read-only)

Scope: review only. No D1 queries, no deploy, no uploads, no catalog edits, no
application-code edits, no changes to the prepared script, no secrets or env
files inspected. Existing work and uncommitted files were left untouched.

## Checks completed

### 1. `scripts/apply-staging-indexes-after-reset.sh`

| Check | Result |
| --- | --- |
| UTC reset guard | Present (lines 17–22): refuses before `2026-11-23T00:00:00Z`; a prior dry run exited 3 with "No index was applied". |
| Staging-only targeting | `DB=lantern-staging-db`, `--config wrangler.rehearsal.jsonc`, `--remote`; public checks use the rehearsal `workers.dev` URL. Config check (lines 27–33) verifies Worker name, D1 binding/database name, and `LANTERN_PUBLIC_READ_DATABASE=staging`. No production resource is referenced. |
| Stop on D1 error 7500 | D1 stage: `run_d1` greps each output for `7500` and exits 2 (lines 35–43). Public stage: `check_public` greps response headers for `exceeded D1` / `7500` / `quota` and exits 2 (lines 61–73). |
| Index idempotency | All three statements are `CREATE INDEX IF NOT EXISTS` (`scripts/staging-d1-indexes.sql`, lines 27, 33, 38). Re-running will not duplicate or rewrite them. |
| Verification order | Probe → DDL → 3 × EXPLAIN → 2 × bounded rows_read → 4 sequential public checks. No step is intentionally skipped. |
| Syntax | `bash -n` passed. |

### 2. Query-to-index matching

| Index | Application query | Match |
| --- | --- | --- |
| `comic_pages(image_path)` | `server/routes/media/[...key].get.ts:71,91` — `… p.image_path = ? LIMIT 1` (owner and anonymous variants) | **Yes**, equality predicate. |
| `comic_pages(episode_id, page_number)` | `server/api/public/comic-episodes/[id].get.ts:10`; `server/api/comic/episodes/[episodeId].get.ts:14`; `server/api/comic/episodes/[episodeId]/read.get.ts:72–75` — `WHERE episode_id = ? ORDER BY page_number ASC`; correlated `COUNT(*)` in `server/api/public/works/[id].get.ts:17` | **Yes**, equality + matching ORDER BY + correlated subquery. |
| `comic_episodes(work_id, status, episode_number)` | `server/api/public/works/[id].get.ts:17` — `WHERE e.work_id=? AND e.status='published' ORDER BY e.episode_number ASC`; prev/next in `public/comic-episodes/[id].get.ts:14–15` | **Yes**, equality columns then ordering column. |

All three indexes match the actual SQL. No new index or scope change was made.

### 3. Local tests

Inspected `package.json`, `vitest.config.ts`, `tests/setup.ts`, the test helpers,
and every candidate test's imports before running anything. Selected nine test
files that use only `tests/helpers/fake-d1.ts`, `fake-r2.ts`, local HTTP mocks,
or local file/config reads. `spawnSync` occurrences were checked: both invoke
`node scripts/deploy-guard.mjs`, which only prints a refusal and exits 1.

Command run:
`npx vitest run tests/media-serving.test.ts tests/media-head-parity.test.ts tests/media-range-parity.test.ts tests/media-origin-proxy.test.ts tests/comic-pages.test.ts tests/public-reading.test.ts tests/write-isolation.test.ts tests/migrations.test.ts tests/environment-configs.test.ts`

Result: **9 test files passed, 261 tests passed, 0 failed** (1.25 s). Expected
stderr from the intentional write-tripwire tests appeared; no remote access
occurred.

## Problems found

1. **No failure propagation (medium).** The script uses `set -uo pipefail` but
   not `-e`. In `run_d1`, a `wrangler` failure is piped into `tee`, then the
   `grep -q '7500'` check returns 0 when no quota string is found, so the
   function returns success and execution continues. The final `DONE` message
   is logged unconditionally. A failed probe, DDL, EXPLAIN or measurement could
   therefore be recorded as if it succeeded — required verification can be
   effectively skipped without an explicit skip.
2. **Public quota detection inspects headers only (medium).**
   `check_public` writes response headers to a file (`-D`) and discards the body
   (`-o /dev/null`), then greps that header file. A D1 7500 response carries its
   error in the JSON body, not the headers, so a quota error on a public check
   would be logged only as a status and would not trigger the immediate stop.
   The HTTP status itself is logged but not asserted.
3. **Guard bypass on `node` failure (low).** If the `node` command on line 17
   fails, `target` is empty; `[ "$now" -lt "" ]` errors, the `if` is treated as
   false, and the script proceeds past the guard.
4. **Config check is partial (low).** It does not verify the expected
   `database_id` (`5ce6be03-…`) or assert the absence of production bindings.
5. **Same-name index drift (low).** `IF NOT EXISTS` skips silently if an index
   with the same name exists but a different definition; it does not validate
   the definition.
6. **Minor, non-blocking query notes.** Prev/next queries in
   `comic/episodes/[episodeId]/read.get.ts:88,93` place `status` inside an
   `OR`, so only the `work_id` index prefix is usable there; reader queries
   select columns not covered by the page index, so table lookups remain.
   Neither affects the three approved indexes' primary targets.

Per instruction, the script was **not** edited to address these.

## Still requires the D1 quota reset

- Apply the three approved indexes and capture the "after" evidence.
- Re-run EXPLAIN QUERY PLAN for the three queries and record the new plans.
- Measure bounded `meta.rows_read` before/after (before: 1,574 for media auth,
  1,457 for reader pages).
- Perform the four small sequential public checks.
- Update `D1_ROW_READ_INVESTIGATION.md` with actual after-values.

As of the last check (2026-11-22 08:02 UTC), a real row-reading D1 query still
returned error 7500. No D1 query was executed during this review.

## Evidence

- `docs/public-catalog-20261122/D1_ROW_READ_INVESTIGATION.md`
- `scripts/staging-d1-indexes.sql`
- `scripts/apply-staging-indexes-after-reset.sh`
- `docs/public-catalog-20261122/LOW_TRAFFIC_VERIFICATION_PLAN.md`
