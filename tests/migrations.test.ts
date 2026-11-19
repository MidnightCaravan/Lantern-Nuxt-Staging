import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyMigrations,
  assertAllowedMigrationTarget,
  discoverMigrations,
  MigrationStateError,
  planMigrations,
  PRODUCTION_BINDING,
  renderMigrationSql,
  sha256,
  splitSql,
  STAGING_BINDING,
} from '../scripts/migrations-core.mjs'

const migrationsDir = path.resolve(process.cwd(), 'migrations')

type MigrationRow = {
  version: string
  name: string
  checksum: string
  applied_at: string
  status: string
  error: string | null
}

function createMigrationDb(
  initialRows: MigrationRow[] = [],
  d1Rows: Array<{ name: string; applied_at: string }> = [],
) {
  const rows: MigrationRow[] = [...initialRows]
  const executed: string[] = []
  let tableExists = initialRows.length > 0
  const d1TableExists = d1Rows.length > 0

  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

  function handle(sql: string) {
    const normalized = normalize(sql)
    executed.push(normalized)

    if (/^CREATE TABLE IF NOT EXISTS lantern_schema_migrations/i.test(normalized)) {
      tableExists = true
      return
    }
    if (/^SELECT version, name, checksum, applied_at, status, error FROM lantern_schema_migrations/i.test(normalized)) {
      if (!tableExists) throw new Error('no such table: lantern_schema_migrations')
      return
    }
    if (/^SELECT name, applied_at FROM d1_migrations/i.test(normalized)) {
      if (!d1TableExists) throw new Error('no such table: d1_migrations')
      return
    }
    if (/^INSERT INTO lantern_schema_migrations/i.test(normalized)) {
      const match = normalized.match(
        /VALUES \('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'(?:, (NULL|'[^']*'))?\)/,
      )
      if (!match) throw new Error(`Unhandled tracking insert: ${normalized}`)
      rows.push({
        version: match[1],
        name: match[2],
        checksum: match[3],
        applied_at: match[4],
        status: match[5],
        error: !match[6] || match[6] === 'NULL' ? null : match[6],
      })
    }
  }

  return {
    rows,
    executed,
    prepare(sql: string) {
      const normalized = normalize(sql)
      return {
        async all() {
          handle(sql)
          if (/^SELECT name, applied_at FROM d1_migrations/.test(normalized)) {
            return { results: d1Rows.map((row) => ({ ...row })) }
          }
          if (!/^SELECT version/.test(normalized)) return { results: [] }
          return { results: rows.map((row) => ({ ...row })) }
        },
        async first() {
          handle(sql)
          return null
        },
        async run() {
          handle(sql)
          return { meta: { changes: 0, last_row_id: 0 } }
        },
        bind() {
          throw new Error('not used')
        },
      }
    },
    async executeSql(sql: string) {
      for (const statement of splitSql(sql)) handle(statement)
    },
  }
}

describe('migration discovery', () => {
  it('discovers migrations in version order with content checksums', async () => {
    const migrations = await discoverMigrations(migrationsDir)

    expect(migrations.map((migration) => migration.version)).toEqual(['0001', '0002', '0003', '0004'])
    expect(migrations.map((migration) => migration.file)).toEqual([
      '0001_initial_schema.sql',
      '0002_auth_rate_limits.sql',
      '0003_comment_feedback.sql',
      '0004_video_upload.sql',
    ])
    for (const migration of migrations) {
      const sql = await readFile(path.join(migrationsDir, migration.file), 'utf8')
      expect(migration.checksum).toBe(sha256(sql))
    }
  })

  it('splits SQL statements and strips comments', () => {
    expect(splitSql('-- note\nCREATE TABLE x (id INTEGER); /* block */ INSERT INTO x VALUES (1);'))
      .toEqual(['CREATE TABLE x (id INTEGER)', 'INSERT INTO x VALUES (1)'])
  })
})

describe('migration planner', () => {
  it('marks all discovered migrations pending on a fresh database', () => {
    const plan = planMigrations([], [
      { version: '0001' },
      { version: '0002' },
    ] as any)

    expect(plan.pending.map((migration: any) => migration.version)).toEqual(['0001', '0002'])
    expect(plan.applied).toEqual([])
    expect(plan.checksumMismatches).toEqual([])
    expect(plan.failed).toEqual([])
    expect(plan.unknown).toEqual([])
  })

  it('flags checksum mismatches, failed migrations, and unknown versions', () => {
    const plan = planMigrations([
      { version: '0001', checksum: 'changed', status: 'applied' },
      { version: '0002', checksum: 'ok', status: 'failed', error: 'boom' },
      { version: '0099', checksum: 'x', status: 'applied' },
    ], [
      { version: '0001', checksum: 'expected' },
      { version: '0002', checksum: 'ok' },
    ] as any)

    expect(plan.checksumMismatches).toEqual([{ version: '0001', expected: 'expected', actual: 'changed' }])
    expect(plan.failed).toHaveLength(1)
    expect(plan.unknown).toHaveLength(1)
  })

  it('renders an atomic migration script with tracking', () => {
    const sql = renderMigrationSql(
      { version: '0001', name: 'initial_schema', checksum: 'abc', sql: 'CREATE TABLE users (id INTEGER);' } as any,
      '2026-11-19T00:00:00.000Z',
    )

    expect(sql).toContain('BEGIN TRANSACTION;')
    expect(sql).toContain('CREATE TABLE users (id INTEGER);')
    expect(sql).toContain("VALUES ('0001', 'initial_schema', 'abc', '2026-11-19T00:00:00.000Z', 'applied', NULL)")
    expect(sql).toContain('COMMIT;')
  })

  it('omits SQL transaction wrappers when D1 API mode is requested', () => {
    const sql = renderMigrationSql(
      { version: '0001', name: 'initial_schema', checksum: 'abc', sql: 'CREATE TABLE users (id INTEGER);' } as any,
      '2026-11-19T00:00:00.000Z',
      { transaction: false },
    )

    expect(sql).not.toContain('BEGIN TRANSACTION')
    expect(sql).not.toContain('COMMIT')
    expect(sql).toContain('CREATE TABLE users (id INTEGER);')
  })
})

describe('Wrangler d1_migrations reconciliation', () => {
  const d1Rows = [
    { name: '0001_initial_schema.sql', applied_at: '2026-11-14 10:01:41' },
    { name: '0002_auth_rate_limits.sql', applied_at: '2026-11-14 10:01:41' },
    { name: '0003_comment_feedback.sql', applied_at: '2026-11-14 10:01:41' },
    { name: '0004_video_upload.sql', applied_at: '2026-11-14 10:01:41' },
  ]

  it('treats d1_migrations entries as applied and marks them for backfill', () => {
    const plan = planMigrations(d1Rows.map((row) => ({
      version: row.name.slice(0, 4),
      name: row.name.slice(5, -4),
      checksum: null,
      applied_at: row.applied_at,
      status: 'applied',
      error: null,
      source: 'd1_migrations',
    })), [
      { version: '0001', checksum: 'a' },
      { version: '0002', checksum: 'b' },
      { version: '0003', checksum: 'c' },
      { version: '0004', checksum: 'd' },
    ] as any)

    expect(plan.pending).toEqual([])
    expect(plan.legacyBackfill.map((row: any) => row.version)).toEqual(['0001', '0002', '0003', '0004'])
    expect(plan.checksumMismatches).toEqual([])
  })

  it('deduplicates applied versions after backfill', () => {
    const versions = ['0001', '0002', '0003', '0004']
    const legacy = versions.map((version) => ({
      version,
      checksum: null,
      applied_at: '2026-11-14 10:01:41',
      status: 'applied',
      source: 'd1_migrations',
    }))
    const tracked = versions.map((version) => ({
      version,
      checksum: 'abc',
      applied_at: '2026-11-14 10:01:41',
      status: 'applied',
      source: 'lantern',
    }))

    const plan = planMigrations([...legacy, ...tracked], versions.map((version) => ({ version, checksum: 'abc' })) as any)

    expect(plan.applied).toHaveLength(4)
    expect(plan.legacyBackfill).toEqual([])
  })

  it('dry-runs a backfill without replaying existing DDL', async () => {
    const migrations = await discoverMigrations(migrationsDir)
    const db = createMigrationDb([], d1Rows)

    const result = await applyMigrations(db, migrations, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.pending).toEqual([])
    expect(result.legacyBackfill).toEqual(['0001', '0002', '0003', '0004'])
    expect(result.backfillSql).toContain('BEGIN TRANSACTION;')
    expect(result.backfillSql).toContain("VALUES ('0001', 'initial_schema'")
    expect(db.executed.some((sql) => sql.startsWith('CREATE TABLE users'))).toBe(false)
  })

  it('backfills checksum rows once and stays idempotent', async () => {
    const migrations = await discoverMigrations(migrationsDir)
    const db = createMigrationDb([], d1Rows)

    const first = await applyMigrations(db, migrations, { now: () => '2026-11-19T00:00:00.000Z' })
    expect(first.applied).toEqual([])
    expect(first.backfilled).toEqual(['0001', '0002', '0003', '0004'])
    expect(db.rows).toHaveLength(4)
    expect(db.rows[0].applied_at).toBe('2026-11-14 10:01:41')
    expect(db.rows.every((row) => row.checksum.length === 64)).toBe(true)
    expect(db.executed.some((sql) => sql.startsWith('CREATE TABLE users'))).toBe(false)

    const second = await applyMigrations(db, migrations, { now: () => '2026-11-19T00:00:00.000Z' })
    expect(second.backfilled).toEqual([])
    expect(second.applied).toEqual([])
    expect(db.rows).toHaveLength(4)
  })
})

describe('migration execution', () => {
  it('applies every migration once and records applied versions', async () => {
    const migrations = await discoverMigrations(migrationsDir)
    const db = createMigrationDb()

    const result = await applyMigrations(db, migrations, { now: () => '2026-11-19T00:00:00.000Z' })

    expect(result.dryRun).toBe(false)
    expect(result.applied.map((item: any) => item.version)).toEqual(['0001', '0002', '0003', '0004'])
    expect(db.rows.map((row) => row.version)).toEqual(['0001', '0002', '0003', '0004'])
    expect(db.rows.every((row) => row.status === 'applied')).toBe(true)
    expect(db.executed.some((sql) => sql.startsWith('CREATE TABLE users'))).toBe(true)
    expect(db.executed.some((sql) => sql.includes('ALTER TABLE works ADD COLUMN video_path TEXT'))).toBe(true)
  })

  it('is idempotent when rerun', async () => {
    const migrations = await discoverMigrations(migrationsDir)
    const db = createMigrationDb()

    await applyMigrations(db, migrations)
    const second = await applyMigrations(db, migrations)

    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(['0001', '0002', '0003', '0004'])
    expect(db.executed.filter((sql) => sql.startsWith('CREATE TABLE users'))).toHaveLength(1)
  })

  it('does not write in dry-run mode', async () => {
    const migrations = await discoverMigrations(migrationsDir)
    const db = createMigrationDb()

    const result = await applyMigrations(db, migrations, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.pending).toEqual(['0001', '0002', '0003', '0004'])
    expect(result.sql).toHaveLength(4)
    expect(result.sql[0]).toContain('BEGIN TRANSACTION;')
    expect(db.rows).toEqual([])
    expect(db.executed.some((sql) => sql.startsWith('CREATE TABLE users'))).toBe(false)
  })

  it('refuses inconsistent migration state without applying anything', async () => {
    const migrations = await discoverMigrations(migrationsDir)
    const db = createMigrationDb([{
      version: '0001',
      name: 'initial_schema',
      checksum: 'stale-checksum',
      applied_at: '2026-11-18T00:00:00.000Z',
      status: 'applied',
      error: null,
    }])

    await expect(applyMigrations(db, migrations)).rejects.toBeInstanceOf(MigrationStateError)
    expect(db.executed.some((sql) => sql.startsWith('CREATE TABLE users'))).toBe(false)
    expect(db.rows).toHaveLength(1)
  })
})

describe('migration target guard', () => {
  it('always refuses production and unknown remote targets', () => {
    expect(() => assertAllowedMigrationTarget({ database: PRODUCTION_BINDING })).toThrow(/Refusing to migrate production/)
    expect(() => assertAllowedMigrationTarget({ database: 'lantern-db' })).toThrow(/Refusing to migrate production/)
    expect(() => assertAllowedMigrationTarget({ database: 'mystery-db', remote: true })).toThrow(/Only .* may be migrated remotely/)
  })

  it('allows local staging and explicitly confirmed remote staging', () => {
    expect(() => assertAllowedMigrationTarget({ database: STAGING_BINDING })).not.toThrow()
    expect(() => assertAllowedMigrationTarget({ database: 'lantern-staging-db', remote: true })).not.toThrow()
  })
})
