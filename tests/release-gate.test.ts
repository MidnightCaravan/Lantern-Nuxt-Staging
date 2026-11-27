import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_MODEL,
  evaluateReleaseGates,
  REQUIRED_SIGNOFF_ROLES,
} from '../scripts/release-gate-core.mjs'

const PINNED_SHA = 'f62b0abada1ee5b3ba1b0397ae9bfead1245e9de'
const REPO_ROOT = process.cwd()
const GATE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'release-gate.mjs')

const openState = {
  approvalModel: APPROVAL_MODEL,
  sourceCommit: PINNED_SHA,
  gates: {
    G0: { title: 'Staging behavioral parity', pass: true, evidence: 'green' },
    G1: { title: 'Operational readiness', pass: false, evidence: 'B1 open' },
    G2: { title: 'Release controls', pass: false, evidence: 'no rehearsal' },
    G3: { title: 'Explicit sign-off', pass: false, evidence: 'absent' },
  },
  blockers: {
    B1: { title: 'Production media binding missing', closed: false },
    B7: { title: 'Rollback rehearsal', closed: false },
  },
}

const readyState = {
  approvalModel: APPROVAL_MODEL,
  sourceCommit: PINNED_SHA,
  gates: Object.fromEntries(['G0', 'G1', 'G2', 'G3'].map((id) => [id, { title: id, pass: true, evidence: 'green' }])),
  blockers: Object.fromEntries(['B1', 'B7'].map((id) => [id, { title: id, closed: true }])),
}

const fullSignoff = {
  approvalModel: APPROVAL_MODEL,
  commit: PINNED_SHA,
  noIndependentHumanReview: true,
  acceptsInfrastructureAndSecurityRisk: true,
  roles: {
    applicationOwner: {
      approved: true,
      name: 'Fixture Owner',
      date: '2026-11-27',
    },
  },
}

