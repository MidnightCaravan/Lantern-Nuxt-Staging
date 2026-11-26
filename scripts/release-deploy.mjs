import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { runReleasePreflight } from './release-preflight.mjs'
import {
  APPROVED_PRODUCTION_WORKER,
  ARTIFACT_DIRECTORY,
  ARTIFACT_MANIFEST_NAME,
  CONTROL_MANIFEST_PATH,
  DEPLOYMENT_INPUT_MANIFEST_NAME,
  MEDIA_RELEASE_CONFIG_PATH,
  PRODUCTION_ASSETS_DIRECTORY,
  PRODUCTION_MAIN_PATH,
  RELEASE_CONFIG_PATH,
  collectDeterministicFiles,
  computeFileHash,
  hashFileList,
  manifestsMatch,
  parseJsonc,
  validateCommitSha,
  validateProductionConfig,
  validateReleaseRefShape,
} from './release-provenance.mjs'

const WRANGLER_COMMAND = 'npx'
const DEPLOY_USAGE = 'Usage: node scripts/release-deploy.mjs (interactive operator confirmation required)'

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function defaultRunCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function defaultIsInteractive() {
  return Boolean(process.stdin.isTTY)
}

async function defaultRequestConfirmation(expected) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    process.stdout.write(`Type the exact deployment confirmation: ${expected}\n`)
    return await readline.question('Confirmation: ')
  } finally {
    readline.close()
  }
}

export function parseDeployArgs(argv = []) {
  const args = { help: false, forced: false, unknown: [] }
  for (const item of argv) {
    if (item === '--help') args.help = true
    else if (item === '--yes' || item === '-y') args.forced = true
    else args.unknown.push(item)
  }
  return args
}

export function validateDeployArgs(args) {
  const problems = []
  if (args.forced) {
    problems.push('deployment control: --yes and -y are forbidden; deployment requires interactive confirmation')
  }
  for (const item of args.unknown ?? []) {
    problems.push(`deployment control: unsupported argument ${item}`)
  }
  return problems
}

export function deploymentConfirmation(sourceCommit) {
  return `DEPLOY ${sourceCommit} TO ${APPROVED_PRODUCTION_WORKER}`
}

export function wranglerDeployArgs(configPath, snapshotRoot) {
  return [
    '--no-install',
    'wrangler',
    'deploy',
    '--cwd',
    snapshotRoot,
    '--config',
    configPath,
  ]
}

function normalizeConfigPath(value, label) {
  if (typeof value !== 'string' || !value.startsWith('./') || value.includes('..')) {
    throw new Error(`${label} must be a safe repository-relative path`)
  }
  return value.slice(2).replace(/\/$/, '')
}

function snapshotPathFor(snapshotRoot, relativePath, label) {
  const normalized = normalizeConfigPath(relativePath, label)
  const absolutePath = path.resolve(snapshotRoot, normalized)
  const relativeToSnapshot = path.relative(path.resolve(snapshotRoot), absolutePath)
  if (!relativeToSnapshot || relativeToSnapshot.startsWith('..') || path.isAbsolute(relativeToSnapshot)) {
    throw new Error(`${label} escapes the verified deployment snapshot`)
  }
  return { normalized, absolutePath }
}

function fileEntry(files, relativePath) {
  return files.find((file) => file.path === relativePath)
}

/**
 * Copies the already-verified artifact and exact A1 configs into a new,
 * standalone tree. Wrangler is later pointed at the copied config; because the
 * config's entrypoint and assets are config-relative, it reads this snapshot
 * instead of the mutable root .output directory.
 */
