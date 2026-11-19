import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioNow } from '../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid novel.' })
  const body = await readBody<{ title?: unknown; content?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const { db } = await ownedStudioWork(event, identity, workId, 'Novel')
  assertStudioWritable(identity)

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const content = typeof body?.content === 'string' ? body.content : ''
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Please give the chapter a title.' })

  const latest = await db.prepare('SELECT MAX(chapter_number) AS latest_number FROM chapters WHERE work_id = ?').bind(workId).first<any>()
  const nextNumber = Number(latest?.latest_number ?? 0) + 1
  const now = studioNow()
  const row = await db.prepare(`INSERT INTO chapters (work_id, chapter_number, title, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?) RETURNING id`).bind(workId, nextNumber, title, content, now, now).first<any>()
  await db.prepare('UPDATE works SET updated_at = ? WHERE id = ?').bind(now, workId).run()
  if (!row) throw createError({ statusCode: 500, statusMessage: 'Chapter could not be created.' })
  return { ok: true, chapterId: Number(row.id), chapterNumber: nextNumber }
})
