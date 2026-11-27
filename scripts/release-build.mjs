import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVED_PRODUCTION_WORKER,
  ARTIFACT_DIRECTORY,
  ARTIFACT_MANIFEST_NAME,
  MEDIA_RELEASE_CONFIG_PATH,
  PRODUCTION_ASSETS_DIRECTORY,
  PRODUCTION_MAIN_PATH,
  RELEASE_CONFIG_PATH,
  collectDeterministicFiles,
  computeArtifactHash,
  computeFileHash,
  computeSourceTreeHash,
  manifestsMatch,
  validateCommitSha,
  validateControlCheckout,
  validateManifestShape,
  validateProductionConfig,
} from './release-provenance.mjs'

export const INSTALL_COMMAND = ['ci']
export const VERIFY_COMMAND = ['run', 'verify']

function defaultRunCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function commandText(result) {
  if (typeof result === 'string') return result.trim()
  if (Buffer.isBuffer(result)) return result.toString('utf8').trim()
  if (result && typeof result.stdout === 'string') return result.stdout.trim()
  if (result && Buffer.isBuffer(result.stdout)) return result.stdout.toString('utf8').trim()
  return ''
}

function readState(root) {
  return JSON.parse(readFileSync(path.resolve(root, 'docs/release-gates.json'), 'utf8'))
}

