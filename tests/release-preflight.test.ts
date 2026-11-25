import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runReleasePreflight } from '../scripts/release-preflight.mjs'
import { REQUIRED_SIGNOFF_ROLES } from '../scripts/release-gate-core.mjs'
import {
  TEST_OTHER_COMMIT,
  createReleaseManifest,
  createTempGitRepo,
  git,
  writeApprovedA1Configs,
  writeJson,
} from './helpers/release-fixtures'

interface PreflightFixture {
  root: string
  sourceCommit: string
  sourceRef: string
  cleanup: () => void
}

let fixture: PreflightFixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

function createPreflightFixture(): PreflightFixture {
  const repo = createTempGitRepo()
  const { root, sourceCommit, sourceRef } = repo

  writeApprovedA1Configs(root)
  for (const name of [
    'REHEARSAL_RECORD.md',
    'CUTOVER_READINESS.md',
    'PRODUCTION_MIGRATION_PLAN.md',
    'RELEASE_READINESS_20261124.md',
    'RELEASE_PREPARATION_20261120.md',
  ]) {
    writeFileSync(path.join(root, 'docs', name), `fixture evidence: ${name}\n`)
  }
  writeFileSync(path.join(root, 'docs/release-signoff.template.json'), readFileSync(
    path.resolve(process.cwd(), 'docs/release-signoff.template.json'),
    'utf8',
  ))

  const outputPublic = path.join(root, '.output', 'public')
  mkdirSync(outputPublic, { recursive: true })
  writeFileSync(path.join(outputPublic, 'index.txt'), 'approved artifact\n')

  const manifest = createReleaseManifest(root, sourceCommit, sourceRef, {
    sourceRefObject: git(root, ['rev-parse', sourceRef]),
  })

  writeJson(path.join(root, 'docs/release-artifact.json'), manifest)
  writeFileSync(
    path.join(root, '.output', 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  const sourceShaRef = `sha:${sourceCommit}`
  const state = {
    release: 'lantern',
    sourceCommit,
    sourceRef,
    gates: {
      G0: { title: 'Staging behavioral parity', pass: true, evidence: 'green', evidenceRefs: [sourceShaRef, 'ci-run:fixture-ci-run'] },
      G1: { title: 'Operational readiness', pass: true, evidence: 'ready', evidenceRefs: [sourceShaRef, 'docs:docs/CUTOVER_READINESS.md'] },
      G2: { title: 'Release controls', pass: true, evidence: 'ready', evidenceRefs: [sourceShaRef, 'docs:docs/REHEARSAL_RECORD.md'] },
      G3: { title: 'Explicit sign-off', pass: true, evidence: 'signed', evidenceRefs: [sourceShaRef, 'docs:docs/release-signoff.json'] },
    },
    blockers: {
      B1: { title: 'Production media binding not deployed', closed: true, evidence: 'deployed', evidenceRefs: ['worker-version:fixture-version', 'ticket:fixture-ticket'] },
      B2: { title: 'Production migration state inspected', closed: true, evidence: 'inspected', evidenceRefs: ['docs:docs/PRODUCTION_MIGRATION_PLAN.md'] },
      B3: { title: 'Durable rate limits and session parity', closed: true, evidence: 'verified', evidenceRefs: ['docs:docs/CUTOVER_READINESS.md'] },
      B4: { title: 'Legacy scrypt hash parity', closed: true, evidence: 'verified', evidenceRefs: ['docs:docs/CUTOVER_READINESS.md'] },
      B5: { title: 'Legacy Worker remains media origin', closed: true, evidence: 'approved', evidenceRefs: ['docs:docs/RELEASE_READINESS_20261124.md'] },
      B6: { title: 'Release gate check prepared', closed: true, evidence: 'prepared', evidenceRefs: ['docs:docs/RELEASE_PREPARATION_20261120.md'] },
      B7: { title: 'Traffic rollback rehearsal', closed: true, evidence: 'rehearsed', evidenceRefs: ['ticket:fixture-ticket', 'docs:docs/REHEARSAL_RECORD.md'] },
    },
  }
  writeJson(path.join(root, 'docs/release-gates.json'), state)

  const signoff = {
    commit: sourceCommit,
    sourceRef,
    roles: Object.fromEntries(REQUIRED_SIGNOFF_ROLES.map((role) => [role, {
      approved: true,
      name: `${role} Approver`,
      date: '2026-11-25',
    }])),
  }
  writeJson(path.join(root, 'docs/release-signoff.json'), signoff)

  // Sign-off and control records are committed after the tagged candidate.
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'record release controls'])

  return { root, sourceCommit, sourceRef, cleanup: repo.cleanup }
}

