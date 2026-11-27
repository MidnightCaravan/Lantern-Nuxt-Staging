import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runReleasePreflight } from '../scripts/release-preflight.mjs'
import { TEST_OTHER_COMMIT, createReleaseControlFixture, writeJson } from './helpers/release-fixtures'

interface PreflightFixture {
  root: string
  sourceCommit: string
  cleanup: () => void
}

let fixture: PreflightFixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

function useFixture(options: Parameters<typeof createReleaseControlFixture>[0] = {}) {
  const created = createReleaseControlFixture(options)
  fixture = { root: created.root, sourceCommit: created.sourceCommit, cleanup: created.cleanup }
  return created
}

describe('release preflight', () => {
  it('passes with matching single-owner gates, source identity, and artifact identity', async () => {
    useFixture()
    expect(await runReleasePreflight({ root: fixture!.root })).toEqual([])
  })

  it('fails when an authoritative control file has uncommitted changes', async () => {
    useFixture()
    writeFileSync(path.join(fixture!.root, 'docs/release-signoff.json'), '{"changed":true}\n')
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('docs/release-signoff.json has uncommitted changes'))).toBe(true)
  })

  it('fails when the artifact is modified after a successful preflight', async () => {
    useFixture()
    expect(await runReleasePreflight({ root: fixture!.root })).toEqual([])

    writeFileSync(path.join(fixture!.root, '.output', 'public', 'index.txt'), 'stale or modified\n')
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('recomputed hash'))).toBe(true)
  })

  it('fails when a manually reviewed manifest copy disagrees with the artifact', async () => {
    const created = useFixture()
    const reviewedPath = path.join(created.root, 'docs/release-artifact.json')
    const reviewed = { ...created.manifest, buildId: 'different-build' }
    writeJson(reviewedPath, reviewed)

    const problems = await runReleasePreflight({
      root: created.root,
      controlManifestPath: 'docs/release-artifact.json',
    })
    expect(problems.some((item: string) => item.includes('manually reviewed manifest and deployed artifact manifest do not match'))).toBe(true)
  })

  it('fails when an artifact manifest introduces a tag/sourceRef', async () => {
    const created = useFixture()
    const manifestPath = path.join(created.root, '.output', 'release-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeJson(manifestPath, { ...manifest, sourceRef: 'refs/tags/v1' })
    const problems = await runReleasePreflight({ root: created.root })
    expect(problems.some((item: string) => item.includes('sourceRef is not permitted'))).toBe(true)
  })

  it('fails for a wrong approved source SHA', async () => {
    const created = useFixture()
    const statePath = path.join(created.root, 'docs/release-gates.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.sourceCommit = TEST_OTHER_COMMIT
    writeJson(statePath, state)

    const problems = await runReleasePreflight({ root: created.root })
    expect(problems.some((item: string) => item.includes('does not match pinned release commit'))).toBe(true)
    expect(problems.some((item: string) => item.includes('does not match approved sourceCommit'))).toBe(true)
  })

  it('fails when production writes are enabled in the release config', async () => {
    useFixture()
    const configPath = path.join(fixture!.root, 'wrangler.release.jsonc')
    const source = readFileSync(configPath, 'utf8')
    writeFileSync(configPath, source.replace(
      '"LANTERN_PUBLIC_READ_DATABASE": "production"',
      '"LANTERN_PUBLIC_READ_DATABASE": "production",\n    "LANTERN_ENABLE_PRODUCTION_WRITES": "1"',
    ))
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('LANTERN_ENABLE_PRODUCTION_WRITES'))).toBe(true)
  })

  it('fails when the artifact directory is missing', async () => {
    useFixture()
    rmSync(path.join(fixture!.root, '.output'), { recursive: true, force: true })
    expect(existsSync(path.join(fixture!.root, '.output'))).toBe(false)
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('artifact manifest: file is missing'))).toBe(true)
  })

  it('fails when the artifact manifest is missing from an existing directory', async () => {
    useFixture()
    rmSync(path.join(fixture!.root, '.output', 'release-manifest.json'), { force: true })
    expect(existsSync(path.join(fixture!.root, '.output'))).toBe(true)
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('artifact manifest: file is missing'))).toBe(true)
  })

  it('fails when a different artifact directory is supplied to preflight', async () => {
    useFixture()
    const problems = await runReleasePreflight({ root: fixture!.root, artifactDirectory: '.verified-output' })
    expect(problems.some((item: string) => item.includes('artifact manifest: file is missing'))).toBe(true)
  })

  it('fails when the approved A1 media Worker config is missing', async () => {
    useFixture()
    rmSync(path.join(fixture!.root, 'wrangler.media-release.jsonc'), { force: true })
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('media config: wrangler.media-release.jsonc is missing'))).toBe(true)
  })

  it('fails when the single-owner sign-off is absent', async () => {
    useFixture({ withSignoff: false })
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.includes('no release sign-off file was provided'))).toBe(true)
    expect(problems.some((item: string) => item.includes('control file: docs/release-signoff.json is missing'))).toBe(false)
  })

  it('fails when a release gate is not passing', async () => {
    useFixture({ gatePass: false })
    const problems = await runReleasePreflight({ root: fixture!.root })
    expect(problems.some((item: string) => item.startsWith('G1:'))).toBe(true)
  })
})
