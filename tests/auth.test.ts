import { beforeAll, describe, expect, it, vi } from 'vitest'
import loginHandler from '../server/api/auth/login.post'
import logoutGetHandler from '../server/routes/logout.get'
import meHandler from '../server/api/auth/me.get'
import registerHandler from '../server/api/auth/register.post'
import {
  createLanternPasswordHash,
  verifyLanternPasswordHash,
} from '../server/utils/lantern-auth'
import { callHandler, cookieValue } from './helpers/handler'
import { createFakeD1, type FakeUser } from './helpers/fake-d1'

const SECRET = 'lantern-test-session-secret-at-least-32-chars'
const CSRF = 'lantern-test-csrf-token-at-least-32-chars'

let validHash: string

const baseUser = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: 1,
  username: 'reader',
  email: 'reader@example.com',
  password_hash: validHash,
  display_name: 'Reader',
  email_verified: 1,
  ...overrides,
})

function envFor(production: any, staging: any) {
  return {
    LANTERN_NUXT_SESSION_SECRET: SECRET,
    lantern_db: production,
    lantern_staging_db: staging,
  }
}

function csrfHeaders(ip: string, cookie = CSRF) {
  return {
    'cf-connecting-ip': ip,
    cookie: `lantern_nuxt_csrf=${cookie}`,
  }
}

beforeAll(async () => {
  validHash = await createLanternPasswordHash('correct horse battery staple')
})

describe('auth utility parity', () => {
  it('round-trips PBKDF2 hashes and rejects legacy scrypt hashes', async () => {
    expect(await verifyLanternPasswordHash(validHash, 'correct horse battery staple')).toBe(true)
    expect(await verifyLanternPasswordHash(validHash, 'wrong password')).toBe(false)
    expect(await verifyLanternPasswordHash('scrypt:anything', 'correct horse battery staple')).toBe(false)
  })
})

describe('POST /api/auth/login', () => {
  it('rejects a request without a valid same-origin CSRF token', async () => {
    const staging = createFakeD1()
    const result = await callHandler(loginHandler, {
      env: envFor(createFakeD1(), staging),
      method: 'POST',
      headers: { 'cf-connecting-ip': 'login-no-csrf' },
      body: { email: 'reader@example.com', password: 'correct horse battery staple', csrfToken: CSRF, database: 'staging' },
    })
    expect(result.status).toBe(403)
  })

  it('rejects invalid credentials without revealing which field was wrong', async () => {
    const staging = createFakeD1({ users: [baseUser({ id: 2, email: 'someone@example.com' })] })
    const result = await callHandler(loginHandler, {
      env: envFor(createFakeD1(), staging),
      method: 'POST',
      headers: csrfHeaders('login-bad-password'),
      body: { email: 'someone@example.com', password: 'wrong password', csrfToken: CSRF, database: 'staging' },
    })
    expect(result.status).toBe(401)
    expect(result.json).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('requires a password reset for legacy scrypt hashes, matching Flask', async () => {
    const staging = createFakeD1({ users: [baseUser({ password_hash: 'scrypt:legacy$hash' })] })
    const result = await callHandler(loginHandler, {
      env: envFor(createFakeD1(), staging),
      method: 'POST',
      headers: csrfHeaders('login-scrypt'),
      body: { email: 'reader@example.com', password: 'correct horse battery staple', csrfToken: CSRF, database: 'staging' },
    })
    expect(result.status).toBe(409)
    expect(result.json).toMatchObject({ ok: false, code: 'PASSWORD_RESET_REQUIRED' })
  })

  it('blocks unverified accounts, matching Flask', async () => {
    const staging = createFakeD1({ users: [baseUser({ email_verified: 0 })] })
    const result = await callHandler(loginHandler, {
      env: envFor(createFakeD1(), staging),
      method: 'POST',
      headers: csrfHeaders('login-unverified'),
      body: { email: 'reader@example.com', password: 'correct horse battery staple', csrfToken: CSRF, database: 'staging' },
    })
    expect(result.status).toBe(403)
    expect(result.json).toMatchObject({ ok: false, code: 'STAGING_EMAIL_NOT_VERIFIED' })
  })

  it('issues a staging session that /api/auth/me resolves', async () => {
    const staging = createFakeD1({ users: [baseUser()] })
    const env = envFor(createFakeD1(), staging)
    const login = await callHandler(loginHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders('login-success'),
      body: { email: 'READER@example.com', password: 'correct horse battery staple', csrfToken: CSRF, database: 'staging' },
    })
    expect(login.status).toBe(200)
    expect(login.json).toMatchObject({ ok: true, user: { id: 1, username: 'reader' } })
    const session = cookieValue(login.headers.get('set-cookie'), 'lantern_nuxt_session')
    expect(session).toBeTruthy()

    const me = await callHandler(meHandler, {
      env,
      headers: { cookie: `lantern_nuxt_session=${session}` },
    })
    expect(me.status).toBe(200)
    expect(me.json).toMatchObject({ database: 'staging', user: { id: 1, username: 'reader' } })
  })
})

describe('GET /logout', () => {
  it('returns 405 like the Flask route, without allowing logout via GET', async () => {
    const result = await callHandler(logoutGetHandler, { env: {} })
    expect(result.status).toBe(405)
    expect(result.json).toBe('Method Not Allowed')
  })
})

describe('POST /api/auth/register', () => {
  it('writes only to staging and creates a verification token', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const production = createFakeD1()
    const staging = createFakeD1()
    const result = await callHandler(registerHandler, {
      env: envFor(production, staging),
      method: 'POST',
      headers: csrfHeaders('register-new'),
      body: {
        username: 'newcreator',
        email: 'new@example.com',
        password: 'correct horse battery staple',
        confirmPassword: 'correct horse battery staple',
        csrfToken: CSRF,
      },
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, emailSent: false })
    expect(production.state.users).toHaveLength(0)
    expect(staging.state.users).toHaveLength(1)
    expect(staging.state.users[0]).toMatchObject({ username: 'newcreator', email: 'new@example.com', email_verified: 0 })
    expect(staging.state.emailTokens).toHaveLength(1)
    expect(staging.state.emailTokens[0]).toMatchObject({ user_id: staging.state.users[0]!.id, token_type: 'email_verification', used: 0 })
    errorSpy.mockRestore()
  })

  it('rejects registration when the email exists in the production database', async () => {
    const production = createFakeD1({ users: [baseUser()] })
    const staging = createFakeD1()
    const result = await callHandler(registerHandler, {
      env: envFor(production, staging),
      method: 'POST',
      headers: csrfHeaders('register-duplicate'),
      body: {
        username: 'someoneelse',
        email: 'reader@example.com',
        password: 'correct horse battery staple',
        confirmPassword: 'correct horse battery staple',
        csrfToken: CSRF,
      },
    })
    expect(result.status).toBe(409)
    expect(result.json).toMatchObject({ ok: false, code: 'ACCOUNT_EXISTS' })
    expect(production.state.users).toHaveLength(1)
    expect(staging.state.users).toHaveLength(0)
  })
})
