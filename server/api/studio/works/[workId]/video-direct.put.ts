import { createError, getHeader, getRequestWebStream, getRouterParam, setResponseStatus } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { parseFlaskInteger } from '../../../../utils/lantern-flask-integers'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioMutationBucket, studioDb, studioNow } from '../../../../utils/lantern-studio'
const TYPES: Record<string,string> = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime' }
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  assertStudioWritable(event, identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const extension = (getHeader(event, 'x-lantern-extension') || '').trim().toLowerCase().replace(/^\.+/, '')
  if (!TYPES[extension]) throw createError({ statusCode: 400, statusMessage: 'Unsupported video format. Use MP4, WebM, or MOV.' })
  // Flask validates the declared size in three distinct steps
  // (worker.py:785-800); preserve each status and message.
  const sizeHeader = getHeader(event, 'content-length') || getHeader(event, 'x-lantern-file-size')
  if (!sizeHeader) throw createError({ statusCode: 411, statusMessage: 'Video size is required.' })
  const expectedSize = parseFlaskInteger(sizeHeader)
  if (expectedSize === null) throw createError({ statusCode: 400, statusMessage: 'Invalid video size.' })
  if (expectedSize < 1) throw createError({ statusCode: 400, statusMessage: 'The video file is empty.' })
  if (expectedSize > 90_000_000) throw createError({ statusCode: 413, statusMessage: 'Videos must be 90 MB or smaller.' })
  // Flask runs the ownership query only after format/size validation
  // (worker.py:773-817), so a request with two faults reports the validation
  // error first. The canonical editor always sends valid values.
  const { db, work } = await ownedStudioWork(event, identity, workId, 'Video')
  // The Flask Worker streams request.body directly into R2 (worker.py:823-829)
  // and trusts the declared size rather than buffering and re-measuring it.
  const body = getRequestWebStream(event) ?? new ReadableStream<Uint8Array>({
    start(controller) { controller.close() },
  })
  const key = `uploads/videos/${workId}/video-${crypto.randomUUID().replace(/-/g,'').slice(0,24)}.${extension}`
  const bucket = studioMutationBucket(event, identity)
  try { await bucket.put(key, body, { httpMetadata: { contentType: TYPES[extension] } }) }
  catch (error) { console.error('Video upload to R2 failed:', error); throw createError({ statusCode: 502, statusMessage: 'Video upload failed. Please try again.' }) }
  const videoPath = `/media/${key}`
  // Flask deletes the newly written object if its D1 reference cannot be
  // saved (worker.py:849-855), so never leave an unreferenced video behind.
  try {
    await db.prepare('UPDATE works SET video_path = ?, updated_at = ? WHERE id = ? AND creator_id = ? AND type = \'Video\'').bind(videoPath, studioNow(), workId, identity.userId).run()
  } catch (error) {
    try { await bucket.delete(key) }
    catch (cleanupError) { console.error('Could not clean up the unreferenced replacement video:', cleanupError) }
    console.error('Video saved but its D1 reference could not be saved:', error)
    throw createError({ statusCode: 500, statusMessage: 'Video was uploaded but could not be saved. Please retry.' })
  }
  const oldVideo = typeof work.video_path === 'string' ? work.video_path : ''
  const prefix = `/media/uploads/videos/${workId}/`
  if (oldVideo.startsWith(prefix)) { const oldKey = oldVideo.slice('/media/'.length); if (oldKey !== key) { try { await bucket.delete(oldKey) } catch (error) { console.error('New video saved but old video cleanup failed:', error) } } }
  setResponseStatus(event, 201)
  return { ok: true, videoPath }
})
