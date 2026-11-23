import { readBody, setResponseHeader, setResponseStatus } from 'h3'
import { checkAuthRateLimit } from '../../utils/lantern-rate-limits'
import { getAnonymousMutationDatabase } from '../../utils/lantern-writes'
import {
  assertSameOriginAndCsrf,
  createLanternVerificationToken,
  sendLanternVerificationEmail,
} from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const db = getAnonymousMutationDatabase(event)
  const limit = await checkAuthRateLimit(event, 'resend_verification', db)
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', String(limit.retryAfter))
    setResponseStatus(event, 429)
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait before trying again.' }
  }

  // Flask performs no format validation here (lantern_auth.py:343-348) and
  // always returns the same privacy-preserving message.
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Flask always shows the same privacy-preserving flash, whether or not the
  // address belongs to an unverified account (lantern_auth.py:405-409).
  const privacyMessage = 'If that email belongs to an unverified Lantern account, a new verification link has been sent.'
  const user = await db.prepare('SELECT id, email_verified, display_name FROM users WHERE LOWER(email) = ? LIMIT 1').bind(email).first<any>()
  if (!user || Number(user.email_verified) === 1) {
    return { ok: true, message: privacyMessage }
  }

  await db.prepare(`
    UPDATE email_tokens SET used = 1
    WHERE user_id = ? AND token_type = 'email_verification' AND used = 0
  `).bind(Number(user.id)).run()

  const { token, tokenHash } = await createLanternVerificationToken()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await db.prepare(`
    INSERT INTO email_tokens (user_id, token_hash, token_type, expires_at, used, created_at)
    VALUES (?, ?, 'email_verification', ?, 0, ?)
  `).bind(Number(user.id), tokenHash, expiresAt, createdAt).run()

  const emailSent = await sendLanternVerificationEmail(event, email, token, 'resend', String(user.display_name ?? ''))
  return { ok: true, emailSent, message: privacyMessage }
})
