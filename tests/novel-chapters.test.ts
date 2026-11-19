import { describe, expect, it } from 'vitest'
import createChapterHandler from '../server/api/studio/works/[workId]/chapters.post'
import autosaveHandler from '../server/api/studio/chapters/[chapterId]/autosave.post'
import saveChapterHandler from '../server/api/studio/chapters/[chapterId].put'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeChapter, type FakeWork } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const novelWork = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 3,
  creator_id: 7,
  title: 'Novel',
  description: '',
  type: 'Novel',
  status: 'draft',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const chapter = (overrides: Partial<FakeChapter> = {}): FakeChapter => ({
  id: 11,
  work_id: 3,
  chapter_number: 1,
  title: 'Old title',
  content: 'Old content',
  status: 'draft',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('POST /api/studio/works/:workId/chapters', () => {
  it('creates the next draft chapter for an owned Novel, matching Flask', async () => {
    const staging = createFakeD1({
      works: [novelWork()],
      chapters: [chapter({ id: 8, chapter_number: 4 })],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(createChapterHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(session),
      params: { workId: '3' },
      body: { title: '  New chapter  ', content: 'Body text', csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, chapterId: 9, chapterNumber: 5 })
    expect(staging.state.chapters[1]).toMatchObject({
      title: 'New chapter',
      content: 'Body text',
      status: 'draft',
      work_id: 3,
      chapter_number: 5,
    })
    expect(staging.state.works[0]!.updated_at).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('rejects blank titles, non-owner works, and non-Novel works', async () => {
    const staging = createFakeD1({ works: [novelWork(), novelWork({ id: 4, creator_id: 8 })], chapters: [] })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)

    const blank = await callHandler(createChapterHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(session),
      params: { workId: '3' },
      body: { title: '  ', content: '', csrfToken: TEST_CSRF },
    })
    expect(blank.status).toBe(400)

    const otherOwner = await callHandler(createChapterHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(session),
      params: { workId: '4' },
      body: { title: 'Hijack', content: '', csrfToken: TEST_CSRF },
    })
    expect(otherOwner.status).toBe(404)

    const comicWork = novelWork({ id: 5, type: 'Comic' })
    staging.state.works.push(comicWork)
    const wrongType = await callHandler(createChapterHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(session),
      params: { workId: '5' },
      body: { title: 'Not a novel', content: '', csrfToken: TEST_CSRF },
    })
    expect(wrongType.status).toBe(404)
    expect(staging.state.chapters).toHaveLength(0)
  })

  it('blocks chapter creation from a production session', async () => {
    const production = createFakeD1({ works: [novelWork()] })
    const staging = createFakeD1({ works: [novelWork()] })
    const env = testEnv(production, staging)
    const session = await makeSession(7, 'production', env)
    const result = await callHandler(createChapterHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(session),
      params: { workId: '3' },
      body: { title: 'Cannot create', content: '', csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(409)
    expect(staging.state.chapters).toHaveLength(0)
  })
})

describe('chapter save and autosave', () => {
  const handlers = [
    { name: 'manual save', handler: saveChapterHandler, successKey: 'ok' },
    { name: 'autosave', handler: autosaveHandler, successKey: 'success' },
  ] as const

  for (const { name, handler, successKey } of handlers) {
    it(`${name} saves owned draft content and stamps both records`, async () => {
      const staging = createFakeD1({
        works: [novelWork()],
        chapters: [chapter()],
      })
      const env = testEnv(createFakeD1(), staging)
      const session = await makeSession(7, 'staging', env)
      const result = await callHandler(handler, {
        env,
        method: 'POST',
        headers: csrfHeaders(session),
        params: { chapterId: '11' },
        body: { title: '  Revised title  ', content: 'Revised content', csrfToken: TEST_CSRF },
      })
      expect(result.status).toBe(200)
      expect(result.json).toMatchObject({ [successKey]: true })
      expect(staging.state.chapters[0]).toMatchObject({ title: 'Revised title', content: 'Revised content' })
      expect(staging.state.works[0]!.updated_at).toBe(staging.state.chapters[0]!.updated_at)
    })

    it(`${name} rejects blank titles, non-owners, and production sessions`, async () => {
      const production = createFakeD1({ works: [novelWork()], chapters: [chapter()] })
      const staging = createFakeD1({ works: [novelWork()], chapters: [chapter()] })
      const env = testEnv(production, staging)
      const owner = await makeSession(7, 'staging', env)
      const nonOwner = await makeSession(8, 'staging', env)
      const productionSession = await makeSession(7, 'production', env)

      const blank = await callHandler(handler, {
        env,
        method: 'POST',
        headers: csrfHeaders(owner),
        params: { chapterId: '11' },
        body: { title: ' ', content: 'x', csrfToken: TEST_CSRF },
      })
      const otherOwner = await callHandler(handler, {
        env,
        method: 'POST',
        headers: csrfHeaders(nonOwner),
        params: { chapterId: '11' },
        body: { title: 'Hijack', content: 'x', csrfToken: TEST_CSRF },
      })
      const productionResult = await callHandler(handler, {
        env,
        method: 'POST',
        headers: csrfHeaders(productionSession),
        params: { chapterId: '11' },
        body: { title: 'Cannot edit', content: 'x', csrfToken: TEST_CSRF },
      })

      expect(blank.status).toBe(400)
      expect(otherOwner.status).toBe(404)
      expect(productionResult.status).toBe(409)
      expect(staging.state.chapters[0]!.title).toBe('Old title')
      expect(production.state.chapters[0]!.title).toBe('Old title')
    })
  }
})
