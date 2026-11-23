import { describe, expect, it, vi } from 'vitest'
import getWorkHandler from '../server/api/studio/works/[workId].get'
import putWorkHandler from '../server/api/studio/works/[workId].put'
import deleteWorkHandler from '../server/api/studio/works/[workId]/delete.post'
import { createLanternSession } from '../server/utils/lantern-auth'
import { callHandler, cookieValue } from './helpers/handler'
import { createFakeD1, type FakeWork } from './helpers/fake-d1'

const SECRET = 'lantern-test-session-secret-at-least-32-chars'
const CSRF = 'lantern-test-csrf-token-at-least-32-chars'
const WORK_ID = '10'

const draftWork = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: Number(WORK_ID),
  creator_id: 7,
  title: 'Original title',
  description: 'Original description',
  type: 'Novel',
  status: 'draft',
  cover: null,
  video_path: null,
  ...overrides,
})

async function sessionCookie(userId: number, database: 'production' | 'staging', env: Record<string, any>) {
  const response = await callHandler(
    (event: any) => createLanternSession(event, userId, database),
    { env },
  )
  return cookieValue(response.headers.get('set-cookie'), 'lantern_nuxt_session')!
}

function envFor(production: any, staging: any, mediaBucket?: any) {
  return {
    LANTERN_NUXT_SESSION_SECRET: SECRET,
    lantern_db: production,
    lantern_staging_db: staging,
    lantern_staging_media: mediaBucket,
  }
}

function requestOptions(session: string, extra: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: { cookie: `lantern_nuxt_session=${session}; lantern_nuxt_csrf=${CSRF}` },
    params: { workId: WORK_ID },
    body: { csrfToken: CSRF },
    ...extra,
  }
}

describe('studio work ownership', () => {
  it('reads only the signed-in creator’s work and exposes staging writability', async () => {
    const env = envFor(
      createFakeD1({ works: [draftWork()] }),
      createFakeD1({ works: [draftWork()] }),
    )
    const session = await sessionCookie(7, 'staging', env)
    const result = await callHandler(getWorkHandler, { env, ...requestOptions(session), method: 'GET' })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ work: { id: 10, creator_id: 7 }, writable: true })
  })

  it('returns 404 for another creator’s work instead of exposing it', async () => {
    const env = envFor(
      createFakeD1({ works: [draftWork()] }),
      createFakeD1({ works: [draftWork()] }),
    )
    const session = await sessionCookie(8, 'staging', env)
    const result = await callHandler(getWorkHandler, { env, ...requestOptions(session), method: 'GET' })
    expect(result.status).toBe(404)
  })

  it('rejects anonymous reads with 401', async () => {
    const env = envFor(createFakeD1(), createFakeD1())
    const result = await callHandler(getWorkHandler, { params: { workId: WORK_ID } })
    expect(result.status).toBe(401)
  })

  it('lets an owner edit a draft, matching Flask title/description rules', async () => {
    const production = createFakeD1({ works: [draftWork()] })
    const staging = createFakeD1({ works: [draftWork()] })
    const env = envFor(production, staging)
    const session = await sessionCookie(7, 'staging', env)
    const result = await callHandler(putWorkHandler, {
      env,
      ...requestOptions(session),
      body: { title: '  New title  ', description: '  New description  ', csrfToken: CSRF },
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.works[0]).toMatchObject({ title: 'New title', description: 'New description' })
    expect(production.state.works[0]!.title).toBe('Original title')
  })

  it('applies the same validation limits as Flask edit_work', async () => {
    const staging = createFakeD1({ works: [draftWork()] })
    const env = envFor(createFakeD1(), staging)
    const session = await sessionCookie(7, 'staging', env)
    const cases = [
      { title: ' ', description: '', expected: 400 },
      { title: 'x'.repeat(201), description: '', expected: 400 },
      { title: 'Valid', description: 'x'.repeat(2001), expected: 400 },
    ]
    for (const item of cases) {
      const result = await callHandler(putWorkHandler, {
        env,
        ...requestOptions(session),
        body: { title: item.title, description: item.description, csrfToken: CSRF },
      })
      expect(result.status).toBe(item.expected)
    }
    expect(staging.state.works[0]!.title).toBe('Original title')
  })

  it('rejects edits by non-owners and requests without CSRF', async () => {
    const staging = createFakeD1({ works: [draftWork()] })
    const env = envFor(createFakeD1(), staging)
    const nonOwner = await sessionCookie(8, 'staging', env)
    const nonOwnerResult = await callHandler(putWorkHandler, {
      env,
      ...requestOptions(nonOwner),
      body: { title: 'Hijacked', description: '', csrfToken: CSRF },
    })
    expect(nonOwnerResult.status).toBe(404)

    const owner = await sessionCookie(7, 'staging', env)
    const noCsrf = await callHandler(putWorkHandler, {
      env,
      ...requestOptions(owner),
      headers: { cookie: `lantern_nuxt_session=${owner}` },
      body: { title: 'No CSRF', description: '', csrfToken: CSRF },
    })
    expect(noCsrf.status).toBe(403)
    expect(staging.state.works[0]!.title).toBe('Original title')
  })

  it('blocks all production-session mutations with 409', async () => {
    const production = createFakeD1({ works: [draftWork()] })
    const staging = createFakeD1({ works: [draftWork()] })
    const env = envFor(production, staging)
    const session = await sessionCookie(7, 'production', env)
    const edit = await callHandler(putWorkHandler, {
      env,
      ...requestOptions(session),
      body: { title: 'Cannot edit', description: '', csrfToken: CSRF },
    })
    const remove = await callHandler(deleteWorkHandler, { env, ...requestOptions(session) })
    expect(edit.status).toBe(409)
    expect(remove.status).toBe(409)
    expect(production.state.works[0]!.title).toBe('Original title')
    expect(staging.state.works).toHaveLength(1)
  })

  it('deletes only owner-owned drafts and cleans up their stored media', async () => {
    const bucket = { delete: vi.fn().mockResolvedValue(undefined) }
    const staging = createFakeD1({
      works: [draftWork({ cover: 'uploads/covers/10/cover.jpg', video_path: 'uploads/videos/10/video.mp4' })],
      chapters: [{
        id: 30, work_id: 10, chapter_number: 1, title: 'Chapter 1', content: 'Text',
        status: 'draft', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      }],
      comicEpisodes: [{ id: 20, work_id: 10 }],
      comicPages: [{ episode_id: 20, image_path: 'uploads/comics/10/page-1.jpg' }],
    })
    const env = envFor(createFakeD1(), staging, bucket)
    const session = await sessionCookie(7, 'staging', env)
    const result = await callHandler(deleteWorkHandler, { env, ...requestOptions(session) })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.works).toHaveLength(0)
    expect(staging.state.comicPages).toHaveLength(0)
    expect(staging.state.comicEpisodes).toHaveLength(0)
    expect(staging.state.chapters).toHaveLength(0)
    expect(bucket.delete.mock.calls.map(([key]) => key).sort()).toEqual([
      'uploads/comics/10/page-1.jpg',
      'uploads/covers/10/cover.jpg',
      'uploads/videos/10/video.mp4',
    ])
  })

  it('refuses to delete a published work', async () => {
    const staging = createFakeD1({ works: [draftWork({ status: 'published' })] })
    const env = envFor(createFakeD1(), staging)
    const session = await sessionCookie(7, 'staging', env)
    const result = await callHandler(deleteWorkHandler, { env, ...requestOptions(session) })
    expect(result.status).toBe(409)
    expect(staging.state.works).toHaveLength(1)
  })
})
