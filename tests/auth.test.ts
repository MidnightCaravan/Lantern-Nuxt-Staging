import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import loginHandler from '../server/api/auth/login.post'
import logoutHandler from '../server/api/auth/logout.post'
import logoutGetHandler from '../server/routes/logout.get'
import meHandler from '../server/api/auth/me.get'
import registerHandler from '../server/api/auth/register.post'
import {
  createLanternPasswordHash,
  createLanternSession,
  verifyLanternPasswordHash,
} from '../server/utils/lantern-auth'
import { callHandler, cookieValue } from './helpers/handler'
import { PRODUCTION_WRITE_FLAG } from '../server/utils/lantern-writes'
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
    LANTERN_ANONYMOUS_WRITE_DATABASE: 'staging',
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

  it('verifies a Flask-generated PBKDF2 hash without hash migration', async () => {
    // Produced by src/lantern_passwords.py:26-88 with hashlib.pbkdf2_hmac:
    // password "parity-password", 16-byte salt 0x00..0x0f, 100000 iterations.
    const flaskHash = 'pbkdf2-sha256-custom:100000$AAECAwQFBgcICQoLDA0ODw$t0a6wfSfTGxXMscl6uQzcF-DBT1p6u5ZfqUPSP23nak'
    expect(await verifyLanternPasswordHash(flaskHash, 'parity-password')).toBe(true)
    expect(await verifyLanternPasswordHash(flaskHash, 'wrong password')).toBe(false)
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

  it('rejects an explicit invalid database target before any rate-limit write', async () => {
    const production = createFakeD1()
    const staging = createFakeD1()
    const result = await callHandler(loginHandler, {
      env: envFor(production, staging),
      method: 'POST',
      headers: csrfHeaders('login-invalid-database'),
      body: {
        email: 'reader@example.com',
        password: 'correct horse battery staple',
        csrfToken: CSRF,
        database: 'PRODUCTION',
      },
    })

    expect(result.status).toBe(403)
    expect(result.json.statusMessage).toBe('The requested account database is invalid.')
    expect(production.state.rateLimits).toEqual([])
    expect(staging.state.rateLimits).toEqual([])
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
  ] as const)('keeps the legacy production default for a %s database value', async (_label, database) => {
    const production = createFakeD1({ users: [baseUser()] })
    const staging = createFakeD1({ users: [baseUser()] })
    const body: Record<string, unknown> = {
      email: 'reader@example.com',
      password: 'correct horse battery staple',
      csrfToken: CSRF,
    }
    if (database !== undefined) body.database = database

    const blocked = await callHandler(loginHandler, {
      env: envFor(production, staging),
      method: 'POST',
      headers: csrfHeaders(`login-default-${_label}-blocked`),
      body,
    })
    expect(blocked.status).toBe(409)
    expect(blocked.json.statusMessage).toBe('Production accounts are read-only in this Nuxt staging build.')
    expect(production.state.rateLimits).toEqual([])
    expect(staging.state.rateLimits).toEqual([])

    const env = { ...envFor(production, staging), [PRODUCTION_WRITE_FLAG]: true }
    const allowed = await callHandler(loginHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders(`login-default-${_label}-enabled`),
      body,
    })
    expect(allowed.status).toBe(200)
    expect(production.state.rateLimits.length).toBeGreaterThan(0)
    expect(staging.state.rateLimits).toEqual([])
    const session = cookieValue(allowed.headers.get('set-cookie'), 'lantern_nuxt_session')
    const me = await callHandler(meHandler, {
      env,
      headers: { cookie: `lantern_nuxt_session=${session}` },
    })
    expect(me.json).toMatchObject({ database: 'production' })
  })
})

describe('GET /logout', () => {
  it('returns 405 like the Flask route, without allowing logout via GET', async () => {
    const result = await callHandler(logoutGetHandler, { env: {} })
    expect(result.status).toBe(405)
    expect(result.json).toBe('Method Not Allowed')
  })
})

describe('POST /api/auth/logout', () => {
  const env = envFor(createFakeD1(), createFakeD1())

  it('clears the session and returns the Flask one-time flash message', async () => {
    const issued = await callHandler(
      (event: any) => createLanternSession(event, 1, 'staging'),
      { env },
    )
    const session = cookieValue(issued.headers.get('set-cookie'), 'lantern_nuxt_session')
    expect(session).toBeTruthy()

    const result = await callHandler(logoutHandler, {
      env,
      method: 'POST',
      headers: { cookie: `lantern_nuxt_session=${session}; lantern_nuxt_csrf=${CSRF}` },
      body: { csrfToken: CSRF },
    })
    expect(result.status).toBe(200)
    expect(result.json).toEqual({ ok: true, message: 'You have been logged out.' })
    const setCookie = result.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('lantern_nuxt_session=')
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
  })

  it('stores the logout message as a one-time client flash', () => {
    const composable = readFileSync(
      path.join(process.cwd(), 'app/composables/useLanternAuth.ts'),
      'utf8',
    )
    expect(composable).toContain("flash.set(result.message, 'success')")
  })

  it('keeps Flask CSRF enforcement and accepts unauthenticated logout', async () => {
    const missingCsrf = await callHandler(logoutHandler, {
      env,
      method: 'POST',
      headers: { cookie: `lantern_nuxt_csrf=${CSRF}` },
      body: {},
    })
    const crossOrigin = await callHandler(logoutHandler, {
      env,
      method: 'POST',
      headers: { origin: 'http://evil.example', cookie: `lantern_nuxt_csrf=${CSRF}` },
      body: { csrfToken: CSRF },
    })
    const anonymous = await callHandler(logoutHandler, {
      env,
      method: 'POST',
      headers: { cookie: `lantern_nuxt_csrf=${CSRF}` },
      body: { csrfToken: CSRF },
    })
    expect([missingCsrf.status, crossOrigin.status, anonymous.status]).toEqual([403, 403, 200])
    expect(anonymous.json).toMatchObject({ message: 'You have been logged out.' })
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

  it('rejects registration when the email exists in the selected staging database', async () => {
    const production = createFakeD1()
    const staging = createFakeD1({ users: [baseUser()] })
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
    expect(production.state.users).toHaveLength(0)
    expect(staging.state.users).toHaveLength(1)
  })
})
