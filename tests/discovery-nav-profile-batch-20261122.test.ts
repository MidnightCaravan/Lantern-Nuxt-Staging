import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFile(path.resolve(process.cwd(), relative), 'utf8')
const excerptsPath = path.resolve(
  process.cwd(),
  'tests/fixtures/flask-template-source-excerpts-20261118.json',
)

type Excerpts = {
  templates: Record<
    string,
    {
      saved_username_markers?: string[]
      contains_flash_block?: boolean
      discover_link_markers?: string[]
      contains_source_query?: boolean
    }
  >
}
const readExcerpts = async (): Promise<Excerpts> =>
  JSON.parse(await readFile(excerptsPath, 'utf8')) as Excerpts

describe('profile editor parity (2026-11-22 audit)', () => {
  it('Flask derives the public address and preview link from the saved DB row', async () => {
    const { templates } = await readExcerpts()
    expect(templates['edit_profile.html']?.saved_username_markers).toEqual([
      "value=\"{{ user['username'] or '' }}\"",
      "/@{{ user['username'] or '' }}",
      "username=user['username']",
    ])
    expect(templates['profile.html']?.contains_flash_block).toBe(false)
    expect(templates['dashboard.html']?.contains_flash_block).toBe(true)
  })

  it('uses the saved username in the hint and View Public Profile link', async () => {
    const source = await read('app/pages/profile/edit.vue')
    expect(source).toContain('const savedUsername = computed(() => String(profile.value?.username || \'\'))')
    expect(source).toContain('/@{{ savedUsername }}</small>')
    expect(source).toContain(':to="`/@${encodeURIComponent(savedUsername)}?source=staging`"')
    expect(source).not.toContain('/@{{ username }}</small>')
    expect(source).not.toContain(':to="`/@${encodeURIComponent(username)}?source=staging`"')
  })

  it('queues the update confirmation as a one-time flash instead of a lost local notice', async () => {
    const source = await read('app/pages/profile/edit.vue')
    expect(source).toContain("flash.set(r.message,'success')")
    expect(source).not.toContain('notice.value=r.message')
    expect(source).not.toContain('class="flash success">{{ notice }}')
  })
})

describe('creator URL lookup parity (2026-11-22 audit)', () => {
  it('queries the raw path segment without trimming or an 80-char 400', async () => {
    const source = await read('server/api/public/profiles/[username].get.ts')
    expect(source).toContain("const username=String(getRouterParam(event,'username')??'')")
    expect(source).not.toContain('.trim()')
    expect(source).not.toContain('username.length>80')
  })

  it('shows the 404 error page instead of an in-page card for non-404 API failures', async () => {
    const source = await read('app/pages/@[username].vue')
    expect(source).toContain('if (error.value) {')
    expect(source).toContain('statusCode: Number(error.value.statusCode) || 500')
    expect(source).toContain("statusMessage: 'Creator could not be loaded.'")
    expect(source).not.toContain('v-else-if="error || !profile"')
  })
})

describe('global navigation source consistency (2026-11-22 audit)', () => {
  it('Flask base.html uses canonical discover links with no source concept', async () => {
    const { templates } = await readExcerpts()
    const base = templates['base.html']
    expect(base?.discover_link_markers).toEqual([
      "url_for('discover', type='novel')",
      "url_for('discover')",
    ])
    expect(base?.contains_source_query).toBe(false)
  })

  it('preserves the current source on header and footer Discover links', async () => {
    const layout = await read('app/layouts/default.vue')
    expect(layout).toContain('function discoverHref(type?: string)')
    expect(layout).toContain("params.set('source', discoverSource.value)")
    expect(layout).toContain(':to="discoverHref()"')
    expect(layout).toContain(":to=\"discoverHref('novel')\"")
    expect(layout).not.toContain('to="/discover"')
    expect(layout).not.toContain('to="/discover?type=novel"')
  })

  it('resolves auth during SSR so header links are in the first HTML', async () => {
    const layout = await read('app/layouts/default.vue')
    expect(layout).toContain('await auth.refresh()')
    expect(layout).not.toContain('void auth.refresh()')
    const composable = await read('app/composables/useLanternAuth.ts')
    expect(composable).toContain('if (import.meta.server)')
    expect(composable).toContain("import('../../server/utils/lantern-auth')")
    expect(composable).toContain("import('../../server/utils/lantern-public')")
    expect(composable).toContain('const event = useRequestEvent() as any')
    expect(composable).toContain('getLanternDatabaseForSession(event, identity.database)')
  })
})
