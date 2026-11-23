import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { parseFlaskInteger, parseFlaskPartNumber } from '../../../../../utils/lantern-flask-integers'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioMutationBucket, studioDb, studioNow } from '../../../../../utils/lantern-studio'
const MAX_BYTES = 2_000_000_000
const PART_SIZE = 16 * 1024 * 1024
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const body = await readBody<{ key?: unknown; uploadId?: unknown; size?: unknown; parts?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  const { work } = await ownedStudioWork(event, identity, workId, 'Video')
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId.trim() : ''
  const size = parseFlaskInteger(body?.size)
  if (!new RegExp(`^uploads/videos/${workId}/video-[0-9a-f]{24}\\.(mp4|webm|mov)$`).test(key) || !uploadId || uploadId.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Invalid video upload reference.' })
  // Flask splits parse failure (400), empty file (400) and oversize (413)
  // into three distinct branches (worker.py:605-611).
  if (size === null) throw createError({ statusCode: 400, statusMessage: 'Invalid video size.' })
  if (size < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid video size.' })
  if (size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Invalid video size.' })
  const partCount = Math.ceil(size / PART_SIZE)
  // Flask reports an unparseable uploaded-parts value separately from a
  // correctly parsed list of the wrong length (worker.py:613-618).
  if (!Array.isArray(body?.parts)) throw createError({ statusCode: 400, statusMessage: 'Missing or invalid uploaded-parts list.' })
  if (body.parts.length !== partCount) throw createError({ statusCode: 400, statusMessage: 'The video upload is incomplete. Please retry.' })
  const parts: Array<{partNumber:number;etag:string}> = []
  for (let i=0;i<body.parts.length;i++) {
    const item: any = body.parts[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw createError({ statusCode: 400, statusMessage: 'Invalid uploaded-part entry.' })
    // Flask's int(item.get("partNumber", 0)) makes a missing number 0 and
    // truncates float JSON values; a non-numeric value (including a decimal
    // or exponent string, which Python int() rejects) is an invalid part
    // number (worker.py:621-631).
    const partNumber = parseFlaskPartNumber(item.partNumber ?? 0)
    if (partNumber === null) throw createError({ statusCode: 400, statusMessage: 'Invalid uploaded-part number.' })
    const etag = item.etag
    if (partNumber !== i+1 || typeof etag !== 'string' || !etag || etag.length > 256) throw createError({ statusCode: 400, statusMessage: 'Uploaded parts are missing or out of order.' })
    parts.push({ partNumber, etag })
  }
  const bucket = studioMutationBucket(event, identity)
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

  // Flask only re-reads the row inside its D1 error handler
  // (worker.py:682-737). A successful UPDATE must never trigger a second read
  // that could turn a committed upload into a 500.
  let updateFailed = false
  try {
    // Flask treats anything other than exactly one changed row as a failed
    // save and re-reads the row before deciding what happened
    // (worker.py:665-682).
    const result: any = await db.prepare('UPDATE works SET video_path = ?, updated_at = ? WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(videoPath, studioNow(), workId, identity.userId).run()
    const changedRows = result?.meta?.changes
    if (changedRows === undefined || changedRows === null || Number(changedRows) !== 1) {
      throw new Error(`Expected D1 to update exactly one video row; reported changes: ${String(changedRows)}`)
    }
  } catch (error) {
    updateFailed = true
    console.error('D1 reported an error after storing the video path:', error)
  }

  if (updateFailed) {
    let saved
    try {
      saved = await db.prepare('SELECT video_path FROM works WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(workId, identity.userId).first<any>()
    } catch (error) {
      console.error('Could not verify replacement video state in D1; preserving the completed R2 object:', error)
      throw createError({ statusCode: 500, statusMessage: 'Video upload outcome could not be verified. Refresh the page before retrying.' })
    }

    if (saved?.video_path !== videoPath) {
      try { await bucket.delete(key) }
      catch (error) { console.error('Could not clean up the unreferenced replacement video:', error) }
      throw createError({ statusCode: 500, statusMessage: 'Video upload completed but could not be saved. Please retry.' })
    }
    console.error('D1 reported an error, but the replacement video is referenced by the work; continuing cleanup.')
  }
  const expectedPrefix = `/media/uploads/videos/${workId}/`
  if (oldVideo.startsWith(expectedPrefix)) {
    const oldKey = oldVideo.slice('/media/'.length)
    if (oldKey !== key) { try { await bucket.delete(oldKey) } catch (error) { console.error('New video saved, but old R2 cleanup failed:', error) } }
  }
  return { ok: true, videoPath, message: 'Video uploaded.' }
})
