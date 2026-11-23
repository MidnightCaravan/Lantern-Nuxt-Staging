import { describe, expect, it } from 'vitest'
import readHandler from '../server/api/comic/episodes/[episodeId]/read.get'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeComicEpisode, type FakeComicPage, type FakeUser, type FakeWork } from './helpers/fake-d1'
import { makeSession, testEnv } from './helpers/session'

const comic = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 5,
  creator_id: 7,
  title: 'Comic',
  description: '',
  type: 'Comic',
  status: 'published',
  ...overrides,
})
const episode = (overrides: Partial<FakeComicEpisode> = {}): FakeComicEpisode => ({
  id: 20,
  work_id: 5,
  episode_number: 1,
  title: 'Episode 1',
  status: 'published',
  ...overrides,
})
const page = (overrides: Partial<FakeComicPage> = {}): FakeComicPage => ({
  id: 1,
  episode_id: 20,
  page_number: 1,
  image_path: 'uploads/comics/5/20/page-1.png',
  ...overrides,
})
const user = (id: number, username: string): FakeUser => ({
  id,
  username,
  email: `${username}@example.com`,
  password_hash: 'hash',
  display_name: username,
  email_verified: 1,
})
const sessionCookie = (session: string) => ({ cookie: `lantern_nuxt_session=${session}` })

describe('comic reader access parity', () => {
  it('serves a published episode publicly even when the URL still carries ?preview=1', async () => {
    // In the staging deployment public reads come from the staging database.
    const staging = createFakeD1({
      users: [user(7, 'author'), user(8, 'reader')],
      works: [comic()],
      comicEpisodes: [episode()],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging)
    const nonOwner = await makeSession(8, 'staging', env)
    const result = await callHandler(readHandler, {
      env,
      headers: sessionCookie(nonOwner),
      params: { episodeId: '20' },
      path: '/api/test?preview=1',
    })
    expect(result.status).toBe(200)
    expect(result.json.isPreview).toBe(false)
    expect(result.json.source).toBe('staging')
    // The canonical public media URL is used, not the owner-only proxy, even
    // for a logged-in non-owner with a copied preview flag.
    expect(result.json.pages[0].imageUrl).toBe(`/media/${page().image_path}`)
  })

  it('still lets the owner preview a draft episode', async () => {
    const staging = createFakeD1({
      users: [user(7, 'author'), user(8, 'reader')],
      works: [comic({ status: 'draft' })],
      comicEpisodes: [episode({ status: 'draft' })],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging)
    const owner = await makeSession(7, 'staging', env)
    const result = await callHandler(readHandler, {
      env,
      headers: sessionCookie(owner),
      params: { episodeId: '20' },
      path: '/api/test?preview=1',
    })
    expect(result.status).toBe(200)
    expect(result.json.isPreview).toBe(true)
    expect(result.json.source).toBe('staging')
    expect(result.json.pages[0].imageUrl).toBe('/api/comic/pages/1/media')
  })

  it('does not let a non-owner preview a draft episode', async () => {
    const staging = createFakeD1({
      users: [user(7, 'author'), user(8, 'reader')],
      works: [comic({ status: 'draft' })],
      comicEpisodes: [episode({ status: 'draft' })],
      comicPages: [page()],
    })
    const env = testEnv(createFakeD1(), staging)
    const nonOwner = await makeSession(8, 'staging', env)
    const result = await callHandler(readHandler, {
      env,
      headers: sessionCookie(nonOwner),
      params: { episodeId: '20' },
      path: '/api/test?preview=1',
    })
    expect(result.status).toBe(404)
  })
})
