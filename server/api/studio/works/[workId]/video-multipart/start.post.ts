import { createError, getRouterParam, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { parseFlaskInteger } from '../../../../../utils/lantern-flask-integers'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioMutationBucket } from '../../../../../utils/lantern-studio'

const TYPES: Record<string,string> = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime' }
const MAX_BYTES = 2_000_000_000
const PART_SIZE = 16 * 1024 * 1024
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const body = await readBody<{ extension?: unknown; size?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  const { work } = await ownedStudioWork(event, identity, workId, 'Video')
  // Flask uses .strip().lower().lstrip(".") and reports an empty file
  // separately from an unparseable size (worker.py:519-532).
  const extension = typeof body?.extension === 'string' ? body.extension.trim().toLowerCase().replace(/^\.+/, '') : ''
  const rawSize = body?.size
  const size = parseFlaskInteger(rawSize)
  if (!TYPES[extension]) throw createError({ statusCode: 400, statusMessage: 'Unsupported video format. Use MP4, WebM, or MOV.' })
  if (size === null) throw createError({ statusCode: 400, statusMessage: 'A valid video file size is required.' })
  if (size < 1) throw createError({ statusCode: 400, statusMessage: 'The video file is empty.' })
  if (size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Videos must be 2 GB or smaller.' })
  const key = `uploads/videos/${workId}/video-${crypto.randomUUID().replace(/-/g,'').slice(0,24)}.${extension}`
  let upload: any
  try { upload = await studioMutationBucket(event, identity).createMultipartUpload(key, { httpMetadata: { contentType: TYPES[extension] } }) }
  catch (error) { console.error('Could not start R2 multipart video upload:', error); throw createError({ statusCode: 502, statusMessage: 'Could not start video upload. Please try again.' }) }
  setResponseStatus(event, 201)
  // Flask marks upload-session metadata uncacheable (worker.py:543-547).
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { key, uploadId: upload.uploadId, partSize: PART_SIZE }
})
