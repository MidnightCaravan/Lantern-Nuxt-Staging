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
  const appliedByVersion = new Map()
  for (const row of appliedRows) {
    const version = String(row.version)
    const existing = appliedByVersion.get(version)
    // Prefer the checksum-bearing tracking row when both sources know a version.
    if (!existing || (existing.source === 'd1_migrations' && row.source !== 'd1_migrations')) {
      appliedByVersion.set(version, row)
    }
  }
  const knownVersions = new Set(migrations.map((migration) => migration.version))

  const checksumMismatches = migrations.flatMap((migration) => {
    const row = appliedByVersion.get(migration.version)
    if (!row || row.status !== 'applied' || !row.checksum || row.checksum === migration.checksum) return []
    return [{
      version: migration.version,
      expected: migration.checksum,
      actual: row.checksum,
    }]
  })

  const legacyBackfill = appliedRows.filter((row) => row.source === 'd1_migrations'
    && knownVersions.has(String(row.version))
    && appliedByVersion.get(String(row.version))?.source === 'd1_migrations')

  return {
    applied: [...appliedByVersion.values()].filter((row) => row.status === 'applied' && knownVersions.has(String(row.version))),
    pending: migrations.filter((migration) => !appliedByVersion.has(migration.version)),
    checksumMismatches,
    legacyBackfill,
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
  const rows = []

  try {
    const result = await db
      .prepare(`SELECT version, name, checksum, applied_at, status, error FROM ${MIGRATION_TABLE} ORDER BY version`)
      .all()
    rows.push(...(result.results ?? []).map((row) => ({ ...row, source: 'lantern' })))
  } catch (error) {
    if (!/no such table/i.test(String(error?.message ?? error))) throw error
  }

  // Wrangler's `d1 migrations apply` records history in d1_migrations. Treat that
  // table as authoritative for legacy application files so the runner does not
  // attempt to re-run DDL that already exists in the target database.
  try {
    const result = await db
      .prepare('SELECT name, applied_at FROM d1_migrations ORDER BY id')
      .all()
    for (const row of result.results ?? []) {
      const match = String(row.name ?? '').match(/^(\d+)_(.+?)(?:\.sql)?$/)
      if (!match) continue
      rows.push({
        version: match[1],
        name: match[2],
        checksum: null,
        applied_at: row.applied_at,
        status: 'applied',
        error: null,
        source: 'd1_migrations',
      })
    }
  } catch (error) {
    if (!/no such table/i.test(String(error?.message ?? error))) throw error
  }

  return rows
}

export async function ensureMigrationTable(db) {
  await db.prepare(CREATE_MIGRATION_TABLE_SQL).run()
}

export function renderMigrationSql(migration, appliedAt = new Date().toISOString(), { transaction = true } = {}) {
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
    ...(transaction ? ['BEGIN TRANSACTION;'] : []),
    `${CREATE_MIGRATION_TABLE_SQL};`,
    ...statements.map((statement) => `${statement};`),
    `${tracking};`,
    ...(transaction ? ['COMMIT;'] : []),
  ].join('\n')
}

export function renderBackfillSql(backfillRows, migrations, now = () => new Date().toISOString(), { transaction = true } = {}) {
  if (!backfillRows.length) return null
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]))

  const statements = backfillRows.map((row) => {
    const version = String(row.version)
    const migration = byVersion.get(version)
    if (!migration) return null
    return `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum, applied_at, status, error)
      VALUES (${quoteSqlLiteral(version)}, ${quoteSqlLiteral(migration.name)}, ${quoteSqlLiteral(migration.checksum)}, ${quoteSqlLiteral(row.applied_at || now())}, 'applied', NULL)
      ON CONFLICT(version) DO NOTHING`
  }).filter(Boolean)

  if (!statements.length) return null
  return [
    ...(transaction ? ['BEGIN TRANSACTION;'] : []),
    ...statements.map((statement) => `${statement};`),
    ...(transaction ? ['COMMIT;'] : []),
  ].join('\n')
}

async function executeSql(db, sql) {
  if (typeof db.executeSql === 'function') {
    await db.executeSql(sql)
  } else {
    for (const statement of splitSql(sql)) {
      await db.prepare(statement).run()
    }
  }
}

export async function applyMigrations(db, migrations, options = {}) {
  const { dryRun = false, now = () => new Date().toISOString(), transaction = true } = options

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
    problems.push(`applied version not present in migrations/: ${plan.unknown.map((row) => String(row.version)).join(', ')}`)
  }
  if (problems.length) {
    throw new MigrationStateError(`Migration state is inconsistent; no changes were applied. ${problems.join('; ')}.`, plan)
  }

  const backfillSql = renderBackfillSql(plan.legacyBackfill, migrations, now, { transaction })

  if (dryRun) {
    return {
      dryRun: true,
      applied: plan.applied.map((row) => String(row.version)),
      pending: plan.pending.map((migration) => migration.version),
      legacyBackfill: plan.legacyBackfill.map((row) => String(row.version)),
      backfillSql,
      sql: plan.pending.map((migration) => renderMigrationSql(migration, now(), { transaction })),
    }
  }

  if (backfillSql) await executeSql(db, backfillSql)

  const applied = []
  for (const migration of plan.pending) {
    const appliedAt = now()
    await executeSql(db, renderMigrationSql(migration, appliedAt, { transaction }))
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
    backfilled: plan.legacyBackfill.map((row) => String(row.version)),
  }
}
