import { createError, getHeader, getRouterParam, readRawBody } from 'h3'
import {
  assertSameOriginAndCsrf,
  getLanternSessionIdentity,
} from '../../../../utils/lantern-auth'
import { resolveMutationTarget } from '../../../../utils/lantern-writes'

const contentTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function ownedCoverKey(value: unknown, workId: number): string | null {
  if (typeof value !== 'string') return null
  const key = value.startsWith('/media/') ? value.slice(7) : value.replace(/^\/+/, '')
  return key.startsWith(`uploads/covers/${workId}/`) ? key : null
}

export default defineEventHandler(async (event) => {
  // Match the original Worker order: parse the work ID, authenticate,
  // validate CSRF, and verify ownership before processing the upload.
  const workId = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  }

  const identity = await getLanternSessionIdentity(event)
  if (!identity) throw createError({ statusCode: 401, statusMessage: 'Please log in.' })

  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))

  const target = resolveMutationTarget(
    event,
    identity.database,
    'Production works are read-only in staging.',
  )
  const { db, media: bucket } = target
  const work = await db.prepare(`
    SELECT id, cover FROM works
    WHERE id = ? AND creator_id = ?
    LIMIT 1
  `).bind(workId, identity.userId).first<any>()

  if (!work) throw createError({ statusCode: 404, statusMessage: 'Work not found.' })

  const extension = String(getHeader(event, 'x-lantern-extension') || '')
    .trim().toLowerCase().replace(/^\./, '')
  const contentType = contentTypes[extension]
  if (!contentType) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported thumbnail format.' })
  }

  // The dashboard client sends the same raw-body PUT as Flask's Worker
  // (worker.py:875-883), which stores request.body verbatim, including an
  // empty body. Do not reject it here.
  const raw = await readRawBody(event, false)
  const data = raw === undefined || raw === null
    ? new Uint8Array()
    : typeof raw === 'string'
      ? new TextEncoder().encode(raw)
      : new Uint8Array(raw)

  const key = `uploads/covers/${workId}/cover.${extension}`
  await bucket.put(key, data, { httpMetadata: { contentType } })

  await db.prepare(`
    UPDATE works SET cover = ?, updated_at = ?
    WHERE id = ? AND creator_id = ?
  `).bind(`/media/${key}`, new Date().toISOString(), workId, identity.userId).run()

  const oldCoverKey = ownedCoverKey(work.cover, workId)
  let message = 'Thumbnail uploaded successfully.'
  if (oldCoverKey && oldCoverKey !== key) {
    try { await bucket.delete(oldCoverKey) }
    catch { message = 'Thumbnail uploaded, but the previous cover could not be removed.' }
  }

  return { ok: true, message }
})
