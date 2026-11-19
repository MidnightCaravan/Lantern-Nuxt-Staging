import { createError } from 'h3'
import { getLanternDatabaseForSession, lanternMediaUrl } from './lantern-public'
import { getLanternSessionIdentity } from './lantern-auth'

export type LanternComicIdentity = {
  userId: number
  database: 'production' | 'staging'
}

export async function requireComicIdentity(event: any): Promise<LanternComicIdentity> {
  const identity = await getLanternSessionIdentity(event)
  if (!identity) {
    throw createError({ statusCode: 401, statusMessage: 'Please log in to manage this comic.' })
  }
  return identity
}

export function comicDatabase(event: any, identity: LanternComicIdentity) {
  return getLanternDatabaseForSession(event, identity.database)
}

export function assertComicWritable(identity: LanternComicIdentity): void {
  if (identity.database !== 'staging') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Production comics are read-only in this Nuxt staging build.',
    })
  }
}

export function comicStagingBucket(event: any) {
  const env = event?.req?.runtime?.cloudflare?.env
    ?? event?.context?.cloudflare?.env
    ?? event?.context?.nitro?.env
  const bucket = env?.lantern_staging_media
  if (!bucket) {
    throw createError({ statusCode: 503, statusMessage: 'Staging comic storage is not connected.' })
  }
  return bucket
}

export async function ownedComicWork(event: any, identity: LanternComicIdentity, workId: number) {
  const db = comicDatabase(event, identity)
  const work = await db.prepare(`
    SELECT id, creator_id, title, description, type, status, cover, created_at, updated_at
    FROM works
    WHERE id = ? AND creator_id = ? AND type = 'Comic'
    LIMIT 1
  `).bind(workId, identity.userId).first<any>()
  if (!work) throw createError({ statusCode: 404, statusMessage: 'Comic not found.' })
  return { db, work }
}

export async function ownedComicEpisode(event: any, identity: LanternComicIdentity, episodeId: number) {
  const db = comicDatabase(event, identity)
  const episode = await db.prepare(`
    SELECT
      comic_episodes.id,
      comic_episodes.work_id,
      comic_episodes.episode_number,
      comic_episodes.title,
      comic_episodes.status,
      comic_episodes.created_at,
      comic_episodes.updated_at,
      works.creator_id,
      works.title AS work_title,
      works.description AS work_description,
      works.status AS work_status
    FROM comic_episodes
    JOIN works ON works.id = comic_episodes.work_id
    WHERE comic_episodes.id = ? AND works.creator_id = ? AND works.type = 'Comic'
    LIMIT 1
  `).bind(episodeId, identity.userId).first<any>()
  if (!episode) throw createError({ statusCode: 404, statusMessage: 'Comic episode not found.' })
  return { db, episode }
}

export function comicImageUrl(identity: LanternComicIdentity, page: any): string | null {
  if (identity.database === 'staging') return `/api/comic/pages/${Number(page.id)}/media`
  return lanternMediaUrl(page.image_path)
}

export function comicNow(): string {
  return new Date().toISOString()
}
