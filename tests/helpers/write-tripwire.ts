/**
 * Production write tripwires for the Lantern migration isolation suite.
 *
 * These wrappers are deliberately fail-fast: any attempt to mutate the bound
 * production D1 database or production R2 bucket throws immediately. Reads are
 * delegated untouched, so handlers that legitimately read production data
 * (for example duplicate-account checks) remain testable.
 */
import type { FakeD1, FakeD1Statement } from './fake-d1'

const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|TRUNCATE)\b/i

export type WriteAttempt = {
  binding: string
  kind: 'd1' | 'r2'
  operation: string
  detail?: string
}

export type Tripwire = {
  attempts: () => WriteAttempt[]
  assertClean: () => void
}

const WRITE_R2_METHODS = new Set([
  'put',
  'delete',
  'createMultipartUpload',
  'resumeMultipartUpload',
  'write',
  'copy',
])

function record(attempts: WriteAttempt[], binding: string, kind: 'd1' | 'r2', operation: string, detail?: string): never {
  attempts.push({ binding, kind, operation, detail })
  throw new Error(`PRODUCTION WRITE TRIPPED: ${binding}.${operation}${detail ? ` (${detail})` : ''}`)
}

export function tripwireD1(database: FakeD1, binding: string): { database: FakeD1; tripwire: Tripwire } {
  const attempts: WriteAttempt[] = []

  function wrapStatement(statement: FakeD1Statement, sql: string): FakeD1Statement {
    const isWrite = WRITE_SQL.test(sql)
    const guard = (operation: string) => {
      if (isWrite) record(attempts, binding, 'd1', operation, sql.replace(/\s+/g, ' ').trim().slice(0, 160))
    }
    return {
      async first<T = any>() {
        guard('first')
        return statement.first<T>()
      },
      async all<T = any>() {
        guard('all')
        return statement.all<T>()
      },
      async run() {
        guard('run')
        return statement.run()
      },
      bind(...params: any[]) {
        return wrapStatement(statement.bind(...params), sql)
      },
    }
  }

  const wrapped: FakeD1 = {
    state: database.state,
    prepare(sql: string) {
      return wrapStatement(database.prepare(sql), sql)
    },
    async batch(statements: FakeD1Statement[]) {
      for (const statement of statements) {
        // Batch statements are already wrapped by prepare(); run() enforces
        // the write guard for each one.
        await statement.run()
      }
      return []
    },
  }

  return {
    database: wrapped,
    tripwire: {
      attempts: () => [...attempts],
      assertClean: () => {
        if (attempts.length) {
          throw new Error(`Production ${binding} received ${attempts.length} write attempt(s): ${JSON.stringify(attempts)}`)
        }
      },
    },
  }
}

export function tripwireR2(bucket: any, binding: string): { bucket: any; tripwire: Tripwire } {
  const attempts: WriteAttempt[] = []
  const wrapped: Record<string, any> = {}

  for (const key of Object.keys(bucket)) {
    const value = bucket[key]
    if (typeof value !== 'function' || !WRITE_R2_METHODS.has(key)) {
      wrapped[key] = value
      continue
    }
    wrapped[key] = (...args: any[]) => {
      record(attempts, binding, 'r2', key, typeof args[0] === 'string' ? args[0] : undefined)
    }
  }

  return {
    bucket: wrapped,
    tripwire: {
      attempts: () => [...attempts],
      assertClean: () => {
        if (attempts.length) {
          throw new Error(`Production ${binding} received ${attempts.length} write attempt(s): ${JSON.stringify(attempts)}`)
        }
      },
    },
  }
}

export function combineTripwires(...tripwires: Tripwire[]): Tripwire {
  return {
    attempts: () => tripwires.flatMap((tripwire) => tripwire.attempts()),
    assertClean: () => tripwires.forEach((tripwire) => tripwire.assertClean()),
  }
}
