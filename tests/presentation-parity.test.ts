import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const commentNode = readFileSync(
  path.join(process.cwd(), 'app/components/LanternCommentNode.vue'),
  'utf8',
)
const overrides = readFileSync(
  path.join(process.cwd(), 'public/css/lantern-nuxt-overrides.css'),
  'utf8',
)
const discover = readFileSync(
  path.join(process.cwd(), 'app/pages/discover.vue'),
  'utf8',
)
const layout = readFileSync(
  path.join(process.cwd(), 'app/layouts/default.vue'),
  'utf8',
)

describe('canonical presentation parity', () => {
  it('renders comment handles as inert text like Flask', () => {
    // work_discussion.html:306-309 and comic_reader.html:830-833 use
    // handle.textContent, not a profile link.
    expect(commentNode).toContain('<div class="comment-handle">@{{ comment.username }}</div>')
    expect(commentNode).not.toContain('NuxtLink class="comment-handle"')
  })

  it('matches canonical discover alt text and footer tooltip', () => {
    // discover.html:110 uses alt="{{ work.title }}" (unlike index.html, which
    // appends " cover").
    expect(discover).toContain(':alt="work.title"')
    expect(discover).not.toContain(':alt="`${work.title} cover`"')
    // base.html:59 marks the disabled footer link with the same tooltip as the
    // header link.
    expect(layout).toContain('<span class="footer-disabled" title="Creator directory coming soon">Creators</span>')
  })

  it('renders chapter bodies without the added card and with Flask line-height', () => {
    // chapter_public.html:23 uses white-space: pre-wrap; line-height: 1.8;
    // overflow-wrap: anywhere; and defines no .chapter-reader-content rule.
    const rule = overrides.split('\n').find(line => line.startsWith('.nuxt-chapter-content')) ?? ''
    expect(rule).toContain('line-height: 1.8')
    expect(rule).toContain('white-space: pre-wrap')
    expect(rule).toContain('overflow-wrap: anywhere')
    expect(rule).not.toContain('border:')
    expect(rule).not.toContain('background:')
    expect(rule).not.toContain('padding:')
  })
})
