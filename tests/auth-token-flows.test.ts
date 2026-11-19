import { afterEach, describe, expect, it, vi } from 'vitest'
import verifyHandler from '../server/api/auth/verify.post'
import registerHandler from '../server/api/auth/register.post'
import resendHandler from '../server/api/auth/resend-verification.post'
import forgotHandler from '../server/api/auth/forgot-password.post'
import resetGetHandler from '../server/api/auth/reset-password/[token].get'
import resetPostHandler from '../server/api/auth/reset-password/[token].post'
import {
  hashLanternVerificationToken,
  verifyLanternPasswordHash,
} from '../server/utils/lantern-auth'
import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeEmailToken, type FakeUser } from './helpers/fake-d1'
import { TEST_CSRF, csrfHeaders, testEnv } from './helpers/session'

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const VERIFY_TOKEN = 'verify-token-0123456789abcdef0123456789abcdef'
const RESET_TOKEN = 'reset-token-0123456789abcdef0123456789abcdef'

let ipCounter = 0
const uniqueIp = () => `token-flow-${++ipCounter}`

const user = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: 7,
  username: 'author',
  email: 'author@example.com',
  password_hash: 'old-hash',
  display_name: 'Author',
  email_verified: 0,
  ...overrides,
})

const token = (overrides: Partial<FakeEmailToken> = {}): FakeEmailToken => ({
  id: 1,
  user_id: 7,
  token_hash: 'unused',
  token_type: 'email_verification',
  expires_at: FUTURE,
  used: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function envFor(staging: ReturnType<typeof createFakeD1>, production = createFakeD1()) {
  return {
    ...testEnv(production, staging),
    LANTERN_BREVO_API_KEY: 'test-brevo-key',
    LANTERN_MAIL_FROM: 'Lantern <no-reply@example.com>',
  }
}

function headers() {
  return { ...csrfHeaders(), 'cf-connecting-ip': uniqueIp() }
}

function stubBrevo() {
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '{"messageId":"test"}' }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('registration email', () => {
  it('sends Flask registration wording with the canonical verification link', async () => {
    const fetchMock = stubBrevo()
    const staging = createFakeD1()
    const result = await callHandler(registerHandler, {
      env: envFor(staging),
      method: 'POST',
      headers: headers(),
      body: {
        username: 'newcreator',
        email: 'new@example.com',
        password: 'correct horse battery staple',
        confirmPassword: 'correct horse battery staple',
        csrfToken: TEST_CSRF,
      },
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, emailSent: true })
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
    expect(payload.subject).toBe('Verify your Lantern account')
    expect(payload.textContent).toContain('Your account has been created successfully.')
    expect(payload.textContent).toContain('/verify-email?token=')
    expect(payload.htmlContent).toBeUndefined()
  })
})

describe('email verification', () => {
  it('verifies a valid staging token, consumes it, and never writes production', async () => {
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash })],
    })
    const production = createFakeD1({ users: [user({ id: 7 })] })
    const env = envFor(staging, production)

    const result = await callHandler(verifyHandler, {
      env, method: 'POST', headers: headers(), body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true })
    expect(staging.state.users[0]!.email_verified).toBe(1)
    expect(staging.state.emailTokens[0]!.used).toBe(1)
    expect(production.state.users[0]!.email_verified).toBe(0)

    const replay = await callHandler(verifyHandler, {
      env, method: 'POST', headers: headers(), body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })
    expect(replay.status).toBe(400)
    expect(replay.json.code).toBe('INVALID_OR_EXPIRED')
  })

  it('rejects expired, wrong-type, malformed, and CSRF-failed tokens', async () => {
    const expiredHash = await hashLanternVerificationToken('expired-verification-token-0123456789')
    const wrongTypeHash = await hashLanternVerificationToken('password-token-used-as-verification')
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [
        token({ id: 1, token_hash: expiredHash, expires_at: PAST }),
        token({ id: 2, token_hash: wrongTypeHash, token_type: 'password_reset' }),
      ],
    })
    const env = envFor(staging)

    const expired = await callHandler(verifyHandler, {
      env, method: 'POST', headers: headers(), body: { token: 'expired-verification-token-0123456789', csrfToken: TEST_CSRF },
    })
    const wrongType = await callHandler(verifyHandler, {
      env, method: 'POST', headers: headers(), body: { token: 'password-token-used-as-verification', csrfToken: TEST_CSRF },
    })
    const malformed = await callHandler(verifyHandler, {
      env, method: 'POST', headers: headers(), body: { token: 'x'.repeat(257), csrfToken: TEST_CSRF },
    })
    const badCsrf = await callHandler(verifyHandler, {
      env, method: 'POST', headers: headers(), body: { token: VERIFY_TOKEN, csrfToken: 'wrong' },
    })

    expect([expired.status, wrongType.status, malformed.status, badCsrf.status]).toEqual([400, 400, 400, 403])
    expect(staging.state.users[0]!.email_verified).toBe(0)
  })
})

