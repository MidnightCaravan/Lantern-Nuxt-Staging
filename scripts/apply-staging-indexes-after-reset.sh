#!/bin/bash
# Approved staging-only index application, guarded against early execution.
# Runs the exact steps authorized on 2026-11-22. Does not touch production.
# Refuses to run before 2026-11-23T00:00:00Z (D1 free-tier daily reset).
#
# Local-test hooks (all default to the production-safe values above):
#   LANTERN_INDEX_EVIDENCE_DIR - alternate evidence directory
#   LANTERN_INDEX_CONFIG       - alternate config file for negative tests
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

RESET_AT='2026-11-23T00:00:00Z'
EXPECTED_DB_ID='5ce6be03-45c1-465e-a461-20e40148404e'
CONFIG="${LANTERN_INDEX_CONFIG:-wrangler.rehearsal.jsonc}"
DB='lantern-staging-db'
BASE='https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev'
EVIDENCE="${LANTERN_INDEX_EVIDENCE_DIR:-docs/public-catalog-20261122}"
LOG="$EVIDENCE/index-application-20261123.log"
mkdir -p "$EVIDENCE"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG"; }
die() { log "STOP: $*"; exit 1; }

# ---- Reset guard: fail closed on every failure path -------------------------
command -v node >/dev/null 2>&1 || die "reset guard: node is unavailable"
target=$(node -e '
  const raw = process.argv[1];
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) process.exit(2);
  process.stdout.write(String(Math.floor(parsed / 1000)));
' "$RESET_AT" 2>/dev/null) || die "reset guard: could not parse reset timestamp $RESET_AT"
case "$target" in ''|*[!0-9]*) die "reset guard: invalid parsed reset timestamp '$target'" ;; esac

command -v date >/dev/null 2>&1 || die "reset guard: date is unavailable"
now=$(date -u +%s 2>/dev/null) || die "reset guard: cannot read UTC clock"
case "$now" in ''|*[!0-9]*) die "reset guard: invalid UTC clock value '$now'" ;; esac

if [ "$now" -lt "$target" ]; then
  log "REFUSED: D1 quota reset not due until $RESET_AT; current UTC $(date -u '+%Y-%m-%dT%H:%M:%SZ'). No index was applied."
  exit 3
fi

log "START approved staging index application"

# ---- Config verification: exact staging binding, reject any extra resource --
config_check="$EVIDENCE/config-check.txt"
if ! node - "$CONFIG" "$EXPECTED_DB_ID" > "$config_check" 2>&1 <<'NODE'
const fs = require('fs')
const [file, expectedId] = process.argv.slice(2)
const fail = (message) => { console.error(message); process.exit(1) }
const source = fs.readFileSync(file, 'utf8')
const config = JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))

if (config.name !== 'lantern-nuxt-rehearsal') fail(`unexpected worker name: ${config.name}`)
const dbs = config.d1_databases || []
if (dbs.length !== 1) fail(`expected exactly one D1 binding, found ${dbs.length}`)
const d = dbs[0]
if (d.binding !== 'lantern_staging_db') fail(`unexpected D1 binding: ${d.binding}`)
if (d.database_name !== 'lantern-staging-db') fail(`unexpected D1 database: ${d.database_name}`)
if (d.database_id !== expectedId) fail(`unexpected D1 database id: ${d.database_id}`)
if (d.remote !== true) fail('D1 binding must be remote')
const buckets = config.r2_buckets || []
if (buckets.length !== 1 || buckets[0].binding !== 'lantern_staging_media' || buckets[0].bucket_name !== 'lantern-staging-media') fail('unexpected R2 binding(s)')
const services = config.services || []
if (services.length !== 1 || services[0].binding !== 'LANTERN_MEDIA_ORIGIN' || services[0].service !== 'lantern-media-rehearsal') fail('unexpected service binding(s)')
if (config.vars?.LANTERN_PUBLIC_READ_DATABASE !== 'staging' || config.vars?.LANTERN_ANONYMOUS_WRITE_DATABASE !== 'staging') fail('public/anonymous writes or reads are not pinned to staging')
if (/\blantern-db\b|bf50e1be-81d7-4cd1-b082-8aa03a784860|"bucket_name"\s*:\s*"lantern-media"/i.test(source)) fail('production resource reference found in config')
console.log(`config OK: ${config.name} / ${d.database_name} / ${d.database_id} / public-read=staging`)
NODE
then
  tee -a "$LOG" < "$config_check" >&2
  die "staging configuration verification failed"
