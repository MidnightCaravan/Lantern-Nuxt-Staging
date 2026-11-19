import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

// Seeds the LOCAL Wrangler D1 databases used by `wrangler dev` rehearsals.
// Never targets --remote. Production and remote staging are out of scope.
const root = process.cwd()
const migrations = readdirSync(path.join(root, 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()

if (!migrations.length) {
  console.error('No migrations found in migrations/.')
  process.exit(1)
}

for (const database of ['lantern-db', 'lantern-staging-db']) {
  for (const migration of migrations) {
    const file = path.join(root, 'migrations', migration)
    const result = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', database, '--local', '--cwd', '.output', '--file', file, '--yes'],
      { cwd: root, stdio: 'pipe', encoding: 'utf8' },
    )
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    if (result.status !== 0) {
      // Local rehearsal databases may already be seeded from a prior run.
      // Treat idempotent "already applied" SQLite errors as success.
      if (/already exists|duplicate column name/i.test(output)) {
        console.log(`  ${migration}: already applied to local ${database}`)
        continue
      }
      console.error(`Failed to seed ${database} with ${migration}:`)
      console.error(output)
      process.exit(result.status ?? 1)
    }
    console.log(`  ${migration}: applied to local ${database}`)
  }
  console.log(`Seeded local ${database} with ${migrations.length} migration(s).`)
}
