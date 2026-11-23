import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertComicWritable, comicDatabase, comicNow, ownedComicEpisode, requireComicIdentity } from '../../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertComicWritable(event, identity)

  const episodeId = Number(getRouterParam(event, 'episodeId'))
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid episode.' })
  }
  const { db } = await ownedComicEpisode(event, identity, episodeId)
  const count = await db.prepare('SELECT COUNT(*) AS count FROM comic_pages WHERE episode_id = ?')
    .bind(episodeId).first<any>()
  if (Number(count?.count ?? 0) < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Add at least one page before publishing this episode.' })
  }
  await db.prepare("UPDATE comic_episodes SET status = 'published', updated_at = ? WHERE id = ?")
    .bind(comicNow(), episodeId).run()
  return { ok: true, message: 'Episode published successfully.' }
})
