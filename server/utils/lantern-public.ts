import { createError } from 'h3'
import { getLanternAuthEnv } from './lantern-auth'

const LEGACY_BASE = 'https://lantern.midnightcaravans.workers.dev'

export const PUBLIC_READ_TARGET = 'LANTERN_PUBLIC_READ_DATABASE'
export type PublicReadDatabase = 'production' | 'staging'

function getLanternEnv(event: any) {
  return event?.req?.runtime?.cloudflare?.env
    ?? event?.context?.cloudflare?.env
    ?? event?.context?.nitro?.env
    ?? {}
}

/**
 * Anonymous public reads default to production for the release Worker. A
 * staging deployment opts in explicitly. Missing values keep the legacy
 * behavior; invalid values fail closed instead of silently choosing a source.
 */
export function getConfiguredPublicReadDatabase(event: any): PublicReadDatabase {
  const configured = getLanternAuthEnv(event)[PUBLIC_READ_TARGET]
  if (configured === undefined || configured === null || configured === '') return 'production'
  if (configured === 'production' || configured === 'staging') return configured
  throw createError({
    statusCode: 503,
    statusMessage: 'Public content source is not configured for this Nuxt session.',
  })
}

export function getLanternPublicDatabase(event: any, requestedDatabase: PublicReadDatabase) {
  return requestedDatabase === 'staging'
    ? getLanternStagingDatabase(event)
    : getLanternDatabase(event)
}

export function getLanternDatabase(event: any) {
  const database = getLanternEnv(event).lantern_db
  if (!database) {
    throw createError({ statusCode: 503, statusMessage: 'Lantern production database is not connected to this Nuxt session.' })
  }
  return database
}

export function getLanternStagingDatabase(event: any) {
  const database = getLanternEnv(event).lantern_staging_db
  if (!database) {
    throw createError({ statusCode: 503, statusMessage: 'Lantern staging database is not connected. Registration is unavailable.' })
  }
  return database
}

export function getLanternDatabaseForSession(event: any, databaseName: 'production' | 'staging') {
  return databaseName === 'staging' ? getLanternStagingDatabase(event) : getLanternDatabase(event)
}

export function lanternMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const path = value.trim()
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/static/')) {
    return `${LEGACY_BASE}${path.split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/')}`
  }
  let key = path.replace(/^\/+/, '')
  if (key.startsWith('media/')) key = key.slice('media/'.length)
  if (key.startsWith('static/')) {
    return `${LEGACY_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
  return `${LEGACY_BASE}/media/${key.split('/').map(encodeURIComponent).join('/')}`
}

export function publicWork(row: any) {
  return {
    ...row,
    creatorName: row.display_name || row.username || 'Lantern Creator',
    coverUrl: lanternMediaUrl(row.cover),
    videoUrl: lanternMediaUrl(row.video_path),
  }
}


export function getLanternStagingMediaBucket(event: any) {
  const bucket = getLanternEnv(event).lantern_staging_media
  if (!bucket) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Lantern staging media storage is not connected.',
    })
  }
  return bucket
}
