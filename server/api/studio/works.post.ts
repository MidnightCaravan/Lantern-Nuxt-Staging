import { createError, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../utils/lantern-auth'
import { assertStudioWritable, requireStudioIdentity, studioDb, studioNow } from '../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const body = await readBody<{ title?: unknown; description?: unknown; type?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  const typeMap: Record<string, string> = { novel: 'Novel', comic: 'Comic', video: 'Video' }
  const type = typeof body?.type === 'string' ? typeMap[body.type] : undefined
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  if (!type) throw createError({ statusCode: 400, statusMessage: 'Choose Novel, Comic, or Video.' })
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Please give your work a title.' })
  if (title.length > 200) throw createError({ statusCode: 400, statusMessage: 'Title must be 200 characters or fewer.' })
  if (description.length > 2000) throw createError({ statusCode: 400, statusMessage: 'Description must be 2,000 characters or fewer.' })
  const db = studioDb(event, identity)
  const now = studioNow()
  const row = await db.prepare(`INSERT INTO works (creator_id,title,description,type,status,created_at,updated_at) VALUES (?,?,?,?, 'draft',?,?) RETURNING id`)
    .bind(identity.userId, title, description, type, now, now).first<any>()
  if (!row) throw createError({ statusCode: 500, statusMessage: 'The draft could not be created.' })
  return { ok: true, workId: Number(row.id), type, message: `${type} draft created successfully.` }
})
