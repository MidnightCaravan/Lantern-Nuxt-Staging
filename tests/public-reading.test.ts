import { describe, expect, it } from 'vitest'
import healthHandler from '../server/api/public/health.get'
import worksListHandler from '../server/api/public/works.get'
import workDetailHandler from '../server/api/public/works/[id].get'
import chapterHandler from '../server/api/public/works/[id]/chapters/[chapterId].get'
import comicEpisodeHandler from '../server/api/public/comic-episodes/[id].get'
import discussionListHandler from '../server/api/discussions/[kind]/[targetId].get'
import comicReaderHandler from '../server/api/comic/episodes/[episodeId]/read.get'
import { callHandler } from './helpers/handler'
import {
  createFakeD1,
  type FakeChapter,
  type FakeComicEpisode,
  type FakeComicPage,
  type FakeUser,
  type FakeWork,
} from './helpers/fake-d1'
import { makeSession, testEnv, TEST_SECRET } from './helpers/session'

const LEGACY_BASE = 'https://lantern.midnightcaravans.workers.dev'
const OLD_TIME = '2026-01-01T00:00:00.000Z'

const user = (id: number, name: string): FakeUser => ({
  id,
  username: name,
  email: `${name}@example.com`,
  password_hash: 'test-hash',
  display_name: name.toUpperCase(),
  email_verified: 1,
})

const work = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 1,
  creator_id: 7,
  title: 'Published work',
  description: 'Description',
  type: 'Novel',
  status: 'published',
  cover: '/media/covers/work.png',
  video_path: null,
  updated_at: '2026-04-01T00:00:00.000Z',
  ...overrides,
})

const chapter = (overrides: Partial<FakeChapter> = {}): FakeChapter => ({
  id: 11,
  work_id: 1,
  chapter_number: 1,
  title: 'Chapter 1',
  content: 'Chapter 1 content',
  status: 'published',
  created_at: OLD_TIME,
  updated_at: '2026-04-01T00:00:00.000Z',
  ...overrides,
})

const episode = (overrides: Partial<FakeComicEpisode> = {}): FakeComicEpisode => ({
  id: 21,
  work_id: 2,
  episode_number: 1,
  title: 'Episode 1',
  status: 'published',
  created_at: OLD_TIME,
  updated_at: '2026-04-01T00:00:00.000Z',
  ...overrides,
})

const page = (overrides: Partial<FakeComicPage> = {}): FakeComicPage => ({
  id: 41,
  episode_id: 21,
  page_number: 1,
  image_path: 'uploads/comics/2/21/page-1.png',
  created_at: OLD_TIME,
  ...overrides,
})

function readOptions(params: Record<string, string> = {}, path = '/api/test', headers: Record<string, string> = {}) {
  return { params, path, headers }
}

describe('public work discovery', () => {
  it('returns only published works, newest first, with Flask-compatible type and limit filters', async () => {
    const production = createFakeD1({
      users: [user(7, 'author')],
      works: [
        work({ id: 1, type: 'Novel', updated_at: '2026-03-01T00:00:00.000Z' }),
        work({ id: 2, type: 'Comic', title: 'Comic', updated_at: '2026-04-01T00:00:00.000Z' }),
        work({ id: 3, type: 'Video', title: 'Video', updated_at: '2026-02-01T00:00:00.000Z' }),
        work({ id: 4, type: 'Novel', status: 'draft', updated_at: '2026-05-01T00:00:00.000Z' }),
      ],
    })
    const staging = createFakeD1({
      users: [user(7, 'author')],
      works: [
        work({ id: 10, type: 'Novel', title: 'Staged novel', cover: '/media/staging-cover.png', updated_at: '2026-06-01T00:00:00.000Z' }),
        work({ id: 11, type: 'Comic', status: 'draft' }),
      ],
    })
    const env = testEnv(production, staging)

    const all = await callHandler(worksListHandler, { env, ...readOptions() })
    expect(all.status).toBe(200)
    expect(all.json).toMatchObject({ source: 'production', type: 'all' })
    expect(all.json.works.map((item: any) => item.id)).toEqual([2, 1, 3])

    const novels = await callHandler(worksListHandler, { env, ...readOptions({}, '/api/test?type=novel') })
    expect(novels.json.works.map((item: any) => item.id)).toEqual([1])
    expect(novels.json.type).toBe('novel')

    const limited = await callHandler(worksListHandler, { env, ...readOptions({}, '/api/test?limit=2') })
    expect(limited.json.works.map((item: any) => item.id)).toEqual([2, 1])

    const stagingSession = await makeSession(7, 'staging', env)
    const staged = await callHandler(worksListHandler, { env, ...readOptions({}, '/api/test', { cookie: `lantern_nuxt_session=${stagingSession}` }) })
    expect(staged.json).toMatchObject({ source: 'staging' })
    expect(staged.json.works.map((item: any) => item.id)).toEqual([10])
    expect(staged.json.works[0].coverUrl).toBe('/media/staging-cover.png')
    expect(all.json.works[0].coverUrl).toBe(`${LEGACY_BASE}/media/covers/work.png`)

    const anonymousStaging = await callHandler(worksListHandler, { env, ...readOptions({}, '/api/test?source=staging') })
    const invalidSource = await callHandler(worksListHandler, { env, ...readOptions({}, '/api/test?source=bogus') })
    expect(anonymousStaging.status).toBe(404)
    expect(invalidSource.status).toBe(400)
  })
})

