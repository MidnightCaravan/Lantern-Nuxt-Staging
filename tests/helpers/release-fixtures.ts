import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  APPROVED_PRODUCTION_WORKER,
  ARTIFACT_MANIFEST_NAME,
  MEDIA_RELEASE_CONFIG_PATH,
  PRODUCTION_ASSETS_DIRECTORY,
  PRODUCTION_MAIN_PATH,
  RELEASE_CONFIG_PATH,
  collectDeterministicFiles,
  computeArtifactHash,
  computeFileHash,
  computeSourceTreeHash,
} from '../../scripts/release-provenance.mjs'
import { APPROVAL_MODEL } from '../../scripts/release-gate-core.mjs'

export const TEST_SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567'
export const TEST_OTHER_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98'

export const APPROVED_A1_RELEASE_CONFIG = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: 'lantern',
  workers_dev: true,
  preview_urls: false,
  main: './.output/server/index.mjs',
  compatibility_date: '2026-11-13',
  assets: {
    binding: 'ASSETS',
    directory: './.output/public/',
  },
  vars: {
    LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
    LANTERN_PUBLIC_READ_DATABASE: 'production',
  },
  services: [
    {
      binding: 'LANTERN_MEDIA_ORIGIN',
      service: 'lantern-media',
    },
  ],
  d1_databases: [
    {
      binding: 'lantern_db',
      database_name: 'lantern-db',
      database_id: 'bf50e1be-81d7-4cd1-b082-8aa03a784860',
      remote: true,
    },
  ],
  observability: {
    enabled: true,
  },
  upload_source_maps: true,
  r2_buckets: [
    {
      bucket_name: 'lantern-media',
      binding: 'lantern_media',
    },
  ],
}

export const APPROVED_A1_MEDIA_CONFIG = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: 'lantern-media',
  main: 'lantern-media-release/src/media_worker.py',
  compatibility_date: '2026-09-28',
  compatibility_flags: ['python_workers'],
  workers_dev: false,
  preview_urls: false,
  r2_buckets: [
    {
      binding: 'lantern_media',
      bucket_name: 'lantern-media',
      remote: true,
    },
  ],
}

export function git(root: string, args: string[], encoding: BufferEncoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], {
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim()
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function writeApprovedA1Configs(root: string) {
  writeJson(path.join(root, RELEASE_CONFIG_PATH), APPROVED_A1_RELEASE_CONFIG)
  writeJson(path.join(root, MEDIA_RELEASE_CONFIG_PATH), APPROVED_A1_MEDIA_CONFIG)
}

export function createSingleOwnerSignoff(
  sourceCommit: string,
  name = 'Fixture Owner',
  date = '2026-11-27',
) {
  return {
    approvalModel: APPROVAL_MODEL,
    commit: sourceCommit,
    noIndependentHumanReview: true,
    acceptsInfrastructureAndSecurityRisk: true,
    roles: {
      applicationOwner: {
        approved: true,
        name,
        date,
      },
    },
  }
}

export function createReadyState(sourceCommit: string, gatePass = true) {
  const gates = Object.fromEntries(['G0', 'G1', 'G2', 'G3'].map((id) => [id, {
    title: id,
    pass: gatePass,
    evidence: gatePass ? 'fixture release evidence' : 'fixture gate blocked',
  }]))
  if (!gatePass) gates.G0.pass = true
  const blockers = Object.fromEntries(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'].map((id) => [id, {
    title: id,
    closed: true,
    evidence: 'fixture release evidence',
  }]))
  return {
    release: 'lantern',
    approvalModel: APPROVAL_MODEL,
    sourceCommit,
    gates,
    blockers,
  }
}

