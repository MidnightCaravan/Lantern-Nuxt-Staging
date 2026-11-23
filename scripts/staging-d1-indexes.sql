-- STAGING ONLY — lantern-staging-db, bound in wrangler.rehearsal.jsonc
-- ---------------------------------------------------------------------------
-- Purpose: remove the full-table scans that consumed ~5.7M D1 rows read/day
--          (mostly the /media/* comic-page authorization lookup).
--
-- Apply ONLY with:
--   npx wrangler d1 execute lantern-staging-db --config wrangler.rehearsal.jsonc --remote --file scripts/staging-d1-indexes.sql
--
-- DO NOT apply to a production database. DO NOT add to migrations/ — these are
-- an indexing fix for the rehearsal staging database, not a Flask-to-Nuxt
-- behavioral migration. No application code change or deploy is required.
--
-- Do NOT run while the account is over its D1 daily row-read limit: Cloudflare
-- counts DDL as a mix of rows read/written, so CREATE INDEX will also fail with
-- error 7500. Wait until after 00:00 UTC 2026-11-23.
--
-- Rollback (staging only):
--   DROP INDEX IF EXISTS idx_comic_pages_image_path;
--   DROP INDEX IF EXISTS idx_comic_pages_episode_page;
--   DROP INDEX IF EXISTS idx_comic_episodes_work_status_number;
--
-- Evidence: docs/public-catalog-20261122/D1_ROW_READ_INVESTIGATION.md

-- Critical: query #1 (4,895,812 rows read/day) filters comic_pages by image_path
-- with no index (EXPLAIN: SCAN p). An anonymous /media/* request for a comic
-- page reads the entire 1,565-row table for each image.
CREATE INDEX IF NOT EXISTS idx_comic_pages_image_path
    ON comic_pages(image_path);

-- Reader/API: queries #2 and #3 filter by episode_id and order by page_number
-- (EXPLAIN: SCAN comic_pages + temp B-tree). This index also serves the
-- correlated page-count subquery in query #4.
CREATE INDEX IF NOT EXISTS idx_comic_pages_episode_page
    ON comic_pages(episode_id, page_number);

-- Episode lists: query #4 and related filters use work_id + status and order
-- by episode_number (EXPLAIN: SCAN e + temp B-tree).
CREATE INDEX IF NOT EXISTS idx_comic_episodes_work_status_number
    ON comic_episodes(work_id, status, episode_number);
