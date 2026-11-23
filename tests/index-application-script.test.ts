import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(process.cwd())
const SCRIPT = join(REPO, 'scripts/apply-staging-indexes-after-reset.sh')
const STAGING_ID = '5ce6be03-45c1-465e-a461-20e40148404e'

function writeStub(bin: string, name: string, body: string) {
  const path = join(bin, name)
  writeFileSync(path, body, { mode: 0o755 })
  chmodSync(path, 0o755)
}

const npxStub = `#!/bin/sh
all="$*"
mode="\${FAKE_NPX_MODE:-ok}"
if printf '%s' "$all" | grep -q 'sqlite_master'; then
  case "$mode" in
    index-mismatch)
      printf '%s\\n' '[{"results":[{"name":"idx_comic_pages_image_path","tbl_name":"comic_pages","sql":"CREATE INDEX idx_comic_pages_image_path ON comic_pages(page_number)"}],"success":true}]'
      ;;
    index-match)
      printf '%s\\n' '[{"results":[{"name":"idx_comic_pages_image_path","tbl_name":"comic_pages","sql":"CREATE INDEX IF NOT EXISTS idx_comic_pages_image_path ON comic_pages(image_path)"},{"name":"idx_comic_pages_episode_page","tbl_name":"comic_pages","sql":"CREATE INDEX IF NOT EXISTS idx_comic_pages_episode_page ON comic_pages(episode_id, page_number)"},{"name":"idx_comic_episodes_work_status_number","tbl_name":"comic_episodes","sql":"CREATE INDEX IF NOT EXISTS idx_comic_episodes_work_status_number ON comic_episodes(work_id, status, episode_number)"}],"success":true}]'
      ;;
    *) printf '%s\\n' '[{"results":[],"success":true}]' ;;
  esac
  exit 0
fi
if [ -n "\${FAKE_NPX_LOG:-}" ]; then printf '%s\\n' "$all" >> "$FAKE_NPX_LOG"; fi
case "$mode" in
  quota) printf '%s\\n' '{"error":{"notes":[{"text":"D1_ERROR code: 7500 exceeded daily row read limit"}]}}'; exit 0 ;;
  fail) printf '%s\\n' 'wrangler: unexpected failure' >&2; exit 1 ;;
  *) printf '%s\\n' '[{"results":[{"ok":1}],"success":true}]'; exit 0 ;;
esac
`

const curlStub = `#!/bin/sh
out=""; hdr=""; all="$*"
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    -D) hdr="\$2"; shift 2 ;;
    *) shift ;;
  esac
done
mode="\${FAKE_CURL_MODE:-ok}"
status=200
type=image/png
body=ok
case "\$mode" in
  quota-body) status=500; type=application/json; body='{"error":"D1_ERROR code 7500 exceeded daily row read limit"}' ;;
  http-fail) status=500; type=text/html; body='server error' ;;
  curl-fail) printf 'curl: (6) connection failed\\n' >&2; exit 6 ;;
esac
if printf '%s' "\$all" | grep -q 'Range:'; then status=206; type=video/mp4; body='0123456789ab'; fi
printf '%s' "\$body" > "\$out"
printf 'HTTP/2 %s\\r\\ncontent-type: %s\\r\\n' "\$status" "\$type" > "\$hdr"
printf '%s %s %s\\n' "\$status" "\$type" "\${#body}"
`

type Opts = {
  epoch?: string
  npxMode?: string
  curlMode?: string
  nodeStub?: boolean
  dateStub?: boolean
  config?: string
}

function runScript(opts: Opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lantern-index-script-'))
  const bin = join(root, 'bin')
  const evidence = join(root, 'evidence')
  mkdirSync(bin)
  mkdirSync(evidence)

  const epoch = opts.epoch ?? '2000000000' // 2033-05-18, safely after the reset
  writeStub(bin, 'date', `#!/bin/sh\nif [ "$1" = "-u" ] && [ "$2" = "+%s" ]; then echo "${epoch}"; else exec /bin/date "$@"; fi\n`)
  writeStub(bin, 'npx', npxStub)
  writeStub(bin, 'curl', curlStub)
  if (opts.nodeStub) writeStub(bin, 'node', '#!/bin/sh\nexit 1\n')
  if (opts.dateStub) writeStub(bin, 'date', '#!/bin/sh\nif [ "$1" = "-u" ] && [ "$2" = "+%s" ]; then exit 1; fi\nexec /bin/date "$@"\n')

  const npxLog = join(root, 'npx-calls.txt')
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    LANTERN_INDEX_EVIDENCE_DIR: evidence,
    FAKE_NPX_LOG: npxLog,
    FAKE_NPX_MODE: opts.npxMode ?? 'ok',
    FAKE_CURL_MODE: opts.curlMode ?? 'ok',
  }
  if (opts.config) env.LANTERN_INDEX_CONFIG = opts.config

  const result = spawnSync('/bin/bash', [SCRIPT], { cwd: REPO, env, encoding: 'utf8' })
  const logPath = join(evidence, 'index-application-20261123.log')
  const log = readFileSync(logPath, 'utf8')
  // Early guard/config failures correctly stop before Wrangler is invoked.
  const npxCalls = existsSync(npxLog) ? readFileSync(npxLog, 'utf8') : ''
  return { result, log, npxCalls, evidence }
}

