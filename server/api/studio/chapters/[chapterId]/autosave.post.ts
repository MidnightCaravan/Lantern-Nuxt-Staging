import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioChapter, requireStudioIdentity, studioNow } from '../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const chapterId = Number(getRouterParam(event, 'chapterId'))
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid chapter.' })
  const body = await readBody<{ title?: unknown; content?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  const { db, chapter } = await ownedStudioChapter(event, identity, chapterId)

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const content = typeof body?.content === 'string' ? body.content : ''
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Chapter title cannot be empty.' })

  const now = studioNow()
  await db.prepare('UPDATE chapters SET title = ?, content = ?, updated_at = ? WHERE id = ?').bind(title, content, now, chapterId).run()
  await db.prepare('UPDATE works SET updated_at = ? WHERE id = ?').bind(now, Number(chapter.work_id)).run()
  return { success: true, saved_at: now }
})
