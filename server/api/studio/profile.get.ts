import { createError } from 'h3'
import { requireStudioIdentity, studioDb } from '../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const db = studioDb(event, identity)
  const user = await db.prepare('SELECT id, username, email, display_name, bio, avatar, created_at, email_verified FROM users WHERE id = ? LIMIT 1').bind(identity.userId).first<any>()
  if (!user) throw createError({ statusCode: 404, statusMessage: 'Account not found.' })
  return { profile: user, writable: identity.database === 'staging' }
})
