import { createError, getHeader, getRouterParam, readRawBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertComicWritable, comicNow, comicMutationBucket, ownedComicEpisode, requireComicIdentity } from '../../../../utils/lantern-comic'

const allowedImages: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export default defineEventHandler(async (event) => {
  const identity = await requireComicIdentity(event)
  assertSameOriginAndCsrf(event, getHeader(event, 'x-csrf-token'))
  assertComicWritable(event, identity)

  const episodeId = Number(getRouterParam(event, 'episodeId'))
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid episode.' })
  }
  const { db, episode } = await ownedComicEpisode(event, identity, episodeId)
  const extension = (getHeader(event, 'x-lantern-extension') || '').trim().toLowerCase().replace(/^\./, '')
  const contentType = allowedImages[extension]
  if (!contentType) throw createError({ statusCode: 400, statusMessage: 'Unsupported image format.' })

  const raw = await readRawBody(event, false)
  const bytes = typeof raw === 'string'
    ? new TextEncoder().encode(raw)
    : raw
      ? new Uint8Array(raw)
      : new Uint8Array(0)

  // The canonical comic editor uploads each file as a raw PUT to the Worker's
  // /comic/episode/<id>/page-direct branch (comic_episode.html:1149-1166).
  // That branch writes request.body verbatim and inserts a comic_pages row
  // with no empty-body check (worker.py:241-278), so a zero-byte file still
  // becomes a page. The old POST-form path's `if not data: continue` guard
  // (lantern_comic_editor.py:219-222) is unreachable from the rendered UI.
  const latest = await db.prepare('SELECT MAX(page_number) AS latest_page FROM comic_pages WHERE episode_id = ?')
    .bind(episodeId).first<any>()
  const nextPage = Number(latest?.latest_page ?? 0) + 1
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const key = `uploads/comics/${Number(episode.work_id)}/${episodeId}/page-${nextPage}-${random}.${extension}`

  await comicMutationBucket(event, identity).put(key, bytes, { httpMetadata: { contentType } })
  const now = comicNow()
  await db.prepare(`
    INSERT INTO comic_pages (episode_id, page_number, image_path, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(episodeId, nextPage, key, now).run()
  await db.prepare('UPDATE comic_episodes SET updated_at = ? WHERE id = ?').bind(now, episodeId).run()

  return { ok: true, pageNumber: nextPage, message: 'All pages added to draft.' }
})
