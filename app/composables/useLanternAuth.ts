export interface LanternAuthUser {
  id: number
  username: string
  displayName: string
  avatar: string | null
}

export function useLanternAuth() {
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
      const result = await $fetch<{ user: LanternAuthUser | null }>(
        '/api/auth/me'
      )

      user.value = result.user
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

    await $fetch('/api/auth/logout', {
      method: 'POST',
      body: { csrfToken: csrf.csrfToken },
    })

    user.value = null
    loaded.value = true
  }

  return {
    user,
    loaded,
    refresh,
    logout,
  }
}
