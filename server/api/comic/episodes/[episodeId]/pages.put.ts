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

const CLIENT_ID = /^[0-9a-f]{16}$/

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

  // A stable per-file id lets the UI retry safely. The response can be lost
  // after the page was committed; replaying the same file must not create a
  // second page. Older clients that do not send the header keep the original
  // random-suffix path and behavior.
  const suppliedId = (getHeader(event, 'x-lantern-client-id') || '').trim().toLowerCase()
  const clientId = CLIENT_ID.test(suppliedId)
    ? suppliedId
    : crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const prefix = `uploads/comics/${Number(episode.work_id)}/${episodeId}/`
  const retryPattern = `${prefix}page-%-${clientId}.${extension}`

  const alreadyStored = await db.prepare(`
    SELECT id, page_number FROM comic_pages
    WHERE episode_id = ? AND image_path LIKE ? LIMIT 1
  `).bind(episodeId, retryPattern).first<any>()
  if (alreadyStored) {
    return {
      ok: true,
      pageNumber: Number(alreadyStored.page_number),
      duplicate: true,
      message: 'Page was already added to draft.',
    }
  }

  // The canonical comic editor uploads each file as a raw PUT to the Worker's
  // /comic/episode/<id>/page-direct branch (comic_episode.html:1149-1166).
  // That branch writes request.body verbatim and inserts a comic_pages row
  // with no empty-body check (worker.py:241-278), so a zero-byte file still
  // becomes a page. The old POST-form path's `if not data: continue` guard
  // (lantern_comic_editor.py:219-222) is unreachable from the rendered UI.
  const latest = await db.prepare('SELECT MAX(page_number) AS latest_page FROM comic_pages WHERE episode_id = ?')
    .bind(episodeId).first<any>()
  const nextPage = Number(latest?.latest_page ?? 0) + 1
  const key = `${prefix}page-${nextPage}-${clientId}.${extension}`
  const bucket = comicMutationBucket(event, identity)

  await bucket.put(key, bytes, { httpMetadata: { contentType } })
  const now = comicNow()
  try {
    // D1 batch statements run sequentially in one transaction. The insert and
    // the episode timestamp either both commit or neither does.
    const results = await db.batch([
      db.prepare(`
        INSERT INTO comic_pages (episode_id, page_number, image_path, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(episodeId, nextPage, key, now),
      db.prepare('UPDATE comic_episodes SET updated_at = ? WHERE id = ?').bind(now, episodeId),
    ])
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new Error('Comic page insert did not commit.')
  } catch {
    // Avoid an orphaned R2 object when the database write fails. This deletes
    // only the object created by this request.
    try { await bucket.delete(key) } catch { /* best effort cleanup */ }
    throw createError({ statusCode: 503, statusMessage: 'The comic page could not be saved. Please try again.' })
  }

  return { ok: true, pageNumber: nextPage, duplicate: false, message: 'All pages added to draft.' }
})
