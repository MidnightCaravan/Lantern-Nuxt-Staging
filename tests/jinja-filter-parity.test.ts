import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { jinjaCapitalize, jinjaTruncate150 } from '../app/utils/lantern-format'

// The literal-copy gate covers static text. This gate covers the other blind
// spot: Jinja filters applied to dynamic values. Every filtered output in the
// pinned Flask snapshot must have a documented Nuxt counterpart; a new filter
// in the source therefore fails the build until it is handled.
const flaskTemplates = path.resolve(
  process.cwd(),
  'LANTERN_PARITY_SOURCE_BUNDLE_20261118-011830/original-flask/src/templates',
)

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

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

describe('Jinja filter parity', () => {
  it('handles every filtered output present in the Flask snapshot', async () => {
    const templates = (await readdir(flaskTemplates)).filter(
      name => name.endsWith('.html') && !name.includes('.before-') && !name.includes('.broken'),
    )
    const found = new Set<string>()
    for (const template of templates) {
      const source = await readFile(path.join(flaskTemplates, template), 'utf8')
      for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        const expression = normalize(match[1]!)
        if (expression.includes('|')) found.add(`${template}|{{ ${expression} }}`)
      }
    }

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
