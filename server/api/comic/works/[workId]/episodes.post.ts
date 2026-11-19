import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertComicWritable, comicNow, ownedComicWork, requireComicIdentity } from '../../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  assertComicWritable(identity)
  const body = await readBody<{ title?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid comic.' })
  }
  const { db } = await ownedComicWork(event, identity, workId)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Please give the episode a title.' })
  if (title.length > 200) throw createError({ statusCode: 400, statusMessage: 'Episode title must be 200 characters or fewer.' })

  const latest = await db.prepare(`
    SELECT MAX(episode_number) AS latest_number
    FROM comic_episodes WHERE work_id = ?
  `).bind(workId).first<any>()
  const episodeNumber = Number(latest?.latest_number ?? 0) + 1
  const now = comicNow()

  await db.prepare(`
    INSERT INTO comic_episodes (work_id, episode_number, title, status, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, ?)
  `).bind(workId, episodeNumber, title, now, now).run()

  const created = await db.prepare(`
    SELECT id FROM comic_episodes
    WHERE work_id = ? AND episode_number = ?
    ORDER BY id DESC LIMIT 1
  `).bind(workId, episodeNumber).first<any>()
  if (!created) throw createError({ statusCode: 500, statusMessage: 'The episode could not be created.' })

  await db.prepare('UPDATE works SET updated_at = ? WHERE id = ? AND creator_id = ?')
    .bind(now, workId, identity.userId).run()

  return { ok: true, episodeId: Number(created.id), episodeNumber, message: `Episode ${episodeNumber} created.` }
})