describe('public work detail', () => {
  it('lists only published chapters and episodes and uses the selected source for media', async () => {
    const production = createFakeD1({
      users: [user(7, 'author')],
      works: [
        work({ id: 1, type: 'Novel' }),
        work({ id: 2, type: 'Comic', title: 'Comic', cover: '/media/covers/comic.png' }),
        work({ id: 4, type: 'Novel', status: 'draft' }),
      ],
      chapters: [
        chapter({ id: 11 }),
        chapter({ id: 12, chapter_number: 2, title: 'Draft chapter', status: 'draft' }),
      ],
      comicEpisodes: [
        episode({ id: 21, work_id: 2 }),
        episode({ id: 22, work_id: 2, episode_number: 2, title: 'Draft episode', status: 'draft' }),
      ],
      comicPages: [page({ id: 41, episode_id: 21 })],
    })
    const staging = createFakeD1({
      users: [user(7, 'author')],
      works: [work({ id: 10, type: 'Novel', title: 'Staged novel', cover: '/media/staging-cover.png' })],
      chapters: [chapter({ id: 101, work_id: 10 })],
    })
    const env = testEnv(production, staging)
    const stagingSession = await makeSession(7, 'staging', env)

    const novel = await callHandler(workDetailHandler, { env, ...readOptions({ id: '1' }) })
    expect(novel.status).toBe(200)
    expect(novel.json.source).toBe('production')
    expect(novel.json.work.contentSource).toBe('production')
    expect(novel.json.work.coverUrl).toBe(`${LEGACY_BASE}/media/covers/work.png`)
    expect(novel.json.chapters.map((item: any) => item.id)).toEqual([11])

    const comic = await callHandler(workDetailHandler, { env, ...readOptions({ id: '2' }) })
    expect(comic.status).toBe(200)
    expect(comic.json.episodes.map((item: any) => item.id)).toEqual([21])
    expect(comic.json.episodes[0]).toMatchObject({ page_count: 1 })

    const staged = await callHandler(workDetailHandler, {
      env,
      ...readOptions({ id: '10' }, '/api/test', { cookie: `lantern_nuxt_session=${stagingSession}` }),
    })
    expect(staged.status).toBe(200)
    expect(staged.json.work).toMatchObject({ contentSource: 'staging' })
    expect(staged.json.work.coverUrl).toBe('/media/staging-cover.png')

    const draft = await callHandler(workDetailHandler, { env, ...readOptions({ id: '4' }) })
    expect(draft.status).toBe(404)
  })
})

describe('published novel reader', () => {
  it('hides draft chapters and skips them in previous/next navigation', async () => {
    const production = createFakeD1({
      users: [user(7, 'author')],
      works: [work({ id: 1, type: 'Novel' })],
      chapters: [
        chapter({ id: 11, chapter_number: 1 }),
        chapter({ id: 12, chapter_number: 2, title: 'Chapter 2', content: 'Chapter 2 content' }),
        chapter({ id: 13, chapter_number: 3, title: 'Draft chapter', status: 'draft' }),
        chapter({ id: 14, chapter_number: 4, title: 'Chapter 4', content: 'Chapter 4 content' }),
      ],
    })
    const env = testEnv(production, createFakeD1())

    const result = await callHandler(chapterHandler, { env, ...readOptions({ id: '1', chapterId: '12' }) })
    expect(result.status).toBe(200)
    expect(result.json.source).toBe('production')
    expect(result.json.chapter).toMatchObject({ id: 12, title: 'Chapter 2' })
    expect(result.json.previous).toMatchObject({ id: 11 })
    expect(result.json.next).toMatchObject({ id: 14 })

    const draftChapter = await callHandler(chapterHandler, { env, ...readOptions({ id: '1', chapterId: '13' }) })
    expect(draftChapter.status).toBe(404)

    production.state.works[0]!.status = 'draft'
    const draftWork = await callHandler(chapterHandler, { env, ...readOptions({ id: '1', chapterId: '12' }) })
    expect(draftWork.status).toBe(404)
  })
})

