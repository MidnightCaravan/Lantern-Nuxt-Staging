import { createError, getRouterParam } from 'h3'
import { comicDatabase, comicImageUrl, ownedComicEpisode, requireComicIdentity } from '../../../utils/lantern-comic'

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  const episodeId = Number(getRouterParam(event, 'episodeId'))
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid episode.' })
  }
  const { episode } = await ownedComicEpisode(event, identity, episodeId)
  const db = comicDatabase(event, identity)
  const result = await db.prepare(`
    SELECT id, episode_id, page_number, image_path, created_at
    FROM comic_pages WHERE episode_id = ? ORDER BY page_number ASC
  `).bind(episodeId).all<any>()

  const pages = (result.results ?? []).map((page: any) => ({
    id: Number(page.id),
    pageNumber: Number(page.page_number),
    imageUrl: comicImageUrl(identity, page),
  }))

  return {
    work: { id: Number(episode.work_id), title: String(episode.work_title ?? ''), status: String(episode.work_status ?? 'draft') },
    episode: {
      id: Number(episode.id),
      workId: Number(episode.work_id),
      episodeNumber: Number(episode.episode_number),
      title: String(episode.title ?? ''),
      status: String(episode.status ?? 'draft'),
    },
    pages,
    writable: identity.database === 'staging',
  }
})
