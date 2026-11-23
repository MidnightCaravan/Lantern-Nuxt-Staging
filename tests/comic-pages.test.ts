import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import uploadPageHandler from '../server/api/comic/episodes/[episodeId]/pages.put'
import deletePageHandler from '../server/api/comic/pages/[pageId]/delete.post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeComicEpisode, type FakeComicPage, type FakeWork } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const comicWork = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 3,
  creator_id: 7,
  title: 'Comic',
  description: '',
  type: 'Comic',
  status: 'draft',
  ...overrides,
})

const episode = (overrides: Partial<FakeComicEpisode> = {}): FakeComicEpisode => ({
  id: 20,
  work_id: 3,
  episode_number: 1,
  title: 'Episode 1',
  status: 'draft',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const page = (overrides: Partial<FakeComicPage> = {}): FakeComicPage => ({
  id: 40,
  episode_id: 20,
  page_number: 2,
  image_path: 'uploads/comics/3/20/page-2-old.png',
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function bucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function uploadOptions(session: string, extension = 'png', bytes: string | Uint8Array = 'image-bytes', clientId?: string) {
  return {
    method: 'PUT',
    headers: {
      ...csrfHeaders(session, { 'x-csrf-token': TEST_CSRF, 'x-lantern-extension': extension }),
      ...(clientId ? { 'x-lantern-client-id': clientId } : {}),
    },
    params: { episodeId: '20' },
    rawBody: bytes,
  }
}

describe('PUT /api/comic/episodes/:episodeId/pages', () => {
  it('uploads the next page to staging R2 and records it with the expected key', async () => {
    const media = bucket()
    const staging = createFakeD1({
      works: [comicWork()],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(uploadPageHandler, { env, ...uploadOptions(session, 'WEBP', 'abc') })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, pageNumber: 3 })

    const [key, bytes, metadata] = media.put.mock.calls[0]!
    expect(key).toMatch(/^uploads\/comics\/3\/20\/page-3-[0-9a-f]{16}\.webp$/)
    expect(Buffer.from(bytes as Uint8Array).toString()).toBe('abc')
    expect(metadata).toEqual({ httpMetadata: { contentType: 'image/webp' } })
    expect(staging.state.comicPages[1]).toMatchObject({ page_number: 3, image_path: key })
    expect(staging.state.comicEpisodes[0]!.updated_at).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('stores a zero-byte file as a page like the canonical Worker upload path', async () => {
    const media = bucket()
    const staging = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()] })
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(uploadPageHandler, { env, ...uploadOptions(session, 'png', '') })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, pageNumber: 1, message: 'All pages added to draft.' })
    expect(media.put).toHaveBeenCalledTimes(1)
    const [key, bytes, metadata] = media.put.mock.calls[0]!
    expect(key).toMatch(/^uploads\/comics\/3\/20\/page-1-[0-9a-f]{16}\.png$/)
    expect((bytes as Uint8Array).byteLength).toBe(0)
    expect(metadata).toEqual({ httpMetadata: { contentType: 'image/png' } })
    expect(staging.state.comicPages).toHaveLength(1)
    expect(staging.state.comicPages[0]).toMatchObject({ page_number: 1, image_path: key })
    expect(staging.state.comicEpisodes[0]!.updated_at).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('replays a retried file without duplicating the page or the R2 object', async () => {
    const media = bucket()
    const staging = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()] })
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)
    const clientId = '0123456789abcdef'

    const first = await callHandler(uploadPageHandler, { env, ...uploadOptions(session, 'png', 'abc', clientId) })
    const retry = await callHandler(uploadPageHandler, { env, ...uploadOptions(session, 'png', 'abc', clientId) })

    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ ok: true, pageNumber: 1, duplicate: false })
    expect(retry.status).toBe(200)
    expect(retry.json).toMatchObject({ ok: true, pageNumber: 1, duplicate: true })
    expect(media.put).toHaveBeenCalledTimes(1)
    expect(staging.state.comicPages).toHaveLength(1)
    expect(staging.state.comicPages[0]!.image_path).toMatch(/^uploads\/comics\/3\/20\/page-1-0123456789abcdef\.png$/)
  })

  it('removes the uploaded object when the page record cannot be committed', async () => {
    const media = bucket()
    const staging = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()] })
    ;(staging as any).batch = vi.fn().mockRejectedValue(new Error('D1 unavailable'))
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)

    const result = await callHandler(uploadPageHandler, { env, ...uploadOptions(session) })

    expect(result.status).toBe(503)
    expect(media.put).toHaveBeenCalledTimes(1)
    expect(media.delete).toHaveBeenCalledTimes(1)
    expect(staging.state.comicPages).toHaveLength(0)
    expect(staging.state.comicEpisodes[0]!.updated_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('rejects unsupported image formats before writing storage or the database', async () => {
    const media = bucket()
    const staging = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()] })
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(uploadPageHandler, { env, ...uploadOptions(session, 'svg') })
    expect(result.status).toBe(400)
    expect(media.put).not.toHaveBeenCalled()
    expect(staging.state.comicPages).toHaveLength(0)
  })

  it('rejects non-owner and production-session uploads', async () => {
    const media = bucket()
    const production = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()] })
    const staging = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()] })
    const env = testEnv(production, staging, media)
    const nonOwner = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const otherOwner = await callHandler(uploadPageHandler, { env, ...uploadOptions(nonOwner) })
    const productionResult = await callHandler(uploadPageHandler, { env, ...uploadOptions(productionSession) })
    expect(otherOwner.status).toBe(404)
    expect(productionResult.status).toBe(409)
    expect(media.put).not.toHaveBeenCalled()
    expect(staging.state.comicPages).toHaveLength(0)
  })
})

