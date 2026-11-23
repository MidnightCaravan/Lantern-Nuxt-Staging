# D1 row-read investigation and media delivery hardening — 2026-11-22

## Scope and restrictions

Investigation only, plus one **prepared but not applied** staging index change.
No production resource, DNS, Flask source, restored content, application code,
account plan or billing was modified. No migration was repeated. No D1/R2 writes
were performed. No secrets were read or printed.

The staging D1 free-tier daily row-read allowance was exhausted again during
this investigation (at ~07:33–07:35 UTC, after a few small measurement queries).
All further D1 query execution stopped immediately at that point (`meta` evidence
below). Evidence after that point came from the D1 Insights analytics API, which
does not execute queries against the database.

> **Update 2026-11-23:** The prepared indexes were applied to staging after the
> daily reset. Sections 1–9 document the pre-application investigation; §10
> records the actual post-application evidence.

Authoritative sources used:

- `npx wrangler d1 insights lantern-staging-db --config wrangler.rehearsal.jsonc --time-period 1d --sort-by reads --sort-type sum --json`
  → preserved as `d1-insights-20261122.json`
- `npx wrangler d1 execute … --remote --json --command "EXPLAIN QUERY PLAN …"` and
  bounded `SELECT … LIMIT 1` with `meta.rows_read`
- `migrations/0001_initial_schema.sql`, `migrations/0002_auth_rate_limits.sql`
- `server/routes/media/[...key].get.ts`, `server/routes/media/[...key].head.ts`
- Cloudflare docs: D1 pricing/limits/best practices and Workers Caching
  configuration/limitations (fetched 2026-11-22)

---

## 1. What consumed the daily allowance

D1 Insights for the last 1 day, sorted by total rows read (top 50 queries =
**5,723,467 rows read**; the Workers Free allowance is 5,000,000/day):

| # | Total rows read | Avg rows/read | Runs | Query (normalized) |
| ---: | ---: | ---: | ---: | --- |
| 1 | **4,895,812** | 812 | 6,023 | `SELECT 1 FROM comic_pages p JOIN comic_episodes e ON e.id=p.episode_id JOIN works w ON w.id=e.work_id WHERE w.status='published' AND e.status='published' AND p.image_path=? LIMIT ?` |
| 2 | 357,162 | 1,457 | 245 | `SELECT id,page_number,image_path FROM comic_pages WHERE episode_id=? ORDER BY page_number ASC` |
| 3 | 178,666 | 1,267 | 141 | `SELECT id,episode_id,page_number,image_path FROM comic_pages WHERE episode_id=? ORDER BY page_number ASC` |
| 4 | 177,574 | 3,946 | 45 | `SELECT e.id,e.episode_number,e.title,e.updated_at,(SELECT COUNT(*) FROM comic_pages p WHERE p.episode_id=e.id) AS page_count FROM comic_episodes e WHERE e.work_id=? AND e.status='published' ORDER BY e.episode_number ASC` |
| 5 | 67,764 | 8 | 7,605 | `SELECT 1 FROM works WHERE status='published' AND (cover=? OR cover=? OR video_path=? OR video_path=?) LIMIT ?` |
| 6 | 12,287 | 63 | 193 | `SELECT id,episode_number,title FROM comic_episodes WHERE work_id=? AND episode_number>? AND status='published' ORDER BY episode_number ASC LIMIT ?` |
| 7 | 7,766 | 1,109 | 7 | `SELECT … FROM comic_pages ORDER BY episode_id,page_number,id` |
| 8 | 5,893 | 60 | 98 | `SELECT id,episode_number,title FROM comic_episodes WHERE work_id=? AND episode_number<? …` |
| 9 | 5,480 | 421 | 13 | owner-variant of query #1 (`w.creator_id=? OR …`) |
| 10–50 | 13,533 | — | — | all remaining queries combined |

