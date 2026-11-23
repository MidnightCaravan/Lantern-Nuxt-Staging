import { createError, getRouterParam, readBody } from 'h3'
import {
  assertSameOriginAndCsrf,
  getLanternSessionIdentity,
} from '../../../../utils/lantern-auth'
import { resolveMutationTarget } from '../../../../utils/lantern-writes'

function ownedPageKey(value: unknown, prefix: string): string | null {
  if (typeof value !== 'string') return null
  return value.startsWith(prefix) ? value : null
}

function ownedCoverKey(value: unknown, prefix: string): string | null {
  if (typeof value !== 'string') return null

  const candidate = value.startsWith('/media/')
    ? value.slice('/media/'.length)
    : value

  if (!candidate.startsWith(prefix)) return null

  const filename = candidate.slice(prefix.length)
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..'
  ) {
    return null
  }

  return candidate
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const identity = await getLanternSessionIdentity(event)
  if (!identity) throw createError({ statusCode: 401, statusMessage: 'Please log in.' })
  const target = resolveMutationTarget(
    event,
    identity.database,
    'Production works are read-only in staging.',
  )
  const { db, media: bucket } = target

  const workId = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  }

  const work = await db.prepare(`
    SELECT id, title, cover, status
    FROM works
    WHERE id = ? AND creator_id = ?
    LIMIT 1
  `).bind(workId, identity.userId).first<any>()

  if (!work) throw createError({ statusCode: 404, statusMessage: 'Work not found.' })
  if (work.status !== 'draft') {
    throw createError({ statusCode: 409, statusMessage: 'Only draft works can be deleted from the dashboard.' })
  }

  const pagesResult = await db.prepare(`
    SELECT comic_pages.image_path
    FROM comic_pages
    JOIN comic_episodes ON comic_episodes.id = comic_pages.episode_id
    WHERE comic_episodes.work_id = ?
  `).bind(workId).all<any>()

  const pagePrefix = `uploads/comics/${workId}/`
  const coverPrefix = `uploads/covers/${workId}/`
  const keys = new Set<string>()

  for (const page of pagesResult.results ?? []) {
    const key = ownedPageKey(page.image_path, pagePrefix)
    if (key) keys.add(key)
  }

  const coverKey = ownedCoverKey(work.cover, coverPrefix)
  if (coverKey) keys.add(coverKey)

  if (keys.size > 0) {
    try {
      for (const key of keys) await bucket.delete(key)
    } catch {
      throw createError({
        statusCode: 502,
        statusMessage: 'Could not remove one or more stored images. Please retry.',
      })
    }
  }

  await db.batch([
    db.prepare(`
      DELETE FROM comic_pages
      WHERE episode_id IN (SELECT id FROM comic_episodes WHERE work_id = ?)
    `).bind(workId),
    db.prepare('DELETE FROM comic_episodes WHERE work_id = ?').bind(workId),
    db.prepare('DELETE FROM chapters WHERE work_id = ?').bind(workId),
    db.prepare(`
      DELETE FROM works
      WHERE id = ? AND creator_id = ? AND status = 'draft'
    `).bind(workId, identity.userId),
  ])

  return { ok: true, message: `"${String(work.title)}" was deleted.` }
})
