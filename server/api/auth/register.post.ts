import { createError, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { checkAuthRateLimit } from '../../utils/lantern-rate-limits'
import { getAnonymousMutationDatabase } from '../../utils/lantern-writes'
import {
  assertSameOriginAndCsrf,
  createLanternPasswordHash,
  createLanternVerificationToken,
  sendLanternVerificationEmail,
} from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: unknown; email?: unknown; password?: unknown; confirmPassword?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const db = getAnonymousMutationDatabase(event)

  const limit = await checkAuthRateLimit(event, 'register', db)
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', String(limit.retryAfter))
    setResponseStatus(event, 429)
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait before trying again.' }
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : ''

  // Flask checks only presence, username length, password length and password
  // confirmation on the server (lantern_auth.py:74-123).
  if (!username || !email || !password) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'MISSING_FIELDS', message: 'Please fill in all required fields.' }
  }

  if (username.length < 3) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_USERNAME', message: 'Username must be at least 3 characters.' }
  }
  if (password.length < 8) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_PASSWORD', message: 'Password must be at least 8 characters.' }
  }
  if (password !== confirmPassword) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'PASSWORD_MISMATCH', message: 'Passwords do not match.' }
  }

  // Flask checks the exact username first, then the lowercased email, and
  // flashes a distinct message for each (lantern_auth.py:129-170).
  const duplicateUsername = await db.prepare(
    'SELECT id FROM users WHERE username = ? LIMIT 1',
  ).bind(username).first<any>()
  if (duplicateUsername) {
    setResponseStatus(event, 409)
    return { ok: false, code: 'ACCOUNT_EXISTS', message: 'That username is already taken.' }
  }

  const duplicateEmail = await db.prepare(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
  ).bind(email).first<any>()
  if (duplicateEmail) {
    setResponseStatus(event, 409)
    return { ok: false, code: 'ACCOUNT_EXISTS', message: 'An account with that email already exists.' }
  }

  const passwordHash = await createLanternPasswordHash(password)
  const userCreatedAt = new Date().toISOString()
  const inserted = await db.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, email_verified, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).bind(username, email, passwordHash, username, userCreatedAt).run()

  const userId = Number(inserted.meta?.last_row_id)
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw createError({ statusCode: 500, statusMessage: 'The new account could not be created.' })
  }

  await db.prepare(`
    UPDATE email_tokens SET used = 1
    WHERE user_id = ? AND token_type = 'email_verification' AND used = 0
  `).bind(userId).run()

  const { token, tokenHash } = await createLanternVerificationToken()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await db.prepare(`
    INSERT INTO email_tokens (user_id, token_hash, token_type, expires_at, used, created_at)
    VALUES (?, ?, 'email_verification', ?, 0, ?)
  `).bind(userId, tokenHash, expiresAt, createdAt).run()

  const emailSent = await sendLanternVerificationEmail(event, email, token)
  return {
    ok: true,
    emailSent,
    message: emailSent
      ? 'Your account has been created. Check your email for the verification link.'
      : 'Your account has been created, but the verification email could not be sent. Configure the staging email settings, then request a new link.',
  }
})
