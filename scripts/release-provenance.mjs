import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/
export const SHA256_PATTERN = /^[0-9a-f]{64}$/
export const ARTIFACT_DIRECTORY = '.output'
export const ARTIFACT_MANIFEST_NAME = 'release-manifest.json'
export const RELEASE_CONFIG_PATH = 'wrangler.release.jsonc'
export const MEDIA_RELEASE_CONFIG_PATH = 'wrangler.media-release.jsonc'
export const APPROVED_PRODUCTION_WORKER = 'lantern'
export const APPROVED_MEDIA_WORKER = 'lantern-media'
export const PRODUCTION_MAIN_PATH = './.output/server/index.mjs'
export const PRODUCTION_ASSETS_DIRECTORY = './.output/public/'
export const APPROVED_MEDIA_ORIGIN_BINDING = 'LANTERN_MEDIA_ORIGIN'
export const PRODUCTION_D1_DATABASE_ID = 'bf50e1be-81d7-4cd1-b082-8aa03a784860'
export const PRODUCTION_R2_BUCKET = 'lantern-media'
export const PRODUCTION_R2_BINDING = 'lantern_media'

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidCommitSha(value) {
  return typeof value === 'string' && FULL_COMMIT_SHA_PATTERN.test(value)
}

export function validateCommitSha(value, label = 'sourceCommit') {
  if (!isValidCommitSha(value)) {
    return [`${label}: must be a full 40-character lowercase hexadecimal Git SHA`]
  }
  return []
}

export function assertCommitSha(value, label = 'sourceCommit') {
  const problems = validateCommitSha(value, label)
  if (problems.length) throw new Error(problems.join('; '))
  return value
}

function runGitBuffer(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

function runGitText(root, args, options = {}) {
  return runGitBuffer(root, args, { encoding: 'utf8', ...options }).trim()
}

/**
 * Validates a control checkout independently of the application source. The
 * control revision may be a later documentation/sign-off commit; it must never
 * be silently substituted for the approved source commit.
 */
export function validateControlCheckout(root, controlSha) {
  const problems = validateCommitSha(controlSha, 'controlSha')
  if (problems.length) return problems

  let head
  try {
    head = runGitText(root, ['rev-parse', 'HEAD'])
  } catch (error) {
    return [`control checkout: HEAD could not be resolved (${error?.message ?? error})`]
  }

  if (head !== controlSha) {
    problems.push(`control checkout: HEAD ${head || 'missing'} does not match workflow control SHA ${controlSha}`)
  }
  return problems
}

export function validateTrackedCleanFiles(root, relativePaths) {
  const problems = []
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(root, relativePath)
    if (!existsSync(absolutePath)) {
      problems.push(`control file: ${relativePath} is missing`)
      continue
    }
    try {
      runGitText(root, ['ls-files', '--error-unmatch', '--', relativePath])
    } catch {
      problems.push(`control file: ${relativePath} is not tracked`)
      continue
    }
    let status
    try {
      status = runGitText(root, [
        'status', '--porcelain=v1', '--untracked-files=no', '--', relativePath,
      ])
    } catch (error) {
      problems.push(`control file: ${relativePath} status could not be checked (${error?.message ?? error})`)
      continue
    }
    if (status) problems.push(`control file: ${relativePath} has uncommitted changes`)
  }
  return problems
}

export function computeSourceTreeHash(root, sourceCommit) {
  assertCommitSha(sourceCommit)
  const tree = runGitBuffer(root, ['ls-tree', '-r', '-z', sourceCommit])
  return `sha256:${createHash('sha256').update(tree).digest('hex')}`
}

function comparePaths(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b))
}

