import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RELEASE_CONFIG = 'wrangler.release.jsonc'

function parseJsonc(source: string) {
  // The template uses full-line `//` comments only, never inline comments.
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

describe('release config skeleton', () => {
  it('declares the B1 binding with placeholders, not a real bucket or worker', async () => {
    const config = parseJsonc(await readFile(path.resolve(process.cwd(), RELEASE_CONFIG), 'utf8'))
    expect(config.r2_buckets.map((bucket: any) => bucket.binding)).toContain('lantern_media')
    expect(config.r2_buckets.find((bucket: any) => bucket.binding === 'lantern_media').bucket_name)
      .toBe('REPLACE_WITH_PRODUCTION_R2_BUCKET_NAME')
    expect(config.name).toBe('REPLACE_WITH_RELEASE_WORKER_NAME')
    // Both bindings the app reads must still be present.
    expect(config.d1_databases.map((db: any) => db.binding)).toEqual(['lantern_db', 'lantern_staging_db'])
    expect(config.r2_buckets.map((bucket: any) => bucket.binding)).toContain('lantern_staging_media')
  })

  it('is not wired into any script or application code', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(JSON.stringify(packageJson.scripts)).not.toContain(RELEASE_CONFIG)
    for (const file of [
      'scripts/deploy-guard.mjs',
      'scripts/release-gate.mjs',
      'scripts/release-gate-core.mjs',
      'wrangler.jsonc',
    ]) {
      expect(await readFile(path.resolve(process.cwd(), file), 'utf8'), file).not.toContain(RELEASE_CONFIG)
    }
  })

  it('leaves the deploy guard failing closed', () => {
    const result = spawnSync(process.execPath, ['scripts/deploy-guard.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('deployment is intentionally disabled')
  })
})
