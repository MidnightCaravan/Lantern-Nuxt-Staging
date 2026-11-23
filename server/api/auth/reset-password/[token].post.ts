import { createError, getRouterParam, readBody, setResponseHeader } from 'h3'
import { assertSameOriginAndCsrf } from '../../../utils/lantern-auth'
import { checkAuthRateLimit } from '../../../utils/lantern-rate-limits'
import { getAnonymousMutationDatabase } from '../../../utils/lantern-writes'

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
  const db = getAnonymousMutationDatabase(event)

  const limit = await checkAuthRateLimit(event, 'reset_password', db)
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', String(limit.retryAfter))
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Please wait before trying again.' })
  }

  // Flask validates the token before reading the submitted password
  // (lantern_auth.py:660-713), so an invalid link always wins over a
  // short or mismatched password.
  const now = new Date().toISOString()
  const row = await db.prepare("SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND token_type = 'password_reset' AND used = 0 AND expires_at > ? LIMIT 1").bind(await hashToken(token), now).first<any>()
  if (!row) throw createError({ statusCode: 400, statusMessage: 'This password reset link is invalid or has expired.' })

  const password = typeof body?.password === 'string' ? body.password : ''
  const confirm = typeof body?.confirm_password === 'string' ? body.confirm_password : ''
  if (password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  if (password !== confirm) throw createError({ statusCode: 400, statusMessage: 'Passwords do not match.' })
  const userId = Number(row.user_id)
  const tokenId = Number(row.id)
  const nextHash = await passwordHash(password)
  // Flask commits the password update before marking the token used. The same
  // captured `now` is bound to the lookup and both updates. D1 batch statements
  // run sequentially in one transaction: a statement failure rolls both back,
  // and the equivalent predicates mean a successful first UPDATE implies the
  // second also matches. The result check below does not roll anything back;
  // it only detects an invariant violation that should be impossible.
  const results = await db.batch([
    db.prepare(`
      UPDATE users SET password_hash = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM email_tokens
          WHERE id = ? AND token_type = 'password_reset' AND used = 0 AND expires_at > ?
        )
    `).bind(nextHash, userId, tokenId, now),
    db.prepare(`
      UPDATE email_tokens SET used = 1
      WHERE id = ? AND used = 0 AND token_type = 'password_reset' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM users WHERE id = ?)
    `).bind(tokenId, now, userId),
  ])
  const userChanges = Number(results[0]?.meta?.changes ?? 0)
  const tokenChanges = Number(results[1]?.meta?.changes ?? 0)

  if (userChanges === 0 && tokenChanges === 0) {
    throw createError({ statusCode: 400, statusMessage: 'This password reset link is invalid or has expired.' })
  }

  if (userChanges !== 1 || tokenChanges !== 1) {
    // Impossible under the batch invariant. Log it and fail closed; a read of
    // batch results cannot undo writes that D1 already committed.
    console.error('[lantern] password reset token batch invariant violation', { userChanges, tokenChanges })
    throw createError({ statusCode: 500, statusMessage: 'Password reset failed unexpectedly.' })
  }

  return { ok: true, message: 'Your password has been changed. You can now log in.' }
})
