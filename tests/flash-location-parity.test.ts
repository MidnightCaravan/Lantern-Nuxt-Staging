import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFile(path.resolve(process.cwd(), relative), 'utf8')
const excerptsPath = path.resolve(
  process.cwd(),
  'tests/fixtures/flask-template-source-excerpts-20261118.json',
)

type Excerpts = {
  templates: Record<string, { contains_flash_block?: boolean }>
}
const readExcerpts = async (): Promise<Excerpts> =>
  JSON.parse(await readFile(excerptsPath, 'utf8')) as Excerpts

describe('one-time flash display location parity (2026-11-22)', () => {
  it('Flask templates for publish/save destinations have no flash block', async () => {
    const { templates } = await readExcerpts()
    for (const template of ['chapter_editor.html', 'work.html', 'comic_public.html', 'base.html']) {
      expect(templates[template]?.contains_flash_block, template).toBe(false)
    }
  })

  it('does not consume the flash on the public novel/video work page', async () => {
    const source = await read('app/pages/works/[id].vue')
    expect(source).not.toContain('useLanternFlash')
    expect(source).not.toContain('publicationNotice')
    expect(source).not.toContain('publicationFlash')
  })

  it('does not consume or render a flash on the chapter editor', async () => {
    const source = await read('app/pages/chapter/[chapterId]/edit.vue')
    expect(source).not.toContain('useLanternFlash')
    expect(source).not.toContain("message.value = 'Chapter saved.'")
    expect(source).not.toContain('class="flash success">{{ message }}')
    // The Flask status bar still reports a saved state.
    expect(source).toContain("setStatus('Saved', 'saved')")
  })

  it('keeps flash consumers on pages whose Flask templates render flashes', async () => {
    const consumers: Array<[string, string]> = [
      ['app/pages/dashboard.vue', 'useLanternFlash().consume()'],
      ['app/pages/work/[workId]/novel/index.vue', 'flash.consume()'],
      ['app/pages/work/[workId]/comic/index.vue', 'flash.consume()'],
      ['app/pages/work/[workId]/edit.vue', 'flash.consume()'],
      ['app/pages/comic/episode/[episodeId]/edit.vue', 'useLanternFlash().consume()'],
      ['app/pages/login.vue', 'flash.consume()'],
    ]
    for (const [file, marker] of consumers) {
      const source = await read(file)
      expect(source, file).toContain(marker)
    }
  })

  it('leaves publication flashes queued for the next flash-rendering page', async () => {
    const novel = await read('app/pages/work/[workId]/novel/index.vue')
    const video = await read('app/pages/work/[workId]/edit.vue')
    const comic = await read('app/pages/work/[workId]/comic/index.vue')
    expect(novel).toContain("flash.set(result.message, 'success')")
    expect(video).toContain("flash.set(result.message, 'success')")
    expect(comic).toContain("flash.set(result.message, 'success')")
  })
})
