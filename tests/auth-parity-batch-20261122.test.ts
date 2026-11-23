import { describe, expect, it } from 'vitest'
import forgotHandler from '../server/api/auth/forgot-password.post'
import loginHandler from '../server/api/auth/login.post'
import resendHandler from '../server/api/auth/resend-verification.post'
import { createLanternSession, getLanternSessionIdentity } from '../server/utils/lantern-auth'
import { canonicalizeClientIp } from '../server/utils/lantern-rate-limits'
import { createFakeD1 } from './helpers/fake-d1'
import { callHandler, cookieValue } from './helpers/handler'
import { TEST_CSRF, csrfHeaders, testEnv } from './helpers/session'

describe('rate-limit client IP canonicalization (app.py:312-326)', () => {
  it('canonicalizes valid IPv4 addresses', () => {
    expect(canonicalizeClientIp('  203.0.113.10 ')).toBe('203.0.113.10')
  })

  it('rejects malformed IPv4 addresses so they fall back to unknown', () => {
    expect(canonicalizeClientIp('203.000.113.10')).toBeNull()
    expect(canonicalizeClientIp('999.0.0.1')).toBeNull()
    expect(canonicalizeClientIp('not-an-ip')).toBeNull()
  })

  it('canonicalizes equivalent IPv6 spellings to one key', () => {
    expect(canonicalizeClientIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    expect(canonicalizeClientIp('2001:db8:0:0:0:0:0:1')).toBe('2001:db8::1')
    expect(canonicalizeClientIp('::ffff:192.0.2.1')).toBe('::ffff:c000:201')
  })
})

describe('session cookie lifetime parity with Flask', () => {
  it('issues a browser-session cookie with no Max-Age, Expires or exp payload', async () => {
    const env = testEnv(createFakeD1(), createFakeD1())
    const response = await callHandler(
      (event: any) => createLanternSession(event, 7, 'staging'),
      { env },
    )
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toMatch(/max-age|expires/i)

    const session = cookieValue(setCookie, 'lantern_nuxt_session')!
    const encoded = session.split('.')[0]!
    const payload = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))
    expect(payload).not.toHaveProperty('exp')
    expect(payload).toMatchObject({ v: 1, uid: 7, db: 'staging' })

    const identity = await callHandler(
      (event: any) => getLanternSessionIdentity(event),
      { env, headers: { cookie: `lantern_nuxt_session=${session}` } },
    )
    expect(identity.json).toEqual({ userId: 7, database: 'staging' })
  })
})

describe('auth handlers do not invent validation Flask lacks', () => {
  it('blank login credentials produce Flasks invalid-credentials message', async () => {
    const env = testEnv(createFakeD1(), createFakeD1())
    const result = await callHandler(loginHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders('', { 'cf-connecting-ip': '203.0.113.50' }),
      body: { email: '', password: '', csrfToken: TEST_CSRF, database: 'staging' },
    })
    expect(result.status).toBe(401)
    expect(result.json).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' })
  })

  it('forgot-password and resend always return the privacy-preserving result', async () => {
    for (const [index, handler] of [forgotHandler, resendHandler].entries()) {
      for (const email of ['', 'a'.repeat(300)]) {
        const env = testEnv(createFakeD1(), createFakeD1())
        const result = await callHandler(handler, {
          env,
          method: 'POST',
          headers: csrfHeaders('', { 'cf-connecting-ip': `203.0.113.${60 + index}` }),
          body: { email, csrfToken: TEST_CSRF },
        })
        expect(result.status, `${index}:${email.length}`).toBe(200)
        expect(result.json.ok).toBe(true)
      }
    }
  })
})
