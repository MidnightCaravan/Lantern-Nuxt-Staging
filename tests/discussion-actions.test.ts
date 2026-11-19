import { describe, expect, it } from 'vitest'
import actionHandler from '../server/api/discussions/[kind]/[targetId]/[commentId]/[action].post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeComment, type FakeComicEpisode, type FakeWork } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const novel: FakeWork = {
  id: 3,
  creator_id: 7,
  title: 'Novel',
  description: '',
  type: 'Novel',
  status: 'published',
}
const comic: FakeWork = {
  id: 5,
  creator_id: 7,
  title: 'Comic',
  description: '',
  type: 'Comic',
  status: 'published',
}
const episode: FakeComicEpisode = { id: 20, work_id: 5, status: 'published' }

const comment = (overrides: Partial<FakeComment> = {}): FakeComment => ({
  id: 60,
  user_id: 8,
  parent_id: null,
  body: 'Original comment',
  content_type: 'novel',
  content_id: 3,
  ...overrides,
})

function setup() {
  const staging = createFakeD1({
    works: [novel, comic],
    comicEpisodes: [episode],
    comments: [comment(), comment({ id: 61, user_id: 9, parent_id: 60, body: 'Reply' })],
  })
  const production = createFakeD1({ works: [novel, comic], comicEpisodes: [episode] })
  const env = testEnv(production, staging)
  return { staging, production, env }
}

function options(session: string, action: string, extra: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    path: '/api/test?source=staging',
    headers: csrfHeaders(session),
    params: { kind: 'work', targetId: '3', commentId: '60', action },
    body: { csrfToken: TEST_CSRF },
    ...extra,
  }
}

describe('discussion comment actions', () => {
  it('toggles a like on and off with a counted total', async () => {
    const { env } = setup()
    const session = await makeSession(9, 'staging', env)
    const first = await callHandler(actionHandler, { env, ...options(session, 'like') })
    const second = await callHandler(actionHandler, { env, ...options(session, 'like') })
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ success: true, liked: true, like_count: 1 })
    expect(second.status).toBe(200)
    expect(second.json).toMatchObject({ success: true, liked: false, like_count: 0 })
  })

  it('lets only the author edit and delete, with replies cascading', async () => {
    const { staging, env } = setup()
    const author = await makeSession(8, 'staging', env)
    const other = await makeSession(9, 'staging', env)

    const edit = await callHandler(actionHandler, {
      env,
      ...options(author, 'edit', { body: { body: '  Edited comment  ', csrfToken: TEST_CSRF } }),
    })
    expect(edit.status).toBe(200)
    expect(edit.json).toMatchObject({ success: true, body: 'Edited comment' })
    expect(staging.state.comments[0]!.body).toBe('Edited comment')

    const nonOwnerEdit = await callHandler(actionHandler, {
      env,
      ...options(other, 'edit', { body: { body: 'Hijacked', csrfToken: TEST_CSRF } }),
    })
    expect(nonOwnerEdit.status).toBe(403)

    const emptyEdit = await callHandler(actionHandler, {
      env,
      ...options(author, 'edit', { body: { body: '   ', csrfToken: TEST_CSRF } }),
    })
    expect(emptyEdit.status).toBe(400)

    const deleteResult = await callHandler(actionHandler, { env, ...options(author, 'delete') })
    expect(deleteResult.status).toBe(200)
    expect(staging.state.comments).toHaveLength(0)
  })

  it('records an open report once, with Flask-compatible 201 and duplicate 409', async () => {
    const { staging, env } = setup()
    const reporter = await makeSession(7, 'staging', env)
    const reportOptions = options(reporter, 'report', {
      body: { reason: '  Spam  ', csrfToken: TEST_CSRF },
    })
    const first = await callHandler(actionHandler, { env, ...reportOptions })
    expect(first.status).toBe(201)
    expect(first.json).toMatchObject({ success: true })
    expect(staging.state.commentReports[0]).toMatchObject({
      comment_id: 60,
      reporter_id: 7,
      reason: 'Spam',
      status: 'open',
    })

    const duplicate = await callHandler(actionHandler, { env, ...reportOptions })
    expect(duplicate.status).toBe(409)
    expect(staging.state.commentReports).toHaveLength(1)
  })

  it('rejects self-reports and invalid report reasons', async () => {
    const { staging, env } = setup()
    const author = await makeSession(8, 'staging', env)
    const selfReport = await callHandler(actionHandler, {
      env,
      ...options(author, 'report', { body: { reason: 'I dislike myself', csrfToken: TEST_CSRF } }),
    })
    expect(selfReport.status).toBe(400)

    const reporter = await makeSession(7, 'staging', env)
    const empty = await callHandler(actionHandler, {
      env,
      ...options(reporter, 'report', { body: { reason: '  ', csrfToken: TEST_CSRF } }),
    })
    const tooLong = await callHandler(actionHandler, {
      env,
      ...options(reporter, 'report', { body: { reason: 'x'.repeat(1001), csrfToken: TEST_CSRF } }),
    })
    expect(empty.status).toBe(400)
    expect(tooLong.status).toBe(400)
    expect(staging.state.commentReports).toHaveLength(0)
  })

  it('rejects production sessions, production source, and episode comments on wrong targets', async () => {
    const { env } = setup()
    const productionSession = await makeSession(7, 'production', env)
    const stagingSession = await makeSession(7, 'staging', env)

    const productionIdentity = await callHandler(actionHandler, {
      env,
      ...options(productionSession, 'like'),
    })
    const productionSource = await callHandler(actionHandler, {
      env,
      ...options(stagingSession, 'like', { path: '/api/test?source=production' }),
    })
    const wrongTarget = await callHandler(actionHandler, {
      env,
      ...options(stagingSession, 'like', {
        params: { kind: 'episode', targetId: '20', commentId: '60', action: 'like' },
      }),
    })

    expect(productionIdentity.status).toBe(409)
    expect(productionSource.status).toBe(409)
    expect(wrongTarget.status).toBe(404)
  })

  it('accepts episode comments against the canonical episode target', async () => {
    const { staging, env } = setup()
    staging.state.comments.push(comment({ id: 62, content_type: 'comic_episode', content_id: 20 }))
    const session = await makeSession(9, 'staging', env)
    const result = await callHandler(actionHandler, {
      env,
      ...options(session, 'like', {
        params: { kind: 'episode', targetId: '20', commentId: '62', action: 'like' },
      }),
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ success: true, liked: true, like_count: 1 })
  })
})