export async function validateSourceCommitExists(root, sourceCommit, runCommand = defaultRunCommand) {
  const problems = validateCommitSha(sourceCommit, 'sourceCommit')
  if (problems.length) return problems

  try {
    await runCommand('git', ['-C', root, 'cat-file', '-e', `${sourceCommit}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    problems.push(`sourceCommit: ${sourceCommit} is not available in this repository (${error?.message ?? error})`)
  }
  return problems
}

function assertNoOutputDirectory(root, relativeDirectory) {
  const target = path.resolve(root, relativeDirectory)
  if (existsSync(target)) {
    throw new Error(`refusing to overwrite existing ${relativeDirectory}; stale build output must be removed by an authorized operator`)
  }
}

async function verifyDetachedWorktree(run, worktreePath, sourceCommit) {
  const head = commandText(await run('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { cwd: worktreePath }))
  if (head !== sourceCommit) {
    throw new Error(`build worktree HEAD ${head || 'missing'} does not match approved sourceCommit ${sourceCommit}`)
  }

  const branch = commandText(await run('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath }))
  if (branch !== 'HEAD') {
    throw new Error(`build worktree must be detached (got ${branch || 'unknown'})`)
  }

  const status = commandText(await run('git', ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all'], { cwd: worktreePath }))
  if (status) {
    throw new Error(`build worktree is not clean:\n${status}`)
  }

  if (existsSync(path.join(worktreePath, ARTIFACT_DIRECTORY))) {
    throw new Error('build worktree already contains stale .output')
  }
}

async function assertTrackedSourceUnchanged(run, worktreePath, sourceCommit) {
  const head = commandText(await run('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { cwd: worktreePath }))
  if (head !== sourceCommit) {
    throw new Error(`tracked source changed during build: HEAD ${head || 'missing'} no longer matches approved sourceCommit ${sourceCommit}`)
  }

  const branch = commandText(await run('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath }))
  if (branch !== 'HEAD') {
    throw new Error(`tracked source changed during build: worktree is no longer detached (got ${branch || 'unknown'})`)
  }

  const status = commandText(await run('git', ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=no'], { cwd: worktreePath }))
  if (status) {
    throw new Error(`tracked source files were modified during install or verification:\n${status}`)
  }
}

function applySourceOverride(state, sourceCommitOverride) {
  if (!sourceCommitOverride) return state
  const problems = validateCommitSha(sourceCommitOverride, '--source-commit')
  if (problems.length) throw new Error(problems.join('; '))
  if (sourceCommitOverride !== state?.sourceCommit) {
    throw new Error('--source-commit does not match docs/release-gates.json#sourceCommit')
  }
  return state
}

export async function buildRelease(options = {}) {
  const {
    root = process.cwd(),
    state: providedState,
    sourceCommitOverride,
    controlShaOverride = null,
    eventSha = process.env.GITHUB_SHA ?? null,
    runCommand = defaultRunCommand,
    now = () => new Date(),
    ciRunId = process.env.GITHUB_RUN_ID || null,
    tempRoot = tmpdir(),
    cleanup = true,
    outputDirectory = ARTIFACT_DIRECTORY,
    logger = console,
  } = options

  const state = applySourceOverride(providedState ?? readState(root), sourceCommitOverride)
  const sourceCommit = state?.sourceCommit
  const run = async (command, args, runOptions = {}) => runCommand(command, args, { cwd: root, ...runOptions })

  const shapeProblems = validateCommitSha(sourceCommit, 'sourceCommit')
  if (shapeProblems.length) throw new Error(shapeProblems.join('; '))

  const sourceProblems = await validateSourceCommitExists(root, sourceCommit, runCommand)
  if (sourceProblems.length) throw new Error(sourceProblems.join('; '))

  const configProblems = validateProductionConfig(root)
  if (configProblems.length) throw new Error(configProblems.join('; '))

  const controlProblems = controlShaOverride
    ? validateControlCheckout(root, controlShaOverride)
    : []
  if (controlProblems.length) throw new Error(controlProblems.join('; '))

  const controlShaFromCheckout = controlShaOverride
    ?? commandText(await run('git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root }))
  const productionConfigHash = computeFileHash(path.resolve(root, RELEASE_CONFIG_PATH))
  const mediaConfigHash = computeFileHash(path.resolve(root, MEDIA_RELEASE_CONFIG_PATH))

  assertNoOutputDirectory(root, outputDirectory)

  const tempParent = mkdtempSync(path.join(tempRoot, 'lantern-release-build-'))
  const worktreePath = path.join(tempParent, 'source')

  try {
    await run('git', ['-C', root, 'worktree', 'add', '--detach', worktreePath, sourceCommit], { cwd: root })
    await verifyDetachedWorktree(run, worktreePath, sourceCommit)

    await run('npm', INSTALL_COMMAND, { cwd: worktreePath })
    // `npm run verify` already runs route coverage, tests, and the Nuxt build.
    // Do not call `npm run build` here; that would build twice.
    await run('npm', VERIFY_COMMAND, { cwd: worktreePath })
    await assertTrackedSourceUnchanged(run, worktreePath, sourceCommit)

    const worktreeOutput = path.join(worktreePath, outputDirectory)
    if (!existsSync(worktreeOutput)) {
      throw new Error(`verification did not create ${outputDirectory}`)
    }
    if (existsSync(path.join(worktreeOutput, ARTIFACT_MANIFEST_NAME))) {
      throw new Error(`build output unexpectedly contains ${ARTIFACT_MANIFEST_NAME}`)
    }

    const { artifactHash, fileCount, byteCount } = computeArtifactHash(worktreeOutput)
    const artifactFiles = collectDeterministicFiles(worktreeOutput, {
      excludedPaths: [ARTIFACT_MANIFEST_NAME],
      label: 'artifact',
    })
    const sourceTreeHash = computeSourceTreeHash(worktreePath, sourceCommit)
    const builtAt = now().toISOString()

    const manifest = {
      schemaVersion: 1,
      sourceCommit,
      sourceTreeHash,
      artifactHash,
      artifactFileCount: fileCount,
      artifactByteCount: byteCount,
      artifactFiles,
      artifactDirectory: outputDirectory,
      productionConfig: {
        path: RELEASE_CONFIG_PATH,
        sha256: productionConfigHash.sha256,
        size: productionConfigHash.size,
        worker: APPROVED_PRODUCTION_WORKER,
        main: PRODUCTION_MAIN_PATH,
        assetsDirectory: PRODUCTION_ASSETS_DIRECTORY,
      },
      mediaConfig: {
        path: MEDIA_RELEASE_CONFIG_PATH,
        sha256: mediaConfigHash.sha256,
        size: mediaConfigHash.size,
      },
      buildId: `lantern-${builtAt.replace(/[:.]/g, '-')}-${sourceCommit.slice(0, 12)}-${randomUUID()}`,
      builtAt,
      nodeVersion: process.version,
      npmVersion: commandText(await run('npm', ['--version'], { cwd: worktreePath })),
      verificationCommand: ['npm', ...VERIFY_COMMAND].join(' '),
      installCommand: ['npm', ...INSTALL_COMMAND].join(' '),
      ciRunId,
      provenance: {
        provider: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
        repository: process.env.GITHUB_REPOSITORY ?? null,
        workflow: process.env.GITHUB_WORKFLOW ?? null,
        workflowEventSha: eventSha,
        workflowControlSha: controlShaFromCheckout,
        applicationSourceSha: sourceCommit,
      },
    }

    const manifestProblems = validateManifestShape(manifest, { expectedArtifactDirectory: outputDirectory })
    if (manifestProblems.length) throw new Error(manifestProblems.join('; '))

    const artifactManifestPath = path.join(worktreeOutput, ARTIFACT_MANIFEST_NAME)
    writeFileSync(artifactManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const afterManifestHash = computeArtifactHash(worktreeOutput).artifactHash
    if (afterManifestHash !== manifest.artifactHash) {
      throw new Error('artifact hash changed after writing the release manifest')
    }

    assertNoOutputDirectory(root, outputDirectory)
    const rootOutput = path.resolve(root, outputDirectory)
    cpSync(worktreeOutput, rootOutput, { recursive: true })
    const copiedHash = computeArtifactHash(rootOutput).artifactHash
    if (copiedHash !== manifest.artifactHash) {
      throw new Error(`copied artifact hash ${copiedHash} does not match verified artifact ${manifest.artifactHash}`)
    }

    const rootManifest = JSON.parse(readFileSync(path.join(rootOutput, ARTIFACT_MANIFEST_NAME), 'utf8'))
    if (!manifestsMatch(rootManifest, manifest)) {
      throw new Error('copied release manifest does not match the verified artifact manifest')
    }

    return {
      manifest,
      worktreePath,
      rootOutput,
      artifactManifestPath: path.join(rootOutput, ARTIFACT_MANIFEST_NAME),
    }
  } finally {
    if (cleanup) {
      try {
        await run('git', ['-C', root, 'worktree', 'remove', worktreePath], { cwd: root })
      } catch (error) {
        logger.warn?.(`Could not remove temporary build worktree ${worktreePath}: ${error?.message ?? error}`)
      }
      rmSync(tempParent, { recursive: true, force: true })
    }
  }
}

function parseArgs(argv) {
  const args = { _: [] }
  for (const item of argv) {
    if (item === '--help') args.help = true
    else if (item === '--validate-source-only') args.validateSourceOnly = true
    else if (item.startsWith('--control-sha=')) args['control-sha'] = item.slice('--control-sha='.length)
    else if (item.startsWith('--source-commit=')) args['source-commit'] = item.slice('--source-commit='.length)
    else args._.push(item)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/release-build.mjs [--control-sha=<full-control-checkout-sha>] [--source-commit=<full-sha>] [--validate-source-only]')
    return
  }

  const root = process.cwd()
  const state = applySourceOverride(readState(root), args['source-commit'])
  const sourceCommit = state.sourceCommit

  const shapeProblems = [
    ...validateCommitSha(sourceCommit, 'sourceCommit'),
    ...(args['control-sha'] ? validateCommitSha(args['control-sha'], '--control-sha') : []),
  ]
  if (shapeProblems.length) {
    for (const problem of shapeProblems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  if (args.validateSourceOnly) {
    const problems = [
      ...await validateSourceCommitExists(root, sourceCommit),
      ...(args['control-sha'] ? validateControlCheckout(root, args['control-sha']) : []),
    ]
    if (problems.length) {
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exit(1)
    }
    const controlSha = args['control-sha'] ?? commandText(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }))
    console.log(`LANTERN_RELEASE_SOURCE_OK source=${sourceCommit} control=${controlSha}`)
    return
  }

  const result = await buildRelease({
    root,
    state,
    controlShaOverride: args['control-sha'] ?? null,
    eventSha: process.env.GITHUB_SHA ?? null,
  })
  console.log(`LANTERN_RELEASE_BUILD_OK source=${result.manifest.sourceCommit} artifact=${result.manifest.artifactHash} build=${result.manifest.buildId}`)
  console.log(`Artifact manifest: ${path.relative(root, result.artifactManifestPath)}`)
  console.log(`Verified artifact: ${path.relative(root, result.rootOutput)}`)
  console.log('No deployment was performed. Review the artifact manifest manually; artifact recording is a separate reviewed action. Run `node scripts/release-preflight.mjs` before any separately authorized deployment.')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Lantern release build failed: ${error?.message ?? error}`)
    process.exit(1)
  })
}
