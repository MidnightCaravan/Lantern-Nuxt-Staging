import { describe, expect, it } from 'vitest'
import loginHandler from '../server/api/auth/login.post'
import registerHandler from '../server/api/auth/register.post'
import resendHandler from '../server/api/auth/resend-verification.post'
import forgotHandler from '../server/api/auth/forgot-password.post'
import resetHandler from '../server/api/auth/reset-password/[token].post'
import { AUTH_RATE_LIMITS, recordAuthAttempt } from '../server/utils/lantern-rate-limits'
import { createFakeD1 } from './helpers/fake-d1'
import { callHandler } from './helpers/handler'
import { TEST_CSRF, csrfHeaders, testEnv } from './helpers/session'

const SECRET = 'lantern-test-session-secret-at-least-32-chars'
const NOW = 1_800_000_000
const IP = '203.0.113.10'

const user = {
  id: 1,
  username: 'reader',
  email: 'reader@example.com',
  password_hash: 'not-a-valid-hash',
  display_name: 'Reader',
  email_verified: 1,
}

function headers(ip = IP) {
  return csrfHeaders('', { 'cf-connecting-ip': ip })
}

describe('durable auth rate-limit algorithm', () => {
  it('uses Flask fixed windows and blocks after the policy maximum', async () => {
    const db = createFakeD1()
    const max = AUTH_RATE_LIMITS.login.max

    for (let attempt = 1; attempt <= max; attempt++) {
      const result = await recordAuthAttempt(db, SECRET, 'login', IP, NOW)
      expect(result.attempts).toBe(attempt)
      expect(result.allowed).toBe(true)
      expect(result.windowStart).toBe(NOW - (NOW % AUTH_RATE_LIMITS.login.windowSeconds))
    }

    const blocked = await recordAuthAttempt(db, SECRET, 'login', IP, NOW)
    expect(blocked.attempts).toBe(max + 1)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('resets attempts when the fixed window rolls over', async () => {
    const db = createFakeD1()
    const window = AUTH_RATE_LIMITS.login.windowSeconds
    const current = NOW - (NOW % window)

    await recordAuthAttempt(db, SECRET, 'login', IP, current + 10)
    await recordAuthAttempt(db, SECRET, 'login', IP, current + 20)

    const nextWindow = await recordAuthAttempt(db, SECRET, 'login', IP, current + window + 1)
    expect(nextWindow.attempts).toBe(1)
    expect(nextWindow.allowed).toBe(true)
  })

  it('keys counters independently by endpoint and client IP', async () => {
    const db = createFakeD1()

    await recordAuthAttempt(db, SECRET, 'login', '203.0.113.1', NOW)
    await recordAuthAttempt(db, SECRET, 'login', '203.0.113.2', NOW)
    const otherEndpoint = await recordAuthAttempt(db, SECRET, 'register', '203.0.113.1', NOW)

    expect(db.state.rateLimits).toHaveLength(3)
    expect(otherEndpoint.attempts).toBe(1)
  })

  it('prunes expired counter rows before recording an attempt', async () => {
    const db = createFakeD1({
      rateLimits: [{ key_hash: 'expired', window_started_at: 0, attempts: 9, expires_at: NOW - 1 }],
    })

    await recordAuthAttempt(db, SECRET, 'login', IP, NOW)

    expect(db.state.rateLimits.some((row) => row.key_hash === 'expired')).toBe(false)
  })

  it('uses Flask retry-after calculation', async () => {
    const db = createFakeD1()
    const window = AUTH_RATE_LIMITS.forgot_password.windowSeconds
    const now = NOW + 37
    const result = await recordAuthAttempt(db, SECRET, 'forgot_password', IP, now)

    expect(result.retryAfter).toBe(window - (now % window))
  })
})

describe('durable rate limits on auth handlers', () => {
  it('persists login counters across separate requests and returns Retry-After', async () => {
    const staging = createFakeD1({ users: [user] })
    const env = testEnv(createFakeD1(), staging)
    const body = { email: user.email, password: 'wrong password', csrfToken: TEST_CSRF, database: 'staging' }

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.login.max; attempt++) {
      const result = await callHandler(loginHandler, { env, method: 'POST', headers: headers(), body })
      expect(result.status).toBe(401)
    }

    const blocked = await callHandler(loginHandler, { env, method: 'POST', headers: headers(), body })
    expect(blocked.status).toBe(429)
    expect(blocked.json).toMatchObject({ code: 'RATE_LIMITED' })
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('limits registration attempts', async () => {
    const staging = createFakeD1()
    const env = testEnv(createFakeD1(), staging)
    const body = { csrfToken: TEST_CSRF }

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.register.max; attempt++) {
      const result = await callHandler(registerHandler, { env, method: 'POST', headers: headers(), body })
      expect(result.status).toBe(400)
    }

    const blocked = await callHandler(registerHandler, { env, method: 'POST', headers: headers(), body })
    expect(blocked.status).toBe(429)
  })

  it('limits password-reset requests, which had no Nuxt limit before', async () => {
    const staging = createFakeD1()
    const env = testEnv(createFakeD1(), staging)
    const body = { csrfToken: TEST_CSRF }

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.forgot_password.max; attempt++) {
      const result = await callHandler(forgotHandler, { env, method: 'POST', headers: headers(), body })
      expect(result.status).toBe(200)
    }

    const blocked = await callHandler(forgotHandler, { env, method: 'POST', headers: headers(), body })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('limits reset-password submissions, which had no Nuxt limit before', async () => {
    const staging = createFakeD1()
    const env = testEnv(createFakeD1(), staging)
    const body = { csrfToken: TEST_CSRF }

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.reset_password.max; attempt++) {
      const result = await callHandler(resetHandler, {
        env, method: 'POST', params: { token: 'abc' }, headers: headers(), body,
      })
      expect(result.status).toBe(400)
    }

    const blocked = await callHandler(resetHandler, {
      env, method: 'POST', params: { token: 'abc' }, headers: headers(), body,
    })
    expect(blocked.status).toBe(429)
  })

  it('limits resend-verification submissions', async () => {
    const staging = createFakeD1()
    const env = testEnv(createFakeD1(), staging)
    const body = { csrfToken: TEST_CSRF }

    for (let attempt = 0; attempt < AUTH_RATE_LIMITS.resend_verification.max; attempt++) {
      const result = await callHandler(resendHandler, { env, method: 'POST', headers: headers(), body })
      expect(result.status).toBe(200)
    }

    const blocked = await callHandler(resendHandler, { env, method: 'POST', headers: headers(), body })
    expect(blocked.status).toBe(429)
  })

  it('fails closed with 503 when staging D1 is unavailable', async () => {
    const env = { LANTERN_NUXT_SESSION_SECRET: SECRET }
    const result = await callHandler(loginHandler, {
      env,
      method: 'POST',
      headers: headers(),
      body: { email: user.email, password: 'wrong password', csrfToken: TEST_CSRF, database: 'staging' },
    })
    expect(result.status).toBe(503)
  })
})
