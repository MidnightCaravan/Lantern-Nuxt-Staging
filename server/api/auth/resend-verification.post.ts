import { readBody, setResponseStatus } from 'h3'
import { getLanternStagingDatabase } from '../../utils/lantern-public'
import { checkAuthRateLimit } from '../../utils/lantern-rate-limits'
import {
  assertSameOriginAndCsrf,
  createLanternVerificationToken,
  sendLanternVerificationEmail,
} from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const limit = await checkAuthRateLimit(event, 'resend_verification')
  if (!limit.allowed) {
    setResponseStatus(event, 429)
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait before trying again.' }
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }
  }

  // Flask always shows the same privacy-preserving flash, whether or not the
  // address belongs to an unverified account (lantern_auth.py:405-409).
  const privacyMessage = 'If that email belongs to an unverified Lantern account, a new verification link has been sent.'
  const db = getLanternStagingDatabase(event)
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
  return {
    ok: true,
    emailSent,
    message: emailSent
      ? privacyMessage
      : 'The verification email could not be sent. Check the staging Brevo settings and try again.',
  }
})
