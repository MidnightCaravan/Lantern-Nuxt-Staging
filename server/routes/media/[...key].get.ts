import { createError, getHeader, getMethod, getRequestHeaders, getRequestURL, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'

// Flask passes the raw request.headers object as R2's `range` for non-video
// objects (worker.py:1154-1157). R2 reads that object's `length` property —
// the number of request headers — and serves that many leading bytes as a
// plain 200 response (no Content-Range). Verified live against the genuine
// staging objects through the Flask media-origin Service Binding.
function requestHeaderCount(event: any): number {
  const headers: any = getRequestHeaders(event)
  if (typeof headers?.size === 'number') return headers.size
  if (typeof headers?.keys === 'function') return [...headers.keys()].length
  return Object.keys(headers ?? {}).length
}
import {
  getConfiguredPublicReadDatabase,
  getLanternDatabaseForSession,
  getLanternStagingDatabase,
} from '../../utils/lantern-public'
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

// Build the request forwarded to the independent Flask media origin.
// In production the incoming Request already has the canonical /media/<key>
// URL and is forwarded unchanged. The constructed form covers embedded/Nitro
// test contexts where the route is mounted under a different path.
function buildMediaOriginRequest(event: any, rawKey: string): Request {
  const incoming = event?.request
  if (incoming instanceof Request) {
    try { if (new URL(incoming.url).pathname.startsWith('/media/')) return incoming } catch {}
  }
  const requestUrl = getRequestURL(event)
  const url = new URL(`/media/${rawKey}`, requestUrl.origin)
  requestUrl.searchParams.forEach((value, name) => url.searchParams.append(name, value))
  return new Request(url.toString(), {
    method: getMethod(event) || 'GET',
    headers: getRequestHeaders(event) as HeadersInit,
  })
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

  // A staging deployment serves published staging media anonymously. The key
  // must still be referenced by a published staging work or comic page, so a
  // guessed key cannot read arbitrary objects from the staging bucket.
  if (!stagingObject && identity?.database !== 'production'
    && getConfiguredPublicReadDatabase(event) === 'staging' && env.lantern_staging_media) {
    const db = getLanternStagingDatabase(event)
    const ref = await db.prepare(`
      SELECT 1 AS found FROM works WHERE status = 'published' AND (
        cover = ? OR cover = ? OR video_path = ? OR video_path = ?
      ) LIMIT 1
    `).bind(`/media/${key}`, key, `/media/${key}`, key).first<any>()
    const page = await db.prepare(`
      SELECT 1 AS found FROM comic_pages p
      JOIN comic_episodes e ON e.id = p.episode_id
      JOIN works w ON w.id = e.work_id
      WHERE w.status = 'published' AND e.status = 'published' AND p.image_path = ? LIMIT 1
    `).bind(key).first<any>()
    if (ref || page) { bucket = env.lantern_staging_media; stagingObject = true }
  }

  // A1 production-style media path. When the Service Binding is present,
  // production media is answered verbatim by the Flask media origin: status,
  // body, headers and streaming are the Worker's, not re-created here.
  // Staging-preview objects keep their existing local R2 behavior above/below.
  // If no binding is configured, the previous direct-R2 behavior is preserved.
  if (!stagingObject && env.LANTERN_MEDIA_ORIGIN && typeof env.LANTERN_MEDIA_ORIGIN.fetch === 'function') {
    return await env.LANTERN_MEDIA_ORIGIN.fetch(buildMediaOriginRequest(event, rawKey))
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
    const isVideo = contentType.startsWith('video/')
    // Match Flask's verbatim non-video Range branch: the request header count
    // becomes R2's range length, so the first N bytes are served with 200.
    const flaskRangeLength = !isVideo && rangeHeader ? requestHeaderCount(event) : 0
    if (flaskRangeLength > 0) {
      const metadata = await bucket.head(key)
      totalSize = Number(metadata?.size ?? 0)
    }
    const rangeLength = flaskRangeLength > 0 ? Math.min(flaskRangeLength, totalSize ?? 0) : 0
    object = rangeLength > 0
      ? await bucket.get(key, { range: { offset: 0, length: rangeLength } })
      : await bucket.get(key)
    if (!object) throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
    if (isVideo) {
      totalSize = Number(object.size ?? 0)
      setResponseHeader(event, 'Accept-Ranges', 'bytes')
      if (totalSize > 0) setResponseHeader(event, 'Content-Length', String(totalSize))
    } else if (rangeLength > 0) {
      // The runtime derives Flask's Content-Length from the ranged R2 stream.
      setResponseHeader(event, 'Content-Length', String(rangeLength))
    }
  }
  // The Flask Worker always derives the response type from the object key
  // (worker.py:1058-1071), not from R2 metadata.
  setResponseHeader(event, 'Content-Type', contentType)
  setResponseHeader(event, 'Cache-Control', stagingObject ? 'private, no-store' : 'public, max-age=31536000')
  if (contentType.startsWith('video/')) setResponseHeader(event, 'Accept-Ranges', 'bytes')
  return object.body
})
