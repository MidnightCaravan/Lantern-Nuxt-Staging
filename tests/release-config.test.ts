import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RELEASE_CONFIG = 'wrangler.release.jsonc'
const STAGING_DB_ID = '5ce6be03-45c1-465e-a461-20e40148404e'

function parseJsonc(source: string) {
  // The template uses full-line `//` comments only, never inline comments.
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

describe('release config skeleton', () => {
  it('declares only verified production bindings and explicit production selectors', async () => {
    const source = await readFile(path.resolve(process.cwd(), RELEASE_CONFIG), 'utf8')
    const config = parseJsonc(source)
    const serialized = JSON.stringify(config)

    expect(config.name).toBe('lantern-nuxt')
    expect(config.workers_dev).toBe(false)
    // Version URLs must never expose the production-bound Worker before cutover.
    expect(config.preview_urls).toBe(false)
    expect(config.routes).toBeUndefined()
    expect(config.route).toBeUndefined()
    expect(config.domains).toBeUndefined()
    expect(config.triggers).toBeUndefined()
    expect(config.services).toBeUndefined()

    expect(config.vars).toEqual({
      LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
      LANTERN_PUBLIC_READ_DATABASE: 'production',
    })
    expect(config.vars).not.toHaveProperty('LANTERN_ENABLE_PRODUCTION_WRITES')

    expect(config.r2_buckets.map((bucket: any) => bucket.binding)).toEqual(['lantern_media'])
    // Confirmed against the pinned Flask Worker config and `wrangler r2 bucket list`.
    expect(config.r2_buckets[0].bucket_name).toBe('lantern-media')

    expect(config.d1_databases).toEqual([{
      binding: 'lantern_db',
      database_name: 'lantern-db',
      database_id: 'bf50e1be-81d7-4cd1-b082-8aa03a784860',
      remote: true,
    }])

    // The production Worker does not need staging bindings. Its production
    // selectors and distinct session secret prevent staging-session access.
    for (const forbidden of [
      STAGING_DB_ID,
      'lantern-staging-db',
      'lantern_staging_db',
      'lantern-staging-media',
      'lantern_staging_media',
    ]) {
      expect(source, `release source must not contain ${forbidden}`).not.toContain(forbidden)
      expect(serialized, `release config must not contain ${forbidden}`).not.toContain(forbidden)
    }

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
