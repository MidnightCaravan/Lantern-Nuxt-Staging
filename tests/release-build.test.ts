import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRelease } from '../scripts/release-build.mjs'
import { evaluateReleaseGates, REQUIRED_SIGNOFF_ROLES } from '../scripts/release-gate-core.mjs'
import { computeArtifactHash, computeSourceTreeHash } from '../scripts/release-provenance.mjs'
import {
  TEST_OTHER_COMMIT,
  createTempGitRepo,
  git,
  writeJson,
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
  it('builds once from the approved detached source and records matching artifact provenance', async () => {
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
        state: { sourceCommit: repo.sourceCommit, sourceRef: repo.sourceRef },
        runCommand: runner,
      })

      expect(npmCommands).toContain('ci')
      expect(npmCommands).toContain('run verify')
      expect(npmCommands).not.toContain('run build')

      expect(result.manifest.sourceCommit).toBe(repo.sourceCommit)
      expect(result.manifest.sourceRef).toBe(repo.sourceRef)
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

      expect(existsSync(path.join(repo.root, '.output', 'release-manifest.json'))).toBe(true)
      expect(existsSync(path.join(repo.root, 'docs/release-artifact.json'))).toBe(true)
      const control = JSON.parse(readFileSync(path.join(repo.root, 'docs/release-artifact.json'), 'utf8'))
      expect(control).toEqual(result.manifest)
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
        state: { sourceCommit: repo.sourceCommit, sourceRef: repo.sourceRef },
        runCommand: runner,
      })).rejects.toThrow(/not clean/)
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
        state: { sourceCommit: repo.sourceCommit, sourceRef: repo.sourceRef },
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
        state: { sourceCommit: repo.sourceCommit, sourceRef: repo.sourceRef },
        runCommand: runner,
      })).rejects.toThrow(/stale build output/)
      expect(readFileSync(path.join(repo.root, '.output', 'stale.txt'), 'utf8')).toBe('stale\n')
    } finally {
      repo.cleanup()
    }
  })

  it('rejects a source SHA that does not match the immutable ref', async () => {
    const repo = createTempGitRepo()
    const { runner } = realRunner(repo.root)

    try {
      await expect(buildRelease({
        root: repo.root,
        state: { sourceCommit: TEST_OTHER_COMMIT, sourceRef: repo.sourceRef },
        runCommand: runner,
      })).rejects.toThrow(/not approved sourceCommit/)
    } finally {
      repo.cleanup()
    }
  })

  it('builds exactly source C when the release-control commit is later than C', async () => {
    const repo = createTempGitRepo({ advanceHead: true })
    const sourceCommit = repo.sourceCommit
    const sourceRef = repo.sourceRef
    const sourceShaRef = `sha:${sourceCommit}`
    const gate = (title: string, refs: string[]) => ({
      title,
      pass: true,
      evidence: 'fixture release evidence',
      evidenceRefs: refs,
    })
    const blocker = (title: string, refs: string[]) => ({
      title,
      closed: true,
      evidence: 'fixture release evidence',
      evidenceRefs: refs,
    })
    const state = {
      release: 'lantern',
      sourceCommit,
      sourceRef,
      gates: {
        G0: gate('Staging behavioral parity', [sourceShaRef, 'ci-run:fixture-ci']),
        G1: gate('Operational readiness', [sourceShaRef, 'ticket:fixture-b1']),
        G2: gate('Release controls', [sourceShaRef, 'ticket:fixture-b7']),
        G3: gate('Explicit sign-off', [sourceShaRef, 'docs:docs/release-signoff.json']),
      },
      blockers: {
        B1: blocker('Production media binding not deployed', ['worker-version:fixture-media-version', 'ticket:fixture-b1']),
        B2: blocker('Production migration state inspected', ['docs:docs/release-gates.json']),
        B3: blocker('Durable rate limits and session parity', ['docs:docs/release-gates.json']),
        B4: blocker('Legacy scrypt hash parity', ['docs:docs/release-gates.json']),
        B5: blocker('Legacy Worker remains media origin', ['docs:docs/release-gates.json']),
        B6: blocker('Release gate check prepared', ['docs:docs/release-gates.json']),
        B7: blocker('Worker-version rollback rehearsal', ['ticket:fixture-b7']),
      },
    }
    const signoff = {
      commit: sourceCommit,
      sourceRef,
      roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role, index) => [role, {
        approved: true,
        name: `Fixture Approver ${index + 1}`,
        date: '2026-11-25',
      }])),
    }
    const controlFiles = [
      'docs/release-gates.json',
      'docs/release-signoff.template.json',
      'docs/release-signoff.json',
    ]

    let buildWorktreeHead = ''
    let buildWorktreeMissingControls = false
    const { runner, npmCwds } = realRunner(repo.root, {
      beforeHeadCheck: (worktreePath) => {
        buildWorktreeHead = git(worktreePath, ['rev-parse', 'HEAD'])
      },
      onNpm: (_args, cwd) => {
        expect(cwd).not.toBe(repo.root)
        expect(existsSync(path.join(cwd, 'docs/release-gates.json'))).toBe(false)
        expect(readFileSync(path.join(cwd, 'fixture.txt'), 'utf8')).toBe('candidate\n')
        buildWorktreeMissingControls = true
      },
    })

    try {
      writeJson(path.join(repo.root, 'docs/release-gates.json'), state)
      writeJson(path.join(repo.root, 'docs/release-signoff.json'), signoff)
      writeFileSync(
        path.join(repo.root, 'docs/release-signoff.template.json'),
        readFileSync(path.resolve(process.cwd(), 'docs/release-signoff.template.json'), 'utf8'),
      )
      git(repo.root, ['add', '-A'])
      git(repo.root, ['commit', '-q', '-m', 'record later release controls'])
      const controlSha = git(repo.root, ['rev-parse', 'HEAD'])
      expect(controlSha).not.toBe(sourceCommit)

      expect(evaluateReleaseGates(state, signoff, {
        root: repo.root,
        checkRef: true,
        controlFiles,
        controlSha,
      })).toEqual([])

      const result = await buildRelease({
        root: repo.root,
        state,
        sourceCommitOverride: sourceCommit,
        sourceRefOverride: sourceRef,
        controlShaOverride: controlSha,
        eventSha: controlSha,
        runCommand: runner,
      })

      expect(buildWorktreeHead).toBe(sourceCommit)
      expect(buildWorktreeMissingControls).toBe(true)
      expect(npmCwds.every((cwd) => cwd !== repo.root)).toBe(true)
      expect(result.manifest.sourceCommit).toBe(sourceCommit)
      expect(result.manifest.sourceTreeHash).toBe(computeSourceTreeHash(repo.root, sourceCommit))
      expect(result.manifest.sourceTreeHash).not.toBe(computeSourceTreeHash(repo.root, controlSha))
      expect(result.manifest.provenance.workflowControlSha).toBe(controlSha)
      expect(result.manifest.provenance.applicationSourceSha).toBe(sourceCommit)
      expect(result.manifest.provenance.workflowEventSha).toBe(controlSha)
      expect(controlSha).not.toBe(sourceCommit)
    } finally {
      repo.cleanup()
    }
  })
})
