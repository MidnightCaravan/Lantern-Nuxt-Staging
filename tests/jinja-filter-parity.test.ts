import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { jinjaCapitalize, jinjaTruncate150 } from '../app/utils/lantern-format'

// The literal-copy gate covers static text. This gate covers the other blind
// spot: Jinja filters applied to dynamic values. The pinned fixture contains
// every filtered output in the Nov 18 Flask snapshot, and every one must have a
// documented Nuxt counterpart. A new filter in the source therefore fails the
// build until it is handled.
const fixturePath = path.resolve(
  process.cwd(),
  'tests/fixtures/flask-template-parity-20261118.json',
)

type Fixture = {
  templates: Record<string, { filter_expressions: string[] }>
}

async function readFixture(): Promise<Fixture> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
}

const HANDLED: Record<string, string> = {
  'comic_episode.html|{{ pages|length }}': 'comic/episode/[episodeId]/edit.vue — pages.length',
  'comic_public.html|{{ "%02d"|format(episode.episode_number) }}': 'comics/[id].vue — padStart(2, "0")',
  'comic_reader.html|{{ pages|length }}': 'comic/episode/[episodeId]/read.vue — pages.length',
  'comic_reader.html|{{ (current_user.display_name or current_user.username)[0]|upper }}': 'LanternCommentNode.vue — charAt(0).toUpperCase()',
  'comic_reader.html|{{ episode.id|tojson }}': 'script-side episode id now comes from the route/API, not an inline literal',
  'comic_workspace.html|{{ work.status|upper }}': 'work/[workId]/comic/index.vue — work.status.toUpperCase()',
  'comic_workspace.html|{{ episodes|length }}': 'work/[workId]/comic/index.vue — episodes.length',
  'comic_workspace.html|{{ "%02d"|format(episode.episode_number) }}': 'work/[workId]/comic/index.vue — padStart(2, "0")',
  'comic_workspace.html|{{ episode.status|title }}': 'work/[workId]/comic/index.vue — charAt(0).toUpperCase() + slice(1)',
  'create_work_form.html|{{ work_label|lower }}': 'create/[workType].vue — label.toLowerCase()',
  'dashboard.html|{{ work.status|capitalize }}': 'dashboard.vue — jinjaCapitalize(work.status)',
  'discover.html|{{ work.type|upper }}': 'discover.vue — String(work.type).toUpperCase()',
  'discover.html|{{ work.description|truncate(150, True) }}': 'discover.vue — jinjaTruncate150(work.description)',
  'edit_work.html|{{ work.status|upper }}': 'work/[workId]/edit.vue — String(work.status).toUpperCase()',
  'index.html|{{ work["type"]|upper }}': 'index.vue — String(work.type).toUpperCase()',
  'novel_workspace.html|{{ work.status|upper }}': 'work/[workId]/novel/index.vue — String(work.status).toUpperCase()',
  'novel_workspace.html|{{ chapter.status|upper }}': 'work/[workId]/novel/index.vue — String(chapter.status).toUpperCase()',
  'profile.html|{{ works|length }}': '@[username].vue — works.length',
}

describe('Jinja filter parity', () => {
  it('handles every filtered output present in the Flask snapshot', async () => {
    const fixture = await readFixture()
    const found = new Set<string>()
    for (const [template, value] of Object.entries(fixture.templates)) {
      for (const expression of value.filter_expressions) {
        found.add(`${template}|{{ ${expression} }}`)
      }
    }

    expect([...found].sort()).toHaveLength(18)
    expect([...found].sort()).toEqual(Object.keys(HANDLED).sort())
  })

  it('reproduces Jinja capitalize', () => {
    expect(jinjaCapitalize('draft')).toBe('Draft')
    expect(jinjaCapitalize('published')).toBe('Published')
    expect(jinjaCapitalize('Novel')).toBe('Novel')
    expect(jinjaCapitalize('')).toBe('')
  })

  it('reproduces Jinja truncate(150, True) including the leeway boundary', () => {
    expect(jinjaTruncate150('x'.repeat(150))).toBe('x'.repeat(150))
    expect(jinjaTruncate150('x'.repeat(155))).toBe('x'.repeat(155))
    expect(jinjaTruncate150('x'.repeat(156))).toBe(`${'x'.repeat(147)}...`)
    expect(jinjaTruncate150('x'.repeat(200))).toBe(`${'x'.repeat(147)}...`)
    expect(jinjaTruncate150('')).toBe('')
  })
})
