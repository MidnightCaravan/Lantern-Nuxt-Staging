import { describe, expect, it } from 'vitest'
import novelPublishHandler from '../server/api/studio/works/[workId]/novel/publish.post'
import comicPublishHandler from '../server/api/comic/works/[workId]/publish.post'
import episodePublishHandler from '../server/api/comic/episodes/[episodeId]/publish.post'
import videoPublishHandler from '../server/api/studio/works/[workId]/video/publish.post'
import { callHandler } from './helpers/handler'
import {
  createFakeD1,
  type FakeChapter,
  type FakeComicEpisode,
  type FakeComicPage,
  type FakeWork,
} from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const OLD_TIME = '2026-01-01T00:00:00.000Z'

const work = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 10,
  creator_id: 7,
  title: 'Work',
  description: '',
  type: 'Novel',
  status: 'draft',
  updated_at: OLD_TIME,
  ...overrides,
})

const chapter = (overrides: Partial<FakeChapter> = {}): FakeChapter => ({
  id: 1,
  work_id: 10,
  chapter_number: 1,
  title: 'Complete chapter',
  content: 'Saved content',
  status: 'draft',
  created_at: OLD_TIME,
  updated_at: OLD_TIME,
  ...overrides,
})

const episode = (overrides: Partial<FakeComicEpisode> = {}): FakeComicEpisode => ({
  id: 20,
  work_id: 10,
  episode_number: 1,
  title: 'Episode 1',
  status: 'draft',
  created_at: OLD_TIME,
  updated_at: OLD_TIME,
  ...overrides,
})

const page = (overrides: Partial<FakeComicPage> = {}): FakeComicPage => ({
  id: 40,
  episode_id: 20,
  page_number: 1,
  image_path: 'uploads/comics/10/20/page-1.png',
  created_at: OLD_TIME,
  ...overrides,
})

function options(session: string, params: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: csrfHeaders(session),
    params,
    body: { csrfToken: TEST_CSRF },
    ...extra,
  }
}

describe('novel publishing', () => {
  it('publishes complete chapters and demotes blank ones, matching Flask', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Novel', status: 'published' })],
      chapters: [
        chapter({ id: 1, status: 'draft' }),
        chapter({ id: 2, chapter_number: 2, title: '  ', content: 'Body', status: 'published' }),
        chapter({ id: 3, chapter_number: 3, title: 'Heading', content: '  ', status: 'published' }),
      ],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(novelPublishHandler, {
      env,
      ...options(session, { workId: '10' }),
    })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.works[0]).toMatchObject({ status: 'published' })
    expect(staging.state.chapters.map((item) => item.status)).toEqual(['published', 'draft', 'draft'])
    expect(new Set(staging.state.chapters.map((item) => item.updated_at)).size).toBe(1)
    expect(staging.state.chapters[0]!.updated_at).not.toBe(OLD_TIME)
    expect(staging.state.works[0]!.updated_at).toBe(staging.state.chapters[0]!.updated_at)
  })

  it('returns a Flask-style error and unpublishes a novel with no complete chapters', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Novel', status: 'published' })],
      chapters: [chapter({ title: '  ', content: 'Only whitespace', status: 'published' })],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(novelPublishHandler, {
      env,
      ...options(session, { workId: '10' }),
    })

    expect(result.status).toBe(400)
    expect(staging.state.works[0]).toMatchObject({ status: 'draft' })
    expect(staging.state.chapters[0]).toMatchObject({ status: 'draft' })
  })

  it('enforces ownership, Novel type, staging sessions, and CSRF', async () => {
    const staging = createFakeD1({
      works: [
        work({ id: 10, type: 'Novel' }),
        work({ id: 11, type: 'Comic' }),
        work({ id: 12, creator_id: 7, type: 'Novel' }),
      ],
    })
    const production = createFakeD1({ works: [work({ id: 10, type: 'Novel' })] })
    const env = testEnv(production, staging)
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const nonOwner = await callHandler(novelPublishHandler, { env, ...options(otherUser, { workId: '12' }) })
    const wrongType = await callHandler(novelPublishHandler, { env, ...options(owner, { workId: '11' }) })
    const productionResult = await callHandler(novelPublishHandler, { env, ...options(productionSession, { workId: '10' }) })
    const crossOrigin = await callHandler(novelPublishHandler, {
      env,
      ...options(owner, { workId: '10' }, {
        headers: { ...csrfHeaders(owner), origin: 'https://evil.example' },
      }),
    })

    expect([nonOwner.status, wrongType.status, productionResult.status, crossOrigin.status]).toEqual([404, 404, 409, 403])
    expect(staging.state.works.every((item) => item.status === 'draft')).toBe(true)
  })
})

