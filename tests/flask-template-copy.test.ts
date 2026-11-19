import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Regression gate for the one-to-one UI migration. Every literal, human-visible
// string and form-attribute value in the pinned Flask template snapshot must
// still appear somewhere in the Nuxt pages, components or layout. This catches
// copy silently drifting during later edits without requiring a browser.
const flaskTemplates = path.resolve(
  process.cwd(),
  'LANTERN_PARITY_SOURCE_BUNDLE_20261118-011830/original-flask/src/templates',
)
const nuxtDirs = ['app/pages', 'app/components', 'app/layouts'].map(dir =>
  path.resolve(process.cwd(), dir),
)

// Cases where the rendered output matches Flask even though the source text
// differs. Each entry is justified by the cited implementation detail.
const SOURCE_ONLY_EXEMPTIONS = new Set([
  // Rendered from data rather than hard-coded; Flask's template shows the
  // initial zero value before its own JS loads the discussion/page count.
  '0 comments',
  '0 pages',
  // `.section-eyebrow` applies `text-transform: uppercase` in both copies of
  // lantern.css, so `Community` renders identically to Flask's `COMMUNITY`.
  'COMMUNITY',
])

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

function visibleStrings(source: string): string[] {
  const withoutScripts = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const values: string[] = []

  for (const match of withoutScripts.matchAll(/>([^<>]+)</g)) {
    values.push(normalize(match[1]!))
  }
  for (const match of withoutScripts.matchAll(
    /(?:placeholder|aria-label|alt|title|value)="([^"]+)"/g,
  )) {
    values.push(normalize(match[1]!))
  }

  return values.filter(
    value =>
      value.length >= 5 &&
      !value.includes('{') &&
      !value.includes('%') &&
      !/^[\W_]+$/.test(value) &&
      !SOURCE_ONLY_EXEMPTIONS.has(value),
  )
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
    const templates = (await readdir(flaskTemplates)).filter(
      name => name.endsWith('.html') && !name.includes('.before-') && !name.includes('.broken'),
    )
    const nuxtSource = normalize(
      (await Promise.all(nuxtDirs.map(vueFiles))).flat().join('\n'),
    )

    const missing: string[] = []
    for (const template of templates) {
      const source = await readFile(path.join(flaskTemplates, template), 'utf8')
      for (const value of new Set(visibleStrings(source))) {
        if (!nuxtSource.includes(value)) missing.push(`${template}: ${value}`)
      }
    }

    expect(missing).toEqual([])
  })
})
