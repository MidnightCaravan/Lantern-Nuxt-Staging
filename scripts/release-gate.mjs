import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { evaluateReleaseGates } from './release-gate-core.mjs'
import {
  ARTIFACT_DIRECTORY,
  ARTIFACT_MANIFEST_NAME,
  CONTROL_MANIFEST_PATH,
} from './release-provenance.mjs'

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function parseArgs(argv) {
  const args = {}
  for (const item of argv) {
    if (item === '--help') args.help = true
    else if (item.startsWith('--control-sha=')) args['control-sha'] = item.slice('--control-sha='.length)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/release-gate.mjs [--control-sha=<full-control-checkout-sha>]')
    return
  }

  const root = process.cwd()
  const state = await readJson(path.join(root, 'docs/release-gates.json'))
  if (!state) {
    console.error('Lantern release gates: docs/release-gates.json is missing.')
    process.exit(1)
  }
  const signoff = await readJson(path.join(root, 'docs/release-signoff.json'))
  const artifactManifest = await readJson(path.join(root, ARTIFACT_DIRECTORY, ARTIFACT_MANIFEST_NAME))
  const controlManifest = await readJson(path.join(root, CONTROL_MANIFEST_PATH))
  const approvedArtifactHash = artifactManifest?.artifactHash ?? controlManifest?.artifactHash ?? null

  const controlFiles = ['docs/release-gates.json', 'docs/release-signoff.template.json']
  if (signoff) controlFiles.push('docs/release-signoff.json')

  const problems = evaluateReleaseGates(state, signoff, {
    root,
    checkRef: true,
    checkDocs: true,
    controlFiles,
    controlSha: args['control-sha'] ?? null,
    expectedArtifactHash: approvedArtifactHash,
  })

  if (problems.length) {
    console.error('Lantern release gates: NOT READY. No deployment was performed.')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log('Lantern release gates: READY.')
  console.log('This command does not deploy. Run `npm run release:preflight` before any separately authorized deployment.')
}

main().catch((error) => {
  console.error(`Lantern release gate failed: ${error?.message ?? error}`)
  process.exit(1)
})
