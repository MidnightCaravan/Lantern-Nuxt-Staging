import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readerPage = readFileSync(
  path.join(process.cwd(), 'app/pages/comic/episode/[episodeId]/read.vue'),
  'utf8',
)
const comicsPage = readFileSync(
  path.join(process.cwd(), 'app/pages/comics/[id].vue'),
  'utf8',
)
const discussionPanel = readFileSync(
  path.join(process.cwd(), 'app/components/LanternDiscussionPanel.vue'),
  'utf8',
)
const cssOverrides = readFileSync(
  path.join(process.cwd(), 'public/css/lantern-nuxt-overrides.css'),
  'utf8',
)

describe('canonical comic reader navigation parity', () => {
  it('preserves preview state when navigating to adjacent episodes', () => {
    expect(readerPage).toContain("if (route.query.preview === '1') params.set('preview', '1')")
    expect(readerPage).toContain("if (source) params.set('source', String(source))")
    expect(readerPage).toContain('/comic/episode/${data.previous.id}/read${readerQuery}')
    expect(readerPage).toContain('/comic/episode/${data.next.id}/read${readerQuery}')
  })

  it('uses episodeNumber fields returned by the reader API', () => {
    expect(readerPage).toContain('data.previous.episodeNumber')
    expect(readerPage).toContain('data.next.episodeNumber')
    expect(readerPage).not.toContain('data.previous.episode_number')
    expect(readerPage).not.toContain('data.next.episode_number')
  })

  it('links the public comic episode list to the canonical reader', () => {
    expect(comicsPage).toContain('/comic/episode/${episode.id}/read?source=')
    expect(comicsPage).not.toContain('/comic-episodes/${episode.id}')
  })

  it('uses the Flask workspace back link and label for every reader mode', () => {
    expect(readerPage).toContain('<NuxtLink :to="`/work/${episode.workId}/comic`" class="button button-outline">← Back to Comic Workspace</NuxtLink>')
    expect(readerPage).not.toContain('← Back to Comic</NuxtLink>')
  })

  it('matches the Flask reader heading and empty-state copy', () => {
    expect(readerPage).toContain('<p class="section-eyebrow">{{ episode.workTitle }}</p>')
    expect(readerPage).not.toContain('Preview · Not yet publicly published')
    expect(readerPage).toContain('Upload the comic pages from the episode editor before previewing the episode.')
    expect(readerPage).toContain('aria-label="Episode navigation"')
  })

  it('keeps the canonical episode-discussion CSS with the discussion component', () => {
    expect(discussionPanel).toContain("class=\"work-discussion\" :class=\"{ 'episode-discussion': kind === 'episode' }\"")
    expect(discussionPanel).toContain('.episode-discussion .discussion-header')
    expect(discussionPanel).toContain('.episode-discussion .comment-form-user')
    expect(discussionPanel).toContain('.episode-discussion .comment-body')
    expect(discussionPanel).toContain('.episode-discussion .comment-inline-status.error')
    expect(cssOverrides).not.toContain('.work-discussion.episode-discussion')
  })
})
