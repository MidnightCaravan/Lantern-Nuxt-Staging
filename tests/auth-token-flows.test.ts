import { afterEach, describe, expect, it, vi } from 'vitest'
import verifyHandler from '../server/api/auth/verify.post'
import verifyGetHandler from '../server/api/auth/verify.get'
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
import { createFakeD1, type FakeD1, type FakeD1Statement, type FakeEmailToken, type FakeUser } from './helpers/fake-d1'
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

type SqlCall = {
  sql: string
  params: any[]
  operation: 'first' | 'all' | 'run'
  result?: { meta: { last_row_id: number; changes: number } }
}

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** Records bound parameters and run metadata without changing fake-D1 behavior. */
function instrumentD1(raw: FakeD1, hooks: { afterFirst?: (call: SqlCall) => void } = {}) {
  const calls: SqlCall[] = []

  function wrap(statement: FakeD1Statement, rawSql: string, params: any[]): FakeD1Statement {
    const sql = normalizeSql(rawSql)
    const wrapped: FakeD1Statement = {
      async first<T = any>() {
        const call: SqlCall = { sql, params: [...params], operation: 'first' }
        calls.push(call)
        const result = await statement.first<T>()
        hooks.afterFirst?.(call)
        return result
      },
      async all<T = any>() {
        calls.push({ sql, params: [...params], operation: 'all' })
        return statement.all<T>()
      },
      run() { return Promise.resolve(wrapped.runSync!()) },
      runSync() {
        const result = statement.runSync!()
        calls.push({ sql, params: [...params], operation: 'run', result })
        return result
      },
      bind(...nextParams: any[]) { return wrap(statement.bind(...nextParams), rawSql, nextParams) },
    }
    return wrapped
  }

  return {
    calls,
    db: {
      state: raw.state,
      prepare(sql: string) { return wrap(raw.prepare(sql), sql, []) },
      batch(statements: FakeD1Statement[]) { return raw.batch(statements) },
    } satisfies FakeD1,
  }
}

