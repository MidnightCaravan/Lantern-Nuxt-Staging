import { createError, readBody, setResponseStatus } from 'h3'
import { getLanternDatabase, getLanternStagingDatabase } from '../../utils/lantern-public'
import { checkAuthRateLimit } from '../../utils/lantern-rate-limits'
import {
  assertSameOriginAndCsrf,
  createLanternPasswordHash,
  createLanternVerificationToken,
  sendLanternVerificationEmail,
} from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: unknown; email?: unknown; password?: unknown; confirmPassword?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const limit = await checkAuthRateLimit(event, 'register')
  if (!limit.allowed) {
    setResponseStatus(event, 429)
    return { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait before trying again.' }
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : ''

  if (username.length < 3 || username.length > 80 || /[\u0000-\u001f\u007f]/.test(username)) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_USERNAME', message: 'Username must be between 3 and 80 characters.' }
  }
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }
  }
  if (password.length < 8 || password.length > 1024) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_PASSWORD', message: 'Password must be at least 8 characters.' }
  }
  if (password !== confirmPassword) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'PASSWORD_MISMATCH', message: 'Your passwords do not match.' }
  }

  const productionDb = getLanternDatabase(event)
  const stagingDb = getLanternStagingDatabase(event)
  const duplicateSql = 'SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1'
  const [productionDuplicate, stagingDuplicate] = await Promise.all([
    productionDb.prepare(duplicateSql).bind(email, username.toLowerCase()).first<any>(),
    stagingDb.prepare(duplicateSql).bind(email, username.toLowerCase()).first<any>(),
  ])
  if (productionDuplicate || stagingDuplicate) {
    setResponseStatus(event, 409)
    return { ok: false, code: 'ACCOUNT_EXISTS', message: 'That email address or username is already registered.' }
  }

  const passwordHash = await createLanternPasswordHash(password)
  const inserted = await stagingDb.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, email_verified)
    VALUES (?, ?, ?, ?, 0)
  `).bind(username, email, passwordHash, username).run()

  const userId = Number(inserted.meta?.last_row_id)
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw createError({ statusCode: 500, statusMessage: 'The new account could not be created.' })
  }

  await stagingDb.prepare(`
    UPDATE email_tokens SET used = 1
    WHERE user_id = ? AND token_type = 'email_verification' AND used = 0
  `).bind(userId).run()

  const { token, tokenHash } = await createLanternVerificationToken()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await stagingDb.prepare(`
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
