export interface LanternAuthUser {
  id: number
  username: string
  displayName: string
  avatar: string | null
}

export function useLanternAuth() {
  const flash = useLanternFlash()
  const user = useState<LanternAuthUser | null>(
    'lantern-auth-user',
    () => null
  )

  const loaded = useState<boolean>(
    'lantern-auth-loaded',
    () => false
  )

  const refreshing = useState<boolean>(
    'lantern-auth-refreshing',
    () => false
  )

  async function refresh(force = false): Promise<LanternAuthUser | null> {
    if (loaded.value && !force) return user.value

    if (refreshing.value) return user.value

    refreshing.value = true

    try {
      if (import.meta.server) {
        // Flask renders the header's auth links in base.html from current_user
        // on every request. Internal SSR fetches do not inherit the Cloudflare
        // env, so resolve the session from the original request event using
        // the same helpers as /api/auth/me and middleware/auth.ts. This makes
        // Dashboard/Log Out or Log In/Join Free present in the first HTML.
        // Capture the request context before awaiting the dynamic imports;
        // otherwise the composable runs outside the Nuxt instance and the
        // signed-in header silently falls back to the anonymous links.
        const event = useRequestEvent() as any
        const [{ getLanternSessionIdentity }, { getLanternDatabaseForSession }] = await Promise.all([
          import('../../server/utils/lantern-auth'),
          import('../../server/utils/lantern-public'),
        ])
        const identity = await getLanternSessionIdentity(event)
        if (!identity) {
          user.value = null
        } else {
          const db = getLanternDatabaseForSession(event, identity.database)
          const row = await db.prepare(`
            SELECT id, username, display_name, avatar, email_verified
            FROM users WHERE id = ? LIMIT 1
          `).bind(identity.userId).first<any>()
          user.value = row && Number(row.email_verified) === 1
            ? {
                id: Number(row.id),
                username: String(row.username),
                displayName: String(row.display_name || row.username),
                avatar: row.avatar ? String(row.avatar) : null,
              }
            : null
        }
      } else {
        const result = await $fetch<{ user: LanternAuthUser | null }>(
          '/api/auth/me'
        )
        user.value = result.user
      }
      loaded.value = true
      return user.value
    } catch {
      user.value = null
      loaded.value = true
      return null
    } finally {
      refreshing.value = false
    }
  }

  async function logout() {
    const csrf = await $fetch<{ csrfToken: string }>('/api/auth/csrf')

    const result = await $fetch<{ ok: boolean; message: string }>('/api/auth/logout', {
      method: 'POST',
      body: { csrfToken: csrf.csrfToken },
    })

    user.value = null
    loaded.value = true
    // Flask stores this as a one-time flash rather than showing it on the
    // homepage; preserve that behavior for the next flash-rendering page.
    flash.set(result.message, 'success')
    return result
  }

  return {
    user,
    loaded,
    refresh,
    logout,
  }
}
