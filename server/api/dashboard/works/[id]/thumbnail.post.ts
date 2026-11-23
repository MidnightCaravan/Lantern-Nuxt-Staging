import { createError, getRouterParam, readBody } from 'h3'
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
  const body = await readBody<{ mode?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const identity = await getLanternSessionIdentity(event)
  if (!identity) throw createError({ statusCode: 401, statusMessage: 'Please log in.' })
  const target = resolveMutationTarget(
    event,
    identity.database,
    'Production works are read-only in staging.',
  )
  const { db, media: bucket } = target

  const workId = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  }
  const work = await db.prepare(`
    SELECT id, type, cover
    FROM works
    WHERE id = ? AND creator_id = ?
    LIMIT 1
  `).bind(workId, identity.userId).first<any>()

  if (!work) throw createError({ statusCode: 404, statusMessage: 'Work not found.' })

  const mode = body?.mode
  const oldCoverKey = ownedCoverKey(work.cover, workId)

  if (mode === 'remove') {
    await db.prepare(`
      UPDATE works SET cover = NULL, updated_at = ?
      WHERE id = ? AND creator_id = ?
    `).bind(new Date().toISOString(), workId, identity.userId).run()

    let message = 'Thumbnail removed.'
    if (oldCoverKey) {
      try { await bucket.delete(oldCoverKey) }
      catch { message = 'Thumbnail removed, but the previous cover could not be deleted.' }
    }
    return { ok: true, message }
  }

  if (mode !== 'first_page') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid thumbnail action.' })
  }

  if (work.type !== 'Comic') {
    throw createError({ statusCode: 400, statusMessage: 'Only comic works can use their first page as a thumbnail.' })
  }

  const firstPage = await db.prepare(`
    SELECT comic_pages.image_path
    FROM comic_pages
    JOIN comic_episodes ON comic_episodes.id = comic_pages.episode_id
    WHERE comic_episodes.work_id = ?
    ORDER BY comic_episodes.episode_number ASC, comic_pages.page_number ASC
    LIMIT 1
  `).bind(workId).first<any>()

  if (!firstPage?.image_path) {
    throw createError({ statusCode: 400, statusMessage: 'This comic does not have a page yet.' })
  }

  const imagePath = String(firstPage.image_path)
  const pageKey = imagePath.startsWith('/media/') ? imagePath.slice(7) : imagePath.replace(/^\/+/, '')
  const pagePrefix = `uploads/comics/${workId}/`
  if (!pageKey.startsWith(pagePrefix) || pageKey.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'The first comic page is not available in staging storage.' })
  }

  const extension = pageKey.split('.').pop()?.toLowerCase() || ''
  const contentType = contentTypes[extension]
  if (!contentType) {
    throw createError({ statusCode: 400, statusMessage: 'The first comic page uses an unsupported image format.' })
  }

  const pageObject = await bucket.get(pageKey)
  if (!pageObject) {
    throw createError({ statusCode: 404, statusMessage: 'The first comic page could not be found.' })
  }

  const key = `uploads/covers/${workId}/cover.${extension}`
  const bytes = new Uint8Array(await pageObject.arrayBuffer())
  await bucket.put(key, bytes, { httpMetadata: { contentType } })

  await db.prepare(`
    UPDATE works SET cover = ?, updated_at = ?
    WHERE id = ? AND creator_id = ?
  `).bind(`/media/${key}`, new Date().toISOString(), workId, identity.userId).run()

  let message = 'First comic page is now the thumbnail.'
  if (oldCoverKey && oldCoverKey !== key) {
    try { await bucket.delete(oldCoverKey) }
    catch { message = 'Thumbnail updated, but the previous cover could not be removed.' }
  }

  return { ok: true, message }
})
