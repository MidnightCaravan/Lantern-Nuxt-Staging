import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PRODUCTION_CONFIG = 'wrangler.release.jsonc'
const REHEARSAL_CONFIG = 'wrangler.rehearsal.jsonc'

const PRODUCTION_DB_ID = 'bf50e1be-81d7-4cd1-b082-8aa03a784860'
const PRODUCTION_DB_NAME = 'lantern-db'
// Quote the bucket value so the rehearsal Service Binding target
// `lantern-media-rehearsal` is not mistaken for the production bucket.
const PRODUCTION_BUCKET = '"lantern-media"'
const STAGING_DB_ID = '5ce6be03-45c1-465e-a461-20e40148404e'

function parseJsonc(source: string) {
  // Both config files use full-line `//` comments only, never inline comments.
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

async function load(file: string) {
  const source = await readFile(path.resolve(process.cwd(), file), 'utf8')
  return { source, config: parseJsonc(source), serialized: JSON.stringify(parseJsonc(source)) }
}

describe('production and rehearsal Worker configurations', () => {
  it('keeps the rehearsal Worker isolated from production resources', async () => {
    const { source, config, serialized } = await load(REHEARSAL_CONFIG)
    expect(config.name).toBe('lantern-nuxt-rehearsal')
    expect(config.workers_dev).toBe(true)
    expect(config.routes).toBeUndefined()
    expect(config.route).toBeUndefined()
    expect(config.triggers).toBeUndefined()
    expect(config.services).toEqual([{
      binding: 'LANTERN_MEDIA_ORIGIN',
      service: 'lantern-media-rehearsal',
    }])

    expect(config.d1_databases).toEqual([{
      binding: 'lantern_staging_db',
      database_name: 'lantern-staging-db',
      database_id: STAGING_DB_ID,
      remote: true,
    }])
    expect(config.r2_buckets).toEqual([{
      binding: 'lantern_staging_media',
      bucket_name: 'lantern-staging-media',
      remote: true,
    }])

    // No production identifier may appear even in a comment or a binding name.
    for (const forbidden of [
      PRODUCTION_DB_ID,
      PRODUCTION_DB_NAME,
      PRODUCTION_BUCKET,
      '"binding": "lantern_db"',
      '"binding": "lantern_media"',
      '"name": "lantern-nuxt"',
    ]) {
      expect(source, `rehearsal source must not contain ${forbidden}`).not.toContain(forbidden)
      expect(serialized, `rehearsal config must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('keeps production bindings out of the rehearsal Worker and vice versa', async () => {
    const production = await load(PRODUCTION_CONFIG)
    const rehearsal = await load(REHEARSAL_CONFIG)

    expect(production.config.name).toBe('lantern-nuxt')
    expect(rehearsal.config.name).toBe('lantern-nuxt-rehearsal')
    expect(production.config.workers_dev).toBe(false)
    expect(rehearsal.config.workers_dev).toBe(true)
    // The media-origin Service Binding is rehearsal-only until A1 is approved.
    expect(production.config.services).toBeUndefined()

    for (const identifier of [PRODUCTION_DB_ID, PRODUCTION_DB_NAME, PRODUCTION_BUCKET]) {
      expect(production.serialized, `production config should contain ${identifier}`).toContain(identifier)
      expect(rehearsal.serialized, `rehearsal config must not contain ${identifier}`).not.toContain(identifier)
    }

    expect(production.source).not.toContain('"name": "lantern-nuxt-rehearsal"')
    expect(rehearsal.source).not.toContain('"name": "lantern-nuxt"')

    // Neither Worker declares a traffic destination.
    for (const { config } of [production, rehearsal]) {
      expect(config.routes).toBeUndefined()
      expect(config.route).toBeUndefined()
      expect(config.triggers).toBeUndefined()
    }
  })

  it('is not wired into any script and leaves the deploy guard failing closed', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'))
    for (const config of [PRODUCTION_CONFIG, REHEARSAL_CONFIG]) {
      expect(JSON.stringify(packageJson.scripts)).not.toContain(config)
    }
    for (const file of ['scripts/deploy-guard.mjs', 'scripts/release-gate.mjs', 'wrangler.jsonc']) {
      const source = await readFile(path.resolve(process.cwd(), file), 'utf8')
      expect(source, file).not.toContain(PRODUCTION_CONFIG)
      expect(source, file).not.toContain(REHEARSAL_CONFIG)
    }

    const result = spawnSync(process.execPath, ['scripts/deploy-guard.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('deployment is intentionally disabled')
  })
})
