import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateReleaseGates, REQUIRED_SIGNOFF_ROLES } from '../scripts/release-gate-core.mjs'
import {
  TEST_OTHER_COMMIT,
  TEST_SOURCE_COMMIT,
  TEST_SOURCE_REF,
  createTempGitRepo,
} from './helpers/release-fixtures'

const roleApproval = (role: string) => ({
  approved: true,
  name: `${role} Approver`,
  date: '2026-11-25',
})

const fullSignoff = {
  commit: TEST_SOURCE_COMMIT,
  sourceRef: TEST_SOURCE_REF,
  roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role) => [role, roleApproval(role)])),
}

const gateEvidence = (title: string) => ({
  title,
  pass: true,
  evidence: 'Verified in the authorized release fixture',
  evidenceRefs: [`sha:${TEST_SOURCE_COMMIT}`, 'ci-run:12345'],
})

const blockerEvidence = (title: string, extraRefs: string[] = []) => ({
  title,
  closed: true,
  evidence: 'Verified in the authorized release fixture',
  evidenceRefs: ['docs:docs/CUTOVER_READINESS.md', ...extraRefs],
})

const readyState = {
  sourceCommit: TEST_SOURCE_COMMIT,
  sourceRef: TEST_SOURCE_REF,
  gates: {
    G0: gateEvidence('Staging behavioral parity'),
    G1: gateEvidence('Operational readiness'),
    G2: gateEvidence('Release controls'),
    G3: {
      ...gateEvidence('Explicit sign-off'),
      evidenceRefs: [`sha:${TEST_SOURCE_COMMIT}`, 'docs:docs/release-signoff.json'],
    },
  },
  blockers: {
    B1: blockerEvidence('Production media binding not deployed', ['worker-version:0b49a4af-8ad8-447d-b29b-2358ebe2e3af', 'ticket:fixture-ticket']),
    B2: blockerEvidence('Production migration state inspected'),
    B3: blockerEvidence('Durable rate limits and session parity'),
    B4: blockerEvidence('Legacy scrypt hash parity'),
    B5: blockerEvidence('Legacy Worker remains media origin'),
    B6: blockerEvidence('Release gate check prepared'),
    B7: blockerEvidence('Traffic rollback rehearsal', ['ticket:fixture-ticket']),
  },
}

const evaluate = (state: any, signoff: any, options: any = {}) => evaluateReleaseGates(state, signoff, {
  checkDocs: false,
  ...options,
})