describe('comic publishing', () => {
  it('publishes all episodes and the work only when every episode has a page', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Comic' })],
      comicEpisodes: [episode({ id: 20 }), episode({ id: 21, episode_number: 2, title: 'Episode 2' })],
      comicPages: [page({ id: 40, episode_id: 20 }), page({ id: 41, episode_id: 21, page_number: 1 })],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(comicPublishHandler, {
      env,
      ...options(session, { workId: '10' }),
    })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.works[0]).toMatchObject({ status: 'published' })
    expect(staging.state.comicEpisodes.map((item) => item.status)).toEqual(['published', 'published'])
    expect(staging.state.comicEpisodes.every((item) => item.updated_at === staging.state.works[0]!.updated_at)).toBe(true)
  })

  it('refuses to publish a comic with no episodes or with an empty episode', async () => {
    const noEpisodes = createFakeD1({ works: [work({ type: 'Comic' })] })
    const emptyEnv = testEnv(createFakeD1(), noEpisodes)
    const emptySession = await makeSession(7, 'staging', emptyEnv)
    const noEpisodeResult = await callHandler(comicPublishHandler, {
      env: emptyEnv,
      ...options(emptySession, { workId: '10' }),
    })
    expect(noEpisodeResult.status).toBe(400)
    expect(noEpisodes.state.works[0]).toMatchObject({ status: 'draft' })

    const staging = createFakeD1({
      works: [work({ type: 'Comic' })],
      comicEpisodes: [episode({ id: 20 }), episode({ id: 21, episode_number: 2 })],
      comicPages: [page({ id: 40, episode_id: 20 })],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const emptyEpisodeResult = await callHandler(comicPublishHandler, {
      env,
      ...options(session, { workId: '10' }),
    })
    expect(emptyEpisodeResult.status).toBe(400)
    expect(staging.state.works[0]).toMatchObject({ status: 'draft' })
    expect(staging.state.comicEpisodes.every((item) => item.status === 'draft')).toBe(true)
  })

  it('enforces comic ownership and production read-only rules', async () => {
    const staging = createFakeD1({ works: [work({ type: 'Comic' })] })
    const production = createFakeD1({ works: [work({ type: 'Comic' })] })
    const env = testEnv(production, staging)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const nonOwner = await callHandler(comicPublishHandler, { env, ...options(otherUser, { workId: '10' }) })
    const productionResult = await callHandler(comicPublishHandler, { env, ...options(productionSession, { workId: '10' }) })
    expect(nonOwner.status).toBe(404)
    expect(productionResult.status).toBe(409)
    expect(staging.state.works[0]).toMatchObject({ status: 'draft' })
  })
})

describe('comic episode publishing', () => {
  it('publishes an owned episode with pages without changing the work status', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Comic' })],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(episodePublishHandler, {
      env,
      ...options(session, { episodeId: '20' }),
    })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.comicEpisodes[0]).toMatchObject({ status: 'published' })
    expect(staging.state.comicEpisodes[0]!.updated_at).not.toBe(OLD_TIME)
    expect(staging.state.works[0]).toMatchObject({ status: 'draft', updated_at: OLD_TIME })
  })

  it('refuses an episode with no pages', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Comic' })],
      comicEpisodes: [episode()],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(episodePublishHandler, {
      env,
      ...options(session, { episodeId: '20' }),
    })
    expect(result.status).toBe(400)
    expect(staging.state.comicEpisodes[0]).toMatchObject({ status: 'draft' })
  })

  it('enforces episode ownership and production read-only rules', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Comic' })],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const production = createFakeD1({
      works: [work({ type: 'Comic' })],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const env = testEnv(production, staging)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const nonOwner = await callHandler(episodePublishHandler, { env, ...options(otherUser, { episodeId: '20' }) })
    const productionResult = await callHandler(episodePublishHandler, { env, ...options(productionSession, { episodeId: '20' }) })
    expect(nonOwner.status).toBe(404)
    expect(productionResult.status).toBe(409)
    expect(staging.state.comicEpisodes[0]).toMatchObject({ status: 'draft' })
  })
})

describe('video publishing', () => {
  it('refuses to publish before a video has been uploaded', async () => {
    const staging = createFakeD1({ works: [work({ type: 'Video' })] })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(videoPublishHandler, {
      env,
      ...options(session, { workId: '10' }),
    })
    expect(result.status).toBe(400)
    expect(staging.state.works[0]).toMatchObject({ status: 'draft' })
  })

  it('publishes an owned video after upload', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Video', video_path: 'uploads/videos/10/video.mp4' })],
    })
    const env = testEnv(createFakeD1(), staging)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(videoPublishHandler, {
      env,
      ...options(session, { workId: '10' }),
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.works[0]).toMatchObject({ status: 'published' })
    expect(staging.state.works[0]!.updated_at).not.toBe(OLD_TIME)
  })

  it('enforces video ownership and production read-only rules', async () => {
    const staging = createFakeD1({
      works: [work({ type: 'Video', video_path: 'uploads/videos/10/video.mp4' })],
    })
    const production = createFakeD1({
      works: [work({ type: 'Video', video_path: 'uploads/videos/10/video.mp4' })],
    })
    const env = testEnv(production, staging)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const nonOwner = await callHandler(videoPublishHandler, { env, ...options(otherUser, { workId: '10' }) })
    const productionResult = await callHandler(videoPublishHandler, { env, ...options(productionSession, { workId: '10' }) })
    expect(nonOwner.status).toBe(404)
    expect(productionResult.status).toBe(409)
    expect(staging.state.works[0]).toMatchObject({ status: 'draft' })
  })
})
