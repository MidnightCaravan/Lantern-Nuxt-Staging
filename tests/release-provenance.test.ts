import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeArtifactHash,
  computeSourceTreeHash,
  isValidCommitSha,
  manifestsMatch,
  parseJsonc,
  validateCommitSha,
  validateControlCheckout,
  validateManifestShape,
  validateProductionConfig,
  validateTrackedCleanFiles,
} from '../scripts/release-provenance.mjs'
import {
  TEST_OTHER_COMMIT,
  TEST_SOURCE_COMMIT,
  createTempGitRepo,
  git,
  writeApprovedA1Configs,
  writeJson,
} from './helpers/release-fixtures'

describe('release provenance validation', () => {
  it('accepts only full lowercase 40-character SHAs', () => {
    expect(isValidCommitSha(TEST_SOURCE_COMMIT)).toBe(true)
    expect(validateCommitSha(TEST_SOURCE_COMMIT)).toEqual([])
    for (const value of ['', '   ', '962cd95', TEST_SOURCE_COMMIT.toUpperCase(), TEST_SOURCE_COMMIT.slice(0, 39), `${TEST_SOURCE_COMMIT}0`, 123, null]) {
      expect(isValidCommitSha(value as any)).toBe(false)
      expect(validateCommitSha(value, 'candidate').length).toBeGreaterThan(0)
    }
  })

  it('validates a control checkout independently from the approved source commit', () => {
    const repo = createTempGitRepo({ advanceHead: true })
    try {
      const controlSha = git(repo.root, ['rev-parse', 'HEAD'])
      expect(controlSha).not.toBe(repo.sourceCommit)
      expect(validateControlCheckout(repo.root, controlSha)).toEqual([])
      expect(validateControlCheckout(repo.root, repo.sourceCommit).some((item: string) => item.includes('does not match workflow control SHA'))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('rejects dirty, missing, and untracked control files', () => {
    const repo = createTempGitRepo()
    try {
      writeFileSync(path.join(repo.root, 'docs/release-gates.json'), '{}\n')
      git(repo.root, ['add', 'docs/release-gates.json'])
      git(repo.root, ['commit', '-q', '-m', 'control files'])
      expect(validateTrackedCleanFiles(repo.root, ['docs/release-gates.json'])).toEqual([])

      writeFileSync(path.join(repo.root, 'docs/release-gates.json'), '{ "changed": true }\n')
      expect(validateTrackedCleanFiles(repo.root, ['docs/release-gates.json']).some((item: string) => item.includes('uncommitted changes'))).toBe(true)
      expect(validateTrackedCleanFiles(repo.root, ['docs/missing.json']).some((item: string) => item.includes('missing'))).toBe(true)

      writeFileSync(path.join(repo.root, 'docs/untracked.json'), '{}\n')
      expect(validateTrackedCleanFiles(repo.root, ['docs/untracked.json']).some((item: string) => item.includes('not tracked'))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('hashes source trees and artifacts deterministically and rejects symlinks', () => {
    const repo = createTempGitRepo()
    const artifactRoot = mkdtempSync(path.join(tmpdir(), 'lantern-artifact-test-'))
    try {
      const firstTree = computeSourceTreeHash(repo.root, repo.sourceCommit)
      expect(firstTree).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(computeSourceTreeHash(repo.root, repo.sourceCommit)).toBe(firstTree)

      mkdirSync(path.join(artifactRoot, 'public'), { recursive: true })
      writeFileSync(path.join(artifactRoot, 'public', 'b.txt'), 'b')
      writeFileSync(path.join(artifactRoot, 'public', 'a.txt'), 'a')
      const first = computeArtifactHash(artifactRoot)
      expect(first.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(first.fileCount).toBe(2)

      writeFileSync(path.join(artifactRoot, 'release-manifest.json'), '{}')
      expect(computeArtifactHash(artifactRoot).artifactHash).toBe(first.artifactHash)

      writeFileSync(path.join(artifactRoot, 'public', 'a.txt'), 'modified')
      expect(computeArtifactHash(artifactRoot).artifactHash).not.toBe(first.artifactHash)

      symlinkSync(path.join(artifactRoot, 'public', 'a.txt'), path.join(artifactRoot, 'link'))
      expect(() => computeArtifactHash(artifactRoot)).toThrow(/symbolic link/)
    } finally {
      repo.cleanup()
      rmSync(artifactRoot, { recursive: true, force: true })
    }
  })

  it('rejects a symbolic link used as the artifact root', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'lantern-artifact-root-test-'))
    try {
      const realRoot = path.join(parent, 'real')
      mkdirSync(realRoot, { recursive: true })
      writeFileSync(path.join(realRoot, 'index.txt'), 'artifact\n')
      const linkedRoot = path.join(parent, 'linked')
      symlinkSync(realRoot, linkedRoot)
      expect(() => computeArtifactHash(linkedRoot)).toThrow(/symbolic link/)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('validates manifest shape and compares manifests independently of key order', () => {
    const left = {
      schemaVersion: 1,
      sourceCommit: TEST_SOURCE_COMMIT,
      sourceTreeHash: `sha256:${'a'.repeat(64)}`,
      artifactHash: `sha256:${'b'.repeat(64)}`,
      buildId: 'fixture-build',
      builtAt: '2026-11-25T00:00:00.000Z',
      nodeVersion: process.version,
      npmVersion: '10.0.0',
      artifactDirectory: '.output',
      ciRunId: null,
      artifactFiles: [{ path: 'public/index.txt', sha256: `sha256:${'c'.repeat(64)}`, size: 10 }],
      productionConfig: {
        path: 'wrangler.release.jsonc',
        sha256: `sha256:${'d'.repeat(64)}`,
        size: 20,
        worker: 'lantern',
        main: './.output/server/index.mjs',
        assetsDirectory: './.output/public/',
      },
      mediaConfig: {
        path: 'wrangler.media-release.jsonc',
        sha256: `sha256:${'e'.repeat(64)}`,
        size: 30,
      },
    }
    expect(validateManifestShape(left)).toEqual([])
    expect(manifestsMatch(left, { ...left })).toBe(true)

    const reordered = Object.fromEntries(Object.entries(left).reverse())
    expect(manifestsMatch(left, reordered)).toBe(true)

    expect(validateManifestShape({ ...left, sourceCommit: TEST_OTHER_COMMIT.slice(0, 7) }).length).toBeGreaterThan(0)
    expect(validateManifestShape({ ...left, artifactDirectory: '.other-output' }).some((item: string) => item.includes('must be .output'))).toBe(true)
    expect(validateManifestShape({ ...left, sourceRef: 'refs/tags/v1' }).some((item: string) => item.includes('sourceRef is not permitted'))).toBe(true)
  })

  it('parses full-line JSONC comments', () => {
    expect(parseJsonc('// note\n{\n  // another note\n  "name": "lantern"\n}\n')).toEqual({ name: 'lantern' })
  })
})

describe('release architecture validation', () => {
  it('accepts the approved A1 config shape and rejects production write enablement', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-a1-config-test-'))
    try {
      writeApprovedA1Configs(root)
      expect(validateProductionConfig(root)).toEqual([])

      const configPath = path.join(root, 'wrangler.release.jsonc')
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      config.vars.LANTERN_ENABLE_PRODUCTION_WRITES = '1'
      writeJson(configPath, config)
      expect(validateProductionConfig(root).some((item: string) => item.includes('LANTERN_ENABLE_PRODUCTION_WRITES'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an unapproved Worker architecture or unexpected config keys', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-a1-config-test-'))
    try {
      writeApprovedA1Configs(root)
      const configPath = path.join(root, 'wrangler.release.jsonc')
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      config.name = 'lantern-nuxt'
      config.workers_dev = false
      delete config.services
      config.kv_namespaces = [{ binding: 'CACHE', id: 'unapproved' }]
      writeJson(configPath, config)

      const problems = validateProductionConfig(root)
      expect(problems.some((item: string) => item.includes('approved A1 name'))).toBe(true)
      expect(problems.some((item: string) => item.includes('workers_dev must remain true'))).toBe(true)
      expect(problems.some((item: string) => item.includes('Service Binding'))).toBe(true)
      expect(problems.some((item: string) => item.includes('unexpected key kv_namespaces'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a media Worker with a public endpoint or non-R2 bindings', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-a1-media-config-test-'))
    try {
      writeApprovedA1Configs(root)
      const mediaPath = path.join(root, 'wrangler.media-release.jsonc')
      const media = JSON.parse(readFileSync(mediaPath, 'utf8'))
      media.workers_dev = true
      media.d1_databases = [{ binding: 'lantern_db', database_id: 'bf50e1be-81d7-4cd1-b082-8aa03a784860' }]
      writeJson(mediaPath, media)

      const problems = validateProductionConfig(root)
      expect(problems.some((item: string) => item.includes('media config: workers_dev must remain false'))).toBe(true)
      expect(problems.some((item: string) => item.includes('media config: d1_databases must remain absent'))).toBe(true)
      expect(problems.some((item: string) => item.includes('media config: unexpected key d1_databases'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
