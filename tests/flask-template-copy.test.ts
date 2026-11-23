import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression gate for the one-to-one UI migration. The pinned fixture contains
// every literal, human-visible string extracted from the Nov 18 Flask template
// snapshot. Every such string must still appear somewhere in the Nuxt pages,
// components or layout. This catches copy silently drifting during later edits
// without requiring the untracked original Flask source bundle in CI.
const fixturePath = path.resolve(
  process.cwd(),
  'tests/fixtures/flask-template-parity-20261118.json',
)
const nuxtDirs = ['app/pages', 'app/components', 'app/layouts'].map(dir =>
  path.resolve(process.cwd(), dir),
)

type Fixture = {
  templates: Record<string, { visible_strings: string[] }>
  login_email_input_tag: string
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function normalize(value: string): string {
  let result = value
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    result = result.split(entity).join(replacement)
  }
  return result.replace(/\s+/g, ' ').trim()
}

async function readFixture(): Promise<Fixture> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
}

async function vueFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await vueFiles(full)))
    else if (entry.name.endsWith('.vue')) files.push(await readFile(full, 'utf8'))
  }
  return files
}

describe('Flask template copy parity', () => {
  it('keeps every literal Flask string present in the Nuxt source', async () => {
    const fixture = await readFixture()
    const templates = Object.entries(fixture.templates)
    const visibleStrings = templates.flatMap(([, value]) => value.visible_strings)

    expect(templates).toHaveLength(27)
    expect(visibleStrings).toHaveLength(310)
    expect(new Set(visibleStrings).size).toBe(254)

    const nuxtSource = normalize(
      (await Promise.all(nuxtDirs.map(vueFiles))).flat().join('\n'),
    )

    const missing: string[] = []
    for (const [template, value] of templates) {
      for (const string of value.visible_strings) {
        if (!nuxtSource.includes(string)) missing.push(`${template}: ${string}`)
      }
    }

    expect(missing).toEqual([])
  })

  it('login email input uses Flask autocomplete="email"', async () => {
    const fixture = await readFixture()
    const flask = fixture.login_email_input_tag
    const nuxt = await readFile(path.resolve(process.cwd(), 'app/pages/login.vue'), 'utf8')
    const emailInput = (source: string) =>
      source.match(/<input[^>]*id="email"[^>]*>/)?.[0] ?? ''
    expect(emailInput(flask)).toMatch(/autocomplete="email"/)
    expect(emailInput(nuxt)).toMatch(/autocomplete="email"/)
  })
})
