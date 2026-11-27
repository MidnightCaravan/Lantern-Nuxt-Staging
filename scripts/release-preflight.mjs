import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateReleaseGates } from './release-gate-core.mjs'
import {
  ARTIFACT_DIRECTORY,
  ARTIFACT_MANIFEST_NAME,
  MEDIA_RELEASE_CONFIG_PATH,
  RELEASE_CONFIG_PATH,
  collectDeterministicFiles,
  computeArtifactHash,
  computeFileHash,
  computeSourceTreeHash,
  isValidCommitSha,
  manifestsMatch,
  validateManifestShape,
  validateProductionConfig,
  validateTrackedCleanFiles,
} from './release-provenance.mjs'

const CONTROL_FILES = [
  'docs/release-gates.json',
  'docs/release-signoff.template.json',
  RELEASE_CONFIG_PATH,
  MEDIA_RELEASE_CONFIG_PATH,
]

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

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && !value.split('/').includes('..')
}

export async function runReleasePreflight(options = {}) {
  const {
    root = process.cwd(),
    artifactDirectory = ARTIFACT_DIRECTORY,
    controlManifestPath = null,
  } = options

  const stateResult = await readJson(path.join(root, 'docs/release-gates.json'))
  const signoffResult = await readJson(path.join(root, 'docs/release-signoff.json'))
  const artifactManifestResult = await readJson(path.join(root, artifactDirectory, ARTIFACT_MANIFEST_NAME))
  const reviewedManifestResult = controlManifestPath
    ? await readJson(path.resolve(root, controlManifestPath))
    : null

  const problems = [
    ...readProblem('release state', stateResult),
    ...await Promise.resolve(
      signoffResult.error
        ? [`release sign-off: could not be parsed (${signoffResult.error?.message ?? signoffResult.error})`]
        : [],
    ),
    ...readProblem('artifact manifest', artifactManifestResult),
  ]
  if (reviewedManifestResult) {
    problems.push(...readProblem('manually reviewed manifest', reviewedManifestResult))
  }

  const state = stateResult.value
  const artifactManifest = artifactManifestResult.value
  const reviewedManifest = reviewedManifestResult?.value ?? null

  if (stateResult.exists) {
    problems.push(...evaluateReleaseGates(state, signoffResult.exists ? signoffResult.value : null))
  }

  const controlFiles = [...CONTROL_FILES]
  if (signoffResult.exists) controlFiles.push('docs/release-signoff.json')
  problems.push(...validateTrackedCleanFiles(root, controlFiles))

  if (artifactManifest) {
    problems.push(...validateManifestShape(artifactManifest, { expectedArtifactDirectory: artifactDirectory }))
    problems.push(...configHashProblem(
      'production config',
      path.resolve(root, RELEASE_CONFIG_PATH),
      artifactManifest.productionConfig,
    ))
    problems.push(...configHashProblem(
      'media config',
      path.resolve(root, MEDIA_RELEASE_CONFIG_PATH),
      artifactManifest.mediaConfig,
    ))
  }

  if (reviewedManifest) {
    problems.push(...validateManifestShape(reviewedManifest, { expectedArtifactDirectory: artifactDirectory }))
  }

  if (state && artifactManifest) {
    if (isValidCommitSha(state.sourceCommit)) {
      if (artifactManifest.sourceCommit !== state.sourceCommit) {
        problems.push(`artifact: manifest sourceCommit ${artifactManifest.sourceCommit ?? 'missing'} does not match approved sourceCommit ${state.sourceCommit}`)
      }
      try {
        const sourceTreeHash = computeSourceTreeHash(root, state.sourceCommit)
        if (artifactManifest.sourceTreeHash !== sourceTreeHash) {
          problems.push(`artifact: source tree hash ${artifactManifest.sourceTreeHash ?? 'missing'} does not match approved commit ${sourceTreeHash}`)
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
        if (artifactManifest.artifactHash !== artifactHash) {
          problems.push(`artifact: recorded hash ${artifactManifest.artifactHash ?? 'missing'} does not match recomputed hash ${artifactHash}; output may be stale or modified`)
        }
        const artifactFiles = collectDeterministicFiles(artifactPath, {
          excludedPaths: [ARTIFACT_MANIFEST_NAME],
          label: 'artifact',
        })
        if (!manifestsMatch(artifactManifest.artifactFiles, artifactFiles)) {
          problems.push('artifact: per-file hashes do not match the release manifest')
        }
      } catch (error) {
        problems.push(`artifact: hash could not be recomputed (${error?.message ?? error})`)
      }
    }
  }

  if (reviewedManifest && artifactManifest && !manifestsMatch(reviewedManifest, artifactManifest)) {
    problems.push('artifact: manually reviewed manifest and deployed artifact manifest do not match')
  }

  problems.push(...validateProductionConfig(root))

  return problems
}

function parseArgs(argv) {
  const args = { _: [], 'artifact-dir': ARTIFACT_DIRECTORY, manifest: null }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--help') args.help = true
    else if (item === '--artifact-dir' && argv[index + 1]) {
      args['artifact-dir'] = argv[index + 1]
      index += 1
    } else if (item.startsWith('--artifact-dir=')) {
      args['artifact-dir'] = item.slice('--artifact-dir='.length)
    } else if (item === '--manifest' && argv[index + 1]) {
      args.manifest = argv[index + 1]
      index += 1
    } else if (item.startsWith('--manifest=')) {
      args.manifest = item.slice('--manifest='.length)
    } else args._.push(item)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/release-preflight.mjs [--artifact-dir=<relative-path>] [--manifest=<relative-path>]')
    return
  }

  const invalid = []
  if (args._.length) invalid.push(...args._.map((item) => `unsupported argument ${item}`))
  if (!isSafeRelativePath(args['artifact-dir'])) invalid.push('--artifact-dir must be a repository-relative path')
  if (args.manifest !== null && !isSafeRelativePath(args.manifest)) {
    invalid.push('--manifest must be a repository-relative path')
  }
  if (invalid.length) {
    for (const problem of invalid) console.error(`  - ${problem}`)
    process.exit(1)
  }

  const problems = await runReleasePreflight({
    root: process.cwd(),
    artifactDirectory: args['artifact-dir'],
    controlManifestPath: args.manifest,
  })
  if (problems.length) {
    console.error('Lantern release preflight: FAILED. No deployment was performed.')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  const manifest = JSON.parse(await readFile(
    path.join(process.cwd(), args['artifact-dir'], ARTIFACT_MANIFEST_NAME),
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
