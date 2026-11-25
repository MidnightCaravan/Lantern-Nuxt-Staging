import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDeploymentSnapshot,
  deploymentConfirmation,
  parseDeployArgs,
  runReleaseDeployment,
  validateDeployArgs,
  validateDeploymentSnapshot,
  wranglerDeployArgs,
} from '../scripts/release-deploy.mjs'
import {
  APPROVED_PRODUCTION_WORKER,
  DEPLOYMENT_INPUT_MANIFEST_NAME,
  RELEASE_CONFIG_PATH,
  computeFileHash,
  hashFileList,
} from '../scripts/release-provenance.mjs'
import {
  TEST_OTHER_COMMIT,
  createReleaseDeploymentFixture,
  writeJson,
} from './helpers/release-fixtures'

interface CommandCall {
  command: string
  args: string[]
  options?: { cwd?: string }
}

const fixtureCleanups: Array<() => void> = []
const snapshotCleanups: Array<() => void> = []

afterEach(() => {
  while (fixtureCleanups.length) fixtureCleanups.pop()!()
  while (snapshotCleanups.length) snapshotCleanups.pop()!()
})

function fixture(options: Parameters<typeof createReleaseDeploymentFixture>[0] = {}) {
  const created = createReleaseDeploymentFixture(options)
  fixtureCleanups.push(created.cleanup)
  return created
}

function emptySnapshotRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'lantern-release-deploy-test-'))
  snapshotCleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function mockRunner(calls: CommandCall[]) {
  return async (command: string, args: string[], options?: { cwd?: string }) => {
    calls.push({ command, args, options })
    return 'mocked wrangler output\n'
  }
}

function interactiveOptions(
  root: string,
  calls: CommandCall[],
  overrides: Record<string, any> = {},
) {
  return {
    root,
    argv: [],
    snapshotRoot: emptySnapshotRoot(),
    cleanupSnapshot: false,
    runCommand: mockRunner(calls),
    isInteractive: () => true,
    requestConfirmation: async (expected: string) => expected,
    ...overrides,
  }
}

