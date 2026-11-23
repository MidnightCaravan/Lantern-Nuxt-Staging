import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFile(path.resolve(process.cwd(), relative), 'utf8')

describe('comic workflow parity — publication flash and page delete (2026-11-22)', () => {
  it('queues Flask publication success message before redirecting to the public comic', async () => {
    const source = await read('app/pages/work/[workId]/comic/index.vue')
    expect(source).toContain("const result = await $fetch<{ message: string }>(`/api/comic/works/${workId.value}/publish`")
    expect(source).toContain("flash.set(result.message, 'success')")
    expect(source).toContain("navigateTo({ path: `/comics/${workId.value}`, query: { source: 'staging' } })")
  })

  it('shows no success banner after deleting a comic page', async () => {
    const source = await read('app/pages/comic/episode/[episodeId]/edit.vue')
    const deleteBody = source.slice(source.indexOf('async function deletePage'), source.indexOf('async function publishEpisode'))
    expect(deleteBody).not.toContain("message.value = 'Comic page deleted.'")
    expect(deleteBody).toContain('await refresh()')
  })
})

describe('discussion whitespace validation parity (work_discussion.html:437,271)', () => {
  it('shows Flasks root-comment error instead of a silently disabled button', async () => {
    const source = await read('app/components/LanternDiscussionPanel.vue')
    expect(source).toContain("rootStatus.value={text:'Write something before posting.',error:true}")
    expect(source).not.toContain(':disabled="submitting || !draft.trim()"')
    expect(source).toContain(':disabled="submitting"')
  })

  it('shows Flasks inline reply/edit error instead of a silently disabled button', async () => {
    const source = await read('app/components/LanternCommentNode.vue')
    expect(source).toContain("status.value='Write something before submitting.';statusError.value=true;return")
    expect(source).not.toContain(':disabled="sending || !body.trim()"')
    expect(source).toContain(':disabled="sending"')
  })
})