fi
cat "$config_check" >> "$LOG"

# ---- D1 runner: any command, quota error or unsuccessful result is fatal ----
run_d1() {
  local label="$1"; shift
  local output="$EVIDENCE/$label.json"
  log "D1 query: $label"
  if ! npx wrangler d1 execute "$DB" --config "$CONFIG" --remote --json "$@" > "$output" 2>&1; then
    die "wrangler command failed during $label (output: $output)"
  fi
  if grep -aqiE '7500|exceeded D1.{0,80}row read limit|daily row read limit' "$output"; then
    die "D1 quota error 7500 during $label"
  fi
  if ! grep -aqE '"success"[[:space:]]*:[[:space:]]*true' "$output"; then
    die "D1 result for $label did not report success"
  fi
}

# Step 2: confirm staging D1 is accessible with a REAL row read (SELECT 1 is 0 rows).
run_d1 d1-access-probe-20261123 --command "SELECT COUNT(*) AS work_count FROM works"

# Step 5: verify any already-present index matches the approved definition.
run_d1 index-definitions-before-20261123 --command "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name IN ('idx_comic_pages_image_path','idx_comic_pages_episode_page','idx_comic_episodes_work_status_number')"
index_check="$EVIDENCE/index-definition-check.txt"
if ! node - "$EVIDENCE/index-definitions-before-20261123.json" > "$index_check" 2>&1 <<'NODE'
const fs = require('fs')
const raw = fs.readFileSync(process.argv[2], 'utf8')
const start = raw.indexOf('[')
const end = raw.lastIndexOf(']')
if (start < 0 || end <= start) { console.error('no D1 JSON result in index inspection output'); process.exit(1) }
let blocks
try { blocks = JSON.parse(raw.slice(start, end + 1)) } catch (e) { console.error(`invalid D1 JSON: ${e.message}`); process.exit(1) }
const rows = (blocks[0] && blocks[0].results) || []
const expected = [
  { name: 'idx_comic_pages_image_path', table: 'comic_pages', columns: ['image_path'] },
  { name: 'idx_comic_pages_episode_page', table: 'comic_pages', columns: ['episode_id', 'page_number'] },
  { name: 'idx_comic_episodes_work_status_number', table: 'comic_episodes', columns: ['work_id', 'status', 'episode_number'] },
]
const unquote = (v) => v.replace(/^[`"]|[`"]$/g, '').toLowerCase()
function parseDefinition(sql) {
  const s = String(sql || '').trim().replace(/;\s*$/, '')
  const m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s+ON\s+("[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/i.exec(s)
  if (!m) return null
  const columns = m[3].split(',').map((part) => {
    const col = /^("[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)/.exec(part.trim())
    return col ? unquote(col[1]) : part.trim().toLowerCase()
  })
  return { name: unquote(m[1]), table: unquote(m[2]), columns }
}
for (const row of rows) {
  const name = unquote(String(row.name || ''))
  const spec = expected.find((item) => item.name === name)
  if (!spec) { console.error(`unexpected index present: ${row.name}`); process.exit(1) }
  const parsed = parseDefinition(row.sql)
  if (!parsed) { console.error(`cannot verify definition of ${row.name}: ${row.sql}`); process.exit(1) }
  if (unquote(String(row.tbl_name || '')) !== spec.table || parsed.table !== spec.table) {
    console.error(`index ${row.name} is attached to ${row.tbl_name || parsed.table}, expected ${spec.table}`); process.exit(1)
  }
  if (parsed.columns.join(',') !== spec.columns.join(',')) {
    console.error(`index ${row.name} has columns (${parsed.columns.join(', ')}), expected (${spec.columns.join(', ')})`); process.exit(1)
  }
  console.log(`existing index OK: ${row.name} ON ${spec.table}(${spec.columns.join(', ')})`)
}
if (rows.length === 0) console.log('no approved indexes present yet; will create')
NODE
then
  tee -a "$LOG" < "$index_check" >&2
  die "existing index definition verification failed"
fi
cat "$index_check" >> "$LOG"

# Step 4: apply the three approved additive indexes.
run_d1 staging-index-ddl-20261123 --file scripts/staging-d1-indexes.sql

# Step 6: confirm access paths after the change.
run_d1 explain-media-auth-after-20261123 --command "EXPLAIN QUERY PLAN SELECT 1 AS found FROM comic_pages p JOIN comic_episodes e ON e.id=p.episode_id JOIN works w ON w.id=e.work_id WHERE w.status='published' AND e.status='published' AND p.image_path='uploads/comics/9/24/page-1-d9fd49b3ebd79bea.png' LIMIT 1"
run_d1 explain-reader-pages-after-20261123 --command "EXPLAIN QUERY PLAN SELECT id,page_number,image_path FROM comic_pages WHERE episode_id=24 ORDER BY page_number ASC"
run_d1 explain-episode-list-after-20261123 --command "EXPLAIN QUERY PLAN SELECT e.id,e.episode_number,e.title,e.updated_at,(SELECT COUNT(*) FROM comic_pages p WHERE p.episode_id=e.id) AS page_count FROM comic_episodes e WHERE e.work_id=9 AND e.status='published' ORDER BY e.episode_number ASC"

# Step 7: bounded meta.rows_read measurements after the change.
run_d1 rows-read-media-auth-after-20261123 --command "SELECT 1 AS found FROM comic_pages p JOIN comic_episodes e ON e.id=p.episode_id JOIN works w ON w.id=e.work_id WHERE w.status='published' AND e.status='published' AND p.image_path='uploads/comics/9/24/page-1-d9fd49b3ebd79bea.png' LIMIT 1"
run_d1 rows-read-reader-pages-after-20261123 --command "SELECT id,page_number,image_path FROM comic_pages WHERE episode_id=24 ORDER BY page_number ASC"

# Step 8: four small, strictly sequential public-delivery checks.
check_public() {
  local name="$1" url="$2" range="$3"
  local headers="$EVIDENCE/public-sample-$name.txt"
  local body="$EVIDENCE/public-sample-$name.body"
  local args=(-sS -o "$body" -D "$headers" --max-time 30 -w '%{http_code} %{content_type} %{size_download}')
  if [ -n "$range" ]; then args+=(-H "Range: $range"); fi
  local result
  if ! result=$(curl "${args[@]}" "$url" 2>&1); then
    die "public request failed for $name: $result"
  fi
  log "public [$name] $result"
  if grep -aqiE '7500|exceeded D1|daily row read limit|quota' "$body" "$headers"; then
    die "D1 quota error detected in public response body for $name"
  fi
  local expected=200
  if [ -n "$range" ]; then expected=206; fi
  case "$result" in
    "$expected"*) ;;
    *) die "unexpected HTTP result for $name: $result (expected $expected)" ;;
  esac
}

check_public warden-comic-page "$BASE/media/uploads/comics/9/24/page-1-d9fd49b3ebd79bea.png" ""
check_public lovers-comic-page "$BASE/media/uploads/comics/6/1/page-10-efe7ced15ddea4ce.png" ""
check_public cover "$BASE/media/uploads/covers/10/cover.png" ""
check_public audiobook-range "$BASE/media/uploads/videos/10/video-3d3b93f6ab4ff43b75dd70ae.mp4" "bytes=0-11"

log "DONE: staging indexes applied and evidence captured at $EVIDENCE/"
