/* Durable authentication rate limits reproducing Flask's app.py implementation.
 *
 * Flask counts attempts in the auth_rate_limits D1 table with an atomic
 * INSERT ... ON CONFLICT ... RETURNING, keyed by HMAC-SHA256 of
 * `endpoint:client-ip` and bucketed into fixed epoch windows. Nuxt previously
 * kept these counters in process memory, which reset on isolate restart and
 * diverged across instances. This module uses the same durable algorithm.
 */
import { createError, getHeader, getRequestIP } from 'h3'
import { getLanternAuthEnv } from './lantern-auth'

export type RateLimitResult = {
  allowed: boolean
  retryAfter: number
  attempts: number
  windowStart: number
}

export const AUTH_RATE_LIMITS = {
  login: { max: 10, windowSeconds: 15 * 60 },
  register: { max: 5, windowSeconds: 60 * 60 },
  forgot_password: { max: 5, windowSeconds: 15 * 60 },
  resend_verification: { max: 5, windowSeconds: 15 * 60 },
  reset_password: { max: 10, windowSeconds: 15 * 60 },
} as const

export type AuthRateLimitEndpoint = keyof typeof AUTH_RATE_LIMITS

const encoder = new TextEncoder()

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function getRateLimitClientIp(event: any): string {
  const header = String(getHeader(event, 'cf-connecting-ip') ?? '').trim()
  if (header) return header
  return String(getRequestIP(event) ?? 'unknown')
}

/** Pure durable counter step. `db` is a D1 database; `nowSeconds` is injectable for tests. */
export async function recordAuthAttempt(
  db: any,
  secret: string,
  endpoint: AuthRateLimitEndpoint,
  clientIp: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RateLimitResult> {
  const policy = AUTH_RATE_LIMITS[endpoint]
  const keyHash = await hmacHex(secret, `lantern-auth-rate-limit:v1:${endpoint}:${clientIp}`)
  const windowStart = nowSeconds - (nowSeconds % policy.windowSeconds)
  const expiresAt = windowStart + policy.windowSeconds + 86400

  await db.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?').bind(nowSeconds).run()

  const row = await db.prepare(`
    INSERT INTO auth_rate_limits (
      key_hash, window_started_at, attempts, expires_at
    )
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE
        WHEN auth_rate_limits.window_started_at = excluded.window_started_at
        THEN auth_rate_limits.attempts + 1
        ELSE 1
      END,
      window_started_at = excluded.window_started_at,
      expires_at = excluded.expires_at
    RETURNING attempts
  `).bind(keyHash, windowStart, expiresAt).first<{ attempts: number }>()

  if (!row) throw new Error('Rate-limit counter could not be read.')

  const attempts = Number(row.attempts)
  const retryAfter = Math.max(1, windowStart + policy.windowSeconds - nowSeconds)
  return {
    allowed: attempts <= policy.max,
    retryAfter,
    attempts,
    windowStart,
  }
}

/** Handler-level check. Rate-limit counters are written to staging D1; production stays read-only. */
export async function checkAuthRateLimit(
  event: any,
  endpoint: AuthRateLimitEndpoint,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RateLimitResult> {
  const env = getLanternAuthEnv(event)
  const secret = env.LANTERN_NUXT_SESSION_SECRET
  if (typeof secret !== 'string' || secret.length < 32) {
    throw createError({ statusCode: 503, statusMessage: 'Local Nuxt session secret is not configured. Restart the dev server after creating .dev.vars.' })
  }
  const db = env.lantern_staging_db
  if (!db) {
    throw createError({ statusCode: 503, statusMessage: 'Authentication is temporarily unavailable. Please try again.' })
  }

  try {
    return await recordAuthAttempt(db, secret, endpoint, getRateLimitClientIp(event), nowSeconds)
  } catch (error) {
    throw createError({ statusCode: 503, statusMessage: 'Authentication is temporarily unavailable. Please try again.' })
  }
}
