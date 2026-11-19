import { createError, getRouterParam } from 'h3'
import { ownedStudioWork, requireStudioIdentity } from '../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid novel.' })
  const { db, work } = await ownedStudioWork(event, identity, workId, 'Novel')
  const result = await db.prepare('SELECT id, work_id, chapter_number, title, status, created_at, updated_at FROM chapters WHERE work_id = ? ORDER BY chapter_number ASC').bind(workId).all<any>()
  return { work, chapters: result.results ?? [], writable: identity.database === 'staging' }
})