describe('POST /api/comic/pages/:pageId/delete', () => {
  const deleteOptions = (session: string) => ({
    method: 'POST',
    headers: csrfHeaders(session),
    params: { pageId: '40' },
    body: { csrfToken: TEST_CSRF },
  })

  it('removes an owned page from R2 and the database', async () => {
    const media = bucket()
    const staging = createFakeD1({
      works: [comicWork()],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(deletePageHandler, { env, ...deleteOptions(session) })
    expect(result.status).toBe(200)
    expect(media.delete).toHaveBeenCalledWith('uploads/comics/3/20/page-2-old.png')
    expect(staging.state.comicPages).toHaveLength(0)
    expect(staging.state.comicEpisodes[0]!.updated_at).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps the page when storage deletion fails', async () => {
    const media = bucket()
    media.delete.mockRejectedValueOnce(new Error('R2 unavailable'))
    const staging = createFakeD1({
      works: [comicWork()],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging, media)
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(deletePageHandler, { env, ...deleteOptions(session) })
    expect(result.status).toBe(503)
    expect(staging.state.comicPages).toHaveLength(1)
  })

  it('rejects non-owner and production-session deletions', async () => {
    const media = bucket()
    const production = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()], comicPages: [page()] })
    const staging = createFakeD1({ works: [comicWork()], comicEpisodes: [episode()], comicPages: [page()] })
    const env = testEnv(production, staging, media)
    const nonOwner = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const otherOwner = await callHandler(deletePageHandler, { env, ...deleteOptions(nonOwner) })
    const productionResult = await callHandler(deletePageHandler, { env, ...deleteOptions(productionSession) })
    expect(otherOwner.status).toBe(404)
    expect(productionResult.status).toBe(409)
    expect(media.delete).not.toHaveBeenCalled()
    expect(staging.state.comicPages).toHaveLength(1)
  })
})

describe('comic page upload feedback', () => {
  const editor = readFileSync(
    path.join(process.cwd(), 'app/pages/comic/episode/[episodeId]/edit.vue'),
    'utf8',
  )

  it('does not contain the stale skippedImages reference that broke the upload button', () => {
    expect(editor).not.toContain('skippedImages')
  })

  it('reports overall counts, percentage and per-file progress', () => {
    expect(editor).toContain("xhr.upload.onprogress")
    expect(editor).toContain('id="upload-progress-count"')
    expect(editor).toContain('id="upload-progress-bar"')
    expect(editor).toContain('role="progressbar"')
    expect(editor).toContain('id="current-file-progress"')
    expect(editor).toContain('{{ uploadUploaded }} / {{ uploadTotal }} files · {{ uploadPercent }}%')
    expect(editor).toContain('Uploaded ${uploadUploaded.value} / ${uploadTotal.value} pages...')
  })

  it('refreshes the page list after each stored page and reports a successful count', () => {
    expect(editor).toContain('await refreshPageList()')
    expect(editor).toContain('All pages added to draft. ${successfulPages.value} page(s) uploaded.')
  })

  it('identifies the failed file, keeps confirmed pages and cleans up the busy state', () => {
    expect(editor).toContain('failed (${xhr.status})')
    expect(editor).toContain('X-Lantern-Client-Id')
    expect(editor).toContain('if (completed.has(entry.clientId))')
    expect(editor).toContain('finally {\n    activeUpload = null\n    busy.value = false\n  }')
    expect(editor).toContain('activeUpload?.abort()')
  })
})
