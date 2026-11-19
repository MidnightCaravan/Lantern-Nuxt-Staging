import { createError } from 'h3'
import { getLanternDatabaseForSession, lanternMediaUrl } from '../utils/lantern-public'
import { getLanternSessionIdentity } from '../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const identity = await getLanternSessionIdentity(event)
  if (!identity) {
    throw createError({ statusCode: 401, statusMessage: 'Please log in.' })
  }

  const db = getLanternDatabaseForSession(event, identity.database)

  const user = await db.prepare(`
    SELECT id, username, display_name, avatar, email_verified
    FROM users WHERE id = ? LIMIT 1
  `).bind(identity.userId).first<any>()

  if (!user || Number(user.email_verified) !== 1) {
    throw createError({ statusCode: 401, statusMessage: 'Please log in.' })
  }

  const result = await db.prepare(`
    SELECT *
    FROM works
    WHERE creator_id = ?
    ORDER BY updated_at DESC
  `).bind(identity.userId).all<any>()

  const works = (result.results ?? []).map((work: any) => {
    const cover = typeof work.cover === 'string' ? work.cover : null
    let coverUrl = lanternMediaUrl(cover)

    if (identity.database === 'staging' && cover) {
      const key = cover.startsWith('/media/')
        ? cover.slice('/media/'.length)
        : cover.replace(/^\/+/, '')

      if (key.startsWith('uploads/covers/')) {
        coverUrl = `/api/staging-media?key=${encodeURIComponent(key)}`
      }
    }

    return {
      id: Number(work.id),
      title: String(work.title ?? ''),
      type: String(work.type ?? ''),
      status: String(work.status ?? 'draft'),
      coverUrl,
    }
  })

  return {
    user: {
      id: Number(user.id),
      username: String(user.username),
      displayName: String(user.display_name || user.username),
      avatar: user.avatar ? String(user.avatar) : null,
    },
    works,
    writable: identity.database === 'staging',
  }
})