describe('resend verification', () => {
  it('invalidates old tokens and sends a fresh staging verification link', async () => {
    const fetchMock = stubBrevo()
    const oldHash = await hashLanternVerificationToken('old-verification-token-0123456789')
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: oldHash })],
    })
    const env = envFor(staging)

    const result = await callHandler(resendHandler, {
      env,
      method: 'POST',
      headers: headers(),
      body: { email: 'AUTHOR@example.com', csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, emailSent: true })
    expect(staging.state.emailTokens[0]!.used).toBe(1)
    const fresh = staging.state.emailTokens[1]!
    expect(fresh).toMatchObject({ user_id: 7, token_type: 'email_verification', used: 0 })
    expect(new Date(fresh.expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
    expect(payload.subject).toBe('Your Lantern verification link')
    expect(payload.textContent).toContain('Here is your new Lantern verification link:')
    expect(payload.textContent).toContain('/verify-email?token=')
    expect(payload.htmlContent).toBeUndefined()
  })

  it('does not create tokens for verified or unknown accounts and rate-limits repeated calls', async () => {
    stubBrevo()
    const staging = createFakeD1({ users: [user({ email_verified: 1 })] })
    const env = envFor(staging)
    const verified = await callHandler(resendHandler, {
      env, method: 'POST', headers: headers(), body: { email: 'author@example.com', csrfToken: TEST_CSRF },
    })
    const unknown = await callHandler(resendHandler, {
      env, method: 'POST', headers: headers(), body: { email: 'nobody@example.com', csrfToken: TEST_CSRF },
    })
    expect([verified.status, unknown.status]).toEqual([200, 200])
    expect(staging.state.emailTokens).toHaveLength(0)

    const unverified = createFakeD1({ users: [user()] })
    const limitedEnv = envFor(unverified)
    const fixedIp = 'resend-rate-limit'
    let last: Awaited<ReturnType<typeof callHandler>> | null = null
    for (let i = 0; i < 6; i++) {
      last = await callHandler(resendHandler, {
        env: limitedEnv,
        method: 'POST',
        headers: { ...csrfHeaders(), 'cf-connecting-ip': fixedIp },
        body: { email: 'author@example.com', csrfToken: TEST_CSRF },
      })
    }
    expect(last!.status).toBe(429)
  })
})

describe('password reset requests', () => {
  it('issues a one-hour password reset token without revealing account existence', async () => {
    const fetchMock = stubBrevo()
    const oldHash = await hashLanternVerificationToken('old-reset-token-0123456789')
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ id: 1, token_hash: oldHash, token_type: 'password_reset' })],
    })
    const env = envFor(staging)

    const existing = await callHandler(forgotHandler, {
      env, method: 'POST', headers: headers(), body: { email: 'AUTHOR@example.com', csrfToken: TEST_CSRF },
    })
    const unknownEnv = envFor(createFakeD1())
    const unknown = await callHandler(forgotHandler, {
      env: unknownEnv, method: 'POST', headers: headers(), body: { email: 'nobody@example.com', csrfToken: TEST_CSRF },
    })

    expect(existing.json).toEqual(unknown.json)
    expect(staging.state.emailTokens[0]!.used).toBe(1)
    const fresh = staging.state.emailTokens[1]!
    expect(fresh.token_type).toBe('password_reset')
    expect(new Date(fresh.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000)
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
    expect(payload.subject).toBe('Reset your Lantern password')
    expect(payload.textContent).toContain('/reset-password/')
  })

  it('fails clearly when staging mail is not configured', async () => {
    const staging = createFakeD1({ users: [user()] })
    const env = testEnv(createFakeD1(), staging)
    const result = await callHandler(forgotHandler, {
      env, method: 'POST', headers: headers(), body: { email: 'author@example.com', csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(503)
    expect(staging.state.emailTokens).toMatchObject([{ user_id: 7, token_type: 'password_reset', used: 0 }])
  })
})

describe('password reset redemption', () => {
  async function setupReset(overrides: Partial<FakeEmailToken> = {}) {
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, token_type: 'password_reset', ...overrides })],
    })
    return { staging, env: envFor(staging) }
  }

  it('validates a reset link and replaces the password hash exactly once', async () => {
    const { staging, env } = await setupReset()
    const valid = await callHandler(resetGetHandler, {
      env, params: { token: RESET_TOKEN },
    })
    expect(valid.status).toBe(200)
    expect(valid.json).toEqual({ valid: true })

    const reset = await callHandler(resetPostHandler, {
      env,
      method: 'POST',
      params: { token: RESET_TOKEN },
      headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })
    expect(reset.status).toBe(200)
    expect(reset.json).toMatchObject({ ok: true })
    expect(await verifyLanternPasswordHash(staging.state.users[0]!.password_hash, 'new-password-123')).toBe(true)
    expect(staging.state.emailTokens[0]!.used).toBe(1)

    const replay = await callHandler(resetPostHandler, {
      env,
      method: 'POST',
      params: { token: RESET_TOKEN },
      headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })
    expect(replay.status).toBe(400)
  })

  it('rejects invalid links, short or mismatched passwords, and missing CSRF', async () => {
    const expired = await setupReset({ expires_at: PAST })
    const expiredResult = await callHandler(resetGetHandler, {
      env: expired.env, params: { token: RESET_TOKEN },
    })
    const shortToken = await callHandler(resetGetHandler, {
      env: expired.env, params: { token: 'short' },
    })

    const { env } = await setupReset()
    const shortPassword = await callHandler(resetPostHandler, {
      env, method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'short', confirm_password: 'short', csrfToken: TEST_CSRF },
    })
    const mismatch = await callHandler(resetPostHandler, {
      env, method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'different-123', csrfToken: TEST_CSRF },
    })
    const badCsrf = await callHandler(resetPostHandler, {
      env, method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: 'wrong' },
    })

    expect([expiredResult.status, shortToken.status, shortPassword.status, mismatch.status, badCsrf.status])
      .toEqual([400, 400, 400, 400, 403])
  })
})
