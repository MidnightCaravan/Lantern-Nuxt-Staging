import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertComicWritable, comicNow, ownedComicWork, requireComicIdentity } from '../../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  assertComicWritable(identity)
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid comic.' })
  }
  const { db } = await ownedComicWork(event, identity, workId)
  const result = await db.prepare(`
    SELECT comic_episodes.id, comic_episodes.episode_number, COUNT(comic_pages.id) AS page_count
    FROM comic_episodes
    LEFT JOIN comic_pages ON comic_pages.episode_id = comic_episodes.id
    WHERE comic_episodes.work_id = ?
    GROUP BY comic_episodes.id, comic_episodes.episode_number
    ORDER BY comic_episodes.episode_number ASC
  `).bind(workId).all<any>()
  const episodes = result.results ?? []
  if (!episodes.length) {
    throw createError({ statusCode: 400, statusMessage: 'Add at least one episode before publishing your comic.' })
  }
  const empty = episodes.filter((episode: any) => Number(episode.page_count ?? 0) < 1)
  if (empty.length) {
    const numbers = empty.map((episode: any) => String(episode.episode_number)).join(', ')
    throw createError({ statusCode: 400, statusMessage: `Episode ${numbers} need at least one page before publishing.` })
  }

  const now = comicNow()
  await db.prepare("UPDATE comic_episodes SET status = 'published', updated_at = ? WHERE work_id = ?")
    .bind(now, workId).run()
  await db.prepare("UPDATE works SET status = 'published', updated_at = ? WHERE id = ? AND creator_id = ? AND type = 'Comic'")
    .bind(now, workId, identity.userId).run()
  return { ok: true, message: 'Your comic is now published on Lantern.' }
})
