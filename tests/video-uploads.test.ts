import { describe, expect, it, vi } from 'vitest'
import directHandler from '../server/api/studio/works/[workId]/video-direct.put'
import startHandler from '../server/api/studio/works/[workId]/video-multipart/start.post'
import partHandler from '../server/api/studio/works/[workId]/video-multipart/part.put'
import completeHandler from '../server/api/studio/works/[workId]/video-multipart/complete.post'
import abortHandler from '../server/api/studio/works/[workId]/video-multipart/abort.post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeD1, type FakeWork } from './helpers/fake-d1'
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

function wrapStatement(db: FakeD1, matches: (sql: string) => boolean, wrap: (statement: any) => any) {
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    const statement = prepare(sql)
    return matches(sql) ? wrap(statement) : statement
  })
}

function failVideoUpdate(db: FakeD1) {
  wrapStatement(db, (sql) => sql.startsWith('UPDATE works SET video_path = ?'), (statement) => ({
    ...statement,
    bind: (...params: any[]) => ({
      ...statement.bind(...params),
      run: async () => { throw new Error('D1 unavailable') },
    }),
  }))
}

function skipVideoUpdate(db: FakeD1) {
  wrapStatement(db, (sql) => sql.startsWith('UPDATE works SET video_path = ?'), (statement) => ({
    ...statement,
    bind: (...params: any[]) => ({
      ...statement.bind(...params),
      run: async () => ({ meta: { last_row_id: 0, changes: 0 } }),
    }),
  }))
}

