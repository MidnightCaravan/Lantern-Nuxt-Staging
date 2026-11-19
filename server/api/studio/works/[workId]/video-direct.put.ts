import { createError, getHeader, getRouterParam, readRawBody, setResponseStatus } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket, studioDb, studioNow } from '../../../../utils/lantern-studio'
const TYPES: Record<string,string> = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime' }
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const { db, work } = await ownedStudioWork(event, identity, workId, 'Video')
  const extension = (getHeader(event, 'x-lantern-extension') || '').toLowerCase().replace(/^\./,'')
  if (!TYPES[extension]) throw createError({ statusCode: 400, statusMessage: 'Unsupported video format. Use MP4, WebM, or MOV.' })
  const expectedSize = Number(getHeader(event, 'content-length') || getHeader(event, 'x-lantern-file-size'))
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1) throw createError({ statusCode: 411, statusMessage: 'Video size is required.' })
  if (expectedSize > 90_000_000) throw createError({ statusCode: 413, statusMessage: 'Videos must be 90 MB or smaller.' })
  const raw = await readRawBody(event, false)
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'The video file is empty.' })
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
  if (bytes.byteLength !== expectedSize) throw createError({ statusCode: 400, statusMessage: 'Video size does not match the request.' })
  const key = `uploads/videos/${workId}/video-${crypto.randomUUID().replace(/-/g,'').slice(0,24)}.${extension}`
  const bucket = studioBucket(event)
  try { await bucket.put(key, bytes, { httpMetadata: { contentType: TYPES[extension] } }) }
  catch (error) { console.error('Video upload to R2 failed:', error); throw createError({ statusCode: 502, statusMessage: 'Video upload failed. Please try again.' }) }
  const videoPath = `/media/${key}`
  await db.prepare('UPDATE works SET video_path = ?, updated_at = ? WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(videoPath, studioNow(), workId, identity.userId).run()
  const oldVideo = typeof work.video_path === 'string' ? work.video_path : ''
  const prefix = `/media/uploads/videos/${workId}/`
  if (oldVideo.startsWith(prefix)) { const oldKey = oldVideo.slice('/media/'.length); if (oldKey !== key) { try { await bucket.delete(oldKey) } catch (error) { console.error('New video saved but old video cleanup failed:', error) } } }
  setResponseStatus(event, 201)
  return { ok: true, videoPath }
})
