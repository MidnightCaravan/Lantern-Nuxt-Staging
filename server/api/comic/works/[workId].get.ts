import { createError, getRouterParam } from 'h3'
import { comicDatabase, requireComicIdentity, ownedComicWork } from '../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid comic.' })
  }

  const { work } = await ownedComicWork(event, identity, workId)
  const db = comicDatabase(event, identity)
  const result = await db.prepare(`
    SELECT
      comic_episodes.*,
      (SELECT COUNT(*) FROM comic_pages WHERE comic_pages.episode_id = comic_episodes.id) AS page_count
    FROM comic_episodes
    WHERE work_id = ?
    ORDER BY episode_number ASC
  `).bind(workId).all<any>()

  return {
    work: {
      id: Number(work.id),
      title: String(work.title ?? ''),
      description: work.description ? String(work.description) : '',
      status: String(work.status ?? 'draft'),
    },
    episodes: (result.results ?? []).map((episode: any) => ({
      id: Number(episode.id),
      episodeNumber: Number(episode.episode_number),
      title: String(episode.title ?? ''),
      status: String(episode.status ?? 'draft'),
      pageCount: Number(episode.page_count ?? 0),
    })),
    writable: identity.database === 'staging',
  }
})
