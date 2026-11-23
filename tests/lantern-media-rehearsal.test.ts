import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_DIR = 'lantern-media-rehearsal'
const CONFIG = `${PROJECT_DIR}/wrangler.jsonc`
const WORKER = `${PROJECT_DIR}/src/media_worker.py`
// Exact 146-line excerpt of original Flask worker.py:1054-1199, pinned so CI
// does not need the untracked original Flask source bundle.
const FLASK_MEDIA_BRANCH = 'tests/fixtures/flask-worker-media-branch-20261118.py'

function parseJsonc(source: string) {
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

async function read(file: string) {
  return readFile(path.resolve(process.cwd(), file), 'utf8')
}

function sliceLines(lines: string[], start: number, end: number) {
  return lines.slice(start, end + 1).join('\n')
}

describe('lantern-media-rehearsal (local A1 media-origin prototype)', () => {
  it('is off-route and binds only the staging media bucket', async () => {
    const source = await read(CONFIG)
    const config = parseJsonc(source)

    expect(config.name).toBe('lantern-media-rehearsal')
    expect(config.workers_dev).toBe(false)
    expect(config.main).toBe('src/media_worker.py')
    expect(config.compatibility_flags).toEqual(['python_workers'])
    expect(config.routes).toBeUndefined()
    expect(config.route).toBeUndefined()
    expect(config.domains).toBeUndefined()
    expect(config.triggers).toBeUndefined()
    expect(config.d1_databases).toBeUndefined()
    expect(config.secrets).toBeUndefined()
    expect(config.services).toBeUndefined()
    expect(config.r2_buckets).toEqual([{
      binding: 'lantern_media',
      bucket_name: 'lantern-staging-media',
      remote: true,
    }])

    for (const forbidden of [
      '"bucket_name": "lantern-media"',
      'lantern-db',
      'bf50e1be-81d7-4cd1-b082-8aa03a784860',
      '"database_id"',
      '"name": "lantern"',
    ]) {
      expect(source, `config must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('matches the Service Binding declared by the Nuxt rehearsal Worker', async () => {
    const rehearsal = parseJsonc(await read('wrangler.rehearsal.jsonc'))
    expect(rehearsal.services).toEqual([{
      binding: 'LANTERN_MEDIA_ORIGIN',
      service: 'lantern-media-rehearsal',
    }])
  })

  it('does not use D1 or secrets in the media execution path', async () => {
    const source = await read(WORKER)
    expect(source).not.toContain('self.env.lantern_db')
    expect(source).not.toContain('env.lantern_db')
    expect(source).not.toContain('get_db(')
    expect(source).not.toContain('env.LANTERN_SECRET_KEY')
    // The pinned Flask branch's only resource reference is the R2 media binding.
    expect(source.match(/self\.env\.lantern_media/g)).toHaveLength(4)
  })

  it('contains the Flask media branch verbatim', async () => {
    const workerLines = (await read(WORKER)).split('\n')
    const flaskLines = (await read(FLASK_MEDIA_BRANCH)).split('\n')

    const begin = workerLines.findIndex((line) => line.includes('BEGIN VERBATIM FLASK MEDIA BRANCH'))
    const end = workerLines.findIndex((line) => line.includes('END VERBATIM FLASK MEDIA BRANCH'))
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(begin)
    const extracted = workerLines.slice(begin + 1, end).join('\n').trimEnd()

    const flaskStart = flaskLines.findIndex((line) => line === '        if url.path.startswith("/media/"):')
    const flaskEnd = flaskLines.findIndex((line) => line === '                return Response(obj.body, status=status, headers=headers)')
    expect(flaskStart).toBeGreaterThanOrEqual(0)
    expect(flaskEnd).toBeGreaterThan(flaskStart)
    // Original source lines 1054-1199 inclusive = 146 lines.
    expect(flaskEnd - flaskStart + 1).toBe(146)
    const original = sliceLines(flaskLines, flaskStart, flaskEnd)

    expect(extracted).toBe(original)
  })

  it('does not add media key validation that Flask does not perform', async () => {
    const source = await read(WORKER)
    // The verbatim block must be the sole /media/* decision logic. Flask reads
    // the raw key from the path and applies no traversal filtering. Nuxt's
    // separate 404 validation is documented as a divergence, not changed here.
    expect(source).not.toContain("part === '..'")
    expect(source).not.toContain("part.includes('\\\\')")
    expect(source).toContain('key = url.path[len("/media/"):]')
  })
})
