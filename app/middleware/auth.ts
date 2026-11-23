type LanternGuardUser = {
  id: number
  username: string
  displayName: string
  avatar: string | null
}

export default defineNuxtRouteMiddleware(async () => {
  const auth = useLanternAuth()

  if (auth.loaded.value) return

  if (import.meta.server) {
    // Internal SSR fetches do not inherit the Cloudflare env, so resolve the
    // session from the original request event using the same server helpers
    // as /api/auth/me. This also keeps the identity available when Nuxt
    // reruns middleware while rendering a 404 error page.
    // Capture the Nuxt request context before the first await; composables
    // called after an await in this middleware lose the active instance.
    const event = useRequestEvent() as any
    const [{ getLanternSessionIdentity }, { getLanternDatabaseForSession }] = await Promise.all([
      import('../../server/utils/lantern-auth'),
      import('../../server/utils/lantern-public'),
    ])
    const identity = await getLanternSessionIdentity(event)
    if (!identity) {
      auth.user.value = null
    } else {
      const db = getLanternDatabaseForSession(event, identity.database)
      const user = await db.prepare(`
        SELECT id, username, display_name, avatar, email_verified
        FROM users WHERE id = ? LIMIT 1
      `).bind(identity.userId).first<any>()
      auth.user.value = user && Number(user.email_verified) === 1
        ? {
            id: Number(user.id),
            username: String(user.username),
            displayName: String(user.display_name || user.username),
            avatar: user.avatar ? String(user.avatar) : null,
          }
        : null
    }
  } else {
    try {
      const result = await $fetch<{ user: LanternGuardUser | null }>('/api/auth/me')
      auth.user.value = result.user ?? null
    } catch {
      auth.user.value = null
    }
  }

  auth.loaded.value = true

  if (!auth.user.value) {
    return navigateTo({
      path: '/login',
      query: { reason: 'login-required' },
    })
  }
})
