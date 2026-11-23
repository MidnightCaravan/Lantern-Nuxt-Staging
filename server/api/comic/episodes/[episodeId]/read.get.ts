import { createError, getRouterParam } from 'h3'
import { getLanternDatabaseForSession, lanternMediaUrl } from '../../../../utils/lantern-public'
import { getLanternSessionIdentity } from '../../../../utils/lantern-auth'
import { studioPublicContext, studioPublicMediaUrl } from '../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const episodeId = Number(getRouterParam(event, 'episodeId'))
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid episode.' })
  }

  const identity = await getLanternSessionIdentity(event)
  let db: any
  let episode: any
  let isPreview = false
  let source: 'production' | 'staging' = 'production'

  // Flask allows the owner to open an unpublished episode from the plain
  // reader URL; only viewers who do not own it receive a 404
  // (lantern_comic_views.py:97-109). Ownership, not any query flag, is the only
  // reason to enter the draft-preview branch. A published episode stays public
  // even when a copied editor link still carries ?preview=1.
  const ownedEpisode = identity
    ? await getLanternDatabaseForSession(event, identity.database).prepare(`
        SELECT
          comic_episodes.id, comic_episodes.work_id, comic_episodes.episode_number,
          comic_episodes.title, comic_episodes.status,
          works.creator_id, works.title AS work_title, works.status AS work_status
        FROM comic_episodes
        JOIN works ON works.id = comic_episodes.work_id
        WHERE comic_episodes.id = ? AND works.type = 'Comic' AND works.creator_id = ?
        LIMIT 1
      `).bind(episodeId, identity.userId).first<any>()
    : null

  if (ownedEpisode) {
    if (!identity) throw createError({ statusCode: 404, statusMessage: 'Episode not found.' })
    source = identity.database
    db = getLanternDatabaseForSession(event, identity.database)
    episode = ownedEpisode ?? await db.prepare(`
      SELECT
        comic_episodes.id, comic_episodes.work_id, comic_episodes.episode_number,
        comic_episodes.title, comic_episodes.status,
        works.creator_id, works.title AS work_title, works.status AS work_status
      FROM comic_episodes
      JOIN works ON works.id = comic_episodes.work_id
      WHERE comic_episodes.id = ? AND works.type = 'Comic' AND works.creator_id = ?
      LIMIT 1
    `).bind(episodeId, identity.userId).first<any>()
    if (!episode) throw createError({ statusCode: 404, statusMessage: 'Episode not found.' })
    isPreview = episode.work_status !== 'published' || episode.status !== 'published'
  } else {
    // Public reader URLs use the same server-side source selection as the
    // other reading pages: production by default, staging when configured.
    const publicContext = await studioPublicContext(event)
    db = publicContext.db
    source = publicContext.staging ? 'staging' : 'production'
    episode = await db.prepare(`
      SELECT
        comic_episodes.id, comic_episodes.work_id, comic_episodes.episode_number,
        comic_episodes.title, comic_episodes.status,
        works.creator_id, works.title AS work_title, works.status AS work_status
      FROM comic_episodes
      JOIN works ON works.id = comic_episodes.work_id
      WHERE comic_episodes.id = ? AND works.type = 'Comic'
        AND works.status = 'published' AND comic_episodes.status = 'published'
      LIMIT 1
    `).bind(episodeId).first<any>()
    if (!episode) throw createError({ statusCode: 404, statusMessage: 'Episode not found.' })
  }

  const pageResult = await db.prepare(`
    SELECT id, episode_id, page_number, image_path
    FROM comic_pages WHERE episode_id = ? ORDER BY page_number ASC
  `).bind(episodeId).all<any>()
  const pages = (pageResult.results ?? []).map((page: any) => ({
    id: Number(page.id),
    pageNumber: Number(page.page_number),
    imageUrl: isPreview && source === 'staging'
      ? `/api/comic/pages/${Number(page.id)}/media`
      : source === 'staging'
        ? studioPublicMediaUrl(page.image_path, true)
        : lanternMediaUrl(page.image_path),
  }))

  const previous = await db.prepare(`
    SELECT id, episode_number, title FROM comic_episodes
    WHERE work_id = ? AND episode_number < ? AND (? = 0 OR status = 'published')
    ORDER BY episode_number DESC LIMIT 1
  `).bind(Number(episode.work_id), Number(episode.episode_number), isPreview ? 0 : 1).first<any>()
  const next = await db.prepare(`
    SELECT id, episode_number, title FROM comic_episodes
    WHERE work_id = ? AND episode_number > ? AND (? = 0 OR status = 'published')
    ORDER BY episode_number ASC LIMIT 1
  `).bind(Number(episode.work_id), Number(episode.episode_number), isPreview ? 0 : 1).first<any>()

  return {
    episode: {
      id: Number(episode.id),
      workId: Number(episode.work_id),
      episodeNumber: Number(episode.episode_number),
      title: String(episode.title ?? ''),
      status: String(episode.status ?? 'draft'),
      workTitle: String(episode.work_title ?? ''),
      workStatus: String(episode.work_status ?? 'draft'),
    },
    pages,
    previous: previous ? { id: Number(previous.id), episodeNumber: Number(previous.episode_number), title: String(previous.title ?? '') } : null,
    next: next ? { id: Number(next.id), episodeNumber: Number(next.episode_number), title: String(next.title ?? '') } : null,
    source,
    isPreview,
  }
})
