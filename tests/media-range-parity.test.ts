import { describe, expect, it } from 'vitest'
import mediaHandler from '../server/routes/media/[...key].get'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeWork } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { createFlaskMediaOrigin } from './helpers/flask-media-origin'
import { testEnv } from './helpers/session'

// Live evidence (2026-11-21, genuine staging objects, Flask media-origin
// reached through a Service Binding): a non-video Range request is served as
// the first N bytes where N is the number of request headers. The response is
// 200 with Content-Length N, no Content-Range and no Accept-Ranges, regardless
// of the Range value (including invalid and unsatisfiable values). The cover
// and page keys below are the exact keys emitted by the staging APIs.
const COVER_KEY = 'uploads/covers/3/cover.png'
const PAGE_KEY = 'uploads/comics/6/1/page-1-a8ea9b09d4ffd553.png'
const BODY = '0123456789abcdefghijklmnopqrstuvwxyz'

const work = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 3,
  creator_id: 4,
  title: 'WARDEN',
  description: '',
  type: 'Novel',
  status: 'published',
  cover: `/media/${COVER_KEY}`,
  video_path: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function localEnv() {
  const stagingDb = createFakeD1({
    works: [work(), work({ id: 6, title: 'The Lovers', type: 'Comic', cover: null })],
    comicEpisodes: [{ id: 2, work_id: 6, status: 'published' }],
    comicPages: [{ id: 1, episode_id: 2, image_path: PAGE_KEY }],
  })
  const staging = createFakeR2()
  return { staging, env: { ...testEnv(createFakeD1(), stagingDb, staging, createFakeR2()), LANTERN_PUBLIC_READ_DATABASE: 'staging' } }
}

function forwardedEnv() {
  const bucket = createFakeR2()
  const origin = createFlaskMediaOrigin(bucket)
  return { bucket, origin, env: { ...testEnv(createFakeD1(), createFakeD1(), createFakeR2(), bucket), LANTERN_MEDIA_ORIGIN: origin } }
}

// callHandler always adds an `origin` header, so the Flask range length is
// one plus the number of explicitly supplied headers.
const expectedLength = (headers: Record<string, string>) => 1 + Object.keys(headers).length

describe('non-video Range parity with the Flask media origin', () => {
  for (const key of [COVER_KEY, PAGE_KEY]) {
    it(`serves the Flask header-count prefix for ${key}`, async () => {
      const { staging, env } = localEnv()
      await staging.put(key, BODY, { httpMetadata: { contentType: 'image/png' } })

      for (const range of ['bytes=0-3', 'bytes=100-200', 'bytes=-1', 'bytes=abc', 'bytes=999999-']) {
        const headers = { range }
        const result = await callHandler(mediaHandler, { env, params: { key }, headers })
        const length = expectedLength(headers)
        expect(result.status, range).toBe(200)
        expect(result.json, range).toBe(BODY.slice(0, length))
        expect(result.headers.get('content-length'), range).toBe(String(length))
        expect(result.headers.get('content-range'), range).toBeNull()
        expect(result.headers.get('accept-ranges'), range).toBeNull()
      }

      const extendedHeaders = { range: 'bytes=0-3', 'x-a': '1', 'x-b': '2' }
      const extended = await callHandler(mediaHandler, { env, params: { key }, headers: extendedHeaders })
      expect(extended.json).toBe(BODY.slice(0, expectedLength(extendedHeaders)))
      expect(extended.headers.get('content-length')).toBe(String(expectedLength(extendedHeaders)))
    })
  }

  it('serves the full object when no Range header is present', async () => {
    const { staging, env } = localEnv()
    await staging.put(COVER_KEY, BODY)
    const result = await callHandler(mediaHandler, { env, params: { key: COVER_KEY }, headers: {} })
    expect(result.status).toBe(200)
    expect(result.json).toBe(BODY)
    expect(result.headers.get('content-range')).toBeNull()
  })

  it('matches the Flask origin oracle on the forwarded path', async () => {
    const { bucket, env } = forwardedEnv()
    await bucket.put(COVER_KEY, BODY)
    const local = localEnv()
    await local.staging.put(COVER_KEY, BODY)

    const headers = { range: 'bytes=0-3', 'x-a': '1' }
    const nuxt = await callHandler(mediaHandler, { env, params: { key: COVER_KEY }, headers })
    const oracle = await callHandler(mediaHandler, { env: local.env, params: { key: COVER_KEY }, headers })

    expect(nuxt.status).toBe(oracle.status)
    expect(nuxt.json).toBe(oracle.json)
    expect(nuxt.headers.get('content-length')).toBe(oracle.headers.get('content-length'))
    expect(nuxt.headers.get('content-range')).toBe(oracle.headers.get('content-range'))
    expect(nuxt.json).toBe(BODY.slice(0, expectedLength(headers)))
  })

  it('caps the prefix at the object size', async () => {
    const { staging, env } = localEnv()
    await staging.put(PAGE_KEY, 'abc')
    const headers = { range: 'bytes=0-3', 'x-a': '1', 'x-b': '2', 'x-c': '3', 'x-d': '4' }
    const result = await callHandler(mediaHandler, { env, params: { key: PAGE_KEY }, headers })
    expect(result.status).toBe(200)
    expect(result.json).toBe('abc')
    expect(result.headers.get('content-length')).toBe('3')
  })
})
