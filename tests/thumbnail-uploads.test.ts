import { describe, expect, it } from 'vitest'
import directHandler from '../server/api/studio/works/[workId]/thumbnail-direct.put'
import dashboardHandler from '../server/api/dashboard/works/[id]/thumbnail.post'
import dashboardPutHandler from '../server/api/dashboard/works/[id]/thumbnail.put'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeWork } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const OLD_COVER_KEY = 'uploads/covers/10/old.png'
const COVER_KEY = 'uploads/covers/10/cover.png'
const PAGE_KEY = 'uploads/comics/10/20/page-1.png'
const LATER_PAGE_KEY = 'uploads/comics/10/21/page-1.png'

const work = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 10,
  creator_id: 7,
  title: 'Work',
  description: '',
  type: 'Novel',
  status: 'draft',
  cover: `/media/${OLD_COVER_KEY}`,
  video_path: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function setup(options: { type?: string; oldCover?: boolean; pageKey?: string; pageInR2?: boolean } = {}) {
  const { type = 'Novel', oldCover = true, pageKey = PAGE_KEY, pageInR2 = true } = options
  const staging = createFakeD1({
    works: [work({ type, cover: oldCover ? `/media/${OLD_COVER_KEY}` : null })],
    comicEpisodes: [
      { id: 20, work_id: 10, episode_number: 1, status: 'draft' },
      { id: 21, work_id: 10, episode_number: 2, status: 'draft' },
    ],
    comicPages: [
      { id: 40, episode_id: 20, image_path: pageKey },
      { id: 41, episode_id: 21, image_path: LATER_PAGE_KEY },
    ],
  })
  const production = createFakeD1({ works: [work()] })
  const bucket = createFakeR2()
  if (oldCover) bucket.objects.set(OLD_COVER_KEY, { bytes: new TextEncoder().encode('old-cover'), httpMetadata: {} })
  if (pageInR2) {
    bucket.objects.set(pageKey, { bytes: new TextEncoder().encode('page-bytes'), httpMetadata: { contentType: 'image/png' } })
    bucket.objects.set(LATER_PAGE_KEY, { bytes: new TextEncoder().encode('later-page'), httpMetadata: { contentType: 'image/png' } })
  }
  const env = testEnv(production, staging, bucket, createFakeR2())
  return { staging, production, bucket, env }
}

function directOptions(session: string, overrides: Record<string, string> = {}) {
  return {
    method: 'PUT',
    headers: csrfHeaders(session, {
      'x-csrf-token': TEST_CSRF,
      'x-lantern-extension': 'PNG',
      ...overrides,
    }),
    params: { workId: '10' },
    rawBody: 'cover-bytes',
  }
}

function dashboardOptions(session: string, mode: string) {
  return {
    method: 'POST',
    headers: csrfHeaders(session),
    params: { id: '10' },
    body: { mode, csrfToken: TEST_CSRF },
  }
}

function dashboardPutOptions(session: string, overrides: Record<string, string> = {}) {
  return {
    method: 'PUT',
    headers: csrfHeaders(session, {
      'x-csrf-token': TEST_CSRF,
      'x-lantern-extension': 'png',
      ...overrides,
    }),
    params: { id: '10' },
  }
}

