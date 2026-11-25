import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateReleaseGates } from './release-gate-core.mjs'
import {
  ARTIFACT_DIRECTORY,
  ARTIFACT_MANIFEST_NAME,
  CONTROL_MANIFEST_PATH,
  MEDIA_RELEASE_CONFIG_PATH,
  RELEASE_CONFIG_PATH,
  collectDeterministicFiles,
  computeArtifactHash,
  computeFileHash,
  computeSourceTreeHash,
  isValidCommitSha,
  isValidReleaseRef,
  manifestsMatch,
  validateManifestShape,
  validateProductionConfig,
} from './release-provenance.mjs'

async function readJson(file) {
  try {
    return { exists: true, value: JSON.parse(await readFile(file, 'utf8')) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: null }
    return { exists: true, value: null, error }
  }
}

function readProblem(label, result) {
  if (result.error) return [`${label}: could not be parsed (${result.error?.message ?? result.error})`]
  if (!result.exists) return [`${label}: file is missing`]
  return []
}

function configHashProblem(label, configPath, binding) {
  if (!binding) return []
  if (!existsSync(configPath)) return [`${label}: current configuration file is missing`]
  const current = computeFileHash(configPath)
  if (current.sha256 !== binding.sha256 || current.size !== binding.size) {
    return [`${label}: current configuration hash ${current.sha256} does not match recorded hash ${binding.sha256}`]
  }
  return []
}

export async function runReleasePreflight(options = {}) {
  const {
    root = process.cwd(),
    artifactDirectory = ARTIFACT_DIRECTORY,
    controlManifestPath = CONTROL_MANIFEST_PATH,
  } = options

  const stateResult = await readJson(path.join(root, 'docs/release-gates.json'))
  const signoffResult = await readJson(path.join(root, 'docs/release-signoff.json'))
  const controlManifestResult = await readJson(path.resolve(root, controlManifestPath))
  const artifactManifestResult = await readJson(path.join(root, artifactDirectory, ARTIFACT_MANIFEST_NAME))

  const problems = [
    ...readProblem('release state', stateResult),
    ...readProblem('release sign-off', signoffResult),
    ...readProblem('control manifest', controlManifestResult),
    ...readProblem('artifact manifest', artifactManifestResult),
  ]

  const state = stateResult.value
  const signoff = signoffResult.value
  const controlManifest = controlManifestResult.value
  const artifactManifest = artifactManifestResult.value

  if (controlManifest) {
    problems.push(...validateManifestShape(controlManifest, { expectedArtifactDirectory: artifactDirectory }))
    problems.push(...configHashProblem(
      'production config',
      path.resolve(root, RELEASE_CONFIG_PATH),
      controlManifest.productionConfig,
    ))
    problems.push(...configHashProblem(
      'media config',
      path.resolve(root, MEDIA_RELEASE_CONFIG_PATH),
      controlManifest.mediaConfig,
    ))
  }

  if (!state || !artifactManifestResult.exists || !controlManifestResult.exists) {
    return problems
  }

  const controlFiles = [
    'docs/release-gates.json',
    'docs/release-signoff.template.json',
    controlManifestPath,
  ]
  if (signoffResult.exists) controlFiles.push('docs/release-signoff.json')

  problems.push(...evaluateReleaseGates(state, signoff, {
    root,
    checkRef: true,
    checkDocs: true,
    controlFiles,
  }))

  problems.push(...validateManifestShape(artifactManifest, { expectedArtifactDirectory: artifactDirectory }))

  if (controlManifest && artifactManifest && !manifestsMatch(controlManifest, artifactManifest)) {
    problems.push('artifact: control manifest and deployed artifact manifest do not match')
  }

  if (isValidCommitSha(state.sourceCommit)) {
    if (controlManifest?.sourceCommit !== state.sourceCommit) {
      problems.push(`artifact: manifest sourceCommit ${controlManifest?.sourceCommit ?? 'missing'} does not match approved sourceCommit ${state.sourceCommit}`)
    }
    if (controlManifest?.sourceRef !== state.sourceRef) {
      problems.push(`artifact: manifest sourceRef ${controlManifest?.sourceRef ?? 'missing'} does not match approved sourceRef ${state.sourceRef}`)
    }
    try {
      const sourceTreeHash = computeSourceTreeHash(root, state.sourceCommit)
      if (controlManifest?.sourceTreeHash !== sourceTreeHash) {
        problems.push(`artifact: source tree hash ${controlManifest?.sourceTreeHash ?? 'missing'} does not match approved commit ${sourceTreeHash}`)
      }
    } catch (error) {
      problems.push(`artifact: source tree identity could not be verified (${error?.message ?? error})`)
    }
  }

  const artifactPath = path.join(root, artifactDirectory)
  if (!existsSync(artifactPath)) {
    problems.push(`artifact: ${artifactDirectory} does not exist`)
  } else {
    try {
      const { artifactHash } = computeArtifactHash(artifactPath)
      if (controlManifest?.artifactHash !== artifactHash) {
        problems.push(`artifact: recorded hash ${controlManifest?.artifactHash ?? 'missing'} does not match recomputed hash ${artifactHash}; output may be stale or modified`)
      }
      const artifactFiles = collectDeterministicFiles(artifactPath, {
        excludedPaths: [ARTIFACT_MANIFEST_NAME],
        label: 'artifact',
      })
      if (controlManifest && !manifestsMatch(controlManifest.artifactFiles, artifactFiles)) {
        problems.push('artifact: per-file hashes do not match the release manifest')
      }
    } catch (error) {
      problems.push(`artifact: hash could not be recomputed (${error?.message ?? error})`)
    }
  }

  problems.push(...validateProductionConfig(root))

  return problems
}

async function main() {
  const args = process.argv.slice(2)
  let artifactDirectory = ARTIFACT_DIRECTORY
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--artifact-dir' && args[index + 1]) {
      artifactDirectory = args[index + 1]
      index += 1
    }
  }
  if (path.isAbsolute(artifactDirectory) || artifactDirectory.split(/[\\/]/).includes('..')) {
    console.error('Lantern release preflight failed: --artifact-dir must be a repository-relative path')
    process.exit(1)
  }

  const problems = await runReleasePreflight({ root: process.cwd(), artifactDirectory })
  if (problems.length) {
    console.error('Lantern release preflight: FAILED. No deployment was performed.')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  const manifest = JSON.parse(await readFile(
    path.join(process.cwd(), artifactDirectory, ARTIFACT_MANIFEST_NAME),
    'utf8',
  ))
  console.log(`LANTERN_RELEASE_PREFLIGHT_OK source=${manifest.sourceCommit} artifact=${manifest.artifactHash} build=${manifest.buildId}`)
  console.log('No deployment was performed. Deployment remains subject to separate owner authorization.')
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Lantern release preflight failed: ${error?.message ?? error}`)
    process.exit(1)
  })
}