export function createDeploymentSnapshot(root, options = {}) {
  const {
    snapshotRoot = mkdtempSync(path.join(tmpdir(), 'lantern-release-deploy-')),
    manifest = readJson(path.join(root, CONTROL_MANIFEST_PATH)),
  } = options

  if (!existsSync(snapshotRoot) || !statSync(snapshotRoot).isDirectory()) {
    throw new Error(`deployment snapshot directory ${snapshotRoot} does not exist`)
  }
  if (readdirSync(snapshotRoot).length > 0) {
    throw new Error(`deployment snapshot directory ${snapshotRoot} is not empty`)
  }

  const artifactSource = path.resolve(root, ARTIFACT_DIRECTORY)
  const configSource = path.resolve(root, RELEASE_CONFIG_PATH)
  const mediaConfigSource = path.resolve(root, MEDIA_RELEASE_CONFIG_PATH)
  const recordedFiles = Array.isArray(manifest.artifactFiles) ? manifest.artifactFiles : []
  if (recordedFiles.length === 0) {
    throw new Error('release manifest does not contain per-file artifact hashes')
  }

  collectDeterministicFiles(artifactSource, { label: 'artifact' })
  mkdirSync(snapshotRoot, { recursive: true })
  cpSync(artifactSource, path.join(snapshotRoot, ARTIFACT_DIRECTORY), {
    recursive: true,
    dereference: false,
  })
  copyFileSync(configSource, path.join(snapshotRoot, RELEASE_CONFIG_PATH))
  copyFileSync(mediaConfigSource, path.join(snapshotRoot, MEDIA_RELEASE_CONFIG_PATH))

  const files = collectDeterministicFiles(snapshotRoot, {
    excludedPaths: [DEPLOYMENT_INPUT_MANIFEST_NAME],
    label: 'deployment snapshot',
  })

  const allowedPaths = new Set([
    RELEASE_CONFIG_PATH,
    MEDIA_RELEASE_CONFIG_PATH,
    `${ARTIFACT_DIRECTORY}/${ARTIFACT_MANIFEST_NAME}`,
    ...recordedFiles.map((entry) => `${ARTIFACT_DIRECTORY}/${entry.path}`),
  ])
  for (const file of files) {
    if (!allowedPaths.has(file.path)) {
      throw new Error(`deployment snapshot contains unexpected file: ${file.path}`)
    }
  }

  const releaseManifestPath = `${ARTIFACT_DIRECTORY}/${ARTIFACT_MANIFEST_NAME}`
  const embeddedManifest = readJson(path.join(snapshotRoot, releaseManifestPath))
  if (!manifestsMatch(embeddedManifest, manifest)) {
    throw new Error('snapshot release manifest does not match the control manifest')
  }

  const configSourceHash = computeFileHash(configSource)
  const mediaConfigHash = computeFileHash(mediaConfigSource)
  const entrypoint = snapshotPathFor(snapshotRoot, PRODUCTION_MAIN_PATH, 'production config.main')
  const assets = snapshotPathFor(snapshotRoot, PRODUCTION_ASSETS_DIRECTORY, 'production config.assets.directory')
  if (!statSync(entrypoint.absolutePath).isFile()) {
    throw new Error(`production entrypoint is not a file: ${entrypoint.normalized}`)
  }
  if (!statSync(assets.absolutePath).isDirectory()) {
    throw new Error(`production asset directory is not a directory: ${assets.normalized}`)
  }

  const entrypointEntry = fileEntry(files, entrypoint.normalized)
  if (!entrypointEntry) throw new Error(`production entrypoint is not in the verified file list: ${entrypoint.normalized}`)
  const assetPrefix = `${assets.normalized}/`
  const assetFiles = files.filter((file) => file.path.startsWith(assetPrefix))
  if (assetFiles.length === 0) throw new Error('production asset directory contains no verified files')

  const deploymentInput = {
    schemaVersion: 1,
    kind: 'lantern-release-deployment-input',
    sourceCommit: manifest.sourceCommit,
    sourceRef: manifest.sourceRef,
    worker: APPROVED_PRODUCTION_WORKER,
    releaseManifestPath,
    releaseManifestHash: fileEntry(files, releaseManifestPath)?.sha256 ?? null,
    productionConfig: {
      path: RELEASE_CONFIG_PATH,
      sha256: configSourceHash.sha256,
      size: configSourceHash.size,
      worker: APPROVED_PRODUCTION_WORKER,
      main: PRODUCTION_MAIN_PATH,
      assetsDirectory: PRODUCTION_ASSETS_DIRECTORY,
    },
    mediaConfig: {
      path: MEDIA_RELEASE_CONFIG_PATH,
      sha256: mediaConfigHash.sha256,
      size: mediaConfigHash.size,
    },
    entrypoint: {
      path: entrypoint.normalized,
      sha256: entrypointEntry.sha256,
      size: entrypointEntry.size,
    },
    assets: {
      path: assets.normalized,
      fileCount: assetFiles.length,
      hash: hashFileList(assetFiles),
    },
    files,
    deploymentInputHash: hashFileList(files),
  }

  writeJson(path.join(snapshotRoot, DEPLOYMENT_INPUT_MANIFEST_NAME), deploymentInput)
  return { snapshotRoot, deploymentInput }
}

