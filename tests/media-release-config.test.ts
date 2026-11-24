import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MEDIA_RELEASE_CONFIG = 'wrangler.media-release.jsonc'
const MEDIA_WORKER_SOURCE = 'lantern-media-release/src/media_worker.py'
const REHEARSAL_MEDIA_SOURCE = 'lantern-media-rehearsal/src/media_worker.py'
const RELEASE_CONFIG = 'wrangler.release.jsonc'

const STAGING_DB_ID = '5ce6be03-45c1-465e-a461-20e40148404e'
const STAGING_BUCKET = 'lantern-staging-media'
const PRODUCTION_DB_ID = 'bf50e1be-81d7-4cd1-b082-8aa03a784860'
const PRODUCTION_DB_NAME = 'lantern-db'

function parseJsonc(source: string) {
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

async function read(file: string) {
  return readFile(path.resolve(process.cwd(), file), 'utf8')
}

describe('A1 production media Worker', () => {
  it('binds only the production R2 bucket and has no public endpoint', async () => {
    const source = await read(MEDIA_RELEASE_CONFIG)
    const config = parseJsonc(source)
    const serialized = JSON.stringify(config)

    expect(config.name).toBe('lantern-media')
    expect(config.main).toBe('lantern-media-release/src/media_worker.py')
    expect(config.compatibility_flags).toEqual(['python_workers'])
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.routes).toBeUndefined()
    expect(config.route).toBeUndefined()
    expect(config.domains).toBeUndefined()
    expect(config.triggers).toBeUndefined()
    expect(config.d1_databases).toBeUndefined()
    expect(config.services).toBeUndefined()
    expect(config.vars).toBeUndefined()
    expect(config.secrets).toBeUndefined()
    expect(config.r2_buckets).toEqual([{
      binding: 'lantern_media',
      bucket_name: 'lantern-media',
      remote: true,
    }])

    // No binding category beyond the verified Python compatibility settings,
    // the private endpoint flags, and the single production R2 binding.
    const allowedKeys = new Set([
      '$schema',
      'name',
      'main',
      'compatibility_date',
      'compatibility_flags',
      'workers_dev',
      'preview_urls',
      'r2_buckets',
    ])
    for (const key of Object.keys(config)) {
      expect(allowedKeys.has(key), `unexpected media Worker config key: ${key}`).toBe(true)
    }

    for (const forbidden of [
      STAGING_DB_ID,
      STAGING_BUCKET,
      'lantern-staging-db',
      'lantern_staging_db',
      'lantern_staging_media',
      PRODUCTION_DB_ID,
      PRODUCTION_DB_NAME,
      'lantern_db',
      'lantern-nuxt-rehearsal',
      'lantern-media-rehearsal',
    ]) {
      expect(source, `media release source must not contain ${forbidden}`).not.toContain(forbidden)
      expect(serialized, `media release config must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('uses the verified Flask media implementation verbatim', async () => {
    const releaseWorker = await read(MEDIA_WORKER_SOURCE)
    const rehearsalWorker = await read(REHEARSAL_MEDIA_SOURCE)

    expect(releaseWorker).toBe(rehearsalWorker)
    expect(releaseWorker).toContain('BEGIN VERBATIM FLASK MEDIA BRANCH')
    expect(releaseWorker).toContain('END VERBATIM FLASK MEDIA BRANCH')
    expect(releaseWorker).toContain('key = url.path[len("/media/"):]')
  })

  it('matches the Service Binding declared by the Nuxt release Worker', async () => {
    const releaseConfig = parseJsonc(await read(RELEASE_CONFIG))
    const mediaConfig = parseJsonc(await read(MEDIA_RELEASE_CONFIG))

    expect(releaseConfig.services).toEqual([{
      binding: 'LANTERN_MEDIA_ORIGIN',
      service: 'lantern-media',
    }])
    expect(mediaConfig.name).toBe(releaseConfig.services[0].service)
  })
})
