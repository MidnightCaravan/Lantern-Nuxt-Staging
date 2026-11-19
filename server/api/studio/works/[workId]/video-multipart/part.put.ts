import { createError, getHeader, getRouterParam, readRawBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket } from '../../../../../utils/lantern-studio'
const MAX_BYTES = 2_000_000_000
const PART_SIZE = 16 * 1024 * 1024
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  await ownedStudioWork(event, identity, workId, 'Video')
  const key = getHeader(event, 'x-lantern-video-key') || ''
  const uploadId = getHeader(event, 'x-lantern-upload-id') || ''
  if (!new RegExp(`^uploads/videos/${workId}/video-[0-9a-f]{24}\\.(mp4|webm|mov)$`).test(key) || !uploadId || uploadId.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Invalid video upload reference.' })
  const size = Number(getHeader(event, 'x-lantern-file-size'))
  const partNumber = Number(getHeader(event, 'x-lantern-part-number'))
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Invalid video size.' })
  const partCount = Math.ceil(size / PART_SIZE)
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > partCount) throw createError({ statusCode: 400, statusMessage: 'Invalid video part number.' })
  const expectedBytes = Math.min(PART_SIZE, size - ((partNumber - 1) * PART_SIZE))
  const raw = await readRawBody(event, false)
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Video part is empty.' })
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
  if (bytes.byteLength !== expectedBytes) throw createError({ statusCode: 400, statusMessage: 'Video part size does not match the expected chunk size.' })
  try {
    const upload = studioBucket(event).resumeMultipartUpload(key, uploadId)
    const part = await upload.uploadPart(partNumber, bytes)
    return { partNumber: part.partNumber, etag: part.etag }
  } catch (error) {
    console.error('R2 video part upload failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Video part upload failed. Please retry this part.' })
  }
})
