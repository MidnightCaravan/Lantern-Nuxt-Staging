import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeArtifactHash,
  computeSourceTreeHash,
  isValidCommitSha,
  resolveReleaseRef,
  validateCommitSha,
  validateControlCheckout,
  validateEvidence,
  validateEvidenceRef,
  validateProductionConfig,
  validateReleaseRef,
  validateSignoff,
  validateTrackedCleanFiles,
} from '../scripts/release-provenance.mjs'
import {
  REQUIRED_SIGNOFF_ROLES,
} from '../scripts/release-gate-core.mjs'
import {
  TEST_OTHER_COMMIT,
  TEST_SOURCE_COMMIT,
  TEST_SOURCE_REF,
  createTempGitRepo,
  git,
  writeApprovedA1Configs,
  writeJson,
} from './helpers/release-fixtures'

const signoff = {
  commit: TEST_SOURCE_COMMIT,
  sourceRef: TEST_SOURCE_REF,
  roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role, index) => [role, {
    approved: true,
    name: `Test Approver ${index + 1}`,
    date: '2026-11-25',
  }])),
}

describe('release provenance validation', () => {
  it('accepts only full lowercase 40-character SHAs', () => {
    expect(isValidCommitSha(TEST_SOURCE_COMMIT)).toBe(true)
    expect(validateCommitSha(TEST_SOURCE_COMMIT)).toEqual([])
    for (const value of ['', '   ', '962cd95', TEST_SOURCE_COMMIT.toUpperCase(), TEST_SOURCE_COMMIT.slice(0, 39), `${TEST_SOURCE_COMMIT}0`, 123, null]) {
      expect(isValidCommitSha(value as any)).toBe(false)
      expect(validateCommitSha(value, 'candidate').length).toBeGreaterThan(0)
    }
  })

  it('resolves lightweight and annotated release tags to the exact commit', () => {
    for (const annotatedTag of [true, false]) {
      const repo = createTempGitRepo({ annotatedTag })
      try {
        const resolved = resolveReleaseRef(repo.root, repo.sourceRef)
        expect(resolved.commit).toBe(repo.sourceCommit)
        expect(resolved.sourceRefKind).toBe(annotatedTag ? 'annotated' : 'lightweight')
        expect(validateReleaseRef(repo.root, repo.sourceRef, repo.sourceCommit)).toEqual([])
      } finally {
        repo.cleanup()
      }
    }
  })

  it('rejects missing refs, moved tags, wrong refs, and mismatched commits', () => {
    const repo = createTempGitRepo({ advanceHead: true })
    try {
      expect(validateReleaseRef(repo.root, 'refs/tags/does-not-exist', repo.sourceCommit).length).toBeGreaterThan(0)
      expect(validateReleaseRef(repo.root, 'HEAD', repo.sourceCommit).some((item: string) => item.includes('refs/tags/'))).toBe(true)
      expect(validateReleaseRef(repo.root, repo.sourceRef, TEST_OTHER_COMMIT).some((item: string) => item.includes('not approved sourceCommit'))).toBe(true)

      const tagName = repo.sourceRef.replace('refs/tags/', '')
      git(repo.root, ['tag', '-f', tagName])
      const problems = validateReleaseRef(repo.root, repo.sourceRef, repo.sourceCommit)
      expect(problems.some((item: string) => item.includes('resolves to') && item.includes('not approved'))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('validates sign-off commit, ref, roles, placeholders, and dates', () => {
    expect(validateSignoff(signoff, TEST_SOURCE_COMMIT, TEST_SOURCE_REF)).toEqual([])
    expect(validateSignoff({ ...signoff, commit: TEST_OTHER_COMMIT }, TEST_SOURCE_COMMIT, TEST_SOURCE_REF).length).toBeGreaterThan(0)
    expect(validateSignoff({ ...signoff, sourceRef: 'refs/tags/other' }, TEST_SOURCE_COMMIT, TEST_SOURCE_REF).length).toBeGreaterThan(0)

    const roles: Record<string, any> = { ...signoff.roles }
    delete roles.authSecurity
    expect(validateSignoff({ ...signoff, roles }, TEST_SOURCE_COMMIT, TEST_SOURCE_REF).some((item: string) => item.includes('authSecurity'))).toBe(true)

    roles.applicationOwner = { approved: 'true', name: 'Test Approver 1', date: '2026-11-25' }
    roles.infraCloudflare = { approved: true, name: 'REPLACE_WITH_NAME', date: '2026-11-25' }
    roles.authSecurity = { approved: true, name: 'Test Approver 3', date: '2026-02-30' }
    const problems = validateSignoff({ ...signoff, roles }, TEST_SOURCE_COMMIT, TEST_SOURCE_REF)
    expect(problems.some((item: string) => item.includes('boolean true'))).toBe(true)
    expect(problems.some((item: string) => item.includes('placeholder'))).toBe(true)
    expect(problems.some((item: string) => item.includes('YYYY-MM-DD'))).toBe(true)
  })

  it('rejects a sign-off where one person holds multiple roles', () => {
    const duplicate = {
      ...signoff,
      roles: {
        ...signoff.roles,
        authSecurity: {
          ...signoff.roles.authSecurity,
          name: signoff.roles.applicationOwner.name,
        },
      },
    }
    const problems = validateSignoff(duplicate, TEST_SOURCE_COMMIT, TEST_SOURCE_REF)
    expect(problems.some((item: string) => item.includes('four distinct people'))).toBe(true)
  })

  it('validates evidence text and reference formats', () => {
    expect(validateEvidence({
      evidence: 'Observed green CI and approved artifact',
      evidenceRefs: [`sha:${TEST_SOURCE_COMMIT}`, 'ci-run:12345', 'docs:docs/CUTOVER_READINESS.md'],
    }, { root: process.cwd(), sourceCommit: TEST_SOURCE_COMMIT, requireSource: true })).toEqual([])

    expect(validateEvidence({ evidence: '', evidenceRefs: [] }, {}).length).toBeGreaterThan(0)
    expect(validateEvidence({
      evidence: 'No source reference',
      evidenceRefs: ['ci-run:12345'],
    }, { sourceCommit: TEST_SOURCE_COMMIT, requireSource: true }).some((item: string) => item.includes('approved source commit'))).toBe(true)
    expect(validateEvidence({
      evidence: 'Bad refs',
      evidenceRefs: [`sha:962cd95`, 'docs:../secret', 'unknown:value'],
    }, {}).length).toBeGreaterThan(0)
  })

  it('validates opaque evidence identifiers, artifact hashes, and tracked docs', () => {
    const approvedHash = `sha256:${'a'.repeat(64)}`
    expect(validateEvidenceRef(`artifact:${approvedHash}`, {
      expectedArtifactHash: approvedHash,
      requireArtifactHash: true,
    })).toEqual([])
    expect(validateEvidenceRef(`artifact:sha256:${'b'.repeat(64)}`, {
      expectedArtifactHash: approvedHash,
      requireArtifactHash: true,
    }).some((item: string) => item.includes('does not match approved artifact'))).toBe(true)
    expect(validateEvidenceRef(`artifact:${approvedHash}`, {
      requireArtifactHash: true,
    }).some((item: string) => item.includes('no approved artifact hash is available'))).toBe(true)

    expect(validateEvidenceRef('ci-run:x').some((item: string) => item.includes('invalid identifier'))).toBe(true)
    expect(validateEvidenceRef('worker-version:not-a-uuid').some((item: string) => item.includes('version UUID'))).toBe(true)
    expect(validateEvidenceRef('release-ref:refs/heads/main').some((item: string) => item.includes('refs/tags'))).toBe(true)
    expect(validateEvidenceRef('ticket:INC-123')).toEqual([])

    const repo = createTempGitRepo()
    try {
      expect(validateEvidenceRef('docs:docs/.gitkeep', {
        root: repo.root,
        checkDocs: true,
        requireDocsTracked: true,
      })).toEqual([])
      writeFileSync(path.join(repo.root, 'docs', 'untracked-evidence.md'), 'untracked\n')
      expect(validateEvidenceRef('docs:docs/untracked-evidence.md', {
        root: repo.root,
        checkDocs: true,
        requireDocsTracked: true,
      }).some((item: string) => item.includes('not tracked in the control checkout'))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('rejects dirty and untracked control files', () => {
    const repo = createTempGitRepo()
    try {
      writeFileSync(path.join(repo.root, 'docs/release-gates.json'), '{}\n')
      git(repo.root, ['add', 'docs/release-gates.json'])
      git(repo.root, ['commit', '-q', '-m', 'control files'])
      expect(validateTrackedCleanFiles(repo.root, ['docs/release-gates.json'])).toEqual([])

      writeFileSync(path.join(repo.root, 'docs/release-gates.json'), '{ "changed": true }\n')
      expect(validateTrackedCleanFiles(repo.root, ['docs/release-gates.json']).some((item: string) => item.includes('uncommitted changes'))).toBe(true)
      expect(validateTrackedCleanFiles(repo.root, ['docs/missing.json']).some((item: string) => item.includes('missing'))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('hashes source trees and artifacts deterministically', () => {
    const repo = createTempGitRepo()
    const artifactRoot = mkdtempSync(path.join(tmpdir(), 'lantern-artifact-test-'))
    try {
      const firstTree = computeSourceTreeHash(repo.root, repo.sourceCommit)
      expect(firstTree).toMatch(/^sha256:[0-9a-f]{64}$/)

      mkdirSync(path.join(artifactRoot, 'public'), { recursive: true })
      writeFileSync(path.join(artifactRoot, 'public', 'b.txt'), 'b')
      writeFileSync(path.join(artifactRoot, 'public', 'a.txt'), 'a')
      const first = computeArtifactHash(artifactRoot)
      expect(first.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/)

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
})

describe('release architecture validation', () => {
  it('validates a control checkout independently from the application source commit', () => {
    const repo = createTempGitRepo({ advanceHead: true })
    try {
      const controlSha = git(repo.root, ['rev-parse', 'HEAD'])
      expect(controlSha).not.toBe(repo.sourceCommit)
      expect(validateControlCheckout(repo.root, controlSha)).toEqual([])
      expect(validateControlCheckout(repo.root, repo.sourceCommit).some(
        (item: string) => item.includes('does not match workflow control SHA'),
      )).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('accepts the approved A1 Worker name, workers.dev host, Service Binding, and private media Worker', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-a1-config-test-'))
    try {
      writeApprovedA1Configs(root)
      expect(validateProductionConfig(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects production config keys outside the approved A1 allow-list', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-a1-config-test-'))
    try {
      writeApprovedA1Configs(root)
      const configPath = path.join(root, 'wrangler.release.jsonc')
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      config.kv_namespaces = [{ binding: 'CACHE', id: 'unapproved' }]
      writeJson(configPath, config)

      const problems = validateProductionConfig(root)
      expect(problems.some((item: string) => item.includes('production config: unexpected key kv_namespaces'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects the unapproved new-Worker and direct-R2 architecture', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-a1-config-test-'))
    try {
      writeApprovedA1Configs(root)
      const configPath = path.join(root, 'wrangler.release.jsonc')
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      config.name = 'lantern-nuxt'
      config.workers_dev = false
      delete config.services
      writeJson(configPath, config)

      const problems = validateProductionConfig(root)
      expect(problems.some((item: string) => item.includes('approved A1 name'))).toBe(true)
      expect(problems.some((item: string) => item.includes('workers_dev must remain true'))).toBe(true)
      expect(problems.some((item: string) => item.includes('Service Binding'))).toBe(true)
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