function failVideoVerificationRead(db: FakeD1) {
  wrapStatement(db, (sql) => sql.startsWith('SELECT video_path FROM works'), (statement) => ({
    ...statement,
    bind: (...params: any[]) => ({
      ...statement.bind(...params),
      first: async () => { throw new Error('D1 read unavailable') },
    }),
  }))
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
      'content-length': '5',
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
    expect(bucket.put).toHaveBeenCalledWith(key, expect.any(ReadableStream), { httpMetadata: { contentType: 'video/mp4' } })
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

  it('deletes the new object and reports Flask error when D1 cannot save the reference', async () => {
    const { staging, bucket, env } = setup()
    failVideoUpdate(staging)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await makeSession(7, 'staging', env)
    try {
      const result = await callHandler(directHandler, { env, ...directOptions(session) })
      const [newKey] = bucket.put.mock.calls[0]!

      expect(result.status).toBe(500)
      expect(result.json.statusMessage).toBe('Video was uploaded but could not be saved. Please retry.')
      expect(bucket.deleted).toContain(newKey)
      expect(bucket.objects.has(String(newKey))).toBe(false)
      expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('enforces format, size, ownership, and staging-session rules', async () => {
    const { staging, bucket, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const unsupported = await callHandler(directHandler, { env, ...directOptions(owner, { extension: 'avi' }) })
    const missingSize = await callHandler(directHandler, { env, ...directOptions(owner, { size: '', rawBody: '' }) })
    const oversized = await callHandler(directHandler, { env, ...directOptions(owner, { size: '90000001' }) })
    const nonOwner = await callHandler(directHandler, { env, ...directOptions(otherUser) })
    const productionResult = await callHandler(directHandler, { env, ...directOptions(productionSession) })

    expect([unsupported.status, missingSize.status, oversized.status, nonOwner.status, productionResult.status])
      .toEqual([400, 411, 413, 404, 409])
    expect(bucket.put).not.toHaveBeenCalled()
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
  })

  it('uses Flask distinct size statuses and messages (worker.py:785-800)', async () => {
    const { bucket, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const missing = await callHandler(directHandler, { env, ...directOptions(owner, { size: null, rawBody: '' }) })
    const invalid = await callHandler(directHandler, { env, ...directOptions(owner, { size: 'abc', rawBody: '' }) })
    const empty = await callHandler(directHandler, { env, ...directOptions(owner, { size: '0', rawBody: '' }) })

    expect(missing.status).toBe(411)
    expect(missing.json.statusMessage).toBe('Video size is required.')
    expect(invalid.status).toBe(400)
    expect(invalid.json.statusMessage).toBe('Invalid video size.')
    expect(empty.status).toBe(400)
    expect(empty.json.statusMessage).toBe('The video file is empty.')
    expect(bucket.put).not.toHaveBeenCalled()
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
    const missingLength = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'content-length': '' }) })
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
      missingLength.status,
      missingParts.status,
      outOfOrderParts.status,
    ]).toEqual([400, 413, 400, 400, 400, 411, 400, 400])
    expect(bucket.objects.has(key)).toBe(false)
    expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
  })

  it('uses Flask distinct part metadata statuses (worker.py:555-565)', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)

    const badSize = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'x-lantern-file-size': 'abc' }) })
    const badPart = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'x-lantern-part-number': 'abc' }) })
    const empty = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'x-lantern-file-size': '0' }) })
    const oversized = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId, { 'x-lantern-file-size': '2000000001' }) })

    expect(badSize.status).toBe(400)
    expect(badSize.json.statusMessage).toBe('Invalid video part metadata.')
    expect(badPart.status).toBe(400)
    expect(badPart.json.statusMessage).toBe('Invalid video part metadata.')
    expect(empty.status).toBe(400)
    expect(empty.json.statusMessage).toBe('Invalid video size.')
    expect(oversized.status).toBe(413)
    expect(oversized.json.statusMessage).toBe('Invalid video size.')
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

  it('preserves the assembled object when the D1 verification read fails', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)
    await callHandler(partHandler, { env, ...partOptions(session, key, uploadId) })
    // Flask only reaches the verification read from its D1 error handler.
    skipVideoUpdate(staging)
    failVideoVerificationRead(staging)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId) })
      expect(result.status).toBe(500)
      expect(result.json.statusMessage).toBe('Video upload outcome could not be verified. Refresh the page before retrying.')
      expect(bucket.objects.has(key)).toBe(true)
      expect(bucket.objects.has(OLD_KEY)).toBe(true)
      expect(bucket.deleted).not.toContain(key)
      expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${OLD_KEY}` })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('does not re-read D1 on the successful completion path', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)
    await callHandler(partHandler, { env, ...partOptions(session, key, uploadId) })
    failVideoVerificationRead(staging)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const result = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId) })
      expect(result.status).toBe(200)
      expect(result.json).toMatchObject({ ok: true, message: 'Video uploaded.' })
      expect(bucket.objects.has(key)).toBe(true)
      expect(staging.state.works[0]).toMatchObject({ video_path: `/media/${key}` })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('deletes the assembled object when D1 verification confirms a mismatch', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)
    await callHandler(partHandler, { env, ...partOptions(session, key, uploadId) })
    skipVideoUpdate(staging)

    const result = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId) })
    expect(result.status).toBe(500)
    expect(result.json.statusMessage).toBe('Video upload completed but could not be saved. Please retry.')
    expect(bucket.deleted).toContain(key)
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

describe('multipart upload error-contract parity with worker.py', () => {
  it('start distinguishes an empty file from an unparseable size', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)

    const empty = await callHandler(startHandler, { env, ...startOptions(session, { size: 0 }) })
    expect(empty.status).toBe(400)
    expect(empty.json.statusMessage).toBe('The video file is empty.')

    const malformed = await callHandler(startHandler, { env, ...startOptions(session, { size: 'abc' }) })
    expect(malformed.status).toBe(400)
    expect(malformed.json.statusMessage).toBe('A valid video file size is required.')
  })

  it('start strips and lowercases all leading dots from the extension', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(startHandler, { env, ...startOptions(session, { extension: '  ..MP4  ' }) })
    expect(result.status).toBe(201)
    expect(result.json.key).toMatch(/\.mp4$/)
    expect(result.json).not.toHaveProperty('maxBytes')
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it('complete splits invalid, empty and oversize sizes into 400/400/413', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)

    for (const size of [0, 'abc']) {
      const result = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId, { size }) })
      expect(result.status, String(size)).toBe(400)
      expect(result.json.statusMessage).toBe('Invalid video size.')
    }
    const oversize = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId, { size: 2_000_000_001 }) })
    expect(oversize.status).toBe(413)
  })

  it('complete reports distinct errors for malformed part entries', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)

    const entry = await callHandler(completeHandler, { env, ...completeOptions(session, key, uploadId, { parts: ['bad'] }) })
    expect(entry.json.statusMessage).toBe('Invalid uploaded-part entry.')
    const number = await callHandler(completeHandler, {
      env,
      ...completeOptions(session, key, uploadId, { parts: [{ partNumber: 'abc', etag: 'etag-1' }] }),
    })
    expect(number.json.statusMessage).toBe('Invalid uploaded-part number.')
    const order = await callHandler(completeHandler, {
      env,
      ...completeOptions(session, key, uploadId, { parts: [{ partNumber: 2, etag: 'etag-1' }] }),
    })
    expect(order.json.statusMessage).toBe('Uploaded parts are missing or out of order.')
  })

  it('part treats a negative Content-Length as a size mismatch, not 411', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)
    const result = await callHandler(partHandler, {
      env,
      ...partOptions(session, key, uploadId, { 'content-length': '-1' }),
    })
    expect(result.status).toBe(400)
    expect(result.json.statusMessage).toBe('Video part size does not match the expected chunk size.')
  })

  it('part response is marked no-store', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await startUpload(env, session)
    const result = await callHandler(partHandler, { env, ...partOptions(session, key, uploadId) })
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
})
