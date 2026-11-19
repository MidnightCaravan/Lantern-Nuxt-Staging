import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioNow } from '../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  const body = await readBody<{ title?: unknown; description?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const { db } = await ownedStudioWork(event, identity, workId)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Title cannot be empty.' })
  if (title.length > 200) throw createError({ statusCode: 400, statusMessage: 'Title must be 200 characters or fewer.' })
  if (description.length > 2000) throw createError({ statusCode: 400, statusMessage: 'Description must be 2,000 characters or fewer.' })
  await db.prepare('UPDATE works SET title = ?, description = ?, updated_at = ? WHERE id = ? AND creator_id = ?')
    .bind(title, description, studioNow(), workId, identity.userId).run()
  return { ok: true, message: 'Your draft has been saved.' }
})
