#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyMigrations,
  assertAllowedMigrationTarget,
  discoverMigrations,
  STAGING_BINDING,
} from './migrations-core.mjs'

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  return `Lantern D1 migration runner (staging only)

Usage:
  node scripts/migrate.mjs [options]

Options:
  --dir <path>            Migration directory (default: migrations)
  --database <name>       D1 binding/name (default: ${STAGING_BINDING})
  --local                 Use local Wrangler D1 state (default)
  --remote                Use remote D1; requires --confirm-staging-remote
  --dry-run, --plan       Print the plan and generated SQL without writing
  --json                  Emit machine-readable output
  --persist-to <path>     Local Wrangler persistence directory
  -h, --help              Show this help

Production database names are always refused. Deploy remains gated by scripts/deploy-guard.mjs.`
}

function parseArgs(argv) {
  const options = {
    dir: 'migrations',
    database: STAGING_BINDING,
    local: true,
    remote: false,
    dryRun: false,
    json: false,
    persistTo: undefined,
    confirmStagingRemote: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--dry-run':
      case '--plan':
        options.dryRun = true
        break
      case '--json':
        options.json = true
        break
      case '--local':
        options.local = true
        options.remote = false
        break
      case '--remote':
        options.remote = true
        options.local = false
        break
      case '--confirm-staging-remote':
        options.confirmStagingRemote = true
        break
      case '--database':
        options.database = argv[++index]
        break
      case '--dir':
        options.dir = argv[++index]
        break
      case '--persist-to':
        options.persistTo = argv[++index]
        break
      case '--help':
      case '-h':
        console.log(usage())
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  for (const [flag, value] of [['--database', options.database], ['--dir', options.dir], ['--persist-to', options.persistTo]]) {
    if (flag === '--persist-to' && value === undefined) continue
    if (!value) throw new Error(`${flag} requires a value`)
  }

  if (options.remote && !options.confirmStagingRemote) {
    throw new Error('Remote execution requires --confirm-staging-remote. Local mode is the default.')
  }

  return options
}

function wranglerError(parsed) {
  if (parsed?.error?.text) {
    const notes = Array.isArray(parsed.error.notes)
      ? parsed.error.notes.map((note) => note?.text).filter(Boolean).join('; ')
      : ''
    return notes ? `${parsed.error.text} ${notes}` : parsed.error.text
  }
  if (parsed?.success === false) return parsed.error ?? parsed.message ?? 'Wrangler D1 execution failed'
  return null
}

function parseWranglerOutput(stdout) {
  const parsed = JSON.parse(stdout)
  const message = wranglerError(parsed)
  if (message) throw new Error(message)
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []))
}

class WranglerD1 {
  constructor(database, { remote, persistTo }) {
    this.database = database
    this.flags = remote ? ['--remote'] : ['--local']
    if (persistTo) this.flags.push('--persist-to', persistTo)
  }

  async executeSql(sql) {
    const args = [
      'wrangler', 'd1', 'execute', this.database,
      '--command', sql,
      '--json', '--yes',
      ...this.flags,
    ]
    try {
      const { stdout } = await execFileAsync('npx', args, {
        cwd: rootDir,
        maxBuffer: 16 * 1024 * 1024,
      })
      return parseWranglerOutput(stdout)
    } catch (error) {
      const stdout = error?.stdout?.toString?.() ?? ''
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout)
          const message = wranglerError(parsed)
          if (message) {
            if (/no such table/i.test(message)) return []
            throw new Error(message)
          }
        } catch (parseError) {
          if (parseError instanceof SyntaxError) throw error
          throw parseError
        }
      }
      throw error
    }
  }

  prepare(sql) {
    const db = this
    return {
      async all() {
        return { results: await db.executeSql(sql) }
      },
      async first() {
        const rows = await db.executeSql(sql)
        return rows[0] ?? null
      },
      async run() {
        await db.executeSql(sql)
        return { meta: { changes: 0, last_row_id: 0 } }
      },
      bind() {
        throw new Error('The migration planner does not use bound parameters')
      },
    }
  }
}

function printReport(result) {
  if (result.dryRun) {
    console.log(`Dry run: ${result.pending.length} pending, ${result.applied.length} already applied, ${result.legacyBackfill.length} legacy d1_migrations entries to backfill.`)
    if (result.pending.length) console.log(`Pending: ${result.pending.join(', ')}`)
    if (result.legacyBackfill.length) console.log(`Backfill: ${result.legacyBackfill.join(', ')}`)
    for (const sql of result.sql) console.log(`\n--- SQL ---\n${sql}`)
    return
  }
  console.log(`Applied ${result.applied.length} migration(s): ${result.applied.map((item) => item.version).join(', ') || 'none'}`)
  if (result.skipped.length) console.log(`Already applied: ${result.skipped.join(', ')}`)
  if (result.backfilled.length) console.log(`Backfilled tracking rows for: ${result.backfilled.join(', ')}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  assertAllowedMigrationTarget(options)

  const migrations = await discoverMigrations(path.resolve(rootDir, options.dir))
  const db = new WranglerD1(options.database, options)
  const result = await applyMigrations(db, migrations, { dryRun: options.dryRun })

  if (options.json) console.log(JSON.stringify(result, null, 2))
  else printReport(result)
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`)
  if (error.details) console.error(JSON.stringify(error.details, null, 2))
  process.exit(1)
})
