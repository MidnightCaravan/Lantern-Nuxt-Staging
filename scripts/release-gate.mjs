import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { evaluateReleaseGates } from './release-gate-core.mjs'

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function main() {
  const root = process.cwd()
  const state = await readJson(path.join(root, 'docs/release-gates.json'))
  if (!state) {
    console.error('Lantern release gates: docs/release-gates.json is missing.')
    process.exit(1)
  }
  const signoff = await readJson(path.join(root, 'docs/release-signoff.json'))
  const problems = evaluateReleaseGates(state, signoff)

  if (problems.length) {
    console.error('Lantern release gates: NOT READY. No deployment was performed.')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log('Lantern release gates: READY.')
  console.log('This command does not deploy. An authorized operator must execute the release steps in docs/CUTOVER_RUNBOOK.md.')
}

main().catch((error) => {
  console.error(`Lantern release gate failed: ${error?.message ?? error}`)
  process.exit(1)
})