function updateChanges(calls: SqlCall[], prefix: string): number[] {
  return calls
    .filter((call) => call.operation === 'run' && call.sql.startsWith(prefix))
    .map((call) => call.result?.meta.changes ?? 0)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
    expect(payload.textContent).toContain('/verify/')
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

  it('uses one captured timestamp for verification lookup and both updates', async () => {
    vi.useFakeTimers()
    const captured = new Date('2026-11-21T12:00:00.000Z')
    vi.setSystemTime(captured)
    const expiresAt = new Date(captured.getTime() + 1).toISOString()
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, expires_at: expiresAt })],
    })
    const instrumented = instrumentD1(raw, {
      afterFirst: (call) => {
        if (call.sql.includes('FROM email_tokens WHERE token_hash = ?')) {
          vi.setSystemTime(new Date(captured.getTime() + 60_000))
        }
      },
    })

    const result = await callHandler(verifyHandler, {
      env: envFor(instrumented.db), method: 'POST', headers: headers(),
      body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(200)
    const lookup = instrumented.calls.find((call) => call.sql.includes('FROM email_tokens WHERE token_hash = ?'))!
    const userUpdate = instrumented.calls.find((call) => call.sql.startsWith('UPDATE users SET email_verified = 1'))!
    const tokenUpdate = instrumented.calls.find((call) => call.sql.startsWith('UPDATE email_tokens SET used = 1'))!
    expect(lookup.params[1]).toBe(captured.toISOString())
    expect(userUpdate.params[2]).toBe(lookup.params[1])
    expect(tokenUpdate.params[1]).toBe(lookup.params[1])
    expect(userUpdate.sql).not.toContain('datetime(')
    expect(tokenUpdate.sql).not.toContain('datetime(')
    expect(userUpdate.result?.meta.changes).toBe(1)
    expect(tokenUpdate.result?.meta.changes).toBe(1)
    expect(raw.state.users[0]!.email_verified).toBe(1)
    expect(raw.state.emailTokens[0]!.used).toBe(1)
  })

  it('rejects a verification token consumed after lookup without a partial update', async () => {
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash })],
    })
    const instrumented = instrumentD1(raw, {
      afterFirst: (call) => {
        if (call.sql.includes('FROM email_tokens WHERE token_hash = ?')) {
          raw.state.emailTokens[0]!.used = 1
        }
      },
    })

    const result = await callHandler(verifyHandler, {
      env: envFor(instrumented.db), method: 'POST', headers: headers(),
      body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(400)
    expect(result.json.code).toBe('INVALID_OR_EXPIRED')
    expect(raw.state.users[0]!.email_verified).toBe(0)
    expect(raw.state.emailTokens[0]!.used).toBe(1)
    expect(updateChanges(instrumented.calls, 'UPDATE users SET email_verified = 1')).toEqual([0])
    expect(updateChanges(instrumented.calls, 'UPDATE email_tokens SET used = 1')).toEqual([0])
  })

  it('fails closed on an impossible verification batch result pair', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash })],
    })
    const db: FakeD1 = {
      state: raw.state,
      prepare(sql: string) { return raw.prepare(sql) },
      async batch(statements) {
        const results = await raw.batch(statements)
        return [
          { ...results[0]! },
          { ...results[1]!, meta: { ...results[1]!.meta, changes: 0 } },
        ]
      },
    }

    const result = await callHandler(verifyHandler, {
      env: envFor(db), method: 'POST', headers: headers(),
      body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(500)
    expect(result.json.code).toBe('TOKEN_BATCH_INVARIANT_VIOLATION')
    expect(errorSpy).toHaveBeenCalledWith(
      '[lantern] email verification token batch invariant violation',
      { userChanges: 1, tokenChanges: 0 },
    )
  })

  it('verifies immediately on the canonical GET link without a CSRF token', async () => {
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash })],
    })
    const production = createFakeD1({ users: [user({ id: 7 })] })
    const env = envFor(staging, production)

    const result = await callHandler(verifyGetHandler, {
      env,
      path: `/api/test?token=${encodeURIComponent(VERIFY_TOKEN)}`,
    })
    expect(result.status).toBe(200)
    expect(result.json).toMatchObject({ ok: true, message: 'Your email has been verified. You can now log in.' })
    expect(staging.state.users[0]!.email_verified).toBe(1)
    expect(staging.state.emailTokens[0]!.used).toBe(1)
    expect(production.state.users[0]!.email_verified).toBe(0)
  })

  it('rolls back verification when the user update fails', async () => {
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const staging = createFakeD1(
      { users: [user()], emailTokens: [token({ token_hash: hash })] },
      { failOn: [{ sql: 'UPDATE users SET email_verified = 1', message: 'user update failed' }] },
    )
    const result = await callHandler(verifyHandler, {
      env: envFor(staging), method: 'POST', headers: headers(),
      body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(500)
    expect(staging.state.users[0]!.email_verified).toBe(0)
    expect(staging.state.emailTokens[0]!.used).toBe(0)
  })

  it('rolls back verification when token consumption fails', async () => {
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const staging = createFakeD1(
      { users: [user()], emailTokens: [token({ token_hash: hash })] },
      { failOn: [{ sql: 'UPDATE email_tokens SET used = 1', message: 'token update failed' }] },
    )
    const result = await callHandler(verifyHandler, {
      env: envFor(staging), method: 'POST', headers: headers(),
      body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(500)
    expect(staging.state.users[0]!.email_verified).toBe(0)
    expect(staging.state.emailTokens[0]!.used).toBe(0)
  })

  it('allows only one of two simultaneous verification attempts', async () => {
    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash })],
    })
    const instrumented = instrumentD1(raw)
    const env = envFor(instrumented.db)
    const results = await Promise.all([
      callHandler(verifyHandler, {
        env, method: 'POST', headers: headers(),
        body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
      }),
      callHandler(verifyHandler, {
        env, method: 'POST', headers: headers(),
        body: { token: VERIFY_TOKEN, csrfToken: TEST_CSRF },
      }),
    ])

    expect(results.map((item) => item.status).sort()).toEqual([200, 400])
    expect(raw.state.users[0]!.email_verified).toBe(1)
    expect(raw.state.emailTokens[0]!.used).toBe(1)

    const userChanges = updateChanges(instrumented.calls, 'UPDATE users SET email_verified = 1')
    const tokenChanges = updateChanges(instrumented.calls, 'UPDATE email_tokens SET used = 1')
    expect(userChanges.length).toBe(tokenChanges.length)
    expect(userChanges.length).toBeGreaterThanOrEqual(1)
    expect(userChanges.length).toBeLessThanOrEqual(2)
    expect(userChanges[0]).toBe(1)
    expect(tokenChanges[0]).toBe(1)
    for (let index = 1; index < userChanges.length; index++) {
      expect(userChanges[index]).toBe(0)
      expect(tokenChanges[index]).toBe(0)
    }
  })

  it('rejects expired and replayed tokens on the canonical GET link', async () => {
    const expiredHash = await hashLanternVerificationToken('expired-get-verification-token-0123456789')
    const expired = createFakeD1({
      users: [user()],
      emailTokens: [token({ id: 3, token_hash: expiredHash, expires_at: PAST })],
    })
    const expiredResult = await callHandler(verifyGetHandler, {
      env: envFor(expired),
      path: `/api/test?token=${encodeURIComponent('expired-get-verification-token-0123456789')}`,
    })
    expect(expiredResult.status).toBe(400)
    expect(expiredResult.json.code).toBe('INVALID_OR_EXPIRED')
    expect(expired.state.users[0]!.email_verified).toBe(0)

    const hash = await hashLanternVerificationToken(VERIFY_TOKEN)
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash })],
    })
    const env = envFor(staging)
    const options = { env, path: `/api/test?token=${encodeURIComponent(VERIFY_TOKEN)}` }
    const first = await callHandler(verifyGetHandler, options)
    const replay = await callHandler(verifyGetHandler, options)
    expect([first.status, replay.status]).toEqual([200, 400])
    expect(staging.state.users[0]!.email_verified).toBe(1)
    expect(staging.state.emailTokens[0]!.used).toBe(1)
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
    expect(payload.textContent).toContain('/verify/')
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

  it('still issues a reset token when staging mail is not configured', async () => {
    const staging = createFakeD1({ users: [user()] })
    const env = testEnv(createFakeD1(), staging)
    const result = await callHandler(forgotHandler, {
      env, method: 'POST', headers: headers(), body: { email: 'author@example.com', csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(200)
    expect(result.json.message).toBe('If an account matches that email, a reset link has been sent.')
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

  it('uses one captured timestamp for reset lookup and both updates', async () => {
    vi.useFakeTimers()
    const captured = new Date('2026-11-21T12:00:00.000Z')
    vi.setSystemTime(captured)
    const expiresAt = new Date(captured.getTime() + 1).toISOString()
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, token_type: 'password_reset', expires_at: expiresAt })],
    })
    const instrumented = instrumentD1(raw, {
      afterFirst: (call) => {
        if (call.sql.includes('FROM email_tokens WHERE token_hash = ?')) {
          vi.setSystemTime(new Date(captured.getTime() + 60_000))
        }
      },
    })

    const result = await callHandler(resetPostHandler, {
      env: envFor(instrumented.db), method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(200)
    const lookup = instrumented.calls.find((call) => call.sql.includes('FROM email_tokens WHERE token_hash = ?'))!
    const userUpdate = instrumented.calls.find((call) => call.sql.startsWith('UPDATE users SET password_hash = ?'))!
    const tokenUpdate = instrumented.calls.find((call) => call.sql.startsWith('UPDATE email_tokens SET used = 1'))!
    expect(lookup.params[1]).toBe(captured.toISOString())
    expect(userUpdate.params[3]).toBe(lookup.params[1])
    expect(tokenUpdate.params[1]).toBe(lookup.params[1])
    expect(userUpdate.result?.meta.changes).toBe(1)
    expect(tokenUpdate.result?.meta.changes).toBe(1)
    expect(await verifyLanternPasswordHash(raw.state.users[0]!.password_hash, 'new-password-123')).toBe(true)
    expect(raw.state.emailTokens[0]!.used).toBe(1)
  })

  it('rejects a reset token consumed after lookup without a partial update', async () => {
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, token_type: 'password_reset' })],
    })
    const instrumented = instrumentD1(raw, {
      afterFirst: (call) => {
        if (call.sql.includes('FROM email_tokens WHERE token_hash = ?')) {
          raw.state.emailTokens[0]!.used = 1
        }
      },
    })

    const result = await callHandler(resetPostHandler, {
      env: envFor(instrumented.db), method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(400)
    expect(raw.state.users[0]!.password_hash).toBe('old-hash')
    expect(raw.state.emailTokens[0]!.used).toBe(1)
    expect(updateChanges(instrumented.calls, 'UPDATE users SET password_hash = ?')).toEqual([0])
    expect(updateChanges(instrumented.calls, 'UPDATE email_tokens SET used = 1')).toEqual([0])
  })

  it('fails closed on an impossible reset batch result pair', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, token_type: 'password_reset' })],
    })
    const db: FakeD1 = {
      state: raw.state,
      prepare(sql: string) { return raw.prepare(sql) },
      async batch(statements) {
        const results = await raw.batch(statements)
        return [
          { ...results[0]! },
          { ...results[1]!, meta: { ...results[1]!.meta, changes: 0 } },
        ]
      },
    }

    const result = await callHandler(resetPostHandler, {
      env: envFor(db), method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(500)
    expect(result.json.statusMessage).toBe('Password reset failed unexpectedly.')
    expect(errorSpy).toHaveBeenCalledWith(
      '[lantern] password reset token batch invariant violation',
      { userChanges: 1, tokenChanges: 0 },
    )
  })

  it('rolls back a reset when the password update fails', async () => {
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const staging = createFakeD1(
      { users: [user()], emailTokens: [token({ token_hash: hash, token_type: 'password_reset' })] },
      { failOn: [{ sql: 'UPDATE users SET password_hash = ?', message: 'password update failed' }] },
    )
    const result = await callHandler(resetPostHandler, {
      env: envFor(staging), method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(500)
    expect(staging.state.users[0]!.password_hash).toBe('old-hash')
    expect(staging.state.emailTokens[0]!.used).toBe(0)
  })

  it('rolls back a reset when token consumption fails', async () => {
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const staging = createFakeD1(
      { users: [user()], emailTokens: [token({ token_hash: hash, token_type: 'password_reset' })] },
      { failOn: [{ sql: 'UPDATE email_tokens SET used = 1', message: 'token update failed' }] },
    )
    const result = await callHandler(resetPostHandler, {
      env: envFor(staging), method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(500)
    expect(staging.state.users[0]!.password_hash).toBe('old-hash')
    expect(staging.state.emailTokens[0]!.used).toBe(0)
  })

  it('allows only one of two simultaneous reset attempts with different passwords', async () => {
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const raw = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, token_type: 'password_reset' })],
    })
    const instrumented = instrumentD1(raw)
    const env = envFor(instrumented.db)
    const bodies = [
      { password: 'new-password-alpha-123', confirm_password: 'new-password-alpha-123', csrfToken: TEST_CSRF },
      { password: 'new-password-beta-456', confirm_password: 'new-password-beta-456', csrfToken: TEST_CSRF },
    ]
    const results = await Promise.all(bodies.map((body) => callHandler(resetPostHandler, {
      env, method: 'POST', params: { token: RESET_TOKEN }, headers: headers(), body,
    })))

    expect(results.map((item) => item.status).sort()).toEqual([200, 400])
    const successIndex = results.findIndex((item) => item.status === 200)
    expect(successIndex).toBeGreaterThanOrEqual(0)
    expect(raw.state.emailTokens[0]!.used).toBe(1)
    expect(await verifyLanternPasswordHash(raw.state.users[0]!.password_hash, bodies[successIndex]!.password)).toBe(true)
    expect(await verifyLanternPasswordHash(raw.state.users[0]!.password_hash, bodies[1 - successIndex]!.password)).toBe(false)

    const userChanges = updateChanges(instrumented.calls, 'UPDATE users SET password_hash = ?')
    const tokenChanges = updateChanges(instrumented.calls, 'UPDATE email_tokens SET used = 1')
    expect(userChanges.length).toBe(tokenChanges.length)
    expect(userChanges.length).toBeGreaterThanOrEqual(1)
    expect(userChanges.length).toBeLessThanOrEqual(2)
    expect(userChanges[0]).toBe(1)
    expect(tokenChanges[0]).toBe(1)
    for (let index = 1; index < userChanges.length; index++) {
      expect(userChanges[index]).toBe(0)
      expect(tokenChanges[index]).toBe(0)
    }
  })

  it('rejects an expired reset token without changing the password', async () => {
    const hash = await hashLanternVerificationToken(RESET_TOKEN)
    const staging = createFakeD1({
      users: [user()],
      emailTokens: [token({ token_hash: hash, token_type: 'password_reset', expires_at: PAST })],
    })
    const result = await callHandler(resetPostHandler, {
      env: envFor(staging), method: 'POST', params: { token: RESET_TOKEN }, headers: headers(),
      body: { password: 'new-password-123', confirm_password: 'new-password-123', csrfToken: TEST_CSRF },
    })

    expect(result.status).toBe(400)
    expect(staging.state.users[0]!.password_hash).toBe('old-hash')
    expect(staging.state.emailTokens[0]!.used).toBe(0)
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

  it('reports an invalid reset link before password validation, matching Flask', async () => {
    const staging = createFakeD1({ users: [user()] })
    const env = envFor(staging)
    const result = await callHandler(resetPostHandler, {
      env,
      method: 'POST',
      params: { token: RESET_TOKEN },
      headers: headers(),
      body: { password: 'short', confirm_password: 'also-short', csrfToken: TEST_CSRF },
    })
    expect(result.status).toBe(400)
    expect(result.json.statusMessage).toBe('This password reset link is invalid or has expired.')
    expect(staging.state.users[0]!.password_hash).toBe('old-hash')
  })
})
