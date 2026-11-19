/* LANTERN_NUXT_AUTH_V2
 * Transitional Nuxt authentication for local staging validation.
 * Existing production accounts remain readable; all new registrations and
 * verification writes are restricted to the separate staging D1 database.
 * Sessions are stateless signed cookies, matching Flask. Authentication rate
 * limits are durable in D1 via server/utils/lantern-rate-limits.ts.
 */
import {
  createError,
  deleteCookie,
  getCookie,
  getHeader,
  getRequestURL,
  setCookie,
} from 'h3'

const SESSION_COOKIE = 'lantern_nuxt_session'
const CSRF_COOKIE = 'lantern_nuxt_csrf'
const SESSION_SECONDS = 12 * 60 * 60
const CSRF_SECONDS = 2 * 60 * 60
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type LanternAuthDatabase = 'production' | 'staging'
export type LanternSessionIdentity = { userId: number; database: LanternAuthDatabase }

export function getLanternAuthEnv(event: any): Record<string, any> {
  return event?.req?.runtime?.cloudflare?.env
    ?? event?.context?.cloudflare?.env
    ?? event?.context?.nitro?.env
    ?? {}
}

function getSessionSecret(event: any): string {
  const value = getLanternAuthEnv(event).LANTERN_NUXT_SESSION_SECRET
  if (typeof value !== 'string' || value.length < 32) {
    throw createError({ statusCode: 503, statusMessage: 'Local Nuxt session secret is not configured. Restart the dev server after creating .dev.vars.' })
  }
  return value
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function safeTextEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!
  return difference === 0
}

function secureCookie(event: any): boolean {
  return getRequestURL(event).protocol === 'https:'
}

export function createCsrfCookie(event: any): string {
  const current = getCookie(event, CSRF_COOKIE)
  const token = current && current.length >= 32
    ? current
    : toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  setCookie(event, CSRF_COOKIE, token, {
    httpOnly: false,
    secure: secureCookie(event),
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_SECONDS,
  })
  return token
}

export function assertSameOriginAndCsrf(event: any, suppliedToken: unknown): void {
  const origin = getHeader(event, 'origin')
  if (!origin) throw createError({ statusCode: 403, statusMessage: 'Request origin is missing.' })
  let originValue: string
  try { originValue = new URL(origin).origin }
  catch { throw createError({ statusCode: 403, statusMessage: 'Request origin is invalid.' }) }
  if (originValue !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request rejected.' })
  }
  const cookieToken = getCookie(event, CSRF_COOKIE) ?? ''
  const bodyToken = typeof suppliedToken === 'string' ? suppliedToken : ''
  if (!cookieToken || !bodyToken || !safeTextEqual(cookieToken, bodyToken)) {
    throw createError({ statusCode: 403, statusMessage: 'CSRF token missing or invalid.' })
  }
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return new Uint8Array(result)
}