export function createReleaseManifest(
  root: string,
  sourceCommit: string,
  options: {
    artifactDirectory?: string
    buildId?: string
    ciRunId?: string | null
    workflowControlSha?: string
    eventSha?: string | null
  } = {},
) {
  const artifactDirectory = options.artifactDirectory ?? '.output'
  const artifactRoot = path.join(root, artifactDirectory)
  const { artifactHash, fileCount, byteCount } = computeArtifactHash(artifactRoot)
  const artifactFiles = collectDeterministicFiles(artifactRoot, {
    excludedPaths: [ARTIFACT_MANIFEST_NAME],
    label: 'artifact',
  })
  const productionConfigHash = computeFileHash(path.join(root, RELEASE_CONFIG_PATH))
  const mediaConfigHash = computeFileHash(path.join(root, MEDIA_RELEASE_CONFIG_PATH))

  return {
    schemaVersion: 1,
    sourceCommit,
    sourceTreeHash: computeSourceTreeHash(root, sourceCommit),
    artifactHash,
    artifactFileCount: fileCount,
    artifactByteCount: byteCount,
    artifactFiles,
    artifactDirectory,
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
    buildId: options.buildId ?? 'fixture-build-id',
    builtAt: '2026-11-25T00:00:00.000Z',
    nodeVersion: process.version,
    npmVersion: '10.0.0',
    verificationCommand: 'npm run verify',
    installCommand: 'npm ci',
    ciRunId: options.ciRunId ?? 'fixture-ci-run',
    provenance: {
      provider: 'local',
      repository: null,
      workflow: null,
      workflowEventSha: options.eventSha ?? sourceCommit,
      workflowControlSha: options.workflowControlSha ?? sourceCommit,
      applicationSourceSha: sourceCommit,
    },
  }
}

export interface TempGitRepo {
  root: string
  sourceCommit: string
  cleanup: () => void
}

export function createTempGitRepo(options: { advanceHead?: boolean } = {}): TempGitRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'lantern-release-test-'))

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'Release Fixture'])
  git(root, ['config', 'user.email', 'release-fixture@example.invalid'])
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  writeFileSync(path.join(root, 'docs', '.gitkeep'), '')
  writeFileSync(path.join(root, '.gitignore'), '.output\n.nuxt\nnode_modules\n')
  writeFileSync(path.join(root, 'fixture.txt'), 'candidate\n')
  writeApprovedA1Configs(root)
  git(root, ['add', '.gitignore', 'fixture.txt', 'docs/.gitkeep', RELEASE_CONFIG_PATH, MEDIA_RELEASE_CONFIG_PATH])
  git(root, ['commit', '-q', '-m', 'candidate'])
  const sourceCommit = git(root, ['rev-parse', 'HEAD'])

  if (options.advanceHead) {
    writeFileSync(path.join(root, 'later.txt'), 'later\n')
    git(root, ['add', 'later.txt'])
    git(root, ['commit', '-q', '-m', 'later control commit'])
  }

  return {
    root,
    sourceCommit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

export interface ReleaseControlFixture extends TempGitRepo {
  manifest: Record<string, any>
}

export function createReleaseControlFixture(options: {
  withSignoff?: boolean
  gatePass?: boolean
  buildId?: string
} = {}): ReleaseControlFixture {
  const repo = createTempGitRepo()
  const { root, sourceCommit } = repo

  writeFileSync(
    path.join(root, 'docs/release-signoff.template.json'),
    readFileSync(path.resolve(process.cwd(), 'docs/release-signoff.template.json'), 'utf8'),
  )

  mkdirSync(path.join(root, '.output', 'public'), { recursive: true })
  mkdirSync(path.join(root, '.output', 'server'), { recursive: true })
  writeFileSync(path.join(root, '.output', 'public', 'index.txt'), 'approved artifact\n')
  writeFileSync(
    path.join(root, '.output', 'server', 'index.mjs'),
    'export default { fetch() { return new Response("ok") } }\n',
  )
  const manifest = createReleaseManifest(root, sourceCommit, { buildId: options.buildId })
  writeFileSync(
    path.join(root, '.output', ARTIFACT_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  writeJson(path.join(root, 'docs/release-gates.json'), createReadyState(sourceCommit, options.gatePass !== false))
  if (options.withSignoff !== false) {
    writeJson(path.join(root, 'docs/release-signoff.json'), createSingleOwnerSignoff(sourceCommit))
  }

  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'record release controls'])

  return { ...repo, manifest }
}
