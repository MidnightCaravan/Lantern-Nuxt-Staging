import { describe, expect, it, vi } from 'vitest'
import directHandler from '../server/api/studio/works/[workId]/video-direct.put'
import startHandler from '../server/api/studio/works/[workId]/video-multipart/start.post'
import partHandler from '../server/api/studio/works/[workId]/video-multipart/part.put'
import completeHandler from '../server/api/studio/works/[workId]/video-multipart/complete.post'
import abortHandler from '../server/api/studio/works/[workId]/video-multipart/abort.post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeWork } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const OLD_TIME = '2026-01-01T00:00:00.000Z'
const VIDEO_BYTES = 'video-bytes'
const OLD_KEY = 'uploads/videos/10/old.mp4'

const videoWork = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 10,
  creator_id: 7,
  title: 'Video',
  description: '',
  type: 'Video',
  status: 'draft',
  video_path: `/media/${OLD_KEY}`,
  updated_at: OLD_TIME,
  ...overrides,
})

function setup(oldVideo = true) {
  const staging = createFakeD1({ works: [videoWork(oldVideo ? {} : { video_path: null })] })
  const production = createFakeD1({ works: [videoWork()] })
  const bucket = createFakeR2()
  if (oldVideo) bucket.objects.set(OLD_KEY, { bytes: new TextEncoder().encode('old'), httpMetadata: {} })
  const env = testEnv(production, staging, bucket)
  return { staging, production, bucket, env }
}

function directOptions(session: string, overrides: { extension?: string; size?: string | null; rawBody?: string } = {}) {
  const { extension = 'mp4', size = String(VIDEO_BYTES.length), rawBody = VIDEO_BYTES } = overrides
  return {
    method: 'PUT',
    headers: csrfHeaders(session, {
      'x-csrf-token': TEST_CSRF,
      'x-lantern-extension': extension,
      ...(size === null ? {} : { 'content-length': size }),
    }),
    params: { workId: '10' },
    ...(rawBody.length ? { rawBody } : {}),
  }
}

function startOptions(session: string, overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: csrfHeaders(session),
    params: { workId: '10' },
    body: { extension: 'webm', size: 5, csrfToken: TEST_CSRF, ...overrides },
  }
}

function partOptions(session: string, key: string, uploadId: string, overrides: Record<string, string> = {}) {
  return {
    method: 'PUT',
    headers: csrfHeaders(session, {
      'x-csrf-token': TEST_CSRF,
      'x-lantern-video-key': key,
      'x-lantern-upload-id': uploadId,
      'x-lantern-file-size': '5',
      'x-lantern-part-number': '1',
      ...overrides,
    }),
    params: { workId: '10' },
    rawBody: 'abcde',
  }
}

function completeOptions(session: string, key: string, uploadId: string, overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: csrfHeaders(session),
    params: { workId: '10' },
    body: {
      key,
      uploadId,
      size: 5,
      parts: [{ partNumber: 1, etag: 'etag-1' }],
      csrfToken: TEST_CSRF,
      ...overrides,
    },
  }
}

async function startUpload(env: Record<string, any>, session: string) {
  const result = await callHandler(startHandler, { env, ...startOptions(session) })
  expect(result.status).toBe(201)
  return { key: String(result.json.key), uploadId: String(result.json.uploadId) }
}