describe('published comic reader', () => {
  it('serves public episodes with production media and published-only navigation', async () => {
    const production = createFakeD1({
      users: [user(7, 'author')],
      works: [work({ id: 2, type: 'Comic', title: 'Comic' })],
      comicEpisodes: [
        episode({ id: 21, work_id: 2 }),
        episode({ id: 22, work_id: 2, episode_number: 2, title: 'Draft episode', status: 'draft' }),
        episode({ id: 23, work_id: 2, episode_number: 3, title: 'Episode 3' }),
      ],
      comicPages: [page({ id: 41, episode_id: 21 })],
    })
    const env = testEnv(production, createFakeD1())

    const result = await callHandler(comicReaderHandler, { env, ...readOptions({ episodeId: '21' }) })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ source: 'production', isPreview: false })
    expect(result.json.episode).toMatchObject({ id: 21, workTitle: 'Comic' })
    expect(result.json.pages).toEqual([{ id: 41, pageNumber: 1, imageUrl: `${LEGACY_BASE}/media/uploads/comics/2/21/page-1.png` }])
    expect(result.json.previous).toBeNull()
    expect(result.json.next).toMatchObject({ id: 23 })

    const draftEpisode = await callHandler(comicReaderHandler, { env, ...readOptions({ episodeId: '22' }) })
    expect(draftEpisode.status).toBe(404)
  })

  it('lets the owner preview a draft episode from the staging database', async () => {
    const staging = createFakeD1({
      users: [user(7, 'author')],
      works: [work({ id: 10, type: 'Comic', title: 'Staged comic', status: 'draft' })],
      comicEpisodes: [
        episode({ id: 29, work_id: 10, episode_number: 0, title: 'Earlier draft', status: 'draft' }),
        episode({ id: 30, work_id: 10, episode_number: 1, title: 'Draft episode', status: 'draft' }),
        episode({ id: 31, work_id: 10, episode_number: 2, title: 'Ready episode' }),
      ],
      comicPages: [page({ id: 50, episode_id: 30, image_path: 'uploads/comics/10/30/page-1.png' })],
    })
    const env = testEnv(createFakeD1(), staging)
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)

    const preview = await callHandler(comicReaderHandler, {
      env,
      ...readOptions({ episodeId: '30' }, '/api/test?preview=1', { cookie: `lantern_nuxt_session=${owner}` }),
    })
    expect(preview.status).toBe(200)
    expect(preview.json).toMatchObject({ source: 'staging', isPreview: true })
    expect(preview.json.pages[0].imageUrl).toBe('/api/comic/pages/50/media')
    expect(preview.json.previous).toMatchObject({ id: 29 })
    expect(preview.json.next).toMatchObject({ id: 31 })

    const anonymous = await callHandler(comicReaderHandler, { env, ...readOptions({ episodeId: '30' }, '/api/test?preview=1') })
    const nonOwner = await callHandler(comicReaderHandler, {
      env,
      ...readOptions({ episodeId: '30' }, '/api/test?preview=1', { cookie: `lantern_nuxt_session=${otherUser}` }),
    })
    expect(anonymous.status).toBe(404)
    expect(nonOwner.status).toBe(404)
  })

  it('reads a published staging episode through the canonical reader with source=staging', async () => {
    const staging = createFakeD1({
      users: [user(7, 'author')],
      works: [work({ id: 10, type: 'Comic', title: 'Staged comic' })],
      comicEpisodes: [episode({ id: 30, work_id: 10 })],
      comicPages: [page({ id: 50, episode_id: 30, image_path: 'uploads/comics/10/30/page-1.png' })],
    })
    const env = testEnv(createFakeD1(), staging)
    const stagedSession = await makeSession(7, 'staging', env)

    const result = await callHandler(comicReaderHandler, {
      env,
      ...readOptions({ episodeId: '30' }, '/api/test?source=staging', { cookie: `lantern_nuxt_session=${stagedSession}` }),
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ source: 'staging', isPreview: false })
    expect(result.json.episode).toMatchObject({ id: 30, workTitle: 'Staged comic' })
    expect(result.json.pages).toEqual([{ id: 50, pageNumber: 1, imageUrl: '/media/uploads/comics/10/30/page-1.png' }])

    const anonymous = await callHandler(comicReaderHandler, {
      env,
      ...readOptions({ episodeId: '30' }, '/api/test?source=staging'),
    })
    expect(anonymous.status).toBe(404)
  })

  it('exposes published episode details and pages through the public API', async () => {
    const production = createFakeD1({
      users: [user(7, 'author')],
      works: [work({ id: 2, type: 'Comic', title: 'Comic' })],
      comicEpisodes: [
        episode({ id: 21, work_id: 2 }),
        episode({ id: 22, work_id: 2, episode_number: 2, title: 'Draft episode', status: 'draft' }),
        episode({ id: 23, work_id: 2, episode_number: 3, title: 'Episode 3' }),
      ],
      comicPages: [page({ id: 41, episode_id: 21 })],
    })
    const env = testEnv(production, createFakeD1())

    const result = await callHandler(comicEpisodeHandler, { env, ...readOptions({ id: '21' }) })
    expect(result.status).toBe(200)
    expect(result.json.source).toBe('production')
    expect(result.json.work).toMatchObject({ title: 'Comic' })
    expect(result.json.pages).toEqual([{ id: 41, page_number: 1, image_path: 'uploads/comics/2/21/page-1.png', imageUrl: `${LEGACY_BASE}/media/uploads/comics/2/21/page-1.png` }])
    expect(result.json.next).toMatchObject({ id: 23 })
  })
})