Concentration: query #1 alone = **85.5%** of the top-50 reads; #1–#3 = **94.9%**;
#1–#4 = **98.0%**. This is not diffuse traffic — it is a single unindexed lookup
executed once per public media request.

### Database / statements responsible

- Database: `lantern-staging-db` (`5ce6be03-45c1-465e-a461-20e40148404e`), bound
  only in `wrangler.rehearsal.jsonc`. No production database or bucket was read.
- Query #1 is the anonymous **comic-page authorization** check in
  `server/routes/media/[...key].get.ts` lines 87–92. It runs for **every**
  `/media/uploads/comics/…` request (1,565 page images × repeated verification
  passes), and also for cover/video requests where the preceding `works` check
  did not match.
- Query #5 is the corresponding cover/video authorization check (lines 82–86).
  It reads only ~8 rows and is not a problem.
- Queries #2/#3 serve the comic reader and episode API; #4 is the episode list
  with a correlated page count.

### `meta.rows_read` measured directly (before quota exhaustion)

| Query | `meta.rows_read` |
| --- | ---: |
| Media page authorization (`image_path = ?`, `LIMIT 1`) | **1,574** |
| `EXPLAIN QUERY PLAN` variants | 0 (EXPLAIN itself reads no rows) |
| A multi-statement EXPLAIN/COUNT batch (7 statements) | 1,638 total |

The next bounded measurement in the same series returned the D1 error
`7500` ("exceeded D1's free tier daily row read limit"), so measurement stopped.
The 1,574-row measurement is the authoritative `meta.rows_read` proof for the
most expensive query: one comic image read costs ~1,574 rows instead of ~1.

---

## 2. Media authorization route — SQL actually invoked

`server/routes/media/[...key].get.ts` (HEAD re-exports the same handler, so HEAD
incurs the same D1 reads — confirmed by `server/routes/media/[...key].head.ts`):