describe('release gate evaluation', () => {
  it('reports every open gate and blocker when no sign-off exists', () => {
    const problems = evaluate({
      ...readyState,
      gates: {
        ...readyState.gates,
        G1: { ...readyState.gates.G1, pass: false },
        G2: { ...readyState.gates.G2, pass: false },
        G3: { ...readyState.gates.G3, pass: false },
      },
      blockers: {
        ...readyState.blockers,
        B1: { ...readyState.blockers.B1, closed: false },
        B7: { ...readyState.blockers.B7, closed: false },
      },
    }, null)

    expect(problems.some((item: string) => item.startsWith('G1:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('G2:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('G3:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B1:'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B7:'))).toBe(true)
  })

  it('passes only with all gates, closed blockers, and complete sign-off', () => {
    expect(evaluate(readyState, fullSignoff)).toEqual([])
  })

  it('rejects a sign-off for a different commit or source ref', () => {
    const wrongCommit = evaluate(readyState, { ...fullSignoff, commit: TEST_OTHER_COMMIT })
    expect(wrongCommit.some((item: string) => item.includes('does not match release commit'))).toBe(true)

    const wrongRef = evaluate({ ...readyState, sourceRef: 'refs/tags/other-release' }, fullSignoff)
    expect(wrongRef.some((item: string) => item.includes('does not match release sourceRef'))).toBe(true)
  })

  it('rejects short SHAs and non-tag source refs', () => {
    const problems = evaluate({
      ...readyState,
      sourceCommit: '962cd95',
      sourceRef: 'HEAD',
    }, fullSignoff)

    expect(problems.some((item: string) => item.includes('full 40-character lowercase'))).toBe(true)
    expect(problems.some((item: string) => item.includes('immutable refs/tags/'))).toBe(true)
  })

  it('rejects a sign-off missing any required role', () => {
    const roles: Record<string, unknown> = { ...fullSignoff.roles }
    delete roles.authSecurity
    const problems = evaluate(readyState, { ...fullSignoff, roles })

    expect(problems.some((item: string) => item.includes('authSecurity approval is missing'))).toBe(true)
  })

  it('rejects non-boolean approvals, placeholder names, and invalid dates', () => {
    const roles: Record<string, any> = {
      ...fullSignoff.roles,
      applicationOwner: { ...fullSignoff.roles.applicationOwner, approved: 'true' },
      infraCloudflare: { ...fullSignoff.roles.infraCloudflare, name: 'REPLACE_WITH_NAME' },
      authSecurity: { ...fullSignoff.roles.authSecurity, date: '2026-02-30' },
    }
    const problems = evaluate(readyState, { ...fullSignoff, roles })

    expect(problems.some((item: string) => item.includes('approved must be boolean true'))).toBe(true)
    expect(problems.some((item: string) => item.includes('name is missing or a placeholder'))).toBe(true)
    expect(problems.some((item: string) => item.includes('valid YYYY-MM-DD date'))).toBe(true)
  })

  it('rejects passed gates and closed blockers without evidence references', () => {
    const problems = evaluate({
      ...readyState,
      gates: { ...readyState.gates, G0: { ...readyState.gates.G0, evidenceRefs: [] } },
      blockers: { ...readyState.blockers, B2: { ...readyState.blockers.B2, evidenceRefs: [] } },
    }, fullSignoff)

    expect(problems.some((item: string) => item.startsWith('G0:') && item.includes('evidenceRefs'))).toBe(true)
    expect(problems.some((item: string) => item.startsWith('B2:') && item.includes('evidenceRefs'))).toBe(true)
  })

  it('verifies artifact evidence against the approved artifact hash', () => {
    const artifactHash = `sha256:${'a'.repeat(64)}`
    const state = {
      ...readyState,
      gates: {
        ...readyState.gates,
        G1: {
          ...readyState.gates.G1,
          evidenceRefs: [`sha:${TEST_SOURCE_COMMIT}`, `artifact:${artifactHash}`],
        },
      },
    }

    expect(evaluate(state, fullSignoff, { expectedArtifactHash: artifactHash })).toEqual([])
    expect(evaluate(state, fullSignoff, {
      expectedArtifactHash: `sha256:${'b'.repeat(64)}`,
    }).some((item: string) => item.includes('does not match approved artifact'))).toBe(true)
    expect(evaluate(state, fullSignoff).some(
      (item: string) => item.includes('no approved artifact hash is available'),
    )).toBe(true)
  })

  it('accepts sign-off committed after the candidate without changing the built source', () => {
    const repo = createTempGitRepo({ advanceHead: true })
    try {
      const state = JSON.parse(
        JSON.stringify(readyState)
          .replaceAll(TEST_SOURCE_COMMIT, repo.sourceCommit)
          .replaceAll(TEST_SOURCE_REF, repo.sourceRef),
      )
      const signoff = JSON.parse(
        JSON.stringify(fullSignoff)
          .replaceAll(TEST_SOURCE_COMMIT, repo.sourceCommit)
          .replaceAll(TEST_SOURCE_REF, repo.sourceRef),
      )
      const problems = evaluate(state, signoff, {
        root: repo.root,
        checkRef: true,
      })
      expect(problems).toEqual([])
    } finally {
      repo.cleanup()
    }
  })

  it('keeps the sign-off template in sync with the required roles', () => {
    const template = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'docs/release-signoff.template.json'), 'utf8'),
    )
    expect(Object.keys(template.roles).sort()).toEqual([...REQUIRED_SIGNOFF_ROLES].sort())
    expect(Object.values(template.roles).every((role: any) => role.approved === false)).toBe(true)
    expect(template.commit).not.toMatch(/^[0-9a-f]{40}$/)
    expect(template.sourceRef).toContain('REPLACE_WITH_')

    const approved = {
      ...template,
      commit: readyState.sourceCommit,
      sourceRef: readyState.sourceRef,
      roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role) => [role, roleApproval(role)])),
    }
    expect(evaluate(readyState, approved)).toEqual([])
  })
})