describe('staging public reads without production fallback', () => {
  function stagingReadEnv(staging: any, publicReadDatabase = 'staging') {
    return {
      LANTERN_NUXT_SESSION_SECRET: TEST_SECRET,
      LANTERN_ANONYMOUS_WRITE_DATABASE: 'staging',
      LANTERN_PUBLIC_READ_DATABASE: publicReadDatabase,
      lantern_db: undefined,
      lantern_staging_db: staging,
      lantern_staging_media: undefined,
    }
  }

  function stagingContent() {
    return createFakeD1({
      users: [user(7, 'author')],
      works: [
        work({ id: 10, type: 'Novel', title: 'Staged novel', cover: '/media/staging-cover.png' }),
        work({ id: 11, type: 'Comic', title: 'Staged comic', updated_at: '2026-06-01T00:00:00.000Z' }),
      ],
      chapters: [chapter({ id: 101, work_id: 10 })],
      comicEpisodes: [episode({ id: 30, work_id: 11, episode_number: 1, title: 'Staged episode' })],
      comicPages: [page({ id: 50, episode_id: 30, image_path: 'uploads/comics/11/30/page-1.png' })],
      comments: [{
        id: 600,
        user_id: 7,
        parent_id: null,
        body: 'Staging comment',
        created_at: '2026-05-01T00:00:00.000Z',
        content_type: 'novel',
        content_id: 10,
      }],
    })
  }

  it('serves anonymous discovery, health, detail, readers and discussions from staging', async () => {
    const env = stagingReadEnv(stagingContent())

    const health = await callHandler(healthHandler, { env, ...readOptions() })
    expect(health.status).toBe(200)
    expect(health.json).toMatchObject({ ok: true, source: 'staging', publishedWorks: 2 })

    const list = await callHandler(worksListHandler, { env, ...readOptions() })
    expect(list.status).toBe(200)
    expect(list.json).toMatchObject({ source: 'staging' })
    expect(list.json.works.map((item: any) => item.id)).toEqual([11, 10])
    expect(list.json.works[0].coverUrl).toBe('/media/covers/work.png')

    const detail = await callHandler(workDetailHandler, { env, ...readOptions({ id: '10' }) })
    expect(detail.status).toBe(200)
    expect(detail.json).toMatchObject({ source: 'staging' })
    expect(detail.json.work.coverUrl).toBe('/media/staging-cover.png')

    const chapterResult = await callHandler(chapterHandler, { env, ...readOptions({ id: '10', chapterId: '101' }) })
    expect(chapterResult.status).toBe(200)
    expect(chapterResult.json).toMatchObject({ source: 'staging' })

    const comicDetail = await callHandler(workDetailHandler, { env, ...readOptions({ id: '11' }) })
    expect(comicDetail.status).toBe(200)
    expect(comicDetail.json.episodes.map((item: any) => item.id)).toEqual([30])

    const comicReader = await callHandler(comicReaderHandler, { env, ...readOptions({ episodeId: '30' }) })
    expect(comicReader.status).toBe(200)
    expect(comicReader.json).toMatchObject({ source: 'staging', isPreview: false })
    expect(comicReader.json.pages[0].imageUrl).toBe('/media/uploads/comics/11/30/page-1.png')

    const publicComic = await callHandler(comicEpisodeHandler, { env, ...readOptions({ id: '30' }) })
    expect(publicComic.status).toBe(200)
    expect(publicComic.json.source).toBe('staging')

    const discussion = await callHandler(discussionListHandler, {
      env,
      ...readOptions({ kind: 'work', targetId: '10' }),
    })
    expect(discussion.status).toBe(200)
    expect(discussion.json).toMatchObject({ source: 'staging', writable: false })
    expect(discussion.json.comments[0].body).toBe('Staging comment')
  })

  it('fails closed when the public read source is invalid', async () => {
    const env = stagingReadEnv(stagingContent(), 'bogus')
    const result = await callHandler(worksListHandler, { env, ...readOptions() })
    expect(result.status).toBe(503)
  })
})