describe('direct thumbnail upload', () => {
  it('stores the cover at the Flask key, updates D1, and removes the old object', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(directHandler, { env, ...directOptions(session) })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, cover: `/media/${COVER_KEY}` })
    expect(bucket.text(COVER_KEY)).toBe('cover-bytes')
    expect(bucket.put).toHaveBeenCalledWith(COVER_KEY, expect.any(Uint8Array), { httpMetadata: { contentType: 'image/png' } })
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${COVER_KEY}` })
    expect(staging.state.works[0]!.updated_at).not.toBe('2026-01-01T00:00:00.000Z')
    expect(bucket.deleted).toContain(OLD_COVER_KEY)
  })

  it('preserves the old cover on storage failure and enforces parity guards', async () => {
    const { staging, bucket, env } = setup()
    bucket.put.mockRejectedValueOnce(new Error('R2 unavailable'))
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const failed = await callHandler(directHandler, { env, ...directOptions(owner) })
    const badFormat = await callHandler(directHandler, { env, ...directOptions(owner, { 'x-lantern-extension': 'bmp' }) })
    const nonOwner = await callHandler(directHandler, { env, ...directOptions(otherUser) })
    const production = await callHandler(directHandler, { env, ...directOptions(productionSession) })
    const badCsrf = await callHandler(directHandler, {
      env,
      ...directOptions(owner, { 'x-csrf-token': 'wrong' }),
    })

    expect([failed.status, badFormat.status, nonOwner.status, production.status, badCsrf.status])
      .toEqual([502, 400, 404, 409, 403])
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${OLD_COVER_KEY}` })
    expect(bucket.deleted).toHaveLength(0)
  })

  it('stores an empty upload body like the Flask Worker', async () => {
    const { staging, bucket, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const empty = await callHandler(directHandler, {
      env, method: 'PUT', headers: csrfHeaders(owner, { 'x-csrf-token': TEST_CSRF, 'x-lantern-extension': 'png' }), params: { workId: '10' },
    })

    expect(empty.status).toBe(200)
    expect(bucket.text(COVER_KEY)).toBe('')
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${COVER_KEY}` })
    expect(bucket.deleted).toContain(OLD_COVER_KEY)
  })
})

describe('dashboard thumbnail actions', () => {
  it('stores an empty direct cover upload like the Flask Worker', async () => {
    const { staging, bucket, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const result = await callHandler(dashboardPutHandler, { env, ...dashboardPutOptions(owner) })

    expect(result.status).toBe(200)
    expect(result.json.message).toBe('Thumbnail uploaded successfully.')
    expect(bucket.text(COVER_KEY)).toBe('')
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${COVER_KEY}` })
    expect(bucket.deleted).toContain(OLD_COVER_KEY)
  })

  it('keeps the dashboard direct cover guards for non-owners and production sessions', async () => {
    const { staging, bucket, env } = setup()
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const nonOwner = await callHandler(dashboardPutHandler, { env, ...dashboardPutOptions(otherUser) })
    const production = await callHandler(dashboardPutHandler, { env, ...dashboardPutOptions(productionSession) })
    const anonymous = await callHandler(dashboardPutHandler, {
      env,
      method: 'PUT',
      headers: {
        cookie: `lantern_nuxt_csrf=${TEST_CSRF}`,
        'x-csrf-token': TEST_CSRF,
        'x-lantern-extension': 'png',
      },
      params: { id: '10' },
    })

    expect([nonOwner.status, production.status, anonymous.status]).toEqual([404, 409, 401])
    expect(bucket.put).not.toHaveBeenCalled()
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${OLD_COVER_KEY}` })
  })

  it('removes an owned cover and reports storage cleanup failure honestly', async () => {
    const { staging, bucket, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(dashboardHandler, { env, ...dashboardOptions(session, 'remove') })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, message: 'Thumbnail removed.' })
    expect(staging.state.works[0]!.cover).toBeNull()
    expect(bucket.deleted).toContain(OLD_COVER_KEY)

    const second = setup()
    second.bucket.delete.mockRejectedValueOnce(new Error('delete failed'))
    const secondSession = await makeSession(7, 'staging', second.env)
    const failedCleanup = await callHandler(dashboardHandler, {
      env: second.env,
      ...dashboardOptions(secondSession, 'remove'),
    })
    expect(failedCleanup.json.message).toContain('could not be deleted')
    expect(second.staging.state.works[0]!.cover).toBeNull()
  })

  it('copies the earliest comic page into the cover slot', async () => {
    const { staging, bucket, env } = setup({ type: 'Comic' })
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(dashboardHandler, { env, ...dashboardOptions(session, 'first_page') })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, message: 'First comic page is now the thumbnail.' })
    expect(bucket.text(COVER_KEY)).toBe('page-bytes')
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${COVER_KEY}` })
    expect(bucket.deleted).toContain(OLD_COVER_KEY)
  })

  it('rejects missing, unsupported, and non-comic first pages', async () => {
    const nonComic = setup()
    const nonComicSession = await makeSession(7, 'staging', nonComic.env)
    const wrongType = await callHandler(dashboardHandler, {
      env: nonComic.env,
      ...dashboardOptions(nonComicSession, 'first_page'),
    })

    const noPage = setup({ type: 'Comic' })
    noPage.staging.state.comicPages.length = 0
    const noPageSession = await makeSession(7, 'staging', noPage.env)
    const noPageResult = await callHandler(dashboardHandler, {
      env: noPage.env,
      ...dashboardOptions(noPageSession, 'first_page'),
    })

    const missingObject = setup({ type: 'Comic', pageInR2: false })
    const missingSession = await makeSession(7, 'staging', missingObject.env)
    const missingResult = await callHandler(dashboardHandler, {
      env: missingObject.env,
      ...dashboardOptions(missingSession, 'first_page'),
    })

    const unsupported = setup({ type: 'Comic', pageKey: 'uploads/comics/10/20/page-1.bmp' })
    const unsupportedSession = await makeSession(7, 'staging', unsupported.env)
    const unsupportedResult = await callHandler(dashboardHandler, {
      env: unsupported.env,
      ...dashboardOptions(unsupportedSession, 'first_page'),
    })

    const traversal = setup({ type: 'Comic', pageKey: 'uploads/comics/10/20/../page-1.png' })
    const traversalSession = await makeSession(7, 'staging', traversal.env)
    const traversalResult = await callHandler(dashboardHandler, {
      env: traversal.env,
      ...dashboardOptions(traversalSession, 'first_page'),
    })

    expect([wrongType.status, noPageResult.status, missingResult.status, unsupportedResult.status, traversalResult.status])
      .toEqual([400, 400, 404, 400, 400])
  })

  it('enforces ownership, production read-only, mode validation, and CSRF', async () => {
    const { staging, env } = setup({ type: 'Comic' })
    const owner = await makeSession(7, 'staging', env)
    const otherUser = await makeSession(8, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)

    const invalidMode = await callHandler(dashboardHandler, { env, ...dashboardOptions(owner, 'bogus') })
    const badCsrf = await callHandler(dashboardHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(owner),
      params: { id: '10' },
      body: { mode: 'remove', csrfToken: 'wrong' },
    })
    const nonOwner = await callHandler(dashboardHandler, { env, ...dashboardOptions(otherUser, 'remove') })
    const production = await callHandler(dashboardHandler, { env, ...dashboardOptions(productionSession, 'remove') })

    expect([invalidMode.status, badCsrf.status, nonOwner.status, production.status]).toEqual([400, 403, 404, 409])
    expect(staging.state.works[0]).toMatchObject({ cover: `/media/${OLD_COVER_KEY}` })
  })
})