function assertPathInsideRoot(root, candidate, label) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} path escapes the verified artifact: ${candidate}`)
  }
}

export function computeFileHash(filePath) {
  const data = readFileSync(filePath)
  return {
    sha256: `sha256:${createHash('sha256').update(data).digest('hex')}`,
    size: data.length,
  }
}

/**
 * Enumerates a tree deterministically. Symlinks, unusual file types, absolute
 * paths, and paths escaping the requested root are rejected rather than
 * silently hashed. The returned paths always use forward slashes.
 */
export function collectDeterministicFiles(root, options = {}) {
  const {
    excludedNames = [],
    excludedPaths = [],
    label = 'artifact',
  } = options
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${label} directory ${root} does not exist`)
  }

  const excludedNameSet = new Set(excludedNames)
  const excludedPathSet = new Set(excludedPaths.map((item) => item.split(path.sep).join('/')))
  const files = []

  const walk = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => comparePaths(a.name, b.name))) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name
      const absolutePath = path.resolve(directory, entry.name)

      if (entry.name.includes('/') || entry.name.includes('\\') || entry.name === '.' || entry.name === '..') {
        throw new Error(`${label}: unsafe path component ${relativePath}`)
      }
      assertPathInsideRoot(root, absolutePath, label)
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link: ${relativePath}`)
      }

      if (entry.isDirectory()) {
        walk(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`${label}: unsupported file type for ${relativePath}`)
      }
      if (excludedPathSet.has(relativePath) || excludedNameSet.has(entry.name)) continue

      const hash = computeFileHash(absolutePath)
      files.push({ path: relativePath, sha256: hash.sha256, size: hash.size })
    }
  }
  walk(root)
  files.sort((a, b) => comparePaths(a.path, b.path))
  return files
}

export function hashFileList(files) {
  const canonicalParts = [...files]
    .sort((a, b) => comparePaths(a.path, b.path))
    .map((file) => `${file.path}\0${file.size}\0${file.sha256.slice(7)}\n`)
  return `sha256:${createHash('sha256').update(canonicalParts.join('')).digest('hex')}`
}

export function computeArtifactHash(artifactDirectory, options = {}) {
  const { manifestName = ARTIFACT_MANIFEST_NAME } = options
  const files = collectDeterministicFiles(artifactDirectory, {
    excludedPaths: [manifestName],
    label: 'artifact',
  })
  return {
    artifactHash: hashFileList(files),
    fileCount: files.length,
    byteCount: files.reduce((sum, file) => sum + file.size, 0),
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function manifestsMatch(left, right) {
  return stableStringify(left) === stableStringify(right)
}

function isValidSha256Reference(value) {
  return typeof value === 'string'
    && value.startsWith('sha256:')
    && SHA256_PATTERN.test(value.slice(7))
}

export function validateManifestShape(manifest, options = {}) {
  const { expectedArtifactDirectory = ARTIFACT_DIRECTORY } = options
  if (!isRecord(manifest)) return ['release manifest is missing or is not a JSON object']

  const problems = []
  if (manifest.schemaVersion !== 1) problems.push('manifest schemaVersion must be 1')
  if (manifest.sourceRef !== undefined) {
    problems.push('manifest sourceRef is not permitted; the pinned full SHA is the only source identity')
  }
  problems.push(...validateCommitSha(manifest.sourceCommit, 'manifest sourceCommit'))

  if (!isValidSha256Reference(manifest.sourceTreeHash)) {
    problems.push('manifest sourceTreeHash must be sha256:<64-hex>')
  }
  if (!isValidSha256Reference(manifest.artifactHash)) {
    problems.push('manifest artifactHash must be sha256:<64-hex>')
  }
  if (!isNonEmptyString(manifest.buildId)) problems.push('manifest buildId is missing or a placeholder')
  if (typeof manifest.builtAt !== 'string' || !ISO_TIMESTAMP_PATTERN.test(manifest.builtAt) || Number.isNaN(Date.parse(manifest.builtAt))) {
    problems.push('manifest builtAt must be an ISO-8601 timestamp')
  }
  if (!isNonEmptyString(manifest.nodeVersion)) problems.push('manifest nodeVersion is required')
  if (!isNonEmptyString(manifest.npmVersion)) problems.push('manifest npmVersion is required')
  if (manifest.artifactDirectory !== expectedArtifactDirectory) {
    problems.push(`manifest artifactDirectory must be ${expectedArtifactDirectory}`)
  }
  if (manifest.ciRunId !== undefined && manifest.ciRunId !== null
    && !isNonEmptyString(manifest.ciRunId)) {
    problems.push('manifest ciRunId must be null or a non-empty string')
  }

  if (!Array.isArray(manifest.artifactFiles) || manifest.artifactFiles.length === 0) {
    problems.push('manifest artifactFiles must list every deployable file with sha256 and size')
  } else {
    const seen = new Set()
    for (const [index, entry] of manifest.artifactFiles.entries()) {
      const label = `manifest artifactFiles[${index}]`
      if (!isRecord(entry)) {
        problems.push(`${label}: must be a JSON object`)
        continue
      }
      const relativePath = entry.path
      if (!isNonEmptyString(relativePath)
        || path.isAbsolute(relativePath)
        || relativePath.includes('\\')
        || relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
        problems.push(`${label}: path must be a safe artifact-relative path`)
      } else if (seen.has(relativePath)) {
        problems.push(`${label}: duplicate path ${relativePath}`)
      } else {
        seen.add(relativePath)
      }
      if (!isValidSha256Reference(entry.sha256)) {
        problems.push(`${label}: sha256 must be sha256:<64-hex>`)
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        problems.push(`${label}: size must be a non-negative safe integer`)
      }
    }
  }

  for (const [field, expectedPath] of [
    ['productionConfig', RELEASE_CONFIG_PATH],
    ['mediaConfig', MEDIA_RELEASE_CONFIG_PATH],
  ]) {
    const binding = manifest[field]
    if (!isRecord(binding)) {
      problems.push(`manifest ${field} must record path, sha256, and size`)
      continue
    }
    if (binding.path !== expectedPath) problems.push(`manifest ${field}.path must be ${expectedPath}`)
    if (!isValidSha256Reference(binding.sha256)) {
      problems.push(`manifest ${field}.sha256 must be sha256:<64-hex>`)
    }
    if (!Number.isSafeInteger(binding.size) || binding.size < 0) {
      problems.push(`manifest ${field}.size must be a non-negative safe integer`)
    }
  }

  const productionConfig = manifest.productionConfig
  if (isRecord(productionConfig)) {
    if (productionConfig.worker !== APPROVED_PRODUCTION_WORKER) {
      problems.push(`manifest productionConfig.worker must be ${APPROVED_PRODUCTION_WORKER}`)
    }
    if (productionConfig.main !== PRODUCTION_MAIN_PATH) {
      problems.push(`manifest productionConfig.main must be ${PRODUCTION_MAIN_PATH}`)
    }
    if (productionConfig.assetsDirectory !== PRODUCTION_ASSETS_DIRECTORY) {
      problems.push(`manifest productionConfig.assetsDirectory must be ${PRODUCTION_ASSETS_DIRECTORY}`)
    }
  }

  return problems
}

export function parseJsonc(source) {
  return JSON.parse(source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'))
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function forbiddenIdentifierProblems(label, source, config) {
  const serialized = JSON.stringify(config)
  const problems = []
  for (const forbidden of [
    '5ce6be03-45c1-465e-a461-20e40148404e',
    'lantern-staging-db',
    'lantern_staging_db',
    'lantern-staging-media',
    'lantern_staging_media',
    'lantern-nuxt-rehearsal',
    'lantern-media-rehearsal',
  ]) {
    if (source.includes(forbidden) || serialized.includes(forbidden)) {
      problems.push(`${label}: staging or rehearsal identifier ${forbidden} is forbidden`)
    }
  }
  return problems
}

/**
 * Validates the owner-approved A1 production shape. The Nuxt Worker replaces
 * the existing `lantern` Worker, keeps workers.dev serving the canonical host,
 * and reaches the private Flask media Worker through a Service Binding.
 */
export function validateProductionConfig(root, options = {}) {
  const {
    configPath = path.resolve(root, RELEASE_CONFIG_PATH),
    mediaConfigPath = path.resolve(root, MEDIA_RELEASE_CONFIG_PATH),
    checkMediaConfig = true,
  } = options

  if (!existsSync(configPath)) {
    return [`production config: ${RELEASE_CONFIG_PATH} is missing`]
  }

  let releaseSource
  let config
  try {
    releaseSource = readFileSync(configPath, 'utf8')
    config = parseJsonc(releaseSource)
    if (releaseSource.includes('REPLACE_WITH_')) {
      return ['production config: unresolved REPLACE_WITH_ placeholder remains']
    }
  } catch (error) {
    return [`production config: could not be parsed (${error?.message ?? error})`]
  }

  const problems = []
  const productionAllowedKeys = new Set([
    '$schema',
    'name',
    'workers_dev',
    'preview_urls',
    'main',
    'compatibility_date',
    'assets',
    'vars',
    'services',
    'd1_databases',
    'observability',
    'upload_source_maps',
    'r2_buckets',
  ])
  for (const key of Object.keys(config)) {
    if (!productionAllowedKeys.has(key)) problems.push(`production config: unexpected key ${key}`)
  }
  if (config.name !== APPROVED_PRODUCTION_WORKER) {
    problems.push(`production config: Worker name must be the approved A1 name ${APPROVED_PRODUCTION_WORKER}`)
  }
  if (config.workers_dev !== true) {
    problems.push('production config: workers_dev must remain true to preserve the canonical hostname')
  }
  if (config.preview_urls !== false) {
    problems.push('production config: preview_urls must remain false')
  }
  for (const forbidden of ['routes', 'route', 'domains', 'triggers']) {
    if (config[forbidden] !== undefined) problems.push(`production config: ${forbidden} must remain absent`)
  }
  if (config.vars?.LANTERN_ENABLE_PRODUCTION_WRITES !== undefined) {
    problems.push('production config: LANTERN_ENABLE_PRODUCTION_WRITES must remain absent')
  }
  if (!sameJson(config.vars, {
    LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
    LANTERN_PUBLIC_READ_DATABASE: 'production',
  })) {
    problems.push('production config: explicit production selectors are required')
  }
  if (config.main !== './.output/server/index.mjs') {
    problems.push('production config: main must use the verified .output/server/index.mjs artifact')
  }
  if (config.assets?.directory !== './.output/public/') {
    problems.push('production config: assets.directory must use the verified .output/public/ artifact')
  }

  const expectedService = {
    binding: APPROVED_MEDIA_ORIGIN_BINDING,
    service: APPROVED_MEDIA_WORKER,
  }
  if (!sameJson(config.services, [expectedService])) {
    problems.push(`production config: required A1 Service Binding ${APPROVED_MEDIA_ORIGIN_BINDING} -> ${APPROVED_MEDIA_WORKER} is missing or incorrect`)
  }
  if (!sameJson(config.d1_databases, [{
    binding: 'lantern_db',
    database_name: 'lantern-db',
    database_id: PRODUCTION_D1_DATABASE_ID,
    remote: true,
  }])) {
    problems.push('production config: approved production D1 database is missing or incorrect')
  }
  if (!sameJson(config.r2_buckets, [{
    bucket_name: PRODUCTION_R2_BUCKET,
    binding: PRODUCTION_R2_BINDING,
  }])) {
    problems.push('production config: approved production R2 binding is missing or incorrect')
  }
  problems.push(...forbiddenIdentifierProblems('production config', releaseSource, config))

  if (!checkMediaConfig) return problems
  if (!existsSync(mediaConfigPath)) {
    problems.push(`media config: ${MEDIA_RELEASE_CONFIG_PATH} is missing`)
    return problems
  }

  let mediaSource
  let mediaConfig
  try {
    mediaSource = readFileSync(mediaConfigPath, 'utf8')
    mediaConfig = parseJsonc(mediaSource)
    if (mediaSource.includes('REPLACE_WITH_')) {
      problems.push('media config: unresolved REPLACE_WITH_ placeholder remains')
      return problems
    }
  } catch (error) {
    problems.push(`media config: could not be parsed (${error?.message ?? error})`)
    return problems
  }

  if (mediaConfig.name !== APPROVED_MEDIA_WORKER) {
    problems.push(`media config: Worker name must be the approved private media Worker ${APPROVED_MEDIA_WORKER}`)
  }
  if (mediaConfig.main !== 'lantern-media-release/src/media_worker.py') {
    problems.push('media config: main must use the verified Flask media implementation')
  }
  if (!sameJson(mediaConfig.compatibility_flags, ['python_workers'])) {
    problems.push("media config: compatibility_flags must be ['python_workers']")
  }
  if (mediaConfig.workers_dev !== false) {
    problems.push('media config: workers_dev must remain false so the media Worker has no public endpoint')
  }
  if (mediaConfig.preview_urls !== false) {
    problems.push('media config: preview_urls must remain false')
  }
  for (const forbidden of ['routes', 'route', 'domains', 'triggers', 'd1_databases', 'services', 'vars', 'secrets']) {
    if (mediaConfig[forbidden] !== undefined) problems.push(`media config: ${forbidden} must remain absent`)
  }
  if (!sameJson(mediaConfig.r2_buckets, [{
    binding: PRODUCTION_R2_BINDING,
    bucket_name: PRODUCTION_R2_BUCKET,
    remote: true,
  }])) {
    problems.push('media config: only the approved production R2 binding is permitted')
  }
  const allowedKeys = new Set([
    '$schema',
    'name',
    'main',
    'compatibility_date',
    'compatibility_flags',
    'workers_dev',
    'preview_urls',
    'r2_buckets',
  ])
  for (const key of Object.keys(mediaConfig)) {
    if (!allowedKeys.has(key)) problems.push(`media config: unexpected key ${key}`)
  }
  problems.push(...forbiddenIdentifierProblems('media config', mediaSource, mediaConfig))
  for (const forbidden of [
    PRODUCTION_D1_DATABASE_ID,
    'lantern-db',
    'lantern_db',
    'lantern-nuxt',
  ]) {
    if (mediaSource.includes(forbidden) || JSON.stringify(mediaConfig).includes(forbidden)) {
      problems.push(`media config: application production identifier ${forbidden} is forbidden`)
    }
  }
  if (Array.isArray(config.services)
    && !config.services.some((service) => service?.service === mediaConfig.name)) {
    problems.push('production config: Service Binding target does not match the approved media Worker')
  }
  return problems
}
