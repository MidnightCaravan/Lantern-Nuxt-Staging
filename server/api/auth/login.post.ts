import { setResponseHeader, setResponseStatus, readBody } from 'h3'
import { getLanternDatabase, getLanternStagingDatabase } from '../../utils/lantern-public'
import { checkAuthRateLimit } from '../../utils/lantern-rate-limits'
import {
  assertSameOriginAndCsrf,
  burnDummyPasswordCheck,
  createLanternSession,
  verifyLanternPasswordHash,
} from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown; password?: unknown; csrfToken?: unknown; database?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const limit = await checkAuthRateLimit(event, 'login')
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', String(limit.retryAfter))
    setResponseStatus(event, 429)
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait before trying again.' }
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password || email.length > 320 || password.length > 1024) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_INPUT', message: 'Enter your email address and password.' }
  }

  const env = event?.req?.runtime?.cloudflare?.env ?? event?.context?.cloudflare?.env ?? event?.context?.nitro?.env ?? {}
  if (typeof env.LANTERN_NUXT_SESSION_SECRET !== 'string' || env.LANTERN_NUXT_SESSION_SECRET.length < 32) {
    setResponseStatus(event, 503)
    return { ok: false, code: 'SESSION_NOT_CONFIGURED', message: 'Local session secret is not configured. Restart the development server after setting .dev.vars.' }
  }

  const database: 'production' | 'staging' =
    body?.database === 'staging' ? 'staging' : 'production'

  const loginDb = database === 'staging'
    ? getLanternStagingDatabase(event)
    : getLanternDatabase(event)

  const user = await loginDb.prepare(`
    SELECT id, username, email, password_hash, display_name, email_verified
    FROM users WHERE LOWER(email) = ? LIMIT 1
  `).bind(email).first<any>()

  if (!user) {
    await burnDummyPasswordCheck(password)
    setResponseStatus(event, 401)
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
  }

  const passwordHash = String(user.password_hash ?? '')
  if (passwordHash.startsWith('scrypt:')) {
    setResponseStatus(event, 409)
    return { ok: false, code: 'PASSWORD_RESET_REQUIRED', message: 'Your password uses an older password format. Please reset your password before logging in.' }
  }

  if (!await verifyLanternPasswordHash(passwordHash, password)) {
    setResponseStatus(event, 401)
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
  }

  if (Number(user.email_verified) !== 1) {
    setResponseStatus(event, 403)
    return database === 'staging'
      ? { ok: false, code: 'STAGING_EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in. You can request a new link here.' }
      : { ok: false, code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in. You can request a new verification link from Lantern.' }
  }

  await createLanternSession(event, Number(user.id), database)
  return {
    ok: true,
    user: { id: Number(user.id), username: String(user.username), displayName: String(user.display_name || user.username) },
  }
})