describe('direct video upload', () => {
  it('stores a staging video with the Worker key layout and replaces the previous object', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(directHandler, { env, ...directOptions(session, { extension: 'MP4' }) })

    expect(result.status).toBe(201)
    expect(result.json.videoPath).toMatch(/^\/media\/uploads\/videos\/10\/video-[0-9a-f]{24}\.mp4$/)
    const key = String(result.json.videoPath).replace(/^\/media\//, '')
    expect(bucket.text(key)).toBe(VIDEO_BYTES)
    expect(bucket.put).toHaveBeenCalledWith(key, expect.any(Uint8Array), { httpMetadata: { contentType: 'video/mp4' } })
    expect(staging.state.works[0]).toMatchObject({ video_path: result.json.videoPath })
    expect(staging.state.works[0]!.updated_at).not.toBe(OLD_TIME)
    expect(bucket.deleted).toContain(OLD_KEY)
  })

  it('returns 502 without changing D1 when R2 rejects the write', async () => {
    const { staging, bucket, env } = setup()
    bucket.put.mockRejectedValueOnce(new Error('R2 unavailable'))
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(directHandler, { env, ...directOptions(session) })
    expect(result.status).toBe(502)
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
    expect(bucket.deleted).toHaveLength(0)
  })

  it('enforces format, size, ownership, and staging-session rules', async () => {
    const { staging, bucket, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const unsupported = await callHandler(directHandler, { env, ...directOptions(owner, { extension: 'avi' }) })
    const missingSize = await callHandler(directHandler, { env, ...directOptions(owner, { size: '', rawBody: '' }) })
    const oversized = await callHandler(directHandler, { env, ...directOptions(owner, { size: '90000001' }) })
    const mismatch = await callHandler(directHandler, { env, ...directOptions(owner, { size: '4' }) })
    const nonOwner = await callHandler(directHandler, { env, ...directOptions(otherUser) })
    const productionResult = await callHandler(directHandler, { env, ...directOptions(productionSession) })

    expect([unsupported.status, missingSize.status, oversized.status, mismatch.status, nonOwner.status, productionResult.status])
      .toEqual([400, 411, 413, 400, 404, 409])
    expect(bucket.put).not.toHaveBeenCalled()
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
  })
})

describe('multipart video upload', () => {
  it('starts, uploads a part, and completes with the Worker-compatible key and D1 reference', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)

    expect(key).toMatch(/^uploads\/videos\/10\/video-[0-9a-f]{24}\.webm$/)
    expect(bucket.createMultipartUpload).toHaveBeenCalledWith(key, { httpMetadata: { contentType: 'video/webm' } })

    const part = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId) })
    expect(part.status).toBe(200)
    expect(part.json).toMatchObject({ partNumber: 1, etag: 'etag-1' })

    const complete = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId) })
    expect(complete.status).toBe(200)
    expect(complete.json.videoPath).toBe(`/media/${key}`)
    expect(bucket.text(key)).toBe('abcde')
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${key}` })
    expect(bucket.deleted).toContain(OLD_KEY)
  })

  it('validates upload references, part metadata, and part count before completing', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)

    const badStartExtension = await callHandler(startHandler, { env, ...startOptions(session, { extension: 'avi' }) })
    const badStartSize = await callHandler(startHandler, { env, ...startOptions(session, { size: 2_000_000_001 }) })
    const badKey = await callHandler(partHandler, { env, ...partOptions(session, 'uploads/videos/10/nope.mp4', uploadId) })
    const badPartNumber = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'x-lantern-part-number': '2' }) })
    const badPartBytes = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'x-lantern-file-size': '9' }) })
    const missingParts = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId, { parts: [] }) })
    const outOfOrderParts = await callHandler(completeHandler, {
      env,
      ...completeOptions(session, key, uploadId, { parts: [{ partNumber: 2, etag: 'etag-2' }] }),
    })

    expect([
      badStartExtension.status,
      badStartSize.status,
      badKey.status,
      badPartNumber.status,
      badPartBytes.status,
      missingParts.status,
      outOfOrderParts.status,
    ]).toEqual([400, 413, 400, 400, 400, 400, 400])
    expect(bucket.objects.has(key)).toBe(false)
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
  })

  it('returns 502 and preserves D1 when R2 cannot complete the upload', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)
    bucket.resumeMultipartUpload.mockImplementationOnce(() => ({
      complete: vi.fn().mockRejectedValue(new Error('R2 assembly failed')),
    }))
    const result = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId) })
    expect(result.status).toBe(502)
    expect(bucket.objects.has(key)).toBe(false)
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
  })

  it('aborts an upload, including when R2 abort fails', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)

    const aborted = await callHandler(abortHandler, { env, ...completeOptions(session, key, uploadId) })
    expect(aborted.status).toBe(200)
    expect(bucket.aborted).toContain(uploadId)

    const second = await startUpload(env, session)
    bucket.resumeMultipartUpload.mockImplementationOnce(() => ({
      abort: vi.fn().mockRejectedValue(new Error('already gone')),
    }))
    const bestEffort = await callHandler(abortHandler, { env, ...completeOptions(session, second.key, second.uploadId) })
    expect(bestEffort.status).toBe(200)
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
  })

  it('enforces ownership and production read-only rules on every multipart action', async () => {
    const { staging, bucket, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)
    const { key, uploadId } = await startUpload(env, owner)

    const results = [
      await callHandler(startHandler, { env, ...startOptions(otherUser) }),
      await callHandler(startHandler, { env, ...startOptions(productionSession) }),
      await callHandler(partHandler, { env, ...partOptions(otherUser, key, uploadId) }),
      await callHandler(partHandler, { env, ...partOptions(productionSession, key, uploadId) }),
      await callHandler(completeHandler, { env, ...completeOptions(otherUser, key, uploadId) }),
      await callHandler(completeHandler, { env, ...completeOptions(productionSession, key, uploadId) }),
      await callHandler(abortHandler, { env, ...completeOptions(otherUser, key, uploadId) }),
      await callHandler(abortHandler, { env, ...completeOptions(productionSession, key, uploadId) }),
    ]
    expect(results.map((result) => result.status)).toEqual([404, 409, 404, 409, 404, 409, 404, 409])
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
    expect(bucket.deleted).toHaveLength(0)
  })
})
