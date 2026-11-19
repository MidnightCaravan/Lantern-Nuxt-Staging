import { describe, expect, it } from 'vitest'
import createHandler from '../server/api/comic/works/[workId]/episodes.post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeComicEpisode, type FakeWork } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const comic = (overrides: Partial<FakeWork> = {}): FakeWork => ({
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
  ...overrides,
})

function setup(initialEpisodes: FakeComicEpisode[] = []) {
  const staging = createFakeD1({ works: [comic()], comicEpisodes: initialEpisodes })
  const production = createFakeD1({ works: [comic()], comicEpisodes: initialEpisodes })
  const env = testEnv(production, staging)
  return { staging, env }
}

function options(session: string, body: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    path: '/api/test',
    headers: csrfHeaders(session),
    params: { workId: '3' },
    body: { title: 'Episode 1', csrfToken: TEST_CSRF, ...body },
  }
}

describe('POST /api/comic/works/:workId/episodes', () => {
  it('creates the first episode as draft number 1 with the Flask flash message', async () => {
    const { staging, env } = setup()
    const session = await makeSession(7, 'staging', env)

    const result = await callHandler(createHandler, { env, ...options(session, { title: 'Episode 1' }) })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, episodeId: 1, episodeNumber: 1, message: 'Episode 1 created.' })
    expect(staging.state.comicEpisodes[0]).toMatchObject({ episode_number: 1, title: 'Episode 1', status: 'draft' })
  })

  it('numbers from MAX + 1 and ignores episodes on other works', async () => {
    const { env } = setup([
      episode({ id: 20, work_id: 3, episode_number: 1 }),
      episode({ id: 21, work_id: 3, episode_number: 3 }),
      episode({ id: 22, work_id: 99, episode_number: 50 }),
    ])
    const session = await makeSession(7, 'staging', env)

    const result = await callHandler(createHandler, { env, ...options(session, { title: 'Episode 4' }) })

    expect(result.json.episodeNumber).toBe(4)
    expect(result.json.episodeId).toBe(23)
  })

  it('requires a non-empty title', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)

    const result = await callHandler(createHandler, { env, ...options(session, { title: '   ' }) })

    expect(result.status).toBe(400)
    expect(result.json.statusMessage).toBe('Please give the episode a title.')
  })

  it('rejects a work the user does not own', async () => {
    const { env } = setup()
    const session = await makeSession(8, 'staging', env)

    const result = await callHandler(createHandler, { env, ...options(session) })

    expect(result.status).toBe(404)
    expect(result.json.statusMessage).toBe('Comic not found.')
  })
})
