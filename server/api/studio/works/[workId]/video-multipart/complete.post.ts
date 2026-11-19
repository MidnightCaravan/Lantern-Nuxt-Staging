import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket, studioDb, studioNow } from '../../../../../utils/lantern-studio'
const MAX_BYTES = 2_000_000_000
const PART_SIZE = 16 * 1024 * 1024
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const body = await readBody<{ key?: unknown; uploadId?: unknown; size?: unknown; parts?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const { work } = await ownedStudioWork(event, identity, workId, 'Video')
  const key = typeof body?.key === 'string' ? body.key : ''
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId : ''
  const size = Number(body?.size)
  if (!new RegExp(`^uploads/videos/${workId}/video-[0-9a-f]{24}\\.(mp4|webm|mov)$`).test(key) || !uploadId || uploadId.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Invalid video upload reference.' })
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Invalid video size.' })
  const partCount = Math.ceil(size / PART_SIZE)
  if (!Array.isArray(body?.parts) || body.parts.length !== partCount) throw createError({ statusCode: 400, statusMessage: 'The video upload is incomplete. Please retry.' })
  const parts: Array<{partNumber:number;etag:string}> = []
  for (let i=0;i<body.parts.length;i++) {
    const item: any = body.parts[i]
    const partNumber = Number(item?.partNumber)
    const etag = item?.etag
    if (partNumber !== i+1 || typeof etag !== 'string' || !etag || etag.length > 256) throw createError({ statusCode: 400, statusMessage: 'Uploaded parts are missing or out of order.' })
    parts.push({ partNumber, etag })
  }
  const bucket = studioBucket(event)
  const oldVideo = typeof work.video_path === 'string' ? work.video_path : ''
  try {
    const upload = bucket.resumeMultipartUpload(key, uploadId)
    await upload.complete(parts as any)
  } catch (error) {
    console.error('R2 multipart video completion failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Could not finish assembling the video. Please retry.' })
  }
  const videoPath = `/media/${key}`
  const db = studioDb(event, identity)
  try {
    await db.prepare('UPDATE works SET video_path = ?, updated_at = ? WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(videoPath, studioNow(), workId, identity.userId).run()
    const saved = await db.prepare('SELECT video_path FROM works WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(workId, identity.userId).first<any>()
    if (saved?.video_path !== videoPath) throw new Error('D1 did not retain the new video path.')
  } catch (error) {
    const current = await db.prepare('SELECT video_path FROM works WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(workId, identity.userId).first<any>().catch(() => null)
    if (current?.video_path !== videoPath) {
      try { await bucket.delete(key) } catch {}
      throw createError({ statusCode: 500, statusMessage: 'Video uploaded but could not be saved. Please retry.' })
    }
    console.error('D1 reported an error after storing the video path:', error)
  }
  const expectedPrefix = `/media/uploads/videos/${workId}/`
  if (oldVideo.startsWith(expectedPrefix)) {
    const oldKey = oldVideo.slice('/media/'.length)
    if (oldKey !== key) { try { await bucket.delete(oldKey) } catch (error) { console.error('New video saved, but old R2 cleanup failed:', error) } }
  }
  return { ok: true, videoPath, message: 'Video uploaded.' }
})
