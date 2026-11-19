import { createError, getQuery } from 'h3'
import { getLanternSessionIdentity } from '../utils/lantern-auth'
import { getLanternStagingMediaBucket } from '../utils/lantern-public'

export default defineEventHandler(async (event) => {
  const identity = await getLanternSessionIdentity(event)
  if (!identity || identity.database !== 'staging') {
    throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
  }

  const key = String(getQuery(event).key ?? '')
  if (
    !key.startsWith('uploads/covers/')
    || key.includes('..')
    || key.includes('\\')
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
  }

  const bucket = getLanternStagingMediaBucket(event)
  const object = await bucket.get(key)
  if (!object) {
    throw createError({ statusCode: 404, statusMessage: 'Media not found.' })
  }

  const headers = new Headers()
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Cache-Control', 'private, max-age=300')
  return new Response(object.body, { status: 200, headers })
})
