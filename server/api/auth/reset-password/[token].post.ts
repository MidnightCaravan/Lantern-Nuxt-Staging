import { createError, getRouterParam, readBody, setResponseHeader } from 'h3'
import { assertSameOriginAndCsrf } from '../../../utils/lantern-auth'
import { checkAuthRateLimit } from '../../../utils/lantern-rate-limits'
import { studioEnv } from '../../../utils/lantern-studio'

function b64url(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
async function hashToken(value: string): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
async function passwordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  return `pbkdf2-sha256-custom:100000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') ?? '')
  const body = await readBody<{ password?: unknown; confirm_password?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const limit = await checkAuthRateLimit(event, 'reset_password')
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', String(limit.retryAfter))
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Please wait before trying again.' })
  }

  const password = typeof body?.password === 'string' ? body.password : ''
  const confirm = typeof body?.confirm_password === 'string' ? body.confirm_password : ''
  if (password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  if (password !== confirm) throw createError({ statusCode: 400, statusMessage: 'Passwords do not match.' })
  const db = studioEnv(event).lantern_staging_db
  if (!db) throw createError({ statusCode: 503, statusMessage: 'Staging account storage is not connected.' })
  const row = await db.prepare("SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND token_type = 'password_reset' AND used = 0 AND expires_at > ? LIMIT 1").bind(await hashToken(token), new Date().toISOString()).first<any>()
  if (!row) throw createError({ statusCode: 400, statusMessage: 'This password reset link is invalid or has expired.' })
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await passwordHash(password), Number(row.user_id)).run()
  await db.prepare('UPDATE email_tokens SET used = 1 WHERE id = ?').bind(Number(row.id)).run()
  return { ok: true, message: 'Your password has been changed. You can now log in.' }
})
