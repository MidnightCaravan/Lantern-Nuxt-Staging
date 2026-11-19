type LanternGuardUser = {
  id: number
  username: string
  displayName: string
  avatar: string | null
}

export default defineNuxtRouteMiddleware(async () => {
  const auth = useLanternAuth()
  const requestFetch = useRequestFetch()

  try {
    const result = await requestFetch<{ user: LanternGuardUser | null }>('/api/auth/me')
    auth.user.value = result.user ?? null
  } catch {
    auth.user.value = null
  }

  auth.loaded.value = true

  if (!auth.user.value) {
    return navigateTo({
      path: '/login',
      query: { reason: 'login-required' },
    })
  }
})
