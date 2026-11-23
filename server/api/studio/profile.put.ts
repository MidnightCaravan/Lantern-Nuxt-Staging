import { createError, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../utils/lantern-auth'
import { assertStudioWritable, requireStudioIdentity, studioDb } from '../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const body = await readBody<{ username?: unknown; display_name?: unknown; bio?: unknown; avatar?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : ''
  const bio = typeof body?.bio === 'string' ? body.bio.trim() : ''
  const avatar = typeof body?.avatar === 'string' ? body.avatar.trim() : ''
  if (username.length < 3) throw createError({ statusCode: 400, statusMessage: 'Username must be at least 3 characters.' })
  if (!displayName) throw createError({ statusCode: 400, statusMessage: 'Display name cannot be empty.' })
  const db = studioDb(event, identity)
  const exists = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1').bind(username, identity.userId).first<any>()
  if (exists) throw createError({ statusCode: 409, statusMessage: 'That username is already taken.' })
  // Flask stores the trimmed value unchanged, including an empty string.
  await db.prepare('UPDATE users SET username = ?, display_name = ?, bio = ?, avatar = ? WHERE id = ?').bind(username, displayName, bio, avatar, identity.userId).run()
  return { ok: true, username, message: 'Your profile has been updated.' }
})
