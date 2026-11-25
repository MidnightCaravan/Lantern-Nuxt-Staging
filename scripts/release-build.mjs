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
  CONTROL_MANIFEST_PATH,
  MEDIA_RELEASE_CONFIG_PATH,
  PRODUCTION_ASSETS_DIRECTORY,
  PRODUCTION_MAIN_PATH,
  RELEASE_CONFIG_PATH,
  collectDeterministicFiles,
  computeArtifactHash,
  computeFileHash,
  computeSourceTreeHash,
  manifestsMatch,
  resolveReleaseRef,
  validateCommitSha,
  validateControlCheckout,
  validateProductionConfig,
  validateReleaseRef,
  validateReleaseRefShape,
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

function applySourceOverrides(state, sourceCommitOverride, sourceRefOverride) {
  if (!sourceCommitOverride && !sourceRefOverride) return state
  if (!sourceCommitOverride || !sourceRefOverride) {
    throw new Error('--source-commit and --source-ref must be supplied together')
  }
  const commitProblems = validateCommitSha(sourceCommitOverride, '--source-commit')
  const refProblems = validateReleaseRefShape(sourceRefOverride)
  const problems = [...commitProblems, ...refProblems]
  if (problems.length) throw new Error(problems.join('; '))
  if (sourceCommitOverride !== state.sourceCommit) {
    throw new Error('--source-commit does not match docs/release-gates.json#sourceCommit')
  }
  if (sourceRefOverride !== state.sourceRef) {
    throw new Error('--source-ref does not match docs/release-gates.json#sourceRef')
  }
  return state
}

export async function buildRelease(options = {}) {
  const {
    root = process.cwd(),
    state: providedState,
    sourceCommitOverride,
    sourceRefOverride,
    controlShaOverride = null,
    eventSha = process.env.GITHUB_SHA ?? null,
    runCommand = defaultRunCommand,
    now = () => new Date(),
    ciRunId = process.env.GITHUB_RUN_ID || null,
    tempRoot = tmpdir(),
    cleanup = true,
    outputDirectory = ARTIFACT_DIRECTORY,
    controlManifestPath = CONTROL_MANIFEST_PATH,
    logger = console,
  } = options

  const state = applySourceOverrides(providedState ?? readState(root), sourceCommitOverride, sourceRefOverride)
  const sourceCommit = state?.sourceCommit
  const sourceRef = state?.sourceRef

  const shapeProblems = [
    ...validateCommitSha(sourceCommit, 'sourceCommit'),
    ...validateReleaseRefShape(sourceRef),
  ]
  if (shapeProblems.length) throw new Error(shapeProblems.join('; '))

  const configProblems = validateProductionConfig(root)
  if (configProblems.length) throw new Error(configProblems.join('; '))

  const refProblems = validateReleaseRef(root, sourceRef, sourceCommit)
  if (refProblems.length) throw new Error(refProblems.join('; '))

  const controlProblems = controlShaOverride
    ? validateControlCheckout(root, controlShaOverride)
    : []
  if (controlProblems.length) throw new Error(controlProblems.join('; '))

  const run = async (command, args, runOptions = {}) => runCommand(command, args, { cwd: root, ...runOptions })
  const controlShaFromCheckout = controlShaOverride
    ?? commandText(await run('git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root }))
  const resolvedRef = resolveReleaseRef(root, sourceRef)

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
      sourceRef,
      sourceRefObject: resolvedRef.sourceRefObject,
      sourceRefKind: resolvedRef.sourceRefKind,
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
        githubRef: process.env.GITHUB_REF ?? null,
        workflowEventSha: eventSha,
        workflowControlSha: controlShaFromCheckout,
        applicationSourceSha: sourceCommit,
      },
    }

    writeFileSync(
      path.join(worktreeOutput, ARTIFACT_MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )

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

    const controlPath = path.resolve(root, controlManifestPath)
    mkdirSync(path.dirname(controlPath), { recursive: true })
    writeFileSync(controlPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const controlManifest = JSON.parse(readFileSync(controlPath, 'utf8'))
    if (!manifestsMatch(controlManifest, manifest)) {
      throw new Error('control copy of release manifest does not match built manifest')
    }

    return {
      manifest,
      worktreePath,
      rootOutput,
      controlManifestPath: controlPath,
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
    else if (item.startsWith('--source-ref=')) args['source-ref'] = item.slice('--source-ref='.length)
    else args._.push(item)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/release-build.mjs [--control-sha=<full-control-checkout-sha>] [--source-commit=<full-sha> --source-ref=<refs/tags/...>] [--validate-source-only]')
    return
  }

  const root = process.cwd()
  const state = applySourceOverrides(
    readState(root),
    args['source-commit'],
    args['source-ref'],
  )
  const sourceCommit = state.sourceCommit
  const sourceRef = state.sourceRef

  const shapeProblems = [
    ...validateCommitSha(sourceCommit, 'sourceCommit'),
    ...validateReleaseRefShape(sourceRef),
    ...(args['control-sha'] ? validateCommitSha(args['control-sha'], '--control-sha') : []),
  ]
  if (shapeProblems.length) {
    for (const problem of shapeProblems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  if (args.validateSourceOnly) {
    const problems = [
      ...validateReleaseRef(root, sourceRef, sourceCommit),
      ...(args['control-sha'] ? validateControlCheckout(root, args['control-sha']) : []),
    ]
    if (problems.length) {
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exit(1)
    }
    const resolved = resolveReleaseRef(root, sourceRef)
    console.log(`LANTERN_RELEASE_SOURCE_OK source=${sourceCommit} ref=${sourceRef} kind=${resolved.sourceRefKind} object=${resolved.sourceRefObject}`)
    return
  }

  const result = await buildRelease({
    root,
    state,
    controlShaOverride: args['control-sha'] ?? null,
    eventSha: process.env.GITHUB_SHA ?? null,
  })
  console.log(`LANTERN_RELEASE_BUILD_OK source=${result.manifest.sourceCommit} artifact=${result.manifest.artifactHash} build=${result.manifest.buildId}`)
  console.log(`Control manifest: ${path.relative(root, result.controlManifestPath)}`)
  console.log(`Verified artifact: ${path.relative(root, result.rootOutput)}`)
  console.log('No deployment was performed. Run `npm run release:preflight` before any separately authorized deployment.')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Lantern release build failed: ${error?.message ?? error}`)
    process.exit(1)
  })
}