describe('release preflight', () => {
  it('passes with matching gates, sign-off, source identity, and artifact identity', async () => {
    fixture = createPreflightFixture()
    expect(await runReleasePreflight({ root: fixture.root })).toEqual([])
  })

  it('fails when a required control file has uncommitted changes', async () => {
    fixture = createPreflightFixture()
    writeFileSync(path.join(fixture.root, 'docs/release-signoff.json'), '{"changed":true}\n')
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('uncommitted changes'))).toBe(true)
    expect(problems.some((item: string) => item.includes('docs/release-signoff.json has uncommitted changes'))).toBe(true)
  })

  it('fails when the artifact is modified after a successful preflight', async () => {
    fixture = createPreflightFixture()
    expect(await runReleasePreflight({ root: fixture.root })).toEqual([])

    writeFileSync(path.join(fixture.root, '.output', 'public', 'index.txt'), 'stale or modified\n')
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('recomputed hash'))).toBe(true)
  })

  it('fails when the control and artifact manifests disagree', async () => {
    fixture = createPreflightFixture()
    const artifactManifestPath = path.join(fixture.root, '.output', 'release-manifest.json')
    const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf8'))
    artifactManifest.buildId = 'different-build'
    writeFileSync(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`)
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('do not match'))).toBe(true)
  })

  it('fails for a wrong approved source SHA', async () => {
    fixture = createPreflightFixture()
    const statePath = path.join(fixture.root, 'docs/release-gates.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.sourceCommit = TEST_OTHER_COMMIT
    writeJson(statePath, state)
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('not approved sourceCommit'))).toBe(true)
    expect(problems.some((item: string) => item.includes('does not match approved sourceCommit'))).toBe(true)
  })

  it('fails when production writes are enabled in the release config', async () => {
    fixture = createPreflightFixture()
    const configPath = path.join(fixture.root, 'wrangler.release.jsonc')
    const source = readFileSync(configPath, 'utf8')
    writeFileSync(configPath, source.replace(
      '"LANTERN_PUBLIC_READ_DATABASE": "production"',
      '"LANTERN_PUBLIC_READ_DATABASE": "production",\n    "LANTERN_ENABLE_PRODUCTION_WRITES": "1"',
    ))
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('LANTERN_ENABLE_PRODUCTION_WRITES'))).toBe(true)
  })

  it('fails when the release artifact is missing', async () => {
    fixture = createPreflightFixture()
    rmSync(path.join(fixture.root, '.output'), { recursive: true, force: true })
    expect(existsSync(path.join(fixture.root, '.output'))).toBe(false)
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('artifact manifest: file is missing'))).toBe(true)
  })

  it('fails when the artifact manifest file is missing from an existing directory', async () => {
    fixture = createPreflightFixture()
    rmSync(path.join(fixture.root, '.output', 'release-manifest.json'), { force: true })
    expect(existsSync(path.join(fixture.root, '.output'))).toBe(true)
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('artifact manifest: file is missing'))).toBe(true)
  })

  it('fails when the verified artifact directory is wrong', async () => {
    fixture = createPreflightFixture()
    const controlPath = path.join(fixture.root, 'docs/release-artifact.json')
    const control = JSON.parse(readFileSync(controlPath, 'utf8'))
    control.artifactDirectory = '.other-output'
    writeJson(controlPath, control)

    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('manifest artifactDirectory must be .output'))).toBe(true)
  })

  it('fails when a different artifact directory is supplied to preflight', async () => {
    fixture = createPreflightFixture()
    const problems = await runReleasePreflight({ root: fixture.root, artifactDirectory: '.verified-output' })
    expect(problems.some((item: string) => item.includes('manifest artifactDirectory must be .verified-output'))).toBe(true)
    expect(problems.some((item: string) => item.includes('artifact manifest: file is missing'))).toBe(true)
  })

  it('fails when the approved A1 media Worker config is missing', async () => {
    fixture = createPreflightFixture()
    rmSync(path.join(fixture.root, 'wrangler.media-release.jsonc'), { force: true })
    const problems = await runReleasePreflight({ root: fixture.root })
    expect(problems.some((item: string) => item.includes('media config: wrangler.media-release.jsonc is missing'))).toBe(true)
  })
})
