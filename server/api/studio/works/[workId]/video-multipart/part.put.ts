import { createError, getHeader, getRequestWebStream, getRouterParam, setResponseHeader } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { parseFlaskInteger } from '../../../../../utils/lantern-flask-integers'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioMutationBucket } from '../../../../../utils/lantern-studio'
const MAX_BYTES = 2_000_000_000
const PART_SIZE = 16 * 1024 * 1024
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  assertStudioWritable(event, identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  await ownedStudioWork(event, identity, workId, 'Video')
  // Flask trims both reference headers before validating them (worker.py:549-553).
  const key = (getHeader(event, 'x-lantern-video-key') || '').trim()
  const uploadId = (getHeader(event, 'x-lantern-upload-id') || '').trim()
  if (!new RegExp(`^uploads/videos/${workId}/video-[0-9a-f]{24}\\.(mp4|webm|mov)$`).test(key) || !uploadId || uploadId.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Invalid video upload reference.' })
  // Flask parses both headers first and reports malformed metadata separately
  // from an invalid size (worker.py:555-565).
  const size = parseFlaskInteger(getHeader(event, 'x-lantern-file-size'))
  const partNumber = parseFlaskInteger(getHeader(event, 'x-lantern-part-number'))
  if (size === null || partNumber === null) throw createError({ statusCode: 400, statusMessage: 'Invalid video part metadata.' })
  if (size < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid video size.' })
  if (size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Invalid video size.' })
  const partCount = Math.ceil(size / PART_SIZE)
  if (partNumber < 1 || partNumber > partCount) throw createError({ statusCode: 400, statusMessage: 'Invalid video part number.' })
  const expectedBytes = Math.min(PART_SIZE, size - ((partNumber - 1) * PART_SIZE))
  // The Flask Worker requires a declared Content-Length and returns 411 when
  // it is missing (worker.py:571-582).
  const declaredLengthHeader = getHeader(event, 'content-length')
  const declaredLength = parseFlaskInteger(declaredLengthHeader)
  // Python int("-1") parses successfully and fails the equality check below
  // with 400, so only a missing/malformed header produces 411 here.
  if (!declaredLengthHeader || declaredLength === null) {
    throw createError({ statusCode: 411, statusMessage: 'Video part length is required.' })
  }
  if (declaredLength !== expectedBytes) {
    throw createError({ statusCode: 400, statusMessage: 'Video part size does not match the expected chunk size.' })
  }
  // Flask also streams request.body into the multipart part (worker.py:586).
  const body = getRequestWebStream(event) ?? new ReadableStream<Uint8Array>({
    start(controller) { controller.close() },
  })
  try {
    const upload = studioMutationBucket(event, identity).resumeMultipartUpload(key, uploadId)
    const part = await upload.uploadPart(partNumber, body)
    // Flask marks part metadata uncacheable (worker.py:590-594).
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return { partNumber: part.partNumber, etag: part.etag }
  } catch (error) {
    console.error('R2 video part upload failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Video part upload failed. Please retry this part.' })
  }
})
