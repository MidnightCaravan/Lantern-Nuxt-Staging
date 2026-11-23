import { describe, expect, it } from 'vitest'
import postHandler from '../server/api/discussions/[kind]/[targetId].post'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeUser, type FakeWork } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, makeSession, testEnv } from './helpers/session'

const user: FakeUser = {
  id: 9,
  username: 'reader',
  email: 'reader@example.com',
  password_hash: 'hash',
  display_name: 'Reader',
  email_verified: 1,
}
const novel: FakeWork = {
  id: 3,
  creator_id: 7,
  title: 'Novel',
  description: '',
  type: 'Novel',
  status: 'published',
}

function setup() {
  const staging = createFakeD1({ users: [user], works: [novel] })
  const production = createFakeD1({ users: [user], works: [novel] })
  const env = testEnv(production, staging)
  return { staging, env }
}

function options(session: string, body: Record<string, unknown> = {}, source = 'staging') {
  return {
    method: 'POST',
    path: `/api/test?source=${source}`,
    headers: csrfHeaders(session),
    params: { kind: 'work', targetId: '3' },
    body: { body: 'A comment', csrfToken: TEST_CSRF, ...body },
  }
}

describe('posting a discussion comment', () => {
  it('creates a comment with the Flask 201 status and lastrowid projection', async () => {
    const { staging, env } = setup()
    const session = await makeSession(user.id, 'staging', env)

    const result = await callHandler(postHandler, { env, ...options(session) })

    expect(result.status).toBe(201)
    expect(result.json).toMatchObject({
      success: true,
      comment: {
        id: 1,
        parent_id: null,
        body: 'A comment',
        username: 'reader',
        display_name: 'Reader',
        like_count: 0,
        liked_by_current_user: false,
        is_mine: true,
      },
    })
    expect(staging.state.comments).toHaveLength(1)
  })

  it('returns the new comment id even when another comment exists on the work', async () => {
    const { staging, env } = setup()
    staging.state.comments.push({
      id: 50,
      user_id: 7,
      parent_id: null,
      body: 'Earlier comment',
      content_type: 'novel',
      content_id: 3,
    })
    const session = await makeSession(user.id, 'staging', env)

    const result = await callHandler(postHandler, { env, ...options(session) })

    expect(result.status).toBe(201)
    expect(result.json.comment.id).toBe(51)
  })

  it('rejects empty and oversized comments like Flask', async () => {
    const { env } = setup()
    const session = await makeSession(user.id, 'staging', env)

    const empty = await callHandler(postHandler, { env, ...options(session, { body: '   ' }) })
    const tooLong = await callHandler(postHandler, { env, ...options(session, { body: 'x'.repeat(5001) }) })

    expect(empty.status).toBe(400)
    expect(empty.json.statusMessage).toBe('Comment cannot be empty.')
    expect(tooLong.status).toBe(400)
    expect(tooLong.json.statusMessage).toBe('Comment is too long.')
  })

  it('rejects a reply target outside this discussion', async () => {
    const { staging, env } = setup()
    staging.state.comments.push({
      id: 50,
      user_id: 7,
      parent_id: null,
      body: 'Elsewhere',
      content_type: 'novel',
      content_id: 99,
    })
    const session = await makeSession(user.id, 'staging', env)

    const result = await callHandler(postHandler, { env, ...options(session, { parent_id: 50 }) })

    expect(result.status).toBe(400)
    expect(result.json.statusMessage).toBe("Reply target was not found in this work's discussion.")
  })

  it("uses Flask's episode wording for an invalid episode reply target", async () => {
    const comic = { ...novel, id: 4, type: 'Comic' }
    const staging = createFakeD1({
      users: [user],
      works: [comic],
      comicEpisodes: [{ id: 5, work_id: 4, status: 'published' }],
    })
    const env = testEnv(createFakeD1(), staging)
    staging.state.comments.push({
      id: 51,
      user_id: 9,
      parent_id: null,
      body: 'Elsewhere',
      content_type: 'novel',
      content_id: 99,
    })
    const session = await makeSession(user.id, 'staging', env)

    const result = await callHandler(postHandler, {
      env,
      ...options(session, { parent_id: 51 }),
      params: { kind: 'episode', targetId: '5' },
    })

    expect(result.status).toBe(400)
    expect(result.json.statusMessage).toBe("Reply target was not found in this episode's discussion.")
  })

  it('refuses production writes in the staging build', async () => {
    const { env } = setup()
    const session = await makeSession(user.id, 'staging', env)

    const result = await callHandler(postHandler, { env, ...options(session, {}, 'production') })

    expect(result.status).toBe(409)
  })
})
