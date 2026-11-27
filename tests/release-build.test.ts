import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRelease } from '../scripts/release-build.mjs'
import { evaluateReleaseGates } from '../scripts/release-gate-core.mjs'
import { computeArtifactHash, computeSourceTreeHash, validateManifestShape } from '../scripts/release-provenance.mjs'
import {
  TEST_OTHER_COMMIT,
  createReleaseControlFixture,
  createTempGitRepo,
  git,
} from './helpers/release-fixtures'

type Runner = (command: string, args: string[], options?: { cwd?: string }) => Promise<string> | string

function realRunner(root: string, hooks: {
  afterWorktreeAdd?: (worktreePath: string) => void
  beforeHeadCheck?: (worktreePath: string) => void
  onNpm?: (command: string[], cwd: string) => void
} = {}) {
  const npmCommands: string[] = []
  const npmCwds: string[] = []

  const runner: Runner = async (command, args, options = {}) => {
    if (command === 'git') {
      const result = execFileSync('git', args, {
        cwd: options.cwd ?? root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (args.includes('worktree') && args.includes('add')) {
        hooks.afterWorktreeAdd?.(args[5])
      }
      if (args.includes('rev-parse') && args.at(-1) === 'HEAD' && options.cwd !== root) {
        hooks.beforeHeadCheck?.(options.cwd!)
      }
      return result
    }
    if (command === 'npm') {
      const cwd = options.cwd ?? root
      npmCommands.push(args.join(' '))
      npmCwds.push(cwd)
      hooks.onNpm?.(args, cwd)
      if (args[0] === 'run' && args[1] === 'verify') {
        mkdirSync(path.join(cwd, '.output', 'public'), { recursive: true })
        writeFileSync(path.join(cwd, '.output', 'public', 'index.txt'), 'built from approved source\n')
      }
      if (args[0] === '--version') return '10.0.0\n'
      return ''
    }
    throw new Error(`unexpected command ${command}`)
  }

  return { runner, npmCommands, npmCwds }
}

describe('clean detached release build', () => {
  it('builds once from the approved detached source and records matching provenance', async () => {
    const repo = createTempGitRepo()
    const { runner, npmCommands, npmCwds } = realRunner(repo.root, {
      onNpm: (args, cwd) => {
        expect(cwd).not.toBe(repo.root)
        expect(args.join(' ')).not.toBe('run build')
      },
    })

    try {
      const result = await buildRelease({
        root: repo.root,
        state: { sourceCommit: repo.sourceCommit },
        runCommand: runner,
      })

      expect(npmCommands).toContain('ci')
      expect(npmCommands).toContain('run verify')
      expect(npmCommands).not.toContain('run build')

      expect(result.manifest.sourceCommit).toBe(repo.sourceCommit)
      expect(result.manifest).not.toHaveProperty('sourceRef')
      expect(result.manifest.provenance).not.toHaveProperty('githubRef')
      expect(result.manifest.sourceTreeHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.manifest.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.manifest.artifactFiles.length).toBeGreaterThan(0)
      expect(result.manifest.artifactFiles[0]).toHaveProperty('sha256')
      expect(result.manifest.productionConfig.worker).toBe('lantern')
      expect(result.manifest.productionConfig.main).toBe('./.output/server/index.mjs')
      expect(result.manifest.productionConfig.assetsDirectory).toBe('./.output/public/')
      expect(result.manifest.productionConfig.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.manifest.mediaConfig.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.manifest.artifactDirectory).toBe('.output')
      expect(result.manifest.buildId).toContain(repo.sourceCommit.slice(0, 12))
      expect(result.manifest.nodeVersion).toBe(process.version)
      expect(result.manifest.npmVersion).toBe('10.0.0')
      expect(validateManifestShape(result.manifest)).toEqual([])

      expect(existsSync(path.join(repo.root, '.output', 'release-manifest.json'))).toBe(true)
      expect(existsSync(path.join(repo.root, 'docs/release-artifact.json'))).toBe(false)
      const copiedManifest = JSON.parse(readFileSync(path.join(repo.root, '.output', 'release-manifest.json'), 'utf8'))
      expect(copiedManifest).toEqual(result.manifest)
      expect(computeArtifactHash(path.join(repo.root, '.output')).artifactHash).toBe(result.manifest.artifactHash)
      expect(npmCwds.every((cwd) => cwd !== repo.root)).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it('rejects a dirty detached build worktree', async () => {
    const repo = createTempGitRepo()
    const { runner } = realRunner(repo.root, {
      afterWorktreeAdd: (worktreePath) => {
        writeFileSync(path.join(worktreePath, 'untracked.txt'), 'dirty\n')
      },
    })

    try {
      await expect(buildRelease({
        root: repo.root,
        state: { sourceCommit: repo.sourceCommit },
        runCommand: runner,
      })).rejects.toThrow(/not clean/)
      expect(existsSync(path.join(repo.root, '.output'))).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it('rejects tracked source modifications made by install or verification', async () => {
    const repo = createTempGitRepo()
    const { runner } = realRunner(repo.root, {
      onNpm: (args, cwd) => {
        if (args[0] === 'run' && args[1] === 'verify') {
          writeFileSync(path.join(cwd, 'fixture.txt'), 'modified during verification\n')
        }
      },
    })

    try {
      await expect(buildRelease({
        root: repo.root,
        state: { sourceCommit: repo.sourceCommit },
        runCommand: runner,
      })).rejects.toThrow(/tracked source files were modified during install or verification/)
      expect(existsSync(path.join(repo.root, '.output'))).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it('rejects a build worktree whose HEAD is not the approved commit', async () => {
    const repo = createTempGitRepo()
    const { runner } = realRunner(repo.root, {
      beforeHeadCheck: () => undefined,
    })
    const wrongHeadRunner: Runner = (command, args, options) => {
      if (command === 'git' && args.includes('rev-parse') && args.at(-1) === 'HEAD' && options?.cwd !== repo.root) {
        return TEST_OTHER_COMMIT
      }
      return runner(command, args, options)
    }

    try {
      await expect(buildRelease({
        root: repo.root,
        state: { sourceCommit: repo.sourceCommit },
        runCommand: wrongHeadRunner,
      })).rejects.toThrow(/does not match approved sourceCommit/)
    } finally {
      repo.cleanup()
    }
  })

  it('refuses to overwrite stale root .output', async () => {
    const repo = createTempGitRepo()
    mkdirSync(path.join(repo.root, '.output'), { recursive: true })
    writeFileSync(path.join(repo.root, '.output', 'stale.txt'), 'stale\n')
    const { runner } = realRunner(repo.root)

    try {
      await expect(buildRelease({
        root: repo.root,
        state: { sourceCommit: repo.sourceCommit },
        runCommand: runner,
      })).rejects.toThrow(/stale build output/)
      expect(readFileSync(path.join(repo.root, '.output', 'stale.txt'), 'utf8')).toBe('stale\n')
    } finally {
      repo.cleanup()
    }
  })

  it('rejects a --source-commit override that does not match the pinned source', async () => {
    const repo = createTempGitRepo()
    const { runner } = realRunner(repo.root)

    try {
      await expect(buildRelease({
        root: repo.root,
        state: { sourceCommit: repo.sourceCommit },
        sourceCommitOverride: TEST_OTHER_COMMIT,
        runCommand: runner,
      })).rejects.toThrow(/does not match docs\/release-gates.json#sourceCommit/)
    } finally {
      repo.cleanup()
    }
  })

  it('builds exactly the pinned source when the control checkout is a later commit', async () => {
    const control = createReleaseControlFixture()
    const { root, sourceCommit } = control
    const controlSha = git(root, ['rev-parse', 'HEAD'])
    const state = JSON.parse(readFileSync(path.join(root, 'docs/release-gates.json'), 'utf8'))
    const signoff = JSON.parse(readFileSync(path.join(root, 'docs/release-signoff.json'), 'utf8'))
    expect(evaluateReleaseGates(state, signoff)).toEqual([])
    rmSync(path.join(root, '.output'), { recursive: true, force: true })

    let buildWorktreeHead = ''
    let buildWorktreeMissingControls = false
    const { runner, npmCwds } = realRunner(root, {
      beforeHeadCheck: (worktreePath) => {
        buildWorktreeHead = git(worktreePath, ['rev-parse', 'HEAD'])
      },
      onNpm: (_args, cwd) => {
        expect(cwd).not.toBe(root)
        expect(existsSync(path.join(cwd, 'docs/release-gates.json'))).toBe(false)
        expect(readFileSync(path.join(cwd, 'fixture.txt'), 'utf8')).toBe('candidate\n')
        buildWorktreeMissingControls = true
      },
    })

    try {
      const result = await buildRelease({
        root,
        state,
        sourceCommitOverride: sourceCommit,
        controlShaOverride: controlSha,
        eventSha: controlSha,
        runCommand: runner,
      })

      expect(buildWorktreeHead).toBe(sourceCommit)
      expect(buildWorktreeMissingControls).toBe(true)
      expect(npmCwds.every((cwd) => cwd !== root)).toBe(true)
      expect(result.manifest.sourceCommit).toBe(sourceCommit)
      expect(result.manifest.sourceTreeHash).toBe(computeSourceTreeHash(root, sourceCommit))
      expect(result.manifest.sourceTreeHash).not.toBe(computeSourceTreeHash(root, controlSha))
      expect(result.manifest.provenance.workflowControlSha).toBe(controlSha)
      expect(result.manifest.provenance.workflowEventSha).toBe(controlSha)
      expect(result.manifest.provenance.applicationSourceSha).toBe(sourceCommit)
    } finally {
      control.cleanup()
    }
  })
})
