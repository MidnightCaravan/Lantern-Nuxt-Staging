# Low-traffic public verification plan (after 2026-11-23 00:00 UTC)

Goal: finish post-restoration public delivery checks without repeating the
D1-quota exhaustion. No migration, no D1/R2 writes, no redeploy, no production
access, no credentials, no bulk downloads, no hashes re-computed.

## Rule 0 — stop conditions

Stop immediately if any of these happens, and record it:

- Any HTTP 500 with `D1_ERROR` / error `7500` (daily row-read limit).
- `Cf-Cache-Status` or a response indicating stale content where privacy matters.
- More than one consecutive non-200/206 response for the same category.

Do **not** retry the failing request. Do **not** use HEAD as a "cheap" check —
`server/routes/media/[...key].head.ts` re-exports the GET handler, so HEAD runs
the same D1 authorization queries.

## Phase 1 — verify the index fix (D1, minimal rows)

After the daily reset, apply the prepared staging-only DDL:

```sh
npx wrangler d1 execute lantern-staging-db --config wrangler.rehearsal.jsonc --remote --file scripts/staging-d1-indexes.sql
```

Then confirm access paths and `meta.rows_read` with **small, bounded** commands:

```sh
npx wrangler d1 execute lantern-staging-db --config wrangler.rehearsal.jsonc --remote --json \
  --command "EXPLAIN QUERY PLAN SELECT 1 AS found FROM comic_pages p JOIN comic_episodes e ON e.id=p.episode_id JOIN works w ON w.id=e.work_id WHERE w.status='published' AND e.status='published' AND p.image_path='uploads/comics/9/24/page-1-165bbed6d614eb8d.png' LIMIT 1"

npx wrangler d1 execute lantern-staging-db --config wrangler.rehearsal.jsonc --remote --json \
  --command "SELECT 1 AS found FROM comic_pages p JOIN comic_episodes e ON e.id=p.episode_id JOIN works w ON w.id=e.work_id WHERE w.status='published' AND e.status='published' AND p.image_path='uploads/comics/9/24/page-1-165bbed6d614eb8d.png' LIMIT 1"

npx wrangler d1 execute lantern-staging-db --config wrangler.rehearsal.jsonc --remote --json \
  --command "SELECT id,page_number,image_path FROM comic_pages WHERE episode_id=24 ORDER BY page_number ASC"
```

Expected: `SEARCH p USING INDEX idx_comic_pages_image_path (image_path=?)` and
`rows_read` close to 1–2 (was 1,574); `SEARCH comic_pages USING INDEX
idx_comic_pages_episode_page` with no temp B-tree (was 1,457 rows). Save the
JSON output next to the other evidence files.

Optional: `npx wrangler d1 insights lantern-staging-db --config wrangler.rehearsal.jsonc --time-period 1d --json`
(analytics API only) to confirm the new daily total is far below 5M.

## Phase 2 — small sequential public-delivery sample

Use the existing sequential verifier (concurrency 1, aborts a category on the
first 500):

```sh
node scripts/final-public-delivery-verification.mjs \
  https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev \
  docs/public-catalog-20261122/final-public-delivery-verification-post-index.json \
  --html-only
```

Then a **sample**, not all 1,565 images, using a small explicit key list — for
example one cover and one first page for each of works 6 and 9, and one page
deep into a long episode. Record status, content type, byte count and whether
the body is readable. Keep total media requests in the tens, not thousands.

Audiobook: one `Range: bytes=0-11` request (expect `206`, `Content-Range:
bytes 0-11/784755576`) and one unsatisfiable range (expect `416`). Do **not**
run the full 748 MiB delivery again — the complete streaming SHA-256 already
passed (`video-direct-verification.json`: 784,755,576 bytes,
`0fc4401a…1158`).

## Phase 3 — integrity (do not repeat)

The 1,570 objects were already verified by direct remote R2 retrieval with
SHA-256: 958/958 (`r2-verification-9-10.json`) and 612/612
(`r2-verification-6-11.json`), 0 missing, 0 mismatches. Do not re-hash them.
Use direct `wrangler r2 object get … --remote` only if a specific object is
suspected, never the public media Worker for bulk verification.

## Phase 4 — record results

Update `POST_RESTORATION_PUBLIC_VERIFICATION.md` and
`docs/REMAINING_DIFFERENCES_20261121.md` with:

- `meta.rows_read` before/after for the three indexed queries;
- D1 Insights daily total after the change;
- public sample results (status, content type, accessibility);
- confirmation that no content, timestamps, code, plan or billing changed.

Keep the catalog-ordering difference (`10, 11, 9, 6` original vs `9, 10, 11, 6`
staging) documented; do not invent timestamps to force the original order.
