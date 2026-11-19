import { getLanternDatabaseForSession } from '../../utils/lantern-public'
import { getLanternSessionIdentity } from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const identity = await getLanternSessionIdentity(event)
  if (!identity) return { user: null }

  const db = getLanternDatabaseForSession(event, identity.database)
  const user = await db.prepare(`
    SELECT id, username, display_name, avatar, email_verified
    FROM users WHERE id = ? LIMIT 1
  `).bind(identity.userId).first<any>()

  if (!user || Number(user.email_verified) !== 1) return { user: null }
  return {
    database: identity.database,
    user: {
      id: Number(user.id),
      username: String(user.username),
      displayName: String(user.display_name || user.username),
      avatar: user.avatar ? String(user.avatar) : null,
    },
  }
})
