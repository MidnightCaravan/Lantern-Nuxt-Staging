import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateReleaseGates, REQUIRED_SIGNOFF_ROLES } from '../scripts/release-gate-core.mjs'

const openState = {
  sourceCommit: 'abc123',
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
  sourceCommit: 'abc123',
  gates: Object.fromEntries(['G0', 'G1', 'G2', 'G3'].map((id) => [id, { title: id, pass: true, evidence: 'green' }])),
  blockers: Object.fromEntries(['B1', 'B7'].map((id) => [id, { title: id, closed: true }])),
}

const fullSignoff = {
  commit: 'abc123',
  roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role) => [role, { approved: true }])),
}

describe('release gate evaluation', () => {
  it('reports every open gate and blocker when no sign-off exists', () => {
    const problems = evaluateReleaseGates(openState, null)

    expect(problems.some((item: string) => item.startsWith('G1:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('G2:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('G3:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B1:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B7:'))).toBe(true)
  })

  it('passes only with all gates, closed blockers, and complete sign-off', () => {
    expect(evaluateReleaseGates(readyState, fullSignoff)).toEqual([])
  })

  it('rejects a sign-off for a different commit', () => {
    const problems = evaluateReleaseGates(readyState, { ...fullSignoff, commit: 'other' })

    expect(problems.some((item: string) => item.includes('does not match release commit'))).toBe(true)
  })

  it('rejects a sign-off missing any required role', () => {
    const roles = { ...fullSignoff.roles }
    delete (roles as any).authSecurity
    const problems = evaluateReleaseGates(readyState, { ...fullSignoff, roles })

    expect(problems.some((item: string) => item.includes('authSecurity has not approved'))).toBe(true)
  })

  it('keeps the sign-off template in sync with the required roles', () => {
    const template = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'docs/release-signoff.template.json'), 'utf8'),
    )
    expect(Object.keys(template.roles).sort()).toEqual([...REQUIRED_SIGNOFF_ROLES].sort())
    expect(Object.values(template.roles).every((role: any) => role.approved === false)).toBe(true)

    const approved = {
      ...template,
      commit: readyState.sourceCommit,
      roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role) => [role, { approved: true }])),
    }
    expect(evaluateReleaseGates(readyState, approved)).toEqual([])
  })
})
