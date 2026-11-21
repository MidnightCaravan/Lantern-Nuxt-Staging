import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import mediaHandler from '../server/routes/media/[...key].get'
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

function call(key: string, env: Record<string, any>, headers: Record<string, string> = {}, method = 'GET') {
  return callHandler(mediaHandler, { env, params: { key }, headers, method })
}

// Like callHandler, but leaves the response body unconsumed so a test can
// read the stream directly and verify cancellation propagation.
async function callRaw(key: string, env: Record<string, any>, headers: Record<string, string> = {}) {
  const app = createApp()
  app.use('/api/test', defineEventHandler(async (event) => {
    (event as any).context.cloudflare = { env }
    ;(event as any).context.params = { key }
    return mediaHandler(event)
  }))
  const webHandler = toWebHandler(app)
  return webHandler(new Request('http://localhost/api/test', { headers }))
}

describe('A1 media-origin proxy', () => {
  it('forwards GET and preserves Flask headers for images', async () => {
    const { bucket, origin, env } = setup()
    await bucket.put(IMAGE_KEY, IMAGE_BYTES, { httpMetadata: { contentType: 'application/x-should-be-ignored' } })

    const result = await call(IMAGE_KEY, env)
    expect(result.status).toBe(200)
    expect(result.json).toBe(IMAGE_BYTES)
    expect(result.headers.get('content-type')).toBe('image/png')
    expect(result.headers.get('cache-control')).toBe('public, max-age=31536000')
    expect(result.headers.get('accept-ranges')).toBeNull()
    expect(result.headers.get('content-range')).toBeNull()
    expect(origin.calls).toHaveLength(1)
    expect(new URL(origin.calls[0]!.url).pathname).toBe(`/media/${IMAGE_KEY}`)
    expect(origin.calls[0]!.method).toBe('GET')
  })

  it('forwards HEAD and preserves Flask status and headers', async () => {
    const { bucket, origin, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const result = await call(VIDEO_KEY, env, {}, 'HEAD')
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('video/mp4')
    expect(result.headers.get('cache-control')).toBe('public, max-age=31536000')
    expect(result.headers.get('accept-ranges')).toBe('bytes')
    expect(result.headers.get('content-length')).toBe(String(VIDEO_BYTES.length))
    expect(origin.calls[0]!.method).toBe('HEAD')
  })

  it('preserves a normal Range response (206, Content-Range, Content-Length)', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const result = await call(VIDEO_KEY, env, { range: 'bytes=2-5' })
    expect(result.status).toBe(206)
    expect(result.json).toBe('cdef')
    expect(result.headers.get('content-range')).toBe(`bytes 2-5/${VIDEO_BYTES.length}`)
    expect(result.headers.get('content-length')).toBe('4')
    expect(result.headers.get('accept-ranges')).toBe('bytes')
    expect(result.headers.get('cache-control')).toBe('public, max-age=31536000')
  })

  it('preserves a suffix Range response', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const result = await call(VIDEO_KEY, env, { range: 'bytes=-4' })
    expect(result.status).toBe(206)
    expect(result.json).toBe('ghij')
    expect(result.headers.get('content-range')).toBe(`bytes 6-9/${VIDEO_BYTES.length}`)
    expect(result.headers.get('content-length')).toBe('4')
  })

  it('preserves both Flask 416 variants', async () => {
    const { bucket, env } = setup()
    await bucket.put(VIDEO_KEY, VIDEO_BYTES)

    const invalid = await call(VIDEO_KEY, env, { range: 'bytes=abc' })
    expect(invalid.status).toBe(416)
    expect(invalid.json).toBe('Invalid byte range.')
    expect(invalid.headers.get('content-range')).toBe(`bytes */${VIDEO_BYTES.length}`)

    const unsatisfiable = await call(VIDEO_KEY, env, { range: 'bytes=20-' })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.json).toBe('Range not satisfiable.')
    expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${VIDEO_BYTES.length}`)
  })

  it('does not apply byte ranges to images', async () => {
    const { bucket, env } = setup()
    await bucket.put(IMAGE_KEY, IMAGE_BYTES, { httpMetadata: { contentType: 'image/png' } })

    const result = await call(IMAGE_KEY, env, { range: 'bytes=0-3' })
    expect(result.status).toBe(200)
    expect(result.json).toBe(IMAGE_BYTES)
    expect(result.headers.get('content-range')).toBeNull()
  })

  it('preserves 404 for a missing object and 502 for an R2 failure', async () => {
    const { bucket, env } = setup()

    const missing = await call(IMAGE_KEY, env)
    expect(missing.status).toBe(404)
    expect(missing.json).toBe('Media not found.')

    await bucket.put(VIDEO_KEY, VIDEO_BYTES)
    bucket.head.mockRejectedValueOnce(new Error('r2 unavailable'))
    const failed = await call(VIDEO_KEY, env, { range: 'bytes=0-1' })
    expect(failed.status).toBe(502)
    expect(failed.json).toBe('Media unavailable.')
  })

  it('streams the origin body and propagates cancellation', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(VIDEO_BYTES))
        // Intentionally left open: the consumer cancels while the stream is
        // still live so the cancel callback proves propagation.
      },
      cancel() { cancelled = true },
    })
    const originCalls: string[] = []
    const env = {
      ...testEnv(createFakeD1(), createFakeD1(), createFakeR2(), createFakeR2()),
      LANTERN_MEDIA_ORIGIN: {
        fetch: async (request: Request) => {
          originCalls.push(request.url)
          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'video/mp4',
              'Cache-Control': 'public, max-age=31536000',
              'Accept-Ranges': 'bytes',
              'Content-Length': String(VIDEO_BYTES.length),
            },
          })
        },
      },
    }

    const response = await callRaw(VIDEO_KEY, env)
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe(VIDEO_BYTES)
    await reader.cancel()
    expect(originCalls).toHaveLength(1)
    expect(cancelled).toBe(true)
  })

  it('retains the existing staging-preview media behavior when the binding is present', async () => {
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

    const result = await call(IMAGE_KEY, env, { cookie: `lantern_nuxt_session=${session}` })
    expect(result.status).toBe(200)
    expect(result.json).toBe('staging-image')
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(origin.calls).toHaveLength(0)
  })

  it('documents the key-validation divergence instead of silently changing it', async () => {
    const { origin, env } = setup()
    // Flask reads the raw key from the URL and applies no traversal filter.
    // Nuxt already rejects such keys before storage/proxy. This prototype
    // keeps that Nuxt behavior and records the difference for owner review.
    const result = await call('uploads/../secret.png', env)
    expect(result.status).toBe(404)
    expect(origin.calls).toHaveLength(0)
  })
})