export function validateDeploymentSnapshot(snapshotRoot, expected = {}) {
  const problems = []
  const manifestPath = path.join(snapshotRoot, DEPLOYMENT_INPUT_MANIFEST_NAME)
  if (!existsSync(manifestPath)) {
    return [`deployment input: ${DEPLOYMENT_INPUT_MANIFEST_NAME} is missing`]
  }

  let input
  try {
    input = readJson(manifestPath)
  } catch (error) {
    return [`deployment input: could not be parsed (${error?.message ?? error})`]
  }

  if (input.schemaVersion !== 1) problems.push('deployment input: schemaVersion must be 1')
  if (input.kind !== 'lantern-release-deployment-input') problems.push('deployment input: unexpected kind')
  if (expected.sourceCommit && input.sourceCommit !== expected.sourceCommit) {
    problems.push(`deployment input: sourceCommit ${input.sourceCommit ?? 'missing'} does not match approved sourceCommit ${expected.sourceCommit}`)
  }
  if (expected.sourceRef && input.sourceRef !== expected.sourceRef) {
    problems.push(`deployment input: sourceRef ${input.sourceRef ?? 'missing'} does not match approved sourceRef ${expected.sourceRef}`)
  }
  if (input.worker !== APPROVED_PRODUCTION_WORKER) {
    problems.push(`deployment input: Worker identity must be ${APPROVED_PRODUCTION_WORKER}`)
  }

  let actualFiles
  try {
    actualFiles = collectDeterministicFiles(snapshotRoot, {
      excludedPaths: [DEPLOYMENT_INPUT_MANIFEST_NAME],
      label: 'deployment snapshot',
    })
  } catch (error) {
    problems.push(`deployment input: file list could not be recomputed (${error?.message ?? error})`)
    return problems
  }

  if (!manifestsMatch(input.files, actualFiles)) {
    problems.push('deployment input: snapshot files do not match recorded file hashes')
  }
  if (hashFileList(actualFiles) !== input.deploymentInputHash) {
    problems.push('deployment input: snapshot hash changed after verification')
  }

  const releaseManifestRelativePath = `${ARTIFACT_DIRECTORY}/${ARTIFACT_MANIFEST_NAME}`
  const releaseManifestEntry = fileEntry(actualFiles, releaseManifestRelativePath)
  if (releaseManifestEntry && input.releaseManifestHash !== releaseManifestEntry.sha256) {
    problems.push('deployment input: release manifest hash changed after verification')
  }

  if (expected.manifest) {
    const artifactPrefix = `${ARTIFACT_DIRECTORY}/`
    const actualArtifactFiles = actualFiles
      .filter((file) => file.path.startsWith(artifactPrefix) && file.path !== releaseManifestRelativePath)
      .map((file) => ({ ...file, path: file.path.slice(artifactPrefix.length) }))
    const approvedArtifactFiles = Array.isArray(expected.manifest.artifactFiles)
      ? expected.manifest.artifactFiles
      : []
    if (!manifestsMatch(actualArtifactFiles, approvedArtifactFiles)) {
      problems.push('deployment input: snapshot artifact files do not match the approved release manifest')
    }
    if (expected.manifest.artifactHash && hashFileList(actualArtifactFiles) !== expected.manifest.artifactHash) {
      problems.push('deployment input: snapshot artifact hash does not match the approved release manifest')
    }
    if (expected.manifest.productionConfig && !manifestsMatch(input.productionConfig, expected.manifest.productionConfig)) {
      problems.push('deployment input: production config binding does not match the approved release manifest')
    }
    if (expected.manifest.mediaConfig && !manifestsMatch(input.mediaConfig, expected.manifest.mediaConfig)) {
      problems.push('deployment input: media config binding does not match the approved release manifest')
    }
  }

  const configPath = path.join(snapshotRoot, RELEASE_CONFIG_PATH)
  const mediaConfigPath = path.join(snapshotRoot, MEDIA_RELEASE_CONFIG_PATH)
  for (const [label, configFilePath, binding, approvedBinding] of [
    ['production config', configPath, input.productionConfig, expected.manifest?.productionConfig],
    ['media config', mediaConfigPath, input.mediaConfig, expected.manifest?.mediaConfig],
  ]) {
    if (!binding || typeof binding.sha256 !== 'string') {
      problems.push(`${label}: recorded hash is missing`)
      continue
    }
    if (!existsSync(configFilePath)) {
      problems.push(`${label}: snapshot configuration file is missing`)
      continue
    }
    const current = computeFileHash(configFilePath)
    if (current.sha256 !== binding.sha256 || current.size !== binding.size) {
      problems.push(`${label}: snapshot configuration changed after verification`)
    }
    if (approvedBinding && (current.sha256 !== approvedBinding.sha256 || current.size !== approvedBinding.size)) {
      problems.push(`${label}: snapshot configuration does not match the approved release manifest`)
    }
  }

  problems.push(...validateProductionConfig(snapshotRoot))

  try {
    const config = parseJsonc(readFileSync(configPath, 'utf8'))
    if (config.name !== APPROVED_PRODUCTION_WORKER) {
      problems.push(`deployment input: Worker name must be ${APPROVED_PRODUCTION_WORKER}`)
    }
    const entrypoint = snapshotPathFor(snapshotRoot, config.main, 'production config.main')
    const assets = snapshotPathFor(snapshotRoot, config.assets?.directory, 'production config.assets.directory')
    const entrypointEntry = fileEntry(actualFiles, entrypoint.normalized)
    if (!entrypointEntry) {
      problems.push(`deployment input: entrypoint ${entrypoint.normalized} is missing from the verified snapshot`)
    } else if (input.entrypoint?.sha256 !== entrypointEntry.sha256) {
      problems.push('deployment input: entrypoint hash changed after verification')
    }
    const assetFiles = actualFiles.filter((file) => file.path.startsWith(`${assets.normalized}/`))
    if (assetFiles.length === 0) {
      problems.push('deployment input: asset directory contains no verified files')
    } else if (input.assets?.hash !== hashFileList(assetFiles)) {
      problems.push('deployment input: asset hashes changed after verification')
    }
  } catch (error) {
    problems.push(`deployment input: Wrangler references could not be verified (${error?.message ?? error})`)
  }

  const releaseManifestPath = path.join(snapshotRoot, ARTIFACT_DIRECTORY, ARTIFACT_MANIFEST_NAME)
  if (!existsSync(releaseManifestPath)) {
    problems.push('deployment input: snapshot release manifest is missing')
  } else if (expected.manifest && !manifestsMatch(readJson(releaseManifestPath), expected.manifest)) {
    problems.push('deployment input: snapshot release manifest does not match the control manifest')
  }

  return problems
}

