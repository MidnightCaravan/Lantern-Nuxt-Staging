import { createError, getHeader, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { getLanternDatabase, getLanternDatabaseForSession } from '../../utils/lantern-public'
import { getLanternSessionIdentity } from '../../utils/lantern-auth'
import { studioEnv } from '../../utils/lantern-studio'

const TYPES: Record<string,string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime' }
function parseRange(header: string, size: number): { start:number; end:number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  let start = 0, end = size - 1
  if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
  else { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) return null; start = Math.max(size - suffix, 0) }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null
  return { start, end }
}

export default defineEventHandler(async (event) => {
  const rawKey = String(getRouterParam(event, 'key') ?? '')
  const key = rawKey.replace(/^\/+/, '')
  if (!key || key.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
  const extension = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : ''
  const contentType = TYPES[extension] || 'application/octet-stream'
  const identity = await getLanternSessionIdentity(event)
  const env = studioEnv(event)
  let bucket: any = env.lantern_media
  let stagingObject = false
  // Staging objects are only served to the account that owns a staging reference.
  if (identity?.database === 'staging' && env.lantern_staging_media) {
    const db = getLanternDatabaseForSession(event, 'staging')
    const ref = await db.prepare(`
      SELECT 1 AS found FROM works WHERE (creator_id = ? OR status = 'published') AND (
        cover = ? OR cover = ? OR video_path = ? OR video_path = ?
      ) LIMIT 1
    `).bind(Number(identity.userId), `/media/${key}`, key, `/media/${key}`, key).first<any>()
    const page = await db.prepare(`
      SELECT 1 AS found FROM comic_pages p JOIN comic_episodes e ON e.id = p.episode_id JOIN works w ON w.id = e.work_id
      WHERE (w.creator_id = ? OR (w.status = 'published' AND e.status = 'published')) AND p.image_path = ? LIMIT 1
    `).bind(Number(identity.userId), key).first<any>()
    if (ref || page) { bucket = env.lantern_staging_media; stagingObject = true }
  }
  if (!bucket) throw createError({ statusCode: 503, statusMessage: 'Media storage is not available.' })
  let object: any
  let totalSize: number | null = null
  const rangeHeader = getHeader(event, 'range')
  if (contentType.startsWith('video/') && rangeHeader) {
    const metadata = await bucket.head(key)
    if (!metadata) throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
    totalSize = Number(metadata.size)
    const range = parseRange(rangeHeader, totalSize)
    if (!range) {
      setResponseHeader(event, 'Content-Range', `bytes */${totalSize}`)
      throw createError({ statusCode: 416, statusMessage: 'Range not satisfiable.' })
    }
    object = await bucket.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } })
    if (!object) throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
    setResponseStatus(event, 206)
    setResponseHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`)
    setResponseHeader(event, 'Content-Length', String(range.end - range.start + 1))
  } else {
    object = await bucket.get(key)
    if (!object) throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
    if (contentType.startsWith('video/')) {
      totalSize = Number(object.size ?? 0)
      setResponseHeader(event, 'Accept-Ranges', 'bytes')
      if (totalSize > 0) setResponseHeader(event, 'Content-Length', String(totalSize))
    }
  }
  setResponseHeader(event, 'Content-Type', object.httpMetadata?.contentType || contentType)
  setResponseHeader(event, 'Cache-Control', stagingObject ? 'private, no-store' : 'public, max-age=31536000')
  if (contentType.startsWith('video/')) setResponseHeader(event, 'Accept-Ranges', 'bytes')
  return object.body
})
