import { describe, expect, it } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'
import getHandler from '../server/routes/media/[...key].get'
import headHandler from '../server/routes/media/[...key].head'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeWork } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { makeSession, testEnv } from './helpers/session'
import { createFlaskMediaOrigin } from './helpers/flask-media-origin'

const VIDEO_KEY = 'uploads/videos/10/video.mp4'
const VIDEO_BYTES = 'abcdefghij'
const IMAGE_KEY = 'uploads/covers/10/cover.png'
const IMAGE_BYTES = 'image-bytes'

function setup() {
  const bucket = createFakeR2()
  const origin = createFlaskMediaOrigin(bucket)
  const env = {
    ...testEnv(createFakeD1(), createFakeD1(), createFakeR2(), bucket),
    LANTERN_MEDIA_ORIGIN: origin,
  }
  return { bucket, origin, env }
}

// Handler-level adapter. h3's toWebHandler strips the HEAD body but preserves
// the headers set by the handler, including Content-Length.
function head(key: string, env: Record<string, any>, headers: Record<string, string> = {}) {
  return callHandler(headHandler, { env, params: { key }, headers, method: 'HEAD' })
}

// Final deployed adapter. Nitro's Cloudflare runtime calls handlers through
// node-mock-http's fetchNodeRequestHandler (nitropack/dist/runtime/internal/
// app.mjs), which strips Content-Length from every HEAD response. This is the
// behavior observed on the rehearsal Worker and is intentionally asserted
// separately from the handler-level tests above.
function deployedHead(key: string, env: Record<string, any>, headers: Record<string, string> = {}) {
  const app = createApp()
  app.use('/api/test', defineEventHandler(async (event) => {
    event.context.cloudflare = { env }
    event.context.params = { key }
    return headHandler(event)
  }))
  return fetchNodeRequestHandler(toNodeListener(app), '/api/test', {
    method: 'HEAD',
    headers: { host: 'localhost', origin: 'http://localhost', ...headers },
  })
}

describe('HEAD media handler parity with Flask (h3 web adapter)', () => {
  it('re-exports the exact same handler used by GET (single source of truth)', () => {
    expect(headHandler).toBe(getHandler)
  })

  it('Handler-level HEAD image via binding preserves 200 and headers, and forwards method HEAD', async () => {
    const { bucket, origin, env } = setup()
    await bucket.put(IMAGE_KEY, IMAGE_BYTES, { httpMetadata: { contentType: 'application/x-wrong' } })

    const result = await head(IMAGE_KEY, env)
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('image/png')
    expect(result.headers.get('cache-control')).toBe('public, max-age=31536000')
    expect(result.headers.get('accept-ranges')).toBeNull()
    expect(result.headers.get('content-range')).toBeNull()
    expect(origin.calls).toHaveLength(1)
    expect(origin.calls[0]!.method).toBe('HEAD')
  })

  it('Handler-level HEAD video via binding preserves Content-Length (stripped later by Nitro)', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const result = await head(VIDEO_KEY, env)
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('video/mp4')
    expect(result.headers.get('accept-ranges')).toBe('bytes')
    expect(result.headers.get('content-length')).toBe(String(VIDEO_BYTES.length))
    expect(result.headers.get('cache-control')).toBe('public, max-age=31536000')
  })

  it('Handler-level HEAD with a valid Range preserves Content-Length (stripped later by Nitro)', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const result = await head(VIDEO_KEY, env, { range: 'bytes=2-5' })
    expect(result.status).toBe(206)
    expect(result.headers.get('content-range')).toBe(`bytes 2-5/${VIDEO_BYTES.length}`)
    expect(result.headers.get('content-length')).toBe('4')
    expect(result.headers.get('accept-ranges')).toBe('bytes')
  })

  it('HEAD with a suffix Range preserves 206 and Content-Range', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const result = await head(VIDEO_KEY, env, { range: 'bytes=-4' })
    expect(result.status).toBe(206)
    expect(result.headers.get('content-range')).toBe(`bytes 6-9/${VIDEO_BYTES.length}`)
    expect(result.headers.get('content-length')).toBe('4')
  })

  // Handler-level HEAD responses carry no body in this adapter; status,
  // Content-Type and Content-Range must still be preserved verbatim. Final
  // Content-Length framing is asserted in the deployed-adapter suite below.
  it('HEAD preserves 404 for a missing object', async () => {
    const { env } = setup()
    const result = await head(IMAGE_KEY, env)
    expect(result.status).toBe(404)
    expect(result.headers.get('content-type')).toContain('text/plain')
    expect(result.json).toBeNull()
  })

  it('HEAD preserves both 416 variants and Content-Range', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const invalid = await head(VIDEO_KEY, env, { range: 'bytes=abc' })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe(`bytes */${VIDEO_BYTES.length}`)
    expect(invalid.json).toBeNull()

    const unsatisfiable = await head(VIDEO_KEY, env, { range: 'bytes=20-' })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${VIDEO_BYTES.length}`)
    expect(unsatisfiable.json).toBeNull()
  })

  it('HEAD preserves 502 when the R2 read fails', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)
    bucket.head.mockRejectedValueOnce(new Error('r2 unavailable'))

    const result = await head(VIDEO_KEY, env, { range: 'bytes=0-1' })
    expect(result.status).toBe(502)
    expect(result.json).toBeNull()
  })

  it('HEAD preserves the existing staging-preview behavior with the binding present', async () => {
    const work: FakeWork = {
      id: 10,
      creator_id: 7,
      title: 'Work',
      description: '',
      type: 'Video',
      status: 'published',
      video_path: `/media/${VIDEO_KEY}`,
      cover: `/media/${IMAGE_KEY}`,
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    const stagingDb = createFakeD1({ works: [work] })
    const stagingMedia = createFakeR2()
    await stagingMedia.put(IMAGE_KEY, 'staging-image')
    const bucket = createFakeR2()
    await bucket.put(IMAGE_KEY, IMAGE_BYTES)
    const origin = createFlaskMediaOrigin(bucket)
    const env = {
      ...testEnv(createFakeD1(), stagingDb, stagingMedia, bucket),
      LANTERN_MEDIA_ORIGIN: origin,
    }
    const session = await makeSession(7, 'staging', env)

    const result = await head(IMAGE_KEY, env, { cookie: `lantern_nuxt_session=${session}` })
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(origin.calls).toHaveLength(0)
  })

  it('HEAD preserves the key-validation divergence (Nuxt 404 before origin)', async () => {
    const { origin, env } = setup()
    const result = await head('uploads/../secret.png', env)
    expect(result.status).toBe(404)
    expect(origin.calls).toHaveLength(0)
  })
})

describe('Final deployed Nitro HEAD response (Cloudflare/node-mock-http adapter)', () => {
  it('strips Content-Length from video HEAD while preserving status and headers', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const response = await deployedHead(VIDEO_KEY, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000')
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('')
  })

  it('strips Content-Length from ranged video HEAD while preserving 206 and Content-Range', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const response = await deployedHead(VIDEO_KEY, env, { range: 'bytes=2-5' })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 2-5/${VIDEO_BYTES.length}`)
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('')
  })

  it('strips Content-Length from image HEAD', async () => {
    const { bucket, env } = setup()
    await bucket.put(IMAGE_KEY, IMAGE_BYTES)

    const response = await deployedHead(IMAGE_KEY, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('')
  })

  it('strips Content-Length from HEAD error responses', async () => {
    const { env } = setup()

    const response = await deployedHead(IMAGE_KEY, env)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.get('content-length')).toBeNull()
    expect(await response.text()).toBe('')
  })
})