function fail(problems, extra = {}) {
  return { ok: false, invoked: false, problems, ...extra }
}

export async function runReleaseDeployment(options = {}) {
  const {
    root = process.cwd(),
    argv = [],
    snapshotRoot: providedSnapshotRoot = null,
    runCommand = defaultRunCommand,
    isInteractive = defaultIsInteractive,
    requestConfirmation = defaultRequestConfirmation,
    preflight = runReleasePreflight,
    cleanupSnapshot = true,
    tempRoot = tmpdir(),
    hooks = {},
  } = options

  const args = parseDeployArgs(argv)
  const argumentProblems = validateDeployArgs(args)
  if (argumentProblems.length) return fail(argumentProblems)

  if (!isInteractive()) {
    return fail(['deployment control: non-interactive invocation is forbidden'])
  }

  const preflightProblems = await preflight({ root })
  if (preflightProblems.length) {
    return fail([
      'deployment control: release preflight failed; no Wrangler invocation was attempted',
      ...preflightProblems,
    ])
  }

  const state = readJson(path.join(root, 'docs/release-gates.json'))
  const manifest = readJson(path.join(root, CONTROL_MANIFEST_PATH))
  const shapeProblems = [
    ...validateCommitSha(state?.sourceCommit, 'sourceCommit'),
    ...validateReleaseRefShape(state?.sourceRef),
  ]
  if (shapeProblems.length) return fail(shapeProblems)
  if (manifest?.sourceCommit !== state.sourceCommit || manifest?.sourceRef !== state.sourceRef) {
    return fail(['deployment control: release manifest identity does not match approved sourceCommit and sourceRef'])
  }

  const expectedConfirmation = deploymentConfirmation(state.sourceCommit)
  let providedConfirmation
  try {
    providedConfirmation = await requestConfirmation(expectedConfirmation)
  } catch (error) {
    return fail([`deployment control: confirmation could not be read (${error?.message ?? error})`])
  }
  if (providedConfirmation !== expectedConfirmation) {
    return fail([`deployment control: confirmation mismatch; expected exactly "${expectedConfirmation}"`])
  }

  const snapshotRoot = providedSnapshotRoot ?? mkdtempSync(path.join(tempRoot, 'lantern-release-deploy-'))
  let snapshotCreated = false
  try {
    const { deploymentInput } = createDeploymentSnapshot(root, { snapshotRoot, manifest })
    snapshotCreated = true

    if (hooks.afterSnapshotCreated) {
      await hooks.afterSnapshotCreated(snapshotRoot, deploymentInput)
    }

    const finalProblems = validateDeploymentSnapshot(snapshotRoot, {
      sourceCommit: state.sourceCommit,
      sourceRef: state.sourceRef,
      manifest,
    })
    if (finalProblems.length) {
      return fail([
        'deployment control: deployment snapshot verification failed; no Wrangler invocation was attempted',
        ...finalProblems,
      ], { snapshotRoot: cleanupSnapshot ? null : snapshotRoot })
    }

    const finalPreflightProblems = await preflight({ root })
    if (finalPreflightProblems.length) {
      return fail([
        'deployment control: final release preflight failed; no Wrangler invocation was attempted',
        ...finalPreflightProblems,
      ], { snapshotRoot: cleanupSnapshot ? null : snapshotRoot })
    }

    const configPath = path.join(snapshotRoot, RELEASE_CONFIG_PATH)
    const wranglerArgs = wranglerDeployArgs(configPath, snapshotRoot)
    const result = await runCommand(WRANGLER_COMMAND, wranglerArgs, { cwd: root })

    return {
      ok: true,
      invoked: true,
      problems: [],
      sourceCommit: state.sourceCommit,
      sourceRef: state.sourceRef,
      snapshotRoot: cleanupSnapshot ? null : snapshotRoot,
      configPath,
      deploymentInputHash: deploymentInput.deploymentInputHash,
      command: WRANGLER_COMMAND,
      args: wranglerArgs,
      result,
    }
  } finally {
    if (cleanupSnapshot && snapshotCreated) {
      rmSync(snapshotRoot, { recursive: true, force: true })
    }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseDeployArgs(argv)
  if (args.help) {
    console.log(DEPLOY_USAGE)
    return
  }
  const argumentProblems = validateDeployArgs(args)
  if (argumentProblems.length) {
    for (const problem of argumentProblems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  const result = await runReleaseDeployment({ root: process.cwd(), argv })
  if (!result.ok) {
    console.error('Lantern release deployment: FAILED. No deployment was performed.')
    for (const problem of result.problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log(`LANTERN_RELEASE_DEPLOY_INVOKED source=${result.sourceCommit} artifact=${result.deploymentInputHash}`)
  console.log(`Verified deployment snapshot config: ${result.configPath}`)
  console.log('Wrangler was invoked through the release-only wrapper. Deployment authorization and verification remain the operator\'s responsibility.')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Lantern release deployment failed: ${error?.message ?? error}`)
    process.exit(1)
  })
}
