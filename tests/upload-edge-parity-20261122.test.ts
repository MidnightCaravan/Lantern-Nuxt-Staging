import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import directHandler from '../server/api/studio/works/[workId]/video-direct.put'
import startHandler from '../server/api/studio/works/[workId]/video-multipart/start.post'
import partHandler from '../server/api/studio/works/[workId]/video-multipart/part.put'
import completeHandler from '../server/api/studio/works/[workId]/video-multipart/complete.post'
import abortHandler from '../server/api/studio/works/[workId]/video-multipart/abort.post'
import { callHandler } from './helpers/handler'
import { createFakeD1 } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const OLD_KEY = 'uploads/videos/10/old.mp4'

function setup() {
  const staging = createFakeD1({
    works: [{
      id: 10,
      creator_id: 7,
      title: 'Video',
      description: '',
      type: 'Video',
      status: 'draft',
      video_path: `/media/${OLD_KEY}`,
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
  })
  const bucket = createFakeR2()
  bucket.objects.set(OLD_KEY, { bytes: new TextEncoder().encode('old'), httpMetadata: {} })
  const env = testEnv(createFakeD1({ works: [] }), staging, bucket)
  return { staging, bucket, env }
}

function direct(session: string, overrides: Record<string, string> = {}) {
  return {
    method: 'PUT',
    headers: csrfHeaders(session, {
      'x-csrf-token': TEST_CSRF,
      'x-lantern-extension': 'mp4',
      'content-length': '3',
      ...overrides,
    }),
    params: { workId: '10' },
    rawBody: 'abc',
  }
}

function start(session: string, size: unknown) {
  return {
    method: 'POST',
    headers: csrfHeaders(session),
    params: { workId: '10' },
    body: { extension: 'webm', size, csrfToken: TEST_CSRF },
  }
}

async function begin(env: Record<string, any>, session: string) {
  const result = await callHandler(startHandler, { env, ...start(session, 5) })
  expect(result.status).toBe(201)
  return { key: String(result.json.key), uploadId: String(result.json.uploadId) }
}

function part(session: string, key: string, uploadId: string, overrides: Record<string, string> = {}) {
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

function complete(session: string, key: string, uploadId: string, overrides: Record<string, unknown> = {}) {
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

describe('Flask int() parsing parity for video uploads (2026-11-22)', () => {
  it('rejects decimal, exponent and hex declarations like Python int()', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)

    for (const size of ['1e3', '0x10', '5.0']) {
      const directResult = await callHandler(directHandler, { env, ...direct(session, { 'content-length': size }) })
      expect(directResult.status, `direct ${size}`).toBe(400)
      expect(directResult.json.statusMessage).toBe('Invalid video size.')
      const started = await callHandler(startHandler, { env, ...start(session, size) })
      expect(started.status, `start ${size}`).toBe(400)
      expect(started.json.statusMessage).toBe('A valid video file size is required.')
    }
  })

  it('treats an arbitrary-precision declaration as oversize rather than malformed', async () => {
    const { env, bucket } = setup()
    const session = await makeSession(7, 'staging', env)
    const huge = '900000000000000000000000000000'

    expect((await callHandler(directHandler, { env, ...direct(session, { 'content-length': huge }) })).status).toBe(413)
    expect((await callHandler(startHandler, { env, ...start(session, huge) })).status).toBe(413)

    const { key, uploadId } = await begin(env, session)
    expect((await callHandler(partHandler, { env, ...part(session, key, uploadId, { 'x-lantern-file-size': huge }) })).status).toBe(413)
    expect((await callHandler(completeHandler, { env, ...complete(session, key, uploadId, { size: huge }) })).status).toBe(413)
    expect(bucket.put).not.toHaveBeenCalled()
  })

  it('keeps Flask status precedence for malformed part metadata and lengths', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await begin(env, session)

    const exponentialSize = await callHandler(partHandler, { env, ...part(session, key, uploadId, { 'x-lantern-file-size': '5e0' }) })
    expect(exponentialSize.status).toBe(400)
    expect(exponentialSize.json.statusMessage).toBe('Invalid video part metadata.')

    const exponentialLength = await callHandler(partHandler, { env, ...part(session, key, uploadId, { 'content-length': '5e0' }) })
    expect(exponentialLength.status).toBe(411)
    expect(exponentialLength.json.statusMessage).toBe('Video part length is required.')

    const hugeLength = await callHandler(partHandler, { env, ...part(session, key, uploadId, { 'content-length': '900000000000000000000' }) })
    expect(hugeLength.status).toBe(400)
    expect(hugeLength.json.statusMessage).toBe('Video part size does not match the expected chunk size.')

    const hugePartNumber = await callHandler(partHandler, { env, ...part(session, key, uploadId, { 'x-lantern-part-number': '900000000000000000000' }) })
    expect(hugePartNumber.status).toBe(400)
    expect(hugePartNumber.json.statusMessage).toBe('Invalid video part number.')
  })

  it('validates the direct-upload format and size before ownership', async () => {
    const { env, bucket } = setup()
    const outsider = await makeSession(8, 'staging', env)

    const badFormat = await callHandler(directHandler, { env, ...direct(outsider, { 'x-lantern-extension': 'avi' }) })
    const missingSize = await callHandler(directHandler, { env, ...direct(outsider, { 'content-length': '' }) })
    const validButUnowned = await callHandler(directHandler, { env, ...direct(outsider) })

    expect([badFormat.status, missingSize.status, validButUnowned.status]).toEqual([400, 411, 404])
    expect(bucket.put).not.toHaveBeenCalled()
  })
})

describe('multipart reference parity with worker.py (2026-11-22)', () => {
  it('distinguishes a missing parts list from a wrong-length list', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await begin(env, session)

    const missing = await callHandler(completeHandler, { env, ...complete(session, key, uploadId, { parts: null }) })
    expect(missing.status).toBe(400)
    expect(missing.json.statusMessage).toBe('Missing or invalid uploaded-parts list.')

    const wrongLength = await callHandler(completeHandler, { env, ...complete(session, key, uploadId, { parts: [] }) })
    expect(wrongLength.status).toBe(400)
    expect(wrongLength.json.statusMessage).toBe('The video upload is incomplete. Please retry.')
  })

  it('accepts padded reference values and preserves Python part-number parsing', async () => {
    const { env, bucket } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await begin(env, session)
    await callHandler(partHandler, { env, ...part(session, key, uploadId) })

    const padded = await callHandler(completeHandler, {
      env,
      ...complete(session, `  ${key}  `, ` ${uploadId} `, {
        parts: [{ partNumber: 1.9, etag: 'etag-1' }],
      }),
    })
    expect(padded.status).toBe(200)
    expect(bucket.text(key)).toBe('abcde')

    const { key: key2, uploadId: uploadId2 } = await begin(env, session)
    await callHandler(partHandler, { env, ...part(session, key2, uploadId2) })
    const exponentPart = await callHandler(completeHandler, {
      env,
      ...complete(session, key2, uploadId2, { parts: [{ partNumber: '1e0', etag: 'etag-1' }] }),
    })
    expect(exponentPart.status).toBe(400)
    expect(exponentPart.json.statusMessage).toBe('Invalid uploaded-part number.')
  })

  it('accepts padded reference values on abort', async () => {
    const { env, bucket } = setup()
    const session = await makeSession(7, 'staging', env)
    const { key, uploadId } = await begin(env, session)
    const result = await callHandler(abortHandler, {
      env,
      ...complete(session, `  ${key}  `, ` ${uploadId} `),
    })
    expect(result.status).toBe(200)
    expect(bucket.aborted).toContain(uploadId)
  })

  it('trims the part endpoint reference headers before validating them', async () => {
    const source = await readFile(path.resolve(process.cwd(), 'server/api/studio/works/[workId]/video-multipart/part.put.ts'), 'utf8')
    expect(source).toContain("getHeader(event, 'x-lantern-video-key') || '').trim()")
    expect(source).toContain("getHeader(event, 'x-lantern-upload-id') || '').trim()")
  })
})
