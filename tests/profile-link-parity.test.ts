import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Flask builds profile URLs with url_for(), which quotes dynamic usernames.
// Several genuine staging accounts contain spaces, so an unencoded `/@${...}`
// link would not reproduce the Flask URL.
const files = [
  'app/components/LanternCommentNode.vue',
  'app/pages/comics/[id].vue',
  'app/pages/profile/edit.vue',
  'app/pages/works/[id].vue',
  'app/pages/works/[workId]/chapters/[chapterId].vue',
]

describe('profile link parity', () => {
  it('URL-encodes every dynamic profile username', () => {
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
      const unencoded = source.match(/\/`?@\$\{(?!encodeURIComponent\()[^}]+\}/g) ?? []
      expect(unencoded, file).toEqual([])
      if (/\/@\$\{/.test(source)) {
        expect(source, file).toContain('encodeURIComponent(')
      }
    }
  })
})
