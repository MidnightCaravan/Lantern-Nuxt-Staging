import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateProductionConfig } from '../scripts/release-provenance.mjs'

const RELEASE_CONFIG = 'wrangler.release.jsonc'
const MEDIA_CONFIG = 'wrangler.media-release.jsonc'
const MEDIA_WORKER = 'lantern-media-release/src/media_worker.py'
const STAGING_DB_ID = '5ce6be03-45c1-465e-a461-20e40148404e'
const PRODUCTION_DB_ID = 'bf50e1be-81d7-4cd1-b082-8aa03a784860'

function parseJsonc(source: string) {
  // The approved templates use full-line `//` comments only, never inline comments.
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

function expectNoStagingIdentifiers(source: string, label: string) {
  for (const forbidden of [
    STAGING_DB_ID,
    'lantern-staging-db',
    'lantern_staging_db',
    'lantern-staging-media',
    'lantern_staging_media',
    'lantern-nuxt-rehearsal',
    'lantern-media-rehearsal',
  ]) {
    expect(source, `${label} must not contain ${forbidden}`).not.toContain(forbidden)
  }
}

describe('approved A1 release configuration', () => {
  it('matches the approved production Nuxt Worker template', async () => {
    const source = await readFile(path.resolve(process.cwd(), RELEASE_CONFIG), 'utf8')
    const config = parseJsonc(source)

    expect(config).toEqual({
      $schema: 'node_modules/wrangler/config-schema.json',
      name: 'lantern',
      workers_dev: true,
      preview_urls: false,
      main: './.output/server/index.mjs',
      compatibility_date: '2026-11-13',
      assets: {
        binding: 'ASSETS',
        directory: './.output/public/',
      },
      vars: {
        LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
        LANTERN_PUBLIC_READ_DATABASE: 'production',
      },
      services: [
        {
          binding: 'LANTERN_MEDIA_ORIGIN',
          service: 'lantern-media',
        },
      ],
      d1_databases: [
        {
          binding: 'lantern_db',
          database_name: 'lantern-db',
          database_id: PRODUCTION_DB_ID,
          remote: true,
        },
      ],
      observability: {
        enabled: true,
      },
      upload_source_maps: true,
      r2_buckets: [
        {
          bucket_name: 'lantern-media',
          binding: 'lantern_media',
        },
      ],
    })
    expect(config.vars).not.toHaveProperty('LANTERN_ENABLE_PRODUCTION_WRITES')
    expect(source).not.toContain('REPLACE_WITH_')
  })

  it('matches the approved private media Worker template and implementation path', async () => {
    const source = await readFile(path.resolve(process.cwd(), MEDIA_CONFIG), 'utf8')
    const config = parseJsonc(source)

    expect(config).toEqual({
      $schema: 'node_modules/wrangler/config-schema.json',
      name: 'lantern-media',
      main: MEDIA_WORKER,
      compatibility_date: '2026-09-28',
      compatibility_flags: ['python_workers'],
      workers_dev: false,
      preview_urls: false,
      r2_buckets: [
        {
          binding: 'lantern_media',
          bucket_name: 'lantern-media',
          remote: true,
        },
      ],
    })

    const implementationPath = path.resolve(process.cwd(), config.main)
    expect(existsSync(implementationPath), config.main).toBe(true)
    const implementation = await readFile(implementationPath, 'utf8')
    expect(implementation).toContain('from workers import WorkerEntrypoint, Response')
    expect(implementation).toContain('self.env.lantern_media')
    expect(implementation).not.toMatch(/^\s*(?:from|import)\s+app\b/m)
    expect(implementation).not.toContain('env.LANTERN_SECRET_KEY')
    expect(implementation).not.toContain('env.lantern_db')
    expect(source).not.toContain('REPLACE_WITH_')
  })

  it('is accepted by the release validator as the approved A1 shape', () => {
    expect(validateProductionConfig(process.cwd())).toEqual([])
  })

  it('keeps production release and staging configuration isolated', async () => {
    const releaseSource = await readFile(path.resolve(process.cwd(), RELEASE_CONFIG), 'utf8')
    const mediaSource = await readFile(path.resolve(process.cwd(), MEDIA_CONFIG), 'utf8')
    const stagingSource = await readFile(path.resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')

    expectNoStagingIdentifiers(releaseSource, RELEASE_CONFIG)
    expectNoStagingIdentifiers(mediaSource, MEDIA_CONFIG)

    const staging = JSON.parse(stagingSource)
    expect(staging.name).toBe('lantern-nuxt-staging')
    expect(staging.r2_buckets.map((bucket: any) => bucket.binding)).toContain('lantern_staging_media')
    expect(staging.d1_databases.some((database: any) => database.binding === 'lantern_staging_db')).toBe(true)
    expect(stagingSource).not.toContain('LANTERN_MEDIA_ORIGIN')
  })

  it('is not wired into any script or application code', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(JSON.stringify(packageJson.scripts)).not.toContain(RELEASE_CONFIG)
    expect(JSON.stringify(packageJson.scripts)).not.toContain(MEDIA_CONFIG)
    for (const file of [
      'scripts/deploy-guard.mjs',
      'scripts/release-gate.mjs',
      'scripts/release-gate-core.mjs',
      'scripts/release-build.mjs',
      'scripts/release-preflight.mjs',
      'wrangler.jsonc',
    ]) {
      expect(await readFile(path.resolve(process.cwd(), file), 'utf8'), file).not.toContain(RELEASE_CONFIG)
    }
    expect(packageJson.scripts['release:deploy']).toBeUndefined()
  })

  it('leaves the deploy guard failing closed', () => {
    const result = spawnSync(process.execPath, ['scripts/deploy-guard.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('deployment is intentionally disabled')
  })

  it('rejects a preflight artifact directory outside the repository', () => {
    const result = spawnSync(process.execPath, [
      'scripts/release-preflight.mjs',
      '--artifact-dir',
      '../outside-output',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be a repository-relative path')
  })
})

describe('release build workflow architecture', () => {
  it('checks out release controls and builds from the separately recorded source SHA', async () => {
    const workflow = await readFile(
      path.resolve(process.cwd(), '.github/workflows/release-build.yml'),
      'utf8',
    )

    expect(workflow).toContain('name: Check out release-control revision')
    expect(workflow).toContain('ref: ${{ inputs.control_sha }}')
    expect(workflow).not.toContain('ref: ${{ inputs.source_commit }}')
    expect(workflow).toContain('--control-sha="$CONTROL_SHA"')
    expect(workflow).toContain('--source-commit="$SOURCE_COMMIT"')
    expect(workflow).toContain('--validate-source-only')
    expect(workflow).not.toContain('test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"')
    expect(workflow).toContain('workflow event SHA $WORKFLOW_EVENT_SHA is informational only')
    expect(workflow).not.toMatch(/wrangler\s+deploy|npm run deploy|secrets\./)
  })
})
