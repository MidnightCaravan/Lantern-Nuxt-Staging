import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const MIGRATION_TABLE = 'lantern_schema_migrations'
export const PRODUCTION_BINDING = 'lantern_db'
export const STAGING_BINDING = 'lantern_staging_db'

const PRODUCTION_IDENTIFIERS = new Set([PRODUCTION_BINDING, 'lantern-db', 'lantern_db'])
const STAGING_IDENTIFIERS = new Set([STAGING_BINDING, 'lantern-staging-db'])

export class MigrationStateError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'MigrationStateError'
    this.details = details
  }
}

export const CREATE_MIGRATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied',
    error TEXT
)`

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function splitSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n\r]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

export function quoteSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export async function discoverMigrations(directory) {
  const files = (await readdir(directory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()

  const migrations = await Promise.all(files.map(async (file) => {
    const sql = await readFile(path.join(directory, file), 'utf8')
    const match = file.match(/^(\d+)_(.+)\.sql$/)
    return {
      version: match[1],
      name: match[2],
      file,
      sql,
      checksum: sha256(sql),
    }
  }))

  const versions = new Set()
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`)
    }
    versions.add(migration.version)
  }

  return migrations
}

export function planMigrations(appliedRows = [], migrations = []) {
  const appliedByVersion = new Map(appliedRows.map((row) => [String(row.version), row]))
  const knownVersions = new Set(migrations.map((migration) => migration.version))

  const checksumMismatches = migrations.flatMap((migration) => {
    const row = appliedByVersion.get(migration.version)
    if (!row || row.status !== 'applied' || row.checksum === migration.checksum) return []
    return [{
      version: migration.version,
      expected: migration.checksum,
      actual: row.checksum,
    }]
  })

  return {
    applied: appliedRows.filter((row) => row.status === 'applied' && knownVersions.has(String(row.version))),
    pending: migrations.filter((migration) => !appliedByVersion.has(migration.version)),
    checksumMismatches,
    failed: appliedRows.filter((row) => row.status && row.status !== 'applied'),
    unknown: appliedRows.filter((row) => !knownVersions.has(String(row.version))),
  }
}

export function assertAllowedMigrationTarget({ database, remote = false }) {
  const name = String(database ?? '')
  if (PRODUCTION_IDENTIFIERS.has(name)) {
    throw new Error(`Refusing to migrate production binding "${name}". Production changes require explicit sign-off (B6/G3).`)
  }
  if (remote && !STAGING_IDENTIFIERS.has(name)) {
    throw new Error(`Refusing remote migration for unrecognized database "${name}". Only ${STAGING_BINDING} may be migrated remotely.`)
  }
}

export async function readAppliedRows(db) {
  try {
    const result = await db
      .prepare(`SELECT version, name, checksum, applied_at, status, error FROM ${MIGRATION_TABLE} ORDER BY version`)
      .all()
    return result.results ?? []
  } catch (error) {
    if (/no such table/i.test(String(error?.message ?? error))) return []
    throw error
  }
}

export async function ensureMigrationTable(db) {
  await db.prepare(CREATE_MIGRATION_TABLE_SQL).run()
}

export function renderMigrationSql(migration, appliedAt = new Date().toISOString()) {
  const statements = splitSql(migration.sql)
  const tracking = `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum, applied_at, status, error)
    VALUES (${quoteSqlLiteral(migration.version)}, ${quoteSqlLiteral(migration.name)}, ${quoteSqlLiteral(migration.checksum)}, ${quoteSqlLiteral(appliedAt)}, 'applied', NULL)
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      applied_at = excluded.applied_at,
      status = 'applied',
      error = NULL`

  return [
    'BEGIN TRANSACTION;',
    `${CREATE_MIGRATION_TABLE_SQL};`,
    ...statements.map((statement) => `${statement};`),
    `${tracking};`,
    'COMMIT;',
  ].join('\n')
}

export async function applyMigrations(db, migrations, options = {}) {
  const { dryRun = false, now = () => new Date().toISOString() } = options

  if (!dryRun) await ensureMigrationTable(db)

  const appliedRows = await readAppliedRows(db)
  const plan = planMigrations(appliedRows, migrations)

  const problems = []
  if (plan.checksumMismatches.length) {
    problems.push(`checksum mismatch: ${plan.checksumMismatches.map((item) => item.version).join(', ')}`)
  }
  if (plan.failed.length) {
    problems.push(`previously failed migration left a partial state: ${plan.failed.map((row) => row.version).join(', ')}`)
  }
  if (plan.unknown.length) {
    problems.push(`applied version not present in migrations/: ${plan.unknown.map((row) => row.version).join(', ')}`)
  }
  if (problems.length) {
    throw new MigrationStateError(`Migration state is inconsistent; no changes were applied. ${problems.join('; ')}.`, plan)
  }

  if (dryRun) {
    return {
      dryRun: true,
      applied: plan.applied.map((row) => String(row.version)),
      pending: plan.pending.map((migration) => migration.version),
      sql: plan.pending.map((migration) => renderMigrationSql(migration, now())),
    }
  }

  const applied = []
  for (const migration of plan.pending) {
    const appliedAt = now()
    const sql = renderMigrationSql(migration, appliedAt)
    if (typeof db.executeSql === 'function') {
      await db.executeSql(sql)
    } else {
      for (const statement of splitSql(sql)) {
        await db.prepare(statement).run()
      }
    }
    applied.push({
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      appliedAt,
    })
  }

  return {
    dryRun: false,
    applied,
    skipped: plan.applied.map((row) => String(row.version)),
  }
}
