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
  it('declares the verified B1 bucket and both app bindings', async () => {
    const source = await readFile(path.resolve(process.cwd(), RELEASE_CONFIG), 'utf8')
    const config = parseJsonc(source)
    expect(config.name).toBe('lantern-nuxt')
    expect(config.r2_buckets.map((bucket: any) => bucket.binding)).toEqual(['lantern_staging_media', 'lantern_media'])
    // Confirmed against the pinned Flask Worker config and `wrangler r2 bucket list`.
    expect(config.r2_buckets.find((bucket: any) => bucket.binding === 'lantern_media').bucket_name).toBe('lantern-media')
    expect(config.d1_databases.map((db: any) => db.binding)).toEqual(['lantern_db', 'lantern_staging_db'])
    // No unresolved placeholders remain in the executable configuration.
    expect(source).not.toContain('REPLACE_WITH_')
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
