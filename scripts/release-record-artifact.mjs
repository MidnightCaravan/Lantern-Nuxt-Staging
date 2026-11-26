import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONTROL_MANIFEST_PATH,
  SHA256_PATTERN,
  isValidCommitSha,
  isValidReleaseRef,
} from './release-provenance.mjs'

export const RECORD_ARTIFACT_MESSAGE = 'chore: record verified release artifact manifest'

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

/**
 * Commits only the control copy of the build manifest. This is the missing
 * link between `npm run release:build` and `npm run release:preflight`: the
 * generated manifest must be part of the release-control revision before it
 * can be required as a tracked, clean control file.
 */
export function recordReleaseArtifact(options = {}) {
  const {
    root = process.cwd(),
    runCommand = defaultRunCommand,
  } = options

  const manifestPath = path.resolve(root, CONTROL_MANIFEST_PATH)
  if (!existsSync(manifestPath)) {
    return { ok: false, problems: [`control manifest: ${CONTROL_MANIFEST_PATH} is missing`] }
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { ok: false, problems: [`control manifest: could not be parsed (${error?.message ?? error})`] }
  }

  const manifestProblems = []
  if (!isValidCommitSha(manifest?.sourceCommit)) {
    manifestProblems.push('control manifest: sourceCommit must be a full 40-character lowercase SHA')
  }
  if (!isValidReleaseRef(manifest?.sourceRef)) {
    manifestProblems.push('control manifest: sourceRef must be an immutable refs/tags/... reference')
  }
  if (typeof manifest?.artifactHash !== 'string'
    || !manifest.artifactHash.startsWith('sha256:')
    || !SHA256_PATTERN.test(manifest.artifactHash.slice(7))) {
    manifestProblems.push('control manifest: artifactHash must be sha256:<64-hex>')
  }
  if (manifestProblems.length) return { ok: false, problems: manifestProblems }

  const status = commandText(runCommand(
    'git',
    ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root },
  ))
  const entries = status ? status.split('\n').filter(Boolean) : []

  if (entries.length === 0) {
    const controlSha = commandText(runCommand(
      'git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root },
    ))
    return { ok: true, recorded: false, controlSha, manifestPath: CONTROL_MANIFEST_PATH }
  }

  const allowedEntry = `?? ${CONTROL_MANIFEST_PATH}`
  const unexpected = entries.filter((entry) => entry !== allowedEntry)
  if (unexpected.length) {
    return {
      ok: false,
      problems: [
        'release artifact: refusing to commit with other working-tree changes',
        ...unexpected,
      ],
    }
  }

  runCommand('git', ['-C', root, 'add', '--', CONTROL_MANIFEST_PATH], { cwd: root })
  runCommand(
    'git',
    ['-C', root, 'commit', '-q', '-m', RECORD_ARTIFACT_MESSAGE],
    { cwd: root },
  )
  const controlSha = commandText(runCommand(
    'git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root },
  ))

  return {
    ok: true,
    recorded: true,
    controlSha,
    manifestPath: CONTROL_MANIFEST_PATH,
    message: RECORD_ARTIFACT_MESSAGE,
  }
}

function main() {
  const result = recordReleaseArtifact()
  if (!result.ok) {
    for (const problem of result.problems) console.error(problem)
    process.exit(1)
  }
  if (result.recorded) {
    console.log(`Recorded ${result.manifestPath} in release-control commit ${result.controlSha}.`)
  } else {
    console.log(`${result.manifestPath} is already recorded at release-control commit ${result.controlSha}.`)
  }
  console.log(`Use npm run release:check --control-sha=${result.controlSha} before preflight.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
