import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../utils/lantern-auth'
import { assertComicWritable, comicNow, ownedComicEpisode, requireComicIdentity } from '../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  assertComicWritable(identity)
  const body = await readBody<{ title?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const episodeId = Number(getRouterParam(event, 'episodeId'))
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid episode.' })
  }
  const { db } = await ownedComicEpisode(event, identity, episodeId)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Episode title cannot be empty.' })
  if (title.length > 200) throw createError({ statusCode: 400, statusMessage: 'Episode title must be 200 characters or fewer.' })

  await db.prepare('UPDATE comic_episodes SET title = ?, updated_at = ? WHERE id = ?')
    .bind(title, comicNow(), episodeId).run()
  return { ok: true, message: 'Episode saved.' }
})
