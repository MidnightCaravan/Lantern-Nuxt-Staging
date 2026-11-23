import { describe, expect, it } from 'vitest'
import profileGetHandler from '../server/api/studio/profile.get'
import profilePutHandler from '../server/api/studio/profile.put'
import createWorkHandler from '../server/api/studio/works.post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeUser, type FakeWork } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const user = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: 7,
  username: 'author',
  email: 'author@example.com',
  password_hash: 'secret-hash',
  display_name: 'Author',
  bio: 'Old bio',
  avatar: '/media/avatar.png',
  email_verified: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const work = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: 1,
  creator_id: 7,
  title: 'Existing',
  description: '',
  type: 'Novel',
  status: 'draft',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function setup() {
  const staging = createFakeD1({ users: [user()], works: [work()] })
  const production = createFakeD1({ users: [user()], works: [work()] })
  const env = testEnv(production, staging)
  return { staging, production, env }
}

describe('studio profile read', () => {
  it('returns a safe profile subset and marks staging writable', async () => {
    const { env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(profileGetHandler, {
      env,
      headers: { cookie: `lantern_nuxt_session=${session}` },
    })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({
      writable: true,
      profile: {
        id: 7,
        username: 'author',
        display_name: 'Author',
        bio: 'Old bio',
        email_verified: 1,
      },
    })
    expect(result.json.profile.password_hash).toBeUndefined()
  })

  it('marks production sessions read-only and rejects anonymous or missing accounts', async () => {
    const { env } = setup()
    const productionSession = await makeSession(7, 'production', env)
    const readOnly = await callHandler(profileGetHandler, {
      env,
      headers: { cookie: `lantern_nuxt_session=${productionSession}` },
    })
    expect(readOnly.json).toMatchObject({ writable: false })

    const anonymous = await callHandler(profileGetHandler, { env })
    const missing = createFakeD1()
    const missingEnv = testEnv(createFakeD1(), missing)
    const session = await makeSession(7, 'staging', missingEnv)
    const missingResult = await callHandler(profileGetHandler, {
      env: missingEnv,
      headers: { cookie: `lantern_nuxt_session=${session}` },
    })
    expect([anonymous.status, missingResult.status]).toEqual([401, 404])
  })
})

describe('studio profile update', () => {
  it('trims fields, clears an empty avatar, and updates the staging row', async () => {
    const { staging, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(profilePutHandler, {
      env,
      method: 'PUT',
      headers: csrfHeaders(session),
      body: {
        username: '  newauthor  ',
        display_name: '  New Author  ',
        bio: '  New bio  ',
        avatar: '   ',
        csrfToken: TEST_CSRF,
      },
    })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({
      ok: true,
      username: 'newauthor',
      message: 'Your profile has been updated.',
    })
    expect(staging.state.users[0]).toMatchObject({
      username: 'newauthor',
      display_name: 'New Author',
      bio: 'New bio',
      avatar: '',
    })
  })

  it('enforces Flask validation, duplicate usernames, CSRF, and staging writes', async () => {
    const { staging, env } = setup()
    staging.state.users.push(user({ id: 8, username: 'taken', email: 'taken@example.com' }))
    const owner = await makeSession(7, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)
    const input = { username: 'newauthor', display_name: 'New Author', bio: '', avatar: '', csrfToken: TEST_CSRF }

    const short = await callHandler(profilePutHandler, {
      env, method: 'PUT', headers: csrfHeaders(owner), body: { ...input, username: 'ab' },
    })
    const emptyName = await callHandler(profilePutHandler, {
      env, method: 'PUT', headers: csrfHeaders(owner), body: { ...input, display_name: '   ' },
    })
    const duplicate = await callHandler(profilePutHandler, {
      env, method: 'PUT', headers: csrfHeaders(owner), body: { ...input, username: 'taken' },
    })
    const badCsrf = await callHandler(profilePutHandler, {
      env, method: 'PUT', headers: csrfHeaders(owner), body: { ...input, csrfToken: 'wrong' },
    })
    const crossOrigin = await callHandler(profilePutHandler, {
      env,
      method: 'PUT',
      headers: { ...csrfHeaders(owner), origin: 'https://evil.example' },
      body: input,
    })
    const anonymous = await callHandler(profilePutHandler, {
      env, method: 'PUT', headers: { 'cf-connecting-ip': 'profile-anon' }, body: input,
    })
    const production = await callHandler(profilePutHandler, {
      env, method: 'PUT', headers: csrfHeaders(productionSession), body: input,
    })

    expect([short.status, emptyName.status, duplicate.status, badCsrf.status, crossOrigin.status, anonymous.status, production.status])
      .toEqual([400, 400, 409, 403, 403, 401, 409])
    expect(staging.state.users[0]).toMatchObject({ username: 'author', display_name: 'Author' })
  })
})

describe('studio work creation', () => {
  it('creates a trimmed draft with Flask type mapping and timestamps', async () => {
    const { staging, env } = setup()
    const session = await makeSession(7, 'staging', env)
    const result = await callHandler(createWorkHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(session),
      body: { type: 'comic', title: '  My Comic  ', description: '  A description  ', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({
      ok: true,
      workId: 2,
      type: 'Comic',
      message: 'Comic draft created successfully.',
    })
    expect(staging.state.works[1]).toMatchObject({
      id: 2,
      creator_id: 7,
      title: 'My Comic',
      description: 'A description',
      type: 'Comic',
      status: 'draft',
    })
    expect(staging.state.works[1]!.created_at).toBeTruthy()
    expect(staging.state.works[1]!.updated_at).toBe(staging.state.works[1]!.created_at)
  })

  it('rejects invalid types, empty titles, oversized fields, CSRF failures, and production writes', async () => {
    const { staging, env } = setup()
    const owner = await makeSession(7, 'staging', env)
    const productionSession = await makeSession(7, 'production', env)
    const valid = { type: 'novel', title: 'Title', description: '', csrfToken: TEST_CSRF }

    const invalidType = await callHandler(createWorkHandler, {
      env, method: 'POST', headers: csrfHeaders(owner), body: { ...valid, type: 'audio' },
    })
    const emptyTitle = await callHandler(createWorkHandler, {
      env, method: 'POST', headers: csrfHeaders(owner), body: { ...valid, title: '   ' },
    })
    const longTitle = await callHandler(createWorkHandler, {
      env, method: 'POST', headers: csrfHeaders(owner), body: { ...valid, title: 'x'.repeat(201) },
    })
    const longDescription = await callHandler(createWorkHandler, {
      env, method: 'POST', headers: csrfHeaders(owner), body: { ...valid, description: 'x'.repeat(2001) },
    })
    const badCsrf = await callHandler(createWorkHandler, {
      env, method: 'POST', headers: csrfHeaders(owner), body: { ...valid, csrfToken: 'wrong' },
    })
    const production = await callHandler(createWorkHandler, {
      env, method: 'POST', headers: csrfHeaders(productionSession), body: valid,
    })

    expect([invalidType.status, emptyTitle.status, longTitle.status, longDescription.status, badCsrf.status, production.status])
      .toEqual([400, 400, 400, 400, 403, 409])
    expect(staging.state.works).toHaveLength(1)
  })
})
