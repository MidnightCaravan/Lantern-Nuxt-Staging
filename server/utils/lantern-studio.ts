import { createError, getQuery } from 'h3'
import { getLanternDatabase, getLanternDatabaseForSession, lanternMediaUrl } from './lantern-public'
import { getLanternSessionIdentity } from './lantern-auth'

export type StudioIdentity = { userId: number; database: 'production' | 'staging' }
export type StudioDb = any

export async function requireStudioIdentity(event: any): Promise<StudioIdentity> {
  const identity = await getLanternSessionIdentity(event)
  if (!identity || !Number.isSafeInteger(Number(identity.userId)) || Number(identity.userId) <= 0) {
    throw createError({ statusCode: 401, statusMessage: 'Please log in to continue.' })
  }
  return { userId: Number(identity.userId), database: identity.database === 'staging' ? 'staging' : 'production' }
}

export function studioDb(event: any, identity: StudioIdentity): StudioDb {
  return getLanternDatabaseForSession(event, identity.database)
}

export function productionDb(event: any): StudioDb {
  return getLanternDatabase(event)
}

export function assertStudioWritable(identity: StudioIdentity): void {
  if (identity.database !== 'staging') {
    throw createError({ statusCode: 409, statusMessage: 'Production content is read-only in this Nuxt staging build.' })
  }
}

export function studioEnv(event: any): Record<string, any> {
  return event?.req?.runtime?.cloudflare?.env
    ?? event?.context?.cloudflare?.env
    ?? event?.context?.nitro?.env
    ?? {}
}

export function studioBucket(event: any): any {
  const bucket = studioEnv(event).lantern_staging_media
  if (!bucket) throw createError({ statusCode: 503, statusMessage: 'Staging media storage is not connected.' })
  return bucket
}

export async function ownedStudioWork(event: any, identity: StudioIdentity, workId: number, type?: string) {
  const db = studioDb(event, identity)
  const row = type
    ? await db.prepare(`SELECT * FROM works WHERE id = ? AND creator_id = ? AND type = ? LIMIT 1`).bind(workId, identity.userId, type).first<any>()
    : await db.prepare(`SELECT * FROM works WHERE id = ? AND creator_id = ? LIMIT 1`).bind(workId, identity.userId).first<any>()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Work not found.' })
  return { db, work: row }
}

export async function ownedStudioChapter(event: any, identity: StudioIdentity, chapterId: number) {
  const db = studioDb(event, identity)
  const chapter = await db.prepare(`
    SELECT chapters.*, works.creator_id, works.title AS work_title, works.type AS work_type
    FROM chapters JOIN works ON works.id = chapters.work_id
    WHERE chapters.id = ? AND works.creator_id = ? AND works.type = 'Novel'
    LIMIT 1
  `).bind(chapterId, identity.userId).first<any>()
  if (!chapter) throw createError({ statusCode: 404, statusMessage: 'Chapter not found.' })
  return { db, chapter }
}

export function studioNow(): string { return new Date().toISOString() }


export async function studioPublicContext(event: any): Promise<{ db: any; staging: boolean }> {
  const requestedSource = getQuery(event).source
  const identity = await getLanternSessionIdentity(event)
  const source = String(requestedSource ?? (identity?.database === 'staging' ? 'staging' : 'production')).trim().toLowerCase()
  if (source === 'staging') {
    if (identity?.database !== 'staging') {
      throw createError({ statusCode: 404, statusMessage: 'This staging preview is not available.' })
    }
    return { db: getLanternDatabaseForSession(event, 'staging'), staging: true }
  }
  if (source !== 'production') throw createError({ statusCode: 400, statusMessage: 'Invalid content source.' })
  return { db: getLanternDatabase(event), staging: false }
}

export function studioPublicMediaUrl(value: unknown, staging: boolean): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  const raw = value.trim()
  if (/^https?:\/\//i.test(raw)) return raw
  const key = raw.replace(/^\/media\//, '').replace(/^\//, '')
  if (!key) return ''
  return staging ? `/media/${key}` : lanternMediaUrl(raw)
}
