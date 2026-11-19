import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket } from '../../../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video work.' })
  const body = await readBody<{ key?: unknown; uploadId?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  await ownedStudioWork(event, identity, workId, 'Video')
  const key = typeof body?.key === 'string' ? body.key : ''
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId : ''
  if (!new RegExp(`^uploads/videos/${workId}/video-[0-9a-f]{24}\\.(mp4|webm|mov)$`).test(key) || !uploadId || uploadId.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Invalid video upload reference.' })
  try { await studioBucket(event).resumeMultipartUpload(key, uploadId).abort() } catch (error) { console.warn('R2 multipart abort did not complete:', error) }
  return { ok: true, message: 'Video upload aborted.' }
})
