import { createError } from 'h3'
import { getLanternAuthEnv } from './lantern-auth'
import {
  getLanternDatabase,
  getLanternStagingDatabase,
  getLanternStagingMediaBucket,
} from './lantern-public'

export const PRODUCTION_WRITE_FLAG = 'LANTERN_ENABLE_PRODUCTION_WRITES'
export const ANONYMOUS_WRITE_TARGET = 'LANTERN_ANONYMOUS_WRITE_DATABASE'

export type MutationDatabase = 'production' | 'staging'

export type MutationTarget = {
  database: MutationDatabase
  db: any
  media: any
}

const DEFAULT_DISABLED_MESSAGE = 'Production writes are disabled in this environment.'

/** Explicit true only. Missing, false, 1, TRUE or any other value stays disabled. */
export function isProductionWritesEnabled(event: any): boolean {
  const value = getLanternAuthEnv(event)[PRODUCTION_WRITE_FLAG]
  return value === true || value === 'true'
}

export function assertProductionWritesEnabled(
  event: any,
  statusMessage: string = DEFAULT_DISABLED_MESSAGE,
): void {
  if (!isProductionWritesEnabled(event)) {
    throw createError({ statusCode: 409, statusMessage })
  }
}

export function assertMutationDatabase(value: unknown): MutationDatabase {
  if (value !== 'production' && value !== 'staging') {
    throw createError({ statusCode: 403, statusMessage: 'The mutation environment is invalid.' })
  }
  return value
}

/** D1-only selection for mutations that do not need R2. */
export function getMutationDatabase(
  event: any,
  requestedDatabase: unknown,
  disabledMessage: string = DEFAULT_DISABLED_MESSAGE,
): any {
  const database = assertMutationDatabase(requestedDatabase)
  if (database === 'production') {
    assertProductionWritesEnabled(event, disabledMessage)
    return getLanternDatabase(event)
  }
  return getLanternStagingDatabase(event)
}

function getProductionMediaBucket(event: any): any {
  const bucket = getLanternAuthEnv(event).lantern_media
  if (!bucket) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Lantern production media storage is not connected to this Nuxt session.',
    })
  }
  return bucket
}

/** R2-only selection for mutations that do not need the D1 binding. */
export function getMutationMediaBucket(event: any, requestedDatabase: unknown): any {
  const database = assertMutationDatabase(requestedDatabase)
  if (database === 'production') {
    assertProductionWritesEnabled(event)
    return getProductionMediaBucket(event)
  }
  return getLanternStagingMediaBucket(event)
}

/**
 * Resolve both D1 and R2 for one mutation. Production requires the explicit
 * server-side feature flag; staging never consults that flag. No fallback is
 * attempted if the requested binding is missing.
 */
export function resolveMutationTarget(
  event: any,
  requestedDatabase: unknown,
  disabledMessage: string = DEFAULT_DISABLED_MESSAGE,
): MutationTarget {
  const database = assertMutationDatabase(requestedDatabase)
  if (database === 'production') {
    assertProductionWritesEnabled(event, disabledMessage)
    return {
      database,
      db: getLanternDatabase(event),
      media: getProductionMediaBucket(event),
    }
  }
  return {
    database,
    db: getLanternStagingDatabase(event),
    media: getLanternStagingMediaBucket(event),
  }
}

function getAnonymousDatabaseName(event: any): MutationDatabase {
  const configured = getLanternAuthEnv(event)[ANONYMOUS_WRITE_TARGET]
  if (configured !== 'production' && configured !== 'staging') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Anonymous account storage is not configured for this Nuxt session.',
    })
  }
  return configured
}

/**
 * Anonymous account flows have no session identity. Their D1 write target comes
 * only from the explicit server-side environment setting; a missing or invalid
 * setting fails closed instead of silently choosing either database.
 */
export function getAnonymousMutationDatabase(event: any): any {
  return getMutationDatabase(event, getAnonymousDatabaseName(event))
}

/** Full target helper retained for anonymous mutations that also need media. */
export function getAnonymousMutationTarget(event: any): MutationTarget {
  return resolveMutationTarget(event, getAnonymousDatabaseName(event))
}

/** Login is a read plus a durable rate-limit write. A missing value keeps the
 * legacy production default; an explicit invalid value fails closed. */
export function getLoginMutationDatabase(event: any, requestedDatabase: unknown): { database: MutationDatabase; db: any } {
  if (requestedDatabase !== undefined && requestedDatabase !== null && requestedDatabase !== ''
    && requestedDatabase !== 'staging' && requestedDatabase !== 'production') {
    throw createError({ statusCode: 403, statusMessage: 'The requested account database is invalid.' })
  }
  const database: MutationDatabase = requestedDatabase === 'staging' ? 'staging' : 'production'
  return {
    database,
    db: getMutationDatabase(
      event,
      database,
      'Production accounts are read-only in this Nuxt staging build.',
    ),
  }
}
