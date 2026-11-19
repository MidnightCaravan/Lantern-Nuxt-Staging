import { createError, getRouterParam } from 'h3'
import { ownedStudioChapter, requireStudioIdentity, studioDb } from '../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const chapterId = Number(getRouterParam(event, 'chapterId'))
  if (!Number.isSafeInteger(chapterId) || chapterId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid chapter.' })
  const { db, chapter } = await ownedStudioChapter(event, identity, chapterId)
  const previous = await db.prepare('SELECT id, chapter_number, title FROM chapters WHERE work_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 1').bind(chapter.work_id, chapter.chapter_number).first<any>()
  const next = await db.prepare('SELECT id, chapter_number, title FROM chapters WHERE work_id = ? AND chapter_number > ? ORDER BY chapter_number ASC LIMIT 1').bind(chapter.work_id, chapter.chapter_number).first<any>()
  return { chapter, work: { id: Number(chapter.work_id), title: String(chapter.work_title ?? '') }, previous, next, writable: identity.database === 'staging' }
})