describe('fail-closed release deployment wrapper', () => {
  it('deploys only from a verified immutable snapshot with exact Wrangler arguments', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    const snapshotRoot = emptySnapshotRoot()
    const expectedConfirmation = deploymentConfirmation(created.sourceCommit)

    expect(expectedConfirmation).toBe(`DEPLOY ${created.sourceCommit} TO ${APPROVED_PRODUCTION_WORKER}`)

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
      snapshotRoot,
      requestConfirmation: async (expected: string) => {
        expect(expected).toBe(expectedConfirmation)
        return expected
      },
    }))

    expect(result.ok).toBe(true)
    expect(result.invoked).toBe(true)
    expect(result.sourceCommit).toBe(created.sourceCommit)
    expect(result.sourceRef).toBe(created.sourceRef)
    expect(calls).toEqual([{
      command: 'npx',
      args: wranglerDeployArgs(path.join(snapshotRoot, RELEASE_CONFIG_PATH), snapshotRoot),
      options: { cwd: created.root },
    }])
    expect(result.configPath).toBe(path.join(snapshotRoot, RELEASE_CONFIG_PATH))
    expect(result.configPath.startsWith(path.join(snapshotRoot, ''))).toBe(true)
    expect(existsSync(path.join(snapshotRoot, DEPLOYMENT_INPUT_MANIFEST_NAME))).toBe(true)
    expect(readFileSync(path.join(snapshotRoot, RELEASE_CONFIG_PATH), 'utf8'))
      .toBe(readFileSync(path.join(created.root, RELEASE_CONFIG_PATH), 'utf8'))
    expect(validateDeploymentSnapshot(snapshotRoot, {
      sourceCommit: created.sourceCommit,
      sourceRef: created.sourceRef,
      manifest: created.manifest,
    })).toEqual([])
  })

  it('fails when the verified artifact is missing', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    rmSync(path.join(created.root, '.output'), { recursive: true, force: true })

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('artifact manifest: file is missing')
    expect(calls).toEqual([])
  })

  it('fails when a deployable artifact file is modified', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    writeFileSync(path.join(created.root, '.output', 'public', 'index.txt'), 'modified artifact\n')

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toMatch(/recomputed hash|per-file hashes/)
    expect(calls).toEqual([])
  })

  it('fails when an unexpected artifact file is added', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    writeFileSync(path.join(created.root, '.output', 'unexpected.txt'), 'unexpected\n')

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toMatch(/recomputed hash|per-file hashes/)
    expect(calls).toEqual([])
  })

  it('fails when a nested file named release-manifest.json is added', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    const nested = path.join(created.root, '.output', 'nested')
    mkdirSync(nested, { recursive: true })
    writeFileSync(path.join(nested, 'release-manifest.json'), 'unexpected manifest\n')

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toMatch(/recomputed hash|per-file hashes/)
    expect(calls).toEqual([])
  })

  it('fails when a changed snapshot artifact is rehashed inside its own input', async () => {
    const created = fixture()
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
      hooks: {
        afterSnapshotCreated: (snapshotRoot: string) => {
          const artifactPath = path.join(snapshotRoot, '.output', 'public', 'index.txt')
          writeFileSync(artifactPath, 'changed after snapshot creation\n')
          const inputPath = path.join(snapshotRoot, DEPLOYMENT_INPUT_MANIFEST_NAME)
          const input = JSON.parse(readFileSync(inputPath, 'utf8'))
          const entry = input.files.find((file: any) => file.path === '.output/public/index.txt')
          const hash = computeFileHash(artifactPath)
          entry.sha256 = hash.sha256
          entry.size = hash.size
          input.deploymentInputHash = hashFileList(input.files)
          writeJson(inputPath, input)
        },
      },
    }))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('snapshot artifact files do not match the approved release manifest')
    expect(calls).toEqual([])
  })

  it('fails when a changed snapshot config is rehashed inside its own input', async () => {
    const created = fixture()
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
      hooks: {
        afterSnapshotCreated: (snapshotRoot: string) => {
          const configPath = path.join(snapshotRoot, RELEASE_CONFIG_PATH)
          writeFileSync(configPath, `// changed after snapshot creation\n${readFileSync(configPath, 'utf8')}`)
          const inputPath = path.join(snapshotRoot, DEPLOYMENT_INPUT_MANIFEST_NAME)
          const input = JSON.parse(readFileSync(inputPath, 'utf8'))
          const hash = computeFileHash(configPath)
          input.productionConfig.sha256 = hash.sha256
          input.productionConfig.size = hash.size
          const entry = input.files.find((file: any) => file.path === RELEASE_CONFIG_PATH)
          entry.sha256 = hash.sha256
          entry.size = hash.size
          input.deploymentInputHash = hashFileList(input.files)
          writeJson(inputPath, input)
        },
      },
    }))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('snapshot configuration does not match the approved release manifest')
    expect(calls).toEqual([])
  })

  it('fails when the Wrangler configuration changes without an A1 shape change', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    const configPath = path.join(created.root, RELEASE_CONFIG_PATH)
    writeFileSync(configPath, `// changed after release build\n${readFileSync(configPath, 'utf8')}`)

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('current configuration hash')
    expect(calls).toEqual([])
  })

  it('fails when the Worker identity is changed', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    const configPath = path.join(created.root, RELEASE_CONFIG_PATH)
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.name = 'lantern-nuxt'
    writeJson(configPath, config)

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('approved A1 name')
    expect(calls).toEqual([])
  })

  it('fails when the source SHA is wrong', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    const statePath = path.join(created.root, 'docs/release-gates.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.sourceCommit = TEST_OTHER_COMMIT
    writeJson(statePath, state)

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toMatch(/not approved sourceCommit|manifest identity/)
    expect(calls).toEqual([])
  })

  it('fails when the snapshot artifact changes after snapshot creation', async () => {
    const created = fixture()
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
      hooks: {
        afterSnapshotCreated: (snapshotRoot: string) => {
          writeFileSync(
            path.join(snapshotRoot, '.output', 'public', 'index.txt'),
            'changed after snapshot creation\n',
          )
        },
      },
    }))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toMatch(/snapshot files do not match|snapshot hash changed/)
    expect(calls).toEqual([])
  })

  it('fails for symlinks and paths escaping the artifact', async () => {
    const created = fixture()
    const calls: CommandCall[] = []
    const outside = mkdtempSync(path.join(tmpdir(), 'lantern-release-escape-'))
    snapshotCleanups.push(() => rmSync(outside, { recursive: true, force: true }))
    writeFileSync(path.join(outside, 'secret.txt'), 'outside artifact\n')
    symlinkSync(
      path.join(outside, 'secret.txt'),
      path.join(created.root, '.output', 'escape.txt'),
    )

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('symbolic link')
    expect(calls).toEqual([])
  })

  it('fails when sign-off is missing', async () => {
    const created = fixture({ withSignoff: false })
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('release sign-off: file is missing')
    expect(calls).toEqual([])
  })

  it('fails when a required release gate is not passed', async () => {
    const created = fixture({ gatePass: false })
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toMatch(/G\d: .*no evidence|G\d: .*fixture release evidence/)
    expect(calls).toEqual([])
  })

  it('fails for non-interactive invocation', async () => {
    const created = fixture()
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
      isInteractive: () => false,
    }))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('non-interactive invocation is forbidden')
    expect(calls).toEqual([])
  })

  it('rejects both --yes and -y before any invocation', async () => {
    const created = fixture()
    const calls: CommandCall[] = []

    for (const flag of ['--yes', '-y']) {
      const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
        argv: [flag],
      }))
      expect(result.ok).toBe(false)
      expect(result.invoked).toBe(false)
      expect(result.problems.join('\n')).toContain('--yes and -y are forbidden')
      expect(parseDeployArgs([flag]).forced).toBe(true)
      expect(validateDeployArgs(parseDeployArgs([flag]))).not.toEqual([])
    }
    expect(calls).toEqual([])
  })

  it('fails for a wrong confirmation string', async () => {
    const created = fixture()
    const calls: CommandCall[] = []

    const result = await runReleaseDeployment(interactiveOptions(created.root, calls, {
      requestConfirmation: async () => 'DEPLOY SOMETHING ELSE',
    }))

    expect(result.ok).toBe(false)
    expect(result.invoked).toBe(false)
    expect(result.problems.join('\n')).toContain('confirmation mismatch')
    expect(calls).toEqual([])
  })

  it('keeps npm run deploy pointed at the fail-closed guard', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'))
    const guard = readFileSync(path.resolve(process.cwd(), 'scripts/deploy-guard.mjs'), 'utf8')

    expect(packageJson.scripts.deploy).toBe('node scripts/deploy-guard.mjs')
    expect(packageJson.scripts['release:deploy']).toBeUndefined()
    expect(guard).toContain('deployment is intentionally disabled')
    expect(guard).toContain('process.exit(1)')
    expect(guard).not.toMatch(/wrangler|release-deploy/)
  })

  it('rejects an unexpected file inside a created deployment snapshot', async () => {
    const created = fixture()
    const snapshotRoot = emptySnapshotRoot()
    createDeploymentSnapshot(created.root, { snapshotRoot, manifest: created.manifest })
    writeFileSync(path.join(snapshotRoot, 'unexpected.txt'), 'unexpected\n')

    const problems = validateDeploymentSnapshot(snapshotRoot, {
      sourceCommit: created.sourceCommit,
      sourceRef: created.sourceRef,
      manifest: created.manifest,
    })

    expect(problems.join('\n')).toMatch(/symbolic link|unsupported file type|snapshot files do not match|snapshot hash changed/)
  })
})
