import { createError, getRequestURL, readBody, setResponseHeader } from 'h3'
import { assertSameOriginAndCsrf } from '../../utils/lantern-auth'
import { checkAuthRateLimit } from '../../utils/lantern-rate-limits'
import { studioEnv, studioNow } from '../../utils/lantern-studio'

function b64url(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
async function sha256(value: string): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
async function sendMail(event: any, email: string, subject: string, body: string) {
  const env = studioEnv(event)
  const apiKey = env.LANTERN_BREVO_API_KEY
  const fromValue = String(env.LANTERN_MAIL_FROM || env.MAIL_FROM || '').trim()
  if (!apiKey || !fromValue) throw createError({ statusCode: 503, statusMessage: 'Email delivery is not configured for this staging environment.' })
  const match = /^(.*?)\s*<([^>]+)>$/.exec(fromValue)
  const sender = match ? { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() } : { email: fromValue }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': String(apiKey), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender, to: [{ email }], subject, textContent: body }) })
  if (!response.ok) { const detail = await response.text().catch(() => ''); console.error('Lantern password reset email failed:', response.status, detail.slice(0, 500)); throw createError({ statusCode: 502, statusMessage: 'Password reset email could not be sent. Please try again.' }) }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)

  const limit = await checkAuthRateLimit(event, 'forgot_password')
  if (!limit.allowed) {
    setResponseHeader(event, 'Retry-After', String(limit.retryAfter))
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Please wait before trying again.' })
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address.' })
  const env = studioEnv(event)
  const db = env.lantern_staging_db
  if (!db) throw createError({ statusCode: 503, statusMessage: 'Staging account storage is not connected.' })
  const user = await db.prepare('SELECT id, email, display_name FROM users WHERE lower(email) = ? LIMIT 1').bind(email).first<any>()
  if (user) {
    const random = crypto.getRandomValues(new Uint8Array(48))
    const token = b64url(random)
    const tokenHash = await sha256(token)
    const now = new Date()
    const expires = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    await db.prepare("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND token_type = 'password_reset' AND used = 0").bind(Number(user.id)).run()
    await db.prepare("INSERT INTO email_tokens (user_id, token_hash, token_type, expires_at, created_at) VALUES (?, ?, 'password_reset', ?, ?)").bind(Number(user.id), tokenHash, expires, studioNow()).run()
    const resetUrl = new URL(`/reset-password/${token}`, getRequestURL(event).origin).toString()
    const name = String(user.display_name || 'there')
    await sendMail(event, email, 'Reset your Lantern password', `Hello ${name},\n\nSomeone requested a password reset for your Lantern account.\n\nReset your password here:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request this, you can safely ignore this email.\n\n— Lantern`)
  }
  // Do not reveal whether the email exists.
  return { ok: true, message: 'If an account matches that email, a reset link has been sent.' }
})
