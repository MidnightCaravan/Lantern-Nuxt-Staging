import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Flask renders templates/404.html with HTTP 404 whenever a public or owned
// resource is missing (see docs/PARITY_AUDIT_20261119.md). Each Nuxt page that
// fetches such a resource must turn the 404 API response into the branded error
// page (`app/error.vue`) rather than an in-page card with HTTP 200.
const PAGES = [
  // Public readers
  'app/pages/works/[id].vue',
  'app/pages/comics/[id].vue',
  'app/pages/@[username].vue',
  'app/pages/comic-episodes/[id].vue',
  'app/pages/works/[workId]/chapters/[chapterId].vue',
  // Authenticated workspace / editor pages
  'app/pages/work/[workId]/novel/index.vue',
  'app/pages/work/[workId]/comic/index.vue',
  'app/pages/work/[workId]/edit.vue',
  'app/pages/work/[workId]/chapter/new.vue',
  'app/pages/chapter/[chapterId]/edit.vue',
  'app/pages/comic/episode/[episodeId]/edit.vue',
  'app/pages/comic/episode/[episodeId]/read.vue',
]

describe('missing-resource pages render the Flask 404', () => {
  for (const page of PAGES) {
    it(`${page} rethrows a 404 API response as the branded error page`, async () => {
      const source = await readFile(path.resolve(process.cwd(), page), 'utf8')
      expect(source).toContain('isLanternNotFound(')
      expect(source).toMatch(/throw createError\(\{\s*statusCode:\s*404/)
    })
  }

  it('/comics/:id rejects published non-comic works like Flask', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'app/pages/comics/[id].vue'), 'utf8')
    expect(source).toContain("String(data.value.work?.type).toLowerCase() !== 'comic'")
  })
})