describe('release gate evaluation', () => {
  it('requires exactly the applicationOwner role', () => {
    expect(REQUIRED_SIGNOFF_ROLES).toEqual(['applicationOwner'])
  })

  it('reports every open gate and blocker when no sign-off exists', () => {
    const problems = evaluateReleaseGates(openState, null)

    expect(problems.some((item: string) => item.startsWith('G1:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('G2:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('G3:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B1:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B7:'))).toBe(true)
  })

  it('passes only with all gates, closed blockers, and complete single-owner sign-off', () => {
    expect(evaluateReleaseGates(readyState, fullSignoff)).toEqual([])
  })

  it('rejects a sign-off for a different commit', () => {
    const problems = evaluateReleaseGates(readyState, { ...fullSignoff, commit: 'other' })

    expect(problems.some((item: string) => item.includes('does not match pinned release commit'))).toBe(true)
  })

  it('requires a full lowercase hexadecimal sourceCommit', () => {
    const short = evaluateReleaseGates({ ...readyState, sourceCommit: 'abc123' }, fullSignoff)
    const uppercase = evaluateReleaseGates({ ...readyState, sourceCommit: PINNED_SHA.toUpperCase() }, fullSignoff)

    expect(short.some((item: string) => item.includes('full 40-character lowercase hexadecimal SHA'))).toBe(true)
    expect(uppercase.some((item: string) => item.includes('full 40-character lowercase hexadecimal SHA'))).toBe(true)
  })

  it('requires the single-owner approvalModel in state and sign-off', () => {
    const badState = evaluateReleaseGates({ ...readyState, approvalModel: 'four-role' }, fullSignoff)
    const badSignoff = evaluateReleaseGates(readyState, { ...fullSignoff, approvalModel: 'four-role' })

    expect(badState.some((item: string) => item.includes('approvalModel must be single-owner in release state'))).toBe(true)
    expect(badSignoff.some((item: string) => item.includes('sign-off approvalModel must be single-owner'))).toBe(true)
  })

  it('rejects a sign-off missing applicationOwner', () => {
    const problems = evaluateReleaseGates(readyState, { ...fullSignoff, roles: {} })

    expect(problems.some((item: string) => item.includes('applicationOwner has not approved'))).toBe(true)
  })

  it('rejects unsupported legacy roles', () => {
    const problems = evaluateReleaseGates(readyState, {
      ...fullSignoff,
      roles: {
        ...fullSignoff.roles,
        infraCloudflare: { approved: true, name: 'Fixture Role', date: '2026-11-27' },
      },
    })

    expect(problems.some((item: string) => item.includes('unsupported legacy role infraCloudflare'))).toBe(true)
  })

  it('requires strict approval, owner name, and valid ISO date', () => {
    const unapproved = evaluateReleaseGates(readyState, {
      ...fullSignoff,
      roles: { applicationOwner: { ...fullSignoff.roles.applicationOwner, approved: 1 as unknown as boolean } },
    })
    const emptyName = evaluateReleaseGates(readyState, {
      ...fullSignoff,
      roles: { applicationOwner: { ...fullSignoff.roles.applicationOwner, name: '   ' } },
    })
    const badDate = evaluateReleaseGates(readyState, {
      ...fullSignoff,
      roles: { applicationOwner: { ...fullSignoff.roles.applicationOwner, date: '2026-02-30' } },
    })

    expect(unapproved.some((item: string) => item.includes('applicationOwner has not approved'))).toBe(true)
    expect(emptyName.some((item: string) => item.includes('applicationOwner name is required'))).toBe(true)
    expect(badDate.some((item: string) => item.includes('valid ISO date'))).toBe(true)
  })

  it('requires both explicit risk acknowledgements', () => {
    const noReview = evaluateReleaseGates(readyState, { ...fullSignoff, noIndependentHumanReview: false })
    const noRisk = evaluateReleaseGates(readyState, { ...fullSignoff, acceptsInfrastructureAndSecurityRisk: false })

    expect(noReview.some((item: string) => item.includes('noIndependentHumanReview must be true'))).toBe(true)
    expect(noRisk.some((item: string) => item.includes('acceptsInfrastructureAndSecurityRisk must be true'))).toBe(true)
  })

  it('keeps the sign-off template in sync with the single-owner policy', () => {
    const template = JSON.parse(
      readFileSync(path.resolve(REPO_ROOT, 'docs/release-signoff.template.json'), 'utf8'),
    )

    expect(template.approvalModel).toBe(APPROVAL_MODEL)
    expect(template.commit).toBe(PINNED_SHA)
    expect(Object.keys(template.roles)).toEqual(['applicationOwner'])
    expect(template.roles.applicationOwner.approved).toBe(false)
    expect(template.noIndependentHumanReview).toBe(false)
    expect(template.acceptsInfrastructureAndSecurityRisk).toBe(false)

    const approved = {
      ...template,
      commit: readyState.sourceCommit,
      noIndependentHumanReview: true,
      acceptsInfrastructureAndSecurityRisk: true,
      roles: {
        applicationOwner: {
          ...template.roles.applicationOwner,
          approved: true,
          name: 'Fixture Owner',
          date: '2026-11-27',
        },
      },
    }
    expect(evaluateReleaseGates(readyState, approved)).toEqual([])
  })

  it('uses the pinned release commit instead of a temporary repository HEAD', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lantern-release-gate-'))

    try {
      mkdirSync(path.join(root, 'docs'))
      writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
        name: 'lantern-release-gate-head-binding-fixture',
        private: true,
        scripts: { 'release:check': `node ${JSON.stringify(GATE_SCRIPT)}` },
      }, null, 2)}\n`)

      execFileSync('git', ['init', '-q'], { cwd: root })
      execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
      writeFileSync(path.join(root, 'fixture.txt'), 'temporary repository head\n')
      execFileSync('git', ['add', 'fixture.txt'], { cwd: root })
      execFileSync('git', ['commit', '-q', '-m', 'fixture head'], { cwd: root })

      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
      expect(head).toMatch(/^[0-9a-f]{40}$/)
      expect(head).not.toBe(PINNED_SHA)

      writeFileSync(path.join(root, 'docs', 'release-gates.json'), `${JSON.stringify(readyState, null, 2)}\n`)
      writeFileSync(path.join(root, 'docs', 'release-signoff.json'), `${JSON.stringify(fullSignoff, null, 2)}\n`)

      const result = spawnSync('npm', ['run', 'release:check'], { cwd: root, encoding: 'utf8' })
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

      if (result.status !== 0) {
        throw new Error(`release:check failed with status ${result.status}: ${output}`)
      }
      expect(output).toContain('Lantern release gates: READY.')
      expect(output).not.toContain('does not match pinned release commit')
      expect(output).not.toContain(head)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
