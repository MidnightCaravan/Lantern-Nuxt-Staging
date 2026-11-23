import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const middleware = readFileSync(
  path.join(process.cwd(), 'app/middleware/auth.ts'),
  'utf8',
)

const authComposable = readFileSync(
  path.join(process.cwd(), 'app/composables/useLanternAuth.ts'),
  'utf8',
)

describe('SSR auth guard parity', () => {
  it('resolves the session from the original request event', () => {
    expect(middleware).toContain("import('../../server/utils/lantern-auth')")
    expect(middleware).toContain('getLanternSessionIdentity(event)')
    expect(middleware).toContain('getLanternDatabaseForSession(event, identity.database)')
    expect(middleware).not.toContain("requestFetch<{ user: LanternGuardUser | null }>('/api/auth/me'")
  })

  it('captures the SSR request event before the first await', () => {
    // Nuxt composables must be called while the request context is active.
    // Calling useRequestEvent() after `await Promise.all(...)` raises
    // NUXT_E1001 and makes signed-in public pages render anonymous links.
    for (const [label, source] of [
      ['middleware', middleware],
      ['composable', authComposable],
    ] as const) {
      const eventIndex = source.indexOf('useRequestEvent()')
      const awaitIndex = source.indexOf('await Promise.all([')
      expect(eventIndex, `${label}: useRequestEvent`).toBeGreaterThanOrEqual(0)
      expect(awaitIndex, `${label}: dynamic import await`).toBeGreaterThanOrEqual(0)
      expect(eventIndex, label).toBeLessThan(awaitIndex)
    }
  })

  it('keeps the Flask login redirect for unauthenticated navigation', () => {
    expect(middleware).toContain("await $fetch<{ user: LanternGuardUser | null }>('/api/auth/me')")
    expect(middleware).toContain("path: '/login'")
    expect(middleware).toContain("reason: 'login-required'")
  })

  it('guards every Flask login_required page, including dashboard and profile edit', () => {
    for (const page of [
      'app/pages/dashboard.vue',
      'app/pages/profile/edit.vue',
      'app/pages/work/[workId]/novel/index.vue',
      'app/pages/comic/episode/[episodeId]/edit.vue',
    ]) {
      const source = readFileSync(path.join(process.cwd(), page), 'utf8')
      expect(source, page).toContain("middleware: ['auth']")
    }
  })
})
