import { createError, getRouterParam, readBody, setResponseStatus } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket } from '../../../../../utils/lantern-studio'

const TYPES: Record<string,string> = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime' }
const MAX_BYTES = 2_000_000_000
const PART_SIZE = 16 * 1024 * 1024
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const body = await readBody<{ extension?: unknown; size?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const { work } = await ownedStudioWork(event, identity, workId, 'Video')
  const extension = typeof body?.extension === 'string' ? body.extension.toLowerCase().replace(/^\./,'') : ''
  const size = Number(body?.size)
  if (!TYPES[extension]) throw createError({ statusCode: 400, statusMessage: 'Unsupported video format. Use MP4, WebM, or MOV.' })
  if (!Number.isSafeInteger(size) || size < 1) throw createError({ statusCode: 400, statusMessage: 'A valid video file size is required.' })
  if (size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Videos must be 2 GB or smaller.' })
  const key = `uploads/videos/${workId}/video-${crypto.randomUUID().replace(/-/g,'').slice(0,24)}.${extension}`
  let upload: any
  try { upload = await studioBucket(event).createMultipartUpload(key, { httpMetadata: { contentType: TYPES[extension] } }) }
  catch (error) { console.error('Could not start R2 multipart video upload:', error); throw createError({ statusCode: 502, statusMessage: 'Could not start video upload. Please try again.' }) }
  setResponseStatus(event, 201)
  return { key, uploadId: upload.uploadId, partSize: PART_SIZE, maxBytes: MAX_BYTES }
})
