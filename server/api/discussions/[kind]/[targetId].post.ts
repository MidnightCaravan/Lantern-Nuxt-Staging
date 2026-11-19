import { createError, getQuery, getRouterParam, readBody, setResponseStatus } from 'h3'
import { assertSameOriginAndCsrf } from '../../../utils/lantern-auth'
import { getLanternDatabase } from '../../../utils/lantern-public'
import { requireStudioIdentity, assertStudioWritable, studioDb, studioNow } from '../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  const kind = String(getRouterParam(event, 'kind') ?? '')
  const targetId = Number(getRouterParam(event, 'targetId'))
  const source = String(getQuery(event).source ?? 'production')
  if (source !== 'staging') throw createError({ statusCode: 409, statusMessage: 'Production discussions are read-only in this staging build.' })
  if (!['work', 'episode'].includes(kind) || !Number.isSafeInteger(targetId) || targetId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid discussion.' })
  const body = await readBody<{ body?: unknown; parent_id?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const commentBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!commentBody) throw createError({ statusCode: 400, statusMessage: 'Comment cannot be empty.' })
  if (commentBody.length > 5000) throw createError({ statusCode: 400, statusMessage: 'Comment is too long.' })
  const db = studioDb(event, identity)
  let entity: any = null
  if (kind === 'work') {
    entity = await db.prepare("SELECT id,type,status FROM works WHERE id = ? AND lower(type) IN ('novel','video') AND status = 'published' LIMIT 1").bind(targetId).first<any>()
    if (!entity) throw createError({ statusCode: 404, statusMessage: 'Published work not found.' })
  } else {
    entity = await db.prepare("SELECT e.id,e.status AS episode_status,w.status AS work_status,w.creator_id FROM comic_episodes e JOIN works w ON w.id = e.work_id WHERE e.id = ? AND w.type = 'Comic' LIMIT 1").bind(targetId).first<any>()
    const isOwner = Boolean(entity && Number(entity.creator_id) === identity.userId)
    const isPublic = Boolean(entity && entity.episode_status === 'published' && entity.work_status === 'published')
    if (!entity || (!isPublic && !isOwner)) throw createError({ statusCode: 404, statusMessage: 'Episode not found.' })
  }
  let parentId: number | null = null
  if (body?.parent_id !== undefined && body.parent_id !== null && body.parent_id !== '') {
    parentId = Number(body.parent_id)
    if (!Number.isSafeInteger(parentId) || parentId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid reply target.' })
    const contentType = kind === 'episode' ? 'comic_episode' : String(entity.type).toLowerCase()
    const parent = await db.prepare('SELECT id FROM comments WHERE id = ? AND content_type = ? AND content_id = ? LIMIT 1').bind(parentId, contentType, targetId).first<any>()
    if (!parent) throw createError({ statusCode: 400, statusMessage: "Reply target was not found in this work's discussion." })
  }
  const contentType = kind === 'episode' ? 'comic_episode' : String(entity.type).toLowerCase()
  const now = studioNow()
  // Flask uses cursor.lastrowid after the insert. Reading it from the write
  // result avoids a second query that could pick up another user's concurrent
  // comment on the same discussion.
  const inserted = await db.prepare('INSERT INTO comments (user_id,content_type,content_id,parent_id,body,created_at) VALUES (?,?,?,?,?,?)').bind(identity.userId, contentType, targetId, parentId, commentBody, now).run()
  const commentId = Number(inserted?.meta?.last_row_id)
  const user = await db.prepare('SELECT username,display_name,avatar FROM users WHERE id = ?').bind(identity.userId).first<any>()
  if (!Number.isSafeInteger(commentId) || commentId <= 0 || !user) throw createError({ statusCode: 500, statusMessage: 'Comment could not be saved.' })
  setResponseStatus(event, 201)
  return { success: true, comment: { id: commentId, parent_id: parentId, body: commentBody, created_at: now, username: user.username, display_name: user.display_name, avatar: user.avatar || '', like_count: 0, liked_by_current_user: false, is_mine: true } }
})
