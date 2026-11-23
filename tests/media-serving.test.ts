import { describe, expect, it } from 'vitest'
import mediaHandler from '../server/routes/media/[...key].get'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeWork } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { makeSession, testEnv } from './helpers/session'

const VIDEO_KEY = 'uploads/videos/10/video.mp4'
const VIDEO_BYTES = 'abcdefghij'
const COVER_KEY = 'uploads/covers/10/cover.png'
const PAGE_KEY = 'uploads/comics/20/30/page-1.png'

const work = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 10,
  creator_id: 7,
  title: 'Work',
  description: '',
  type: 'Video',
  status: 'published',
  video_path: `/media/${VIDEO_KEY}`,
  cover: `/media/${COVER_KEY}`,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function readOptions(key: string, headers: Record<string, string> = {}) {
  return { params: { key }, headers }
}

describe('public media serving', () => {
  it('serves production video bytes with Flask-compatible range and cache headers', async () => {
    const production = createFakeR2()
    await production.put(VIDEO_KEY, VIDEO_BYTES, { httpMetadata: { contentType: 'video/mp4' } })
    const env = testEnv(createFakeD1(), createFakeD1(), createFakeR2(), production)

    const full = await callHandler(mediaHandler, { env, ...readOptions(VIDEO_KEY) })
    expect(full.status).toBe(200)
    expect(full.json).toBe(VIDEO_BYTES)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(full.headers.get('cache-control')).toBe('public, max-age=31536000')
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-length')).toBe(String(VIDEO_BYTES.length))

    const range = await callHandler(mediaHandler, { env, ...readOptions(VIDEO_KEY, { range: 'bytes=2-5' }) })
    expect(range.status).toBe(206)
    expect(range.json).toBe('cdef')
    expect(range.headers.get('content-range')).toBe(`bytes 2-5/${VIDEO_BYTES.length}`)
    expect(range.headers.get('content-length')).toBe('4')

    const suffix = await callHandler(mediaHandler, { env, ...readOptions(VIDEO_KEY, { range: 'bytes=-4' }) })
    expect(suffix.status).toBe(206)
    expect(suffix.json).toBe('ghij')
    expect(suffix.headers.get('content-range')).toBe(`bytes 6-9/${VIDEO_BYTES.length}`)

    const invalid = await callHandler(mediaHandler, { env, ...readOptions(VIDEO_KEY, { range: 'bytes=20-' }) })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe(`bytes */${VIDEO_BYTES.length}`)
  })

  it('applies Flask header-count prefixes to non-video ranges', async () => {
    const production = createFakeR2()
    await production.put(COVER_KEY, 'image-bytes', { httpMetadata: { contentType: 'image/png' } })
    const env = testEnv(createFakeD1(), createFakeD1(), createFakeR2(), production)

    // callHandler adds `origin`, so Flask's range length is the header count: 2.
    const result = await callHandler(mediaHandler, { env, ...readOptions(COVER_KEY, { range: 'bytes=0-3' }) })
    expect(result.status).toBe(200)
    expect(result.json).toBe('im')
    expect(result.headers.get('content-length')).toBe('2')
    expect(result.headers.get('content-range')).toBeNull()
    expect(result.headers.get('accept-ranges')).toBeNull()

    const extended = await callHandler(mediaHandler, {
      env,
      ...readOptions(COVER_KEY, { range: 'bytes=0-3', 'x-a': '1', 'x-b': '2' }),
    })
    expect(extended.json).toBe('imag')
    expect(extended.headers.get('content-length')).toBe('4')

    const empty = await callHandler(mediaHandler, { env, ...readOptions(COVER_KEY, { range: '' }) })
    expect(empty.json).toBe('image-bytes')
    expect(empty.headers.get('content-length')).toBeNull()
  })

  it('serves published staging media to staging sessions and draft staging media only to its owner', async () => {
    const stagingDb = createFakeD1({ works: [work()] })
    const production = createFakeR2()
    const staging = createFakeR2()
    await production.put(COVER_KEY, 'production-cover')
    await staging.put(COVER_KEY, 'staging-cover')
    const env = testEnv(createFakeD1(), stagingDb, staging, production)
    const owner = await makeSession(7, 'staging', env)
    const outsider = await makeSession(8, 'staging', env)

    const ownerResult = await callHandler(mediaHandler, {
      env,
      ...readOptions(COVER_KEY, { cookie: `lantern_nuxt_session=${owner}` }),
    })
    expect(ownerResult.status).toBe(200)
    expect(ownerResult.json).toBe('staging-cover')
    expect(ownerResult.headers.get('cache-control')).toBe('private, no-store')

    const publishedOutsider = await callHandler(mediaHandler, {
      env,
      ...readOptions(COVER_KEY, { cookie: `lantern_nuxt_session=${outsider}` }),
    })
    expect(publishedOutsider.json).toBe('staging-cover')
    expect(publishedOutsider.headers.get('cache-control')).toBe('private, no-store')

    stagingDb.state.works[0]!.status = 'draft'
    const draftOwner = await callHandler(mediaHandler, {
      env,
      ...readOptions(COVER_KEY, { cookie: `lantern_nuxt_session=${owner}` }),
    })
    const draftOutsider = await callHandler(mediaHandler, {
      env,
      ...readOptions(COVER_KEY, { cookie: `lantern_nuxt_session=${outsider}` }),
    })
    expect(draftOwner.json).toBe('staging-cover')
    expect(draftOutsider.json).toBe('production-cover')
    expect(draftOutsider.headers.get('cache-control')).toBe('public, max-age=31536000')

    const anonymous = await callHandler(mediaHandler, { env, ...readOptions(COVER_KEY) })
    expect(anonymous.json).toBe('production-cover')
  })

  it('serves a published comic page from staging to its owner', async () => {
    const stagingDb = createFakeD1({
      works: [work({ id: 20, type: 'Comic', video_path: null, cover: null })],
      comicEpisodes: [{ id: 30, work_id: 20, status: 'published' }],
      comicPages: [{ id: 40, episode_id: 30, image_path: PAGE_KEY }],
    })
    const staging = createFakeR2()
    await staging.put(PAGE_KEY, 'staging-page')
    const env = testEnv(createFakeD1(), stagingDb, staging, createFakeR2())
    const owner = await makeSession(7, 'staging', env)

    const result = await callHandler(mediaHandler, {
      env,
      ...readOptions(PAGE_KEY, { cookie: `lantern_nuxt_session=${owner}` }),
    })
    expect(result.status).toBe(200)
    expect(result.json).toBe('staging-page')
    expect(result.headers.get('content-type')).toBe('image/png')
    expect(result.headers.get('cache-control')).toBe('private, no-store')
  })

  it('serves published staging media anonymously when public reads are pinned to staging', async () => {
    const stagingDb = createFakeD1({
      works: [
        work(),
        work({ id: 20, type: 'Comic', video_path: null, cover: null }),
      ],
      comicEpisodes: [{ id: 30, work_id: 20, status: 'published' }],
      comicPages: [{ id: 40, episode_id: 30, image_path: PAGE_KEY }],
    })
    const staging = createFakeR2()
    const production = createFakeR2()
    await staging.put(COVER_KEY, 'staging-cover')
    await staging.put(PAGE_KEY, 'staging-page')
    await production.put(COVER_KEY, 'production-cover')
    const env = {
      ...testEnv(createFakeD1(), stagingDb, staging, production),
      LANTERN_PUBLIC_READ_DATABASE: 'staging',
    }

    const cover = await callHandler(mediaHandler, { env, ...readOptions(COVER_KEY) })
    expect(cover.status).toBe(200)
    expect(cover.json).toBe('staging-cover')
    expect(cover.headers.get('cache-control')).toBe('private, no-store')

    const page = await callHandler(mediaHandler, { env, ...readOptions(PAGE_KEY) })
    expect(page.status).toBe(200)
    expect(page.json).toBe('staging-page')
  })

  it('rejects traversal, missing objects, and unavailable storage', async () => {
    const production = createFakeR2()
    await production.put(COVER_KEY, 'image-bytes')
    const env = testEnv(createFakeD1(), createFakeD1(), createFakeR2(), production)

    const traversal = await callHandler(mediaHandler, { env, ...readOptions('uploads/../secret.png') })
    const backslash = await callHandler(mediaHandler, { env, ...readOptions('uploads\\secret.png') })
    const missing = await callHandler(mediaHandler, { env, ...readOptions('uploads/covers/10/missing.png') })
    expect([traversal.status, backslash.status, missing.status]).toEqual([404, 404, 404])

    const noStorage = await callHandler(mediaHandler, {
      env: testEnv(createFakeD1(), createFakeD1()),
      ...readOptions(COVER_KEY),
    })
    expect(noStorage.status).toBe(503)
  })
})