function productionBindingConfig() {
  const root = mkdtempSync(join(tmpdir(), 'lantern-index-config-'))
  const file = join(root, 'bad.jsonc')
  const config = {
    name: 'lantern-nuxt-rehearsal',
    vars: { LANTERN_PUBLIC_READ_DATABASE: 'staging', LANTERN_ANONYMOUS_WRITE_DATABASE: 'staging' },
    d1_databases: [
      { binding: 'lantern_staging_db', database_name: 'lantern-staging-db', database_id: STAGING_ID, remote: true },
      { binding: 'lantern_db', database_name: 'lantern-db', database_id: 'bf50e1be-81d7-4cd1-b082-8aa03a784860', remote: true },
    ],
    r2_buckets: [{ binding: 'lantern_staging_media', bucket_name: 'lantern-staging-media', remote: true }],
    services: [{ binding: 'LANTERN_MEDIA_ORIGIN', service: 'lantern-media-rehearsal' }],
  }
  writeFileSync(file, JSON.stringify(config, null, 2))
  return file
}

describe('apply-staging-indexes-after-reset.sh safeguards (local stubs only)', () => {
  it('refuses to run before the reset', () => {
    const { result, log, npxCalls } = runScript({ epoch: '1' })
    expect(result.status).toBe(3)
    expect(log).toContain('REFUSED: D1 quota reset not due')
    expect(npxCalls).toBe('')
  })

  it('fails closed when node is unavailable', () => {
    const { result, log, npxCalls } = runScript({ nodeStub: true })
    expect(result.status).not.toBe(0)
    expect(log).toContain('reset guard: could not parse reset timestamp')
    expect(npxCalls).toBe('')
  })

  it('fails closed when the UTC clock cannot be read', () => {
    const { result, log, npxCalls } = runScript({ dateStub: true })
    expect(result.status).not.toBe(0)
    expect(log).toContain('reset guard: cannot read UTC clock')
    expect(npxCalls).toBe('')
  })

  it('rejects a config containing an unexpected production D1 binding', () => {
    const { result, log, npxCalls } = runScript({ config: productionBindingConfig() })
    expect(result.status).not.toBe(0)
    expect(log).toContain('staging configuration verification failed')
    expect(npxCalls).toBe('')
  })

  it('stops on a failed wrangler command without logging DONE', () => {
    const { result, log } = runScript({ npxMode: 'fail' })
    expect(result.status).not.toBe(0)
    expect(log).toContain('wrangler command failed')
    expect(log).not.toContain('DONE:')
  })

  it('stops on D1 error 7500 in command output', () => {
    const { result, log } = runScript({ npxMode: 'quota' })
    expect(result.status).not.toBe(0)
    expect(log).toContain('D1 quota error 7500')
    expect(log).not.toContain('DONE:')
  })

  it('rejects an existing index whose definition does not match', () => {
    const { result, log, npxCalls } = runScript({ npxMode: 'index-mismatch' })
    expect(result.status).not.toBe(0)
    expect(log).toContain('columns (page_number), expected (image_path)')
    expect(npxCalls).not.toContain('--file scripts/staging-d1-indexes.sql')
    expect(log).not.toContain('DONE:')
  })

  it('accepts matching existing index definitions', () => {
    const { result, log, npxCalls } = runScript({ npxMode: 'index-match' })
    expect(result.status).toBe(0)
    expect(log).toContain('existing index OK: idx_comic_pages_image_path')
    expect(npxCalls).toContain('--file scripts/staging-d1-indexes.sql')
    expect(log).toContain('DONE:')
  })

  it('stops on D1 error 7500 in a public response body', () => {
    const { result, log } = runScript({ curlMode: 'quota-body' })
    expect(result.status).not.toBe(0)
    expect(log).toContain('D1 quota error detected in public response body')
    expect(log).not.toContain('DONE:')
  })

  it('stops on an unexpected public HTTP status or curl failure', () => {
    const badStatus = runScript({ curlMode: 'http-fail' })
    expect(badStatus.result.status).not.toBe(0)
    expect(badStatus.log).toContain('unexpected HTTP result')
    const failedCurl = runScript({ curlMode: 'curl-fail' })
    expect(failedCurl.result.status).not.toBe(0)
    expect(failedCurl.log).toContain('public request failed')
  })

  it('completes only when every safeguarded step succeeds', () => {
    const { result, log } = runScript()
    expect(result.status).toBe(0)
    expect(log).toContain('config OK')
    expect(log).toContain('DONE:')
  })
})
