import { createError, getRouterParam, setResponseHeader } from 'h3'
import { comicDatabase, comicStagingBucket, requireComicIdentity } from '../../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  if (identity.database !== 'staging') {
    throw createError({ statusCode: 404, statusMessage: 'Comic page not found.' })
  }
  const pageId = Number(getRouterParam(event, 'pageId'))
  if (!Number.isSafeInteger(pageId) || pageId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid page.' })
  }

  const db = comicDatabase(event, identity)
  const page = await db.prepare(`
    SELECT comic_pages.image_path
    FROM comic_pages
    JOIN comic_episodes ON comic_episodes.id = comic_pages.episode_id
    JOIN works ON works.id = comic_episodes.work_id
    WHERE comic_pages.id = ? AND works.creator_id = ? AND works.type = 'Comic'
    LIMIT 1
  `).bind(pageId, identity.userId).first<any>()
  if (!page?.image_path) throw createError({ statusCode: 404, statusMessage: 'Comic page not found.' })

  const object = await comicStagingBucket(event).get(String(page.image_path))
  if (!object) throw createError({ statusCode: 404, statusMessage: 'Comic page image not found.' })
  setResponseHeader(event, 'Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return object.body
})
