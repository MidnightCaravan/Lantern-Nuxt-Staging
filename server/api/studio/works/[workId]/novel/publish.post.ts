import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioNow } from '../../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid novel.' })
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const { db } = await ownedStudioWork(event, identity, workId, 'Novel')
  assertStudioWritable(identity)

  const now = studioNow()
  await db.prepare(`UPDATE chapters SET status = 'draft', updated_at = ? WHERE work_id = ? AND (TRIM(COALESCE(title,'')) = '' OR TRIM(COALESCE(content,'')) = '')`).bind(now, workId).run()
  const publishable = await db.prepare(`SELECT id FROM chapters WHERE work_id = ? AND TRIM(COALESCE(title,'')) <> '' AND TRIM(COALESCE(content,'')) <> '' ORDER BY chapter_number ASC`).bind(workId).all<any>()
  if (!(publishable.results ?? []).length) {
    await db.prepare(`UPDATE works SET status = 'draft', updated_at = ? WHERE id = ? AND creator_id = ? AND type = 'Novel'`).bind(now, workId, identity.userId).run()
    throw createError({ statusCode: 400, statusMessage: 'Write and save at least one chapter with content before publishing your novel.' })
  }
  await db.prepare(`UPDATE chapters SET status = 'published', updated_at = ? WHERE work_id = ? AND TRIM(COALESCE(title,'')) <> '' AND TRIM(COALESCE(content,'')) <> ''`).bind(now, workId).run()
  await db.prepare(`UPDATE works SET status = 'published', updated_at = ? WHERE id = ? AND creator_id = ? AND type = 'Novel'`).bind(now, workId, identity.userId).run()
  return { ok: true, message: 'Your novel and its saved chapters are now published on Lantern.' }
})
