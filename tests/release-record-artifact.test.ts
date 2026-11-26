import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RECORD_ARTIFACT_MESSAGE,
  recordReleaseArtifact,
} from '../scripts/release-record-artifact.mjs'
import {
  CONTROL_MANIFEST_PATH,
} from '../scripts/release-provenance.mjs'
import {
  createTempGitRepo,
  git,
  writeJson,
} from './helpers/release-fixtures'

function writeManifest(root: string, sourceCommit: string, sourceRef: string) {
  writeJson(path.join(root, CONTROL_MANIFEST_PATH), {
    schemaVersion: 1,
    sourceCommit,
    sourceRef,
    artifactHash: `sha256:${'a'.repeat(64)}`,
  })
}

describe('release artifact recording', () => {
  it('commits only the generated control manifest and returns the new control SHA', () => {
    const repo = createTempGitRepo()
    try {
      writeManifest(repo.root, repo.sourceCommit, repo.sourceRef)
      const before = git(repo.root, ['rev-parse', 'HEAD'])
      const result = recordReleaseArtifact({ root: repo.root })

      expect(result.ok).toBe(true)
      expect(result.recorded).toBe(true)
      expect(result.controlSha).not.toBe(before)
      expect(result.controlSha).toBe(git(repo.root, ['rev-parse', 'HEAD']))
      expect(git(repo.root, ['log', '-1', '--pretty=%s'])).toBe(RECORD_ARTIFACT_MESSAGE)
      expect(git(repo.root, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('')
      expect(existsSync(path.join(repo.root, CONTROL_MANIFEST_PATH))).toBe(true)
      expect(git(repo.root, ['ls-files', '--error-unmatch', '--', CONTROL_MANIFEST_PATH]))
        .toBe(CONTROL_MANIFEST_PATH)
    } finally {
      repo.cleanup()
    }
  })

  it('refuses to record when unrelated working-tree changes exist', () => {
    const repo = createTempGitRepo()
    try {
      writeManifest(repo.root, repo.sourceCommit, repo.sourceRef)
      writeFileSync(path.join(repo.root, 'fixture.txt'), 'unrelated change\n')
      const before = git(repo.root, ['rev-parse', 'HEAD'])
      const result = recordReleaseArtifact({ root: repo.root })

      expect(result.ok).toBe(false)
      expect(result.problems.join('\n')).toContain('refusing to commit with other working-tree changes')
      expect(result.problems.join('\n')).toContain('fixture.txt')
      expect(git(repo.root, ['rev-parse', 'HEAD'])).toBe(before)
    } finally {
      repo.cleanup()
    }
  })

  it('is idempotent once the generated manifest is already recorded', () => {
    const repo = createTempGitRepo()
    try {
      writeManifest(repo.root, repo.sourceCommit, repo.sourceRef)
      const first = recordReleaseArtifact({ root: repo.root })
      const second = recordReleaseArtifact({ root: repo.root })

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(second.recorded).toBe(false)
      expect(second.controlSha).toBe(first.controlSha)
      expect(git(repo.root, ['rev-parse', 'HEAD'])).toBe(first.controlSha)
    } finally {
      repo.cleanup()
    }
  })

  it('rejects a manifest with invalid release identity', () => {
    const repo = createTempGitRepo()
    try {
      writeJson(path.join(repo.root, CONTROL_MANIFEST_PATH), {
        sourceCommit: 'short',
        sourceRef: 'HEAD',
        artifactHash: 'not-a-hash',
      })
      const result = recordReleaseArtifact({ root: repo.root })

      expect(result.ok).toBe(false)
      expect(result.problems.join('\n')).toContain('sourceCommit must be a full 40-character')
      expect(result.problems.join('\n')).toContain('refs/tags')
      expect(result.problems.join('\n')).toContain('artifactHash must be sha256')
    } finally {
      repo.cleanup()
    }
  })

  it('documents the executable build-to-preflight handoff', () => {
    const handoff = readFileSync(path.resolve(process.cwd(), 'docs/RELEASE_ARTIFACT_HANDOFF.md'), 'utf8')
    const readme = readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8')

    expect(handoff).toContain('npm run release:build')
    expect(handoff).toContain('npm run release:record-artifact')
    expect(handoff).toContain('npm run release:check --control-sha=')
    expect(handoff).toContain('npm run release:preflight')
    expect(readme).toContain('npm run release:record-artifact')
  })
})
