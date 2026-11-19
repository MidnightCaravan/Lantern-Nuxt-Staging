import { describe, expect, it } from 'vitest'
import listHandler from '../server/api/discussions/[kind]/[targetId].get'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeComment, type FakeUser, type FakeWork } from './helpers/fake-d1'
import { csrfHeaders, makeSession, testEnv } from './helpers/session'

const user: FakeUser = {
  id: 9,
  username: 'reader',
  email: 'reader@example.com',
  password_hash: 'hash',
  display_name: 'Reader',
  email_verified: 1,
  avatar: null,
}
const novel: FakeWork = {
  id: 3,
  creator_id: 7,
  title: 'Novel',
  description: '',
  type: 'Novel',
  status: 'published',
}
const comments: FakeComment[] = [
  { id: 60, user_id: 9, parent_id: null, body: 'Mine', content_type: 'novel', content_id: 3 },
  { id: 61, user_id: 7, parent_id: 60, body: 'Reply', content_type: 'novel', content_id: 3 },
  { id: 62, user_id: 7, parent_id: null, body: 'Elsewhere', content_type: 'novel', content_id: 99 },
]

function setup() {
  const production = createFakeD1({ users: [user], works: [novel], comments })
  const staging = createFakeD1({ users: [user], works: [novel], comments })
  const env = testEnv(production, staging)
  return { production, staging, env }
}

function options(session?: string, kind = 'work', targetId = '3', source = 'production') {
  return {
    method: 'GET',
    path: `/api/test?source=${source}`,
    headers: session ? csrfHeaders(session) : {},
    params: { kind, targetId },
  }
}

describe('GET /api/discussions/:kind/:targetId', () => {
  it('projects comments in order with Flask ownership and like fields', async () => {
    const { env } = setup()
    const session = await makeSession(user.id, 'production', env)

    const result = await callHandler(listHandler, { env, ...options(session) })

    expect(result.status).toBe(200)
    expect(result.json.success).toBe(true)
    expect(result.json.comments).toHaveLength(2)
    expect(result.json.comments[0]).toMatchObject({
      id: 60,
      parent_id: null,
      body: 'Mine',
      username: 'reader',
      display_name: 'Reader',
      avatar: '',
      like_count: 0,
      liked_by_current_user: false,
      is_mine: true,
    })
    expect(result.json.comments[1]).toMatchObject({ id: 61, parent_id: 60, is_mine: false })
  })

  it('uses Flask 404 wording for a missing work discussion', async () => {
    const { env } = setup()

    const result = await callHandler(listHandler, { env, ...options(undefined, 'work', '999') })

    expect(result.status).toBe(404)
    expect(result.json.statusMessage).toBe('Published work not found.')
  })

  it('uses Flask 404 wording for a missing episode discussion', async () => {
    const { env } = setup()

    const result = await callHandler(listHandler, { env, ...options(undefined, 'episode', '999') })

    expect(result.status).toBe(404)
    expect(result.json.statusMessage).toBe('Episode not found.')
  })

  it('hides staging discussions from production sessions', async () => {
    const { env } = setup()
    const session = await makeSession(user.id, 'production', env)

    const result = await callHandler(listHandler, { env, ...options(session, 'work', '3', 'staging') })

    expect(result.status).toBe(404)
    expect(result.json.statusMessage).toBe('Staging discussion not found.')
  })
})
