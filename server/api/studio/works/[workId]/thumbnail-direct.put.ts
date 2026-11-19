import { createError, getHeader, getRouterParam, readRawBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket, studioDb, studioNow } from '../../../../utils/lantern-studio'
const TYPES: Record<string,string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif' }
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  const { work } = await ownedStudioWork(event, identity, workId)
  const extension = (getHeader(event, 'x-lantern-extension') || '').trim().toLowerCase().replace(/^\./, '')
  if (!TYPES[extension]) throw createError({ statusCode: 400, statusMessage: 'Unsupported image format.' })
  const raw = await readRawBody(event, false)
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Thumbnail file is empty.' })
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
  if (!bytes.byteLength) throw createError({ statusCode: 400, statusMessage: 'Thumbnail file is empty.' })
  const key = `uploads/covers/${workId}/cover.${extension}`
  const bucket = studioBucket(event)
  try { await bucket.put(key, bytes, { httpMetadata: { contentType: TYPES[extension] } }) }
  catch (cause) { console.error('Staging thumbnail upload failed:', cause); throw createError({ statusCode: 502, statusMessage: 'Thumbnail upload failed. Please try again.' }) }
  const cover = `/media/${key}`
  const db = studioDb(event, identity)
  await db.prepare('UPDATE works SET cover = ?, updated_at = ? WHERE id = ? AND creator_id = ?').bind(cover, studioNow(), workId, identity.userId).run()
  const oldCover = typeof work.cover === 'string' ? work.cover : ''
  const prefix = `/media/uploads/covers/${workId}/`
  if (oldCover.startsWith(prefix)) { const oldKey = oldCover.slice('/media/'.length); if (oldKey !== key) { try { await bucket.delete(oldKey) } catch (cause) { console.error('Thumbnail saved but old staging object cleanup failed:', cause) } } }
  return { ok: true, cover, message: 'Thumbnail uploaded.' }
})
