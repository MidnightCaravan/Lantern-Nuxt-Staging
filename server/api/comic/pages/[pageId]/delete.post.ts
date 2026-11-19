import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertComicWritable, comicDatabase, comicNow, comicStagingBucket, requireComicIdentity } from '../../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  assertComicWritable(identity)
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const pageId = Number(getRouterParam(event, 'pageId'))
  if (!Number.isSafeInteger(pageId) || pageId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid page.' })
  }
  const db = comicDatabase(event, identity)
  const page = await db.prepare(`
    SELECT comic_pages.id, comic_pages.episode_id, comic_pages.image_path
    FROM comic_pages
    JOIN comic_episodes ON comic_episodes.id = comic_pages.episode_id
    JOIN works ON works.id = comic_episodes.work_id
    WHERE comic_pages.id = ? AND works.creator_id = ? AND works.type = 'Comic'
    LIMIT 1
  `).bind(pageId, identity.userId).first<any>()
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Comic page not found.' })

  if (page.image_path) {
    try {
      await comicStagingBucket(event).delete(String(page.image_path))
    } catch {
      throw createError({ statusCode: 503, statusMessage: 'Could not delete the stored image. Please try again.' })
    }
  }
  await db.prepare('DELETE FROM comic_pages WHERE id = ?').bind(pageId).run()
  await db.prepare('UPDATE comic_episodes SET updated_at = ? WHERE id = ?')
    .bind(comicNow(), Number(page.episode_id)).run()
  return { ok: true, message: 'Comic page deleted.' }
})
