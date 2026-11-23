import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioMutationBucket } from '../../../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const body = await readBody<{ key?: unknown; uploadId?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  await ownedStudioWork(event, identity, workId, 'Video')
  // Flask trims both reference headers before validating them (worker.py:549-553).
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId.trim() : ''
  if (!new RegExp(`^uploads/videos/${workId}/video-[0-9a-f]{24}\\.(mp4|webm|mov)$`).test(key) || !uploadId || uploadId.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Invalid video upload reference.' })
  try { await studioMutationBucket(event, identity).resumeMultipartUpload(key, uploadId).abort() } catch (error) { console.warn('R2 multipart abort did not complete:', error) }
  return { ok: true, message: 'Video upload aborted.' }
})