1. `getLanternSessionIdentity(event)` — session lookup.
2. If a staging-authenticated identity exists: a `works` reference check
   (owner OR published) and a `comic_pages` join check (query #9).
3. For anonymous/public staging reads (`getConfiguredPublicReadDatabase() ===
   'staging'`), two more queries always run:
   - `works` cover/video check (query #5, ~8 rows);
   - `comic_pages` join check (query #1, ~812–1,574 rows).
4. Only after authorization does R2 `head`/`get` run.

Both authorization queries use `LIMIT 1`, but `LIMIT` does not reduce scans on an
unindexed predicate: SQLite must scan `comic_pages` until it finds a match (or
the whole table when the key is a cover/video and no page row matches).

---

## 3. Full-table scans and missing indexes — EXPLAIN evidence

`EXPLAIN QUERY PLAN` against `lantern-staging-db` produced:

| Query | Plan before indexes |
| --- | --- |
| Media page auth (`p.image_path = ?`) | `SCAN p`; `SEARCH e USING INTEGER PRIMARY KEY`; `SEARCH w USING INTEGER PRIMARY KEY` |
| `comic_pages WHERE episode_id=? ORDER BY page_number` | `SCAN comic_pages`; `USE TEMP B-TREE FOR ORDER BY` |
| Episode list + correlated page count | `SCAN e`; `CORRELATED SCALAR SUBQUERY`; `SCAN p`; `USE TEMP B-TREE FOR ORDER BY` |
| Published works catalog | `SCAN works`; `SEARCH users USING INTEGER PRIMARY KEY`; `USE TEMP B-TREE FOR ORDER BY` |
| `works` cover/video auth | `SCAN works` (small table, ~8 rows — not worth indexing) |

Schema (`migrations/0001_initial_schema.sql`): `comic_pages` and
`comic_episodes` have **no indexes at all** beyond their integer primary keys.
The only explicit indexes in the schema are on `comments` and
`auth_rate_limits`. That is the root cause.

---

## 4. Recommended indexes (minimal, staging-safe)

| Index | Targets | Expected effect |
| --- | --- | --- |
| `idx_comic_pages_image_path ON comic_pages(image_path)` | #1, #9 | `SCAN p` → `SEARCH p USING INDEX`. ~1–2 rows per media check instead of ~812–1,574. Removes ~4.89M rows/day. |
| `idx_comic_pages_episode_page ON comic_pages(episode_id, page_number)` | #2, #3, #4 subquery, #7, #10, #23 | `SCAN comic_pages` + temp B-tree → index search in page order. ~35–40 rows instead of ~1,200–1,500. Removes ~0.54M rows/day. |
| `idx_comic_episodes_work_status_number ON comic_episodes(work_id, status, episode_number)` | #4, #6, #8, #11, #15, #42 | Indexed filter/order for episode lists; removes ~0.18M rows/day. |

Not recommended: indexes on `works.cover`, `works.video_path`, `works.status`
or `chapters` — those tables are small and measured at 8–19 rows/read; the
added write cost and schema churn are not justified.

**Safety:** indexes do not alter result sets, authorization, ordering (all
affected queries have explicit `ORDER BY`, and the composite index matches their
key order), content, or R2 behavior. They change only access paths. They are
DDL, which Cloudflare counts as a mix of rows read/written — so they must be
created **after** the quota reset, not while the account is over the limit.

**Expected post-change total:** roughly 0.2–0.3M rows/day instead of ~5.7M
(~4–6% of the free allowance), including repeated verification passes.

A secondary, optional code improvement (not implemented): skip the irrelevant
authorization query based on the key prefix (`uploads/covers/…` vs
`uploads/comics/…`). Halves auth queries per request but requires a Worker
redeploy; the indexes already solve the problem without a deploy.

---

## 5. Workers Caching assessment

Current Cloudflare Workers Caching (`cache.enabled`, Wrangler ≥4.69) checks the
cache **before invoking the Worker**, so a cache HIT would skip the D1
authorization queries entirely. However, it is **not safe for Lantern media**.

| Question | Finding |
| --- | --- |
| Public vs owner-only behavior | The route allows an authenticated staging owner to read media referenced by their own (including draft) works, and anonymous visitors to read only media referenced by published works. One URL can therefore have different authorization outcomes. |
| Draft media privacy | Enforced solely by the per-request D1 query. A public cache entry created for a published object could be served to anyone; a misclassified draft response would leak private media. |
| Unpublish / delete invalidation | The route sets no `Cache-Tag`, and the unpublish/delete/thumbnail/video-replace endpoints do not call `ctx.cache.purge()` / `invalidate()`. Workers Cache is **not** invalidated by R2 object deletion. Any `public, max-age=N` response remains publicly reachable for up to N seconds after unpublish/delete — an unsafe stale-public-access window. |
| Non-video Range compatibility | The route deliberately reproduces a Flask quirk: a non-video `Range` header's *header count* becomes R2's range length and is served as a plain `200`. Workers Caching strips `Range` before invoking the Worker and returns its own `206` from a cached full body. That would break verified Flask parity. |
| Video 206 Range behavior | The Worker implements `206` + `Content-Range` itself; Cloudflare does **not cache Worker-generated 206**. With caching on, Cloudflare strips `Range`, asks for the full 748 MiB video, caches it, then slices — a large cache-fill cost and a behavior change. |
| Cache keys / versions | Default key is the full request URL plus Worker version; `cross_version_cache` defaults to `false`, so a new deploy starts with an empty cache (the safe setting). `cross_version_cache: true` would keep responses valid across deploys and prolong stale access — do **not** enable. |
| Does a cache hit avoid D1? | Yes — but every staging media response currently carries `Cache-Control: private, no-store` (`[...key].get.ts` line 149), which Cloudflare treats as `BYPASS`. With the current code, caching would never help; making media public-cacheable is exactly what creates the privacy/staleness risk. |

**Conclusion / proposal:** do **not** enable Workers Caching for media. Keep
`private, no-store`, keep the per-request authorization check, and remove the
row-read cost with indexes instead. If caching is ever reconsidered, it must be
limited to a separate immutable, public-only path with explicit `Cache-Tag`
purge on every unpublish/delete, `cross_version_cache: false`, and verified
Range parity — a larger change than this task authorizes.

---

## 6. Paid-plan alternative (documentation only — no plan change)

| | Workers Free (current) | Workers Paid |
| --- | --- | --- |
| D1 rows read | 5 million **/day** (resets 00:00 UTC) | First 25 billion **/month** included, then $0.001 / million |
| D1 rows written | 100,000 / day | 50 million / month included, then $1.00 / million |
| Storage | 5 GB total | 5 GB included, then $0.75 / GB-month |
| Plan fee | $0 | **$5 / month minimum** for the account (includes 10M Workers requests/month, 30M CPU-ms/month; extra requests $0.30/M, extra CPU-ms $0.02/M) |

Observed peak here was ~5.7M rows/day ≈ 171M/month — far below the 25B monthly
inclusion, so **D1 row-read overage would be $0** on Paid. The real cost is the
$5/month account minimum (plus any Workers request/CPU overage). Upgrading
would remove the hard daily stop "typically within minutes", but it is a
billing decision for the project owner. **No account or billing change was made.**

---

## 7. Minimal staging-only implementation (prepared 2026-11-22; applied 2026-11-23 — see §10)

File: `scripts/staging-d1-indexes.sql` — three `CREATE INDEX IF NOT EXISTS`
statements, explicitly scoped to staging. Apply only after 00:00 UTC 2026-11-23:

```sh
npx wrangler d1 execute lantern-staging-db --config wrangler.rehearsal.jsonc --remote --file scripts/staging-d1-indexes.sql
```

Then verify with `EXPLAIN QUERY PLAN` and small bounded queries, recording
`meta.rows_read` before/after (see
`docs/public-catalog-20261122/LOW_TRAFFIC_VERIFICATION_PLAN.md`). No Worker code
change and no deploy are required (`npx wrangler deploy --config
wrangler.rehearsal.jsonc` is **not** needed for an index-only fix).

The existing pre-reconciliation backup
(`backups/staging-d1-before-reconciliation-20261122.sql`, SHA-256
`46793334de60e581076a07145d2ca42ff9c3be8eb45244736773c26dfbe35b5f`) remains
untouched; indexes can be removed with `DROP INDEX IF EXISTS <name>` if needed.

---

## 8. Limitations / not verified

- Pre-application status: index impact was initially **predicted from EXPLAIN
  and row-read measurements** because quota exhausted before application. This
  limitation is superseded by §10, which records actual post-creation EXPLAIN,
  `meta.rows_read` and public-delivery evidence.
- D1 Insights `time-period 1d` is a rolling analytics window, not an exact
  midnight-to-midnight daily total; it includes manual verification traffic
  from this task and the earlier restoration.
- Cloudflare Workers Caching behavior was reviewed from current official docs
  (2026-11-22), not exercised against rehearsal staging — enabling it was
  rejected on privacy/parity grounds before any test deploy.
- No production D1/R2, DNS, Flask source or restored content was inspected with
  write intent or modified.

## Related evidence

- `d1-insights-20261122.json` — raw insights output (top 50 queries)
- `POST_RESTORATION_PUBLIC_VERIFICATION.md` — prior quota evidence and 78/78 probe
- `final-public-delivery-verification.json` — degraded/blocked public sweep
- `scripts/staging-d1-indexes.sql` — prepared staging-only DDL
- `LOW_TRAFFIC_VERIFICATION_PLAN.md` — post-reset verification steps

---

## 9. Approved application attempt — 2026-11-22 08:02 UTC (BLOCKED, no index applied)

The project owner approved the three additive staging indexes. Execution was
attempted in the required order and stopped at the quota gate:

1. **Clock check:** `2026-11-22 08:02:17 UTC` — the free-tier daily reset is not
   due until `2026-11-23 00:00:00 UTC`.
2. **Config verification (passed):** `wrangler.rehearsal.jsonc` targets Worker
   `lantern-nuxt-rehearsal`, D1 binding `lantern_staging_db` → `lantern-staging-db`
   (`5ce6be03-45c1-465e-a461-20e40148404e`), R2 `lantern_staging_media` →
   `lantern-staging-media`, `LANTERN_PUBLIC_READ_DATABASE = staging`. No
   production binding is present.
3. **Accessibility probe:** `SELECT 1 AS probe` succeeded with
   `meta.rows_read = 0` — this is *not* proof of quota recovery because it reads
   no rows.
4. **Real-read probe:** `SELECT COUNT(*) AS work_count FROM works` returned
   **D1 error 7500** ("exceeded D1's free tier daily row read limit … wait until
   tomorrow (midnight UTC)").
5. **Stopped immediately** per the approval's step 9. **No `CREATE INDEX` was
   executed**, no content was altered, no public-delivery requests were made,
   and no production resource, plan or billing was touched.

A guarded one-command runner was prepared at
`scripts/apply-staging-indexes-after-reset.sh`. It refuses to run before
`2026-11-23T00:00:00Z` (verified by a dry run: exit 3, "No index was applied"),
then performs the approved steps in order: real-read quota probe → apply the
three indexes → EXPLAIN QUERY PLAN ×3 → bounded `meta.rows_read` ×2 → four
sequential public checks (WARDEN page, The Lovers page, one cover, one
`bytes=0-11` audiobook range). It aborts on error 7500 at any stage and writes
all raw output to `docs/public-catalog-20261122/`.

**After-evidence is recorded in §10 below.** The guarded runner executed after
the reset; no post-index work remains pending.

---

## 10. Approved staging index application — 2026-11-23 04:14 UTC (COMPLETED)

### 10.1 Pre-execution safety checks

- Workspace: original `lantern-nuxt-staging` repository, branch
  `feat/lantern-staging-d1-indexes`, HEAD
  `1e07aeb99a78cfd6bad12fb9136cb787f2c95f7a`.
- Runtime clock: `2026-11-23T04:13:09Z`, after the
  `2026-11-23T00:00:00Z` reset guard.
- `scripts/staging-d1-indexes.sql` and
  `scripts/apply-staging-indexes-after-reset.sh` were byte-identical to their
  committed approved versions (SHA-256 `e5a794b0…b0448` and `f128fc57…769a9b6`).
  The SQL contains exactly three `CREATE INDEX IF NOT EXISTS` statements.
- `bash -n` passed; `tests/index-application-script.test.ts` passed 11/11 with
  local stubs only.
- `LANTERN_INDEX_CONFIG` and `LANTERN_INDEX_EVIDENCE_DIR` overrides were unset.
- Config verification passed: Worker `lantern-nuxt-rehearsal`, one D1 binding
  `lantern_staging_db` → `lantern-staging-db`
  (`5ce6be03-45c1-465e-a461-20e40148404e`), one R2 binding
  `lantern_staging_media` → `lantern-staging-media`, one media-origin service
  binding, and both `LANTERN_PUBLIC_READ_DATABASE` and
  `LANTERN_ANONYMOUS_WRITE_DATABASE` pinned to `staging`. No production resource
  reference was found. Evidence: `config-check.txt`.
- Existing-index inspection found none of the three approved indexes present.
  Evidence: `index-definition-check.txt`,
  `index-definitions-before-20261123.json`.

### 10.2 Accessibility and DDL

The real-read accessibility probe succeeded:

```text
SELECT COUNT(*) AS work_count FROM works
→ work_count = 12, meta.rows_read = 12, success = true
```

The exact three approved indexes were then applied in one DDL execution:

| Index | Definition | Status |
| --- | --- | --- |
| `idx_comic_pages_image_path` | `ON comic_pages(image_path)` | applied |
| `idx_comic_pages_episode_page` | `ON comic_pages(episode_id, page_number)` | applied |
| `idx_comic_episodes_work_status_number` | `ON comic_episodes(work_id, status, episode_number)` | applied |

DDL result (`staging-index-ddl-20261123.json`): `success = true`,
`changed_db = true`, `Total queries executed = 3`, `Rows read = 6,454`,
`Rows written = 3,203`, database size `0.48 MB`. No error `7500` occurred.
No catalog content, media object, application code, or Worker deployment changed.
Evidence: `index-application-20261123.log`.

### 10.3 Post-change `EXPLAIN QUERY PLAN`

All three plans were captured (`explain-*-after-20261123.json`). Each returned
`success = true` and `meta.rows_read = 0`.

| Query | Plan after indexes | Before → after |
| --- | --- | --- |
| Media page authorization (`p.image_path = ?`) | `SEARCH p USING INDEX idx_comic_pages_image_path (image_path=?)`; `SEARCH e USING INTEGER PRIMARY KEY`; `SEARCH w USING INTEGER PRIMARY KEY` | `SCAN p` → indexed search; no temp B-tree |
| Reader pages (`episode_id = ? ORDER BY page_number`) | `SEARCH comic_pages USING INDEX idx_comic_pages_episode_page (episode_id=?)` | `SCAN comic_pages` + temp B-tree → indexed search |
| Episode list + page count | `SEARCH e USING INDEX idx_comic_episodes_work_status_number (work_id=? AND status=?)`; `CORRELATED SCALAR SUBQUERY`; `SEARCH p USING COVERING INDEX idx_comic_pages_episode_page (episode_id=?)` | `SCAN e` + `SCAN p` + temp B-tree → indexed searches; no temp B-tree |

### 10.4 Bounded `meta.rows_read` after the change

| Query | Before | After | Evidence file |
| --- | ---: | ---: | --- |
| Media page authorization (`image_path = ?`, `LIMIT 1`) | 1,574 | **3** | `rows-read-media-auth-after-20261123.json` |
| Reader pages (`episode_id = 24 ORDER BY page_number`) | 1,457 | **21** (20 rows returned) | `rows-read-reader-pages-after-20261123.json` |

Both post-change measurements returned `success = true`; no error `7500`
appeared. These are bounded, single-query measurements, not a full-day
high-traffic projection.

### 10.5 Sequential public-delivery checks

Four small checks ran strictly in order. All request bodies and headers were
scanned for `7500`, `exceeded D1`, `daily row read limit` and `quota`; **zero**
matches were found. All responses retained `Cache-Control: private, no-store`.

| Check | Result | Content type | Bytes | Notable header |
| --- | ---: | --- | ---: | --- |
| WARDEN comic page | `200` | `image/png` | 2,367,469 | — |
| The Lovers comic page | `200` | `image/png` | 2,660,046 | — |
| Cover image | `200` | `image/png` | 2,332,318 | — |
| Audiobook `bytes=0-11` | `206` | `video/mp4` | 12 | `Content-Range: bytes 0-11/784755576`, `Accept-Ranges: bytes` |

Evidence: `public-sample-warden-comic-page.*`,
`public-sample-lovers-comic-page.*`, `public-sample-cover.*`,
`public-sample-audiobook-range.*`. The runner logged
`DONE: staging indexes applied and evidence captured` at
`2026-11-23T04:14:24Z`.

### 10.6 Restrictions observed

No retry was made for any failing request (none failed). No full 1,570-object
verification was repeated; no media was uploaded; no catalog content was
modified. No production resource, DNS, account plan, billing, deployment,
application code, or caching configuration was touched. All unrelated local
modifications and untracked files were preserved.
