import { createError, getHeader, getRouterParam, readRawBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioMutationBucket, studioDb, studioNow } from '../../../../utils/lantern-studio'
const TYPES: Record<string,string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' }
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  assertStudioWritable(event, identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  const { work } = await ownedStudioWork(event, identity, workId)
  const extension = (getHeader(event, 'x-lantern-extension') || '').trim().toLowerCase().replace(/^\.+/, '')
  if (!TYPES[extension]) throw createError({ statusCode: 400, statusMessage: 'Unsupported image format.' })
  // Flask's Worker stores request.body verbatim, including an empty body.
  // Preserve that behavior instead of rejecting empty uploads locally.
  const raw = await readRawBody(event, false)
  const bytes = raw === undefined || raw === null
    ? new Uint8Array()
    : typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
  const key = `uploads/covers/${workId}/cover.${extension}`
  const bucket = studioMutationBucket(event, identity)
  try { await bucket.put(key, bytes, { httpMetadata: { contentType: TYPES[extension] } }) }
  catch (cause) { console.error('Staging thumbnail upload failed:', cause); throw createError({ statusCode: 502, statusMessage: 'Thumbnail upload failed. Please try again.' }) }
  const cover = `/media/${key}`
  const db = studioDb(event, identity)
  await db.prepare('UPDATE works SET cover = ?, updated_at = ? WHERE id = ? AND creator_id = ?').bind(cover, studioNow(), workId, identity.userId).run()
  const oldCover = typeof work.cover === 'string' ? work.cover : ''
  // Match the Worker: delete any changed cover under /media/, not just the
  // current cover prefix (worker.py:1031-1042).
  if (oldCover.startsWith('/media/')) { const oldKey = oldCover.slice('/media/'.length); if (oldKey !== key) { try { await bucket.delete(oldKey) } catch (cause) { console.error('Thumbnail saved but old staging object cleanup failed:', cause) } } }
  return { ok: true, cover, message: 'Thumbnail uploaded.' }
})