export async function createLanternPasswordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePassword(password, salt, 100_000)
  return `pbkdf2-sha256-custom:100000$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

export async function verifyLanternPasswordHash(storedHash: string, password: string): Promise<boolean> {
  try {
    const parts = storedHash.split('$')
    if (parts.length !== 3) return false
    const [method, saltText, hashText] = parts
    const methodMatch = /^pbkdf2-sha256-custom:(\d+)$/.exec(method ?? '')
    if (!methodMatch) return false
    const iterations = Number(methodMatch[1])
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 200_000) return false
    const salt = fromBase64Url(saltText ?? '')
    const expected = fromBase64Url(hashText ?? '')
    if (salt.length !== 16 || expected.length !== 32) return false
    const actual = await derivePassword(password, salt, iterations)
    let difference = 0
    for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ actual[i]!
    return difference === 0
  } catch { return false }
}

export async function burnDummyPasswordCheck(password: string): Promise<void> {
  await derivePassword(password, new Uint8Array(16).fill(0x4c), 100_000)
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function createLanternSession(event: any, userId: number, database: LanternAuthDatabase = 'production'): Promise<void> {
  const secret = getSessionSecret(event)
  const now = Math.floor(Date.now() / 1000)
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: 1, uid: userId, db: database, iat: now, exp: now + SESSION_SECONDS })))
  const key = await getHmacKey(secret)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
  setCookie(event, SESSION_COOKIE, `${payload}.${toBase64Url(signature)}`, {
    httpOnly: true,
    secure: secureCookie(event),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  })
}

export async function getLanternSessionIdentity(event: any): Promise<LanternSessionIdentity | null> {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null
  const secret = getSessionSecret(event)
  const parts = token.split('.')
  if (parts.length !== 2) {
    deleteCookie(event, SESSION_COOKIE, { path: '/' })
    return null
  }
  try {
    const payloadPart = parts[0]!
    const signature = fromBase64Url(parts[1]!)
    const key = await getHmacKey(secret)
    if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payloadPart))) throw new Error('Invalid signature')
    const payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart)))
    const userId = Number(payload?.uid)
    const expires = Number(payload?.exp)
    // Older v1 cookies did not include db; those remain production sessions.
    const database: LanternAuthDatabase = payload?.db === 'staging' ? 'staging' : 'production'
    if (payload?.v !== 1 || !Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
      throw new Error('Invalid or expired session')
    }
    return { userId, database }
  } catch {
    deleteCookie(event, SESSION_COOKIE, { path: '/' })
    return null
  }
}

export async function getLanternSessionUserId(event: any): Promise<number | null> {
  const identity = await getLanternSessionIdentity(event)
  return identity?.userId ?? null
}

export function clearLanternSession(event: any): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export async function createLanternVerificationToken(): Promise<{ token: string; tokenHash: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(48)))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
  return { token, tokenHash: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') }
}

export async function hashLanternVerificationToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function sendLanternVerificationEmail(
  event: any,
  email: string,
  token: string,
  purpose: 'registration' | 'resend' = 'registration',
  displayName = '',
): Promise<boolean> {
  const env = getLanternAuthEnv(event)
  const apiKey = env.LANTERN_BREVO_API_KEY
  const sender = env.LANTERN_MAIL_FROM || env.MAIL_FROM

  if (typeof apiKey !== 'string' || !apiKey.trim() || typeof sender !== 'string' || !sender.trim()) {
    console.error('[Lantern email] Missing configuration:', {
      apiKeyConfigured: typeof apiKey === 'string' && !!apiKey.trim(),
      senderConfigured: typeof sender === 'string' && !!sender.trim(),
    })
    return false
  }

  const configuredBase = env.LANTERN_PUBLIC_BASE_URL
  const baseUrl = typeof configuredBase === 'string' && configuredBase.trim()
    ? configuredBase.trim().replace(/\/+$/, '')
    : getRequestURL(event).origin

  // Flask sends the canonical /verify/<token> link. Nuxt's /verify-email route
  // is the documented alias, so the link is equivalent without the redirect.
  const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`

  // Mirror Flask's distinct registration and resend messages exactly:
  // lantern_auth.py:226-247 and lantern_auth.py:385-402.
  const subject = purpose === 'resend'
    ? 'Your Lantern verification link'
    : 'Verify your Lantern account'
  const textContent = purpose === 'resend'
    ? `Hello ${displayName},\n\nHere is your new Lantern verification link:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\n— Lantern`
    : `Welcome to Lantern.\n\nYour account has been created successfully.\n\nPlease verify your email address by opening this link:\n\n${verifyUrl}\n\nThis verification link expires in 24 hours.\n\nIf you did not create this account, you can safely ignore this email.\n\n— Lantern`

  const payload = {
    sender: { name: 'Lantern', email: sender.trim() },
    to: [{ email }],
    subject,
    textContent,
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    let details: any = {}
    try { details = JSON.parse(responseText) } catch {}

    if (!response.ok) {
      const safeMessage = typeof details.message === 'string'
        ? details.message.replaceAll(sender.trim(), '[sender]').replaceAll(email, '[recipient]').slice(0, 400)
        : 'Brevo returned an error.'

      console.error('[Lantern email] Brevo rejected the message:', {
        status: response.status,
        code: details.code || 'UNKNOWN',
        message: safeMessage,
      })
      return false
    }

    console.info('[Lantern email] Brevo accepted the message:', {
      status: response.status,
      messageId: details.messageId || 'not provided',
    })
    return true
  } catch (error: any) {
    console.error('[Lantern email] Request failed:', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown network error',
    })
    return false
  }
}
