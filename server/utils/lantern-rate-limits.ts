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

/* Flask's _auth_rate_limit_client_ip() (app.py:312-326) validates and
 * canonicalizes CF-Connecting-IP with ipaddress.ip_address(), then does the
 * same for request.remote_addr, falling back to "unknown". Reproduce that
 * here so malformed/spoofed headers cannot create extra buckets and so
 * equivalent IPv6 spellings share one key. */
function canonicalIpv4(value: string): string | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const numbers: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return null
    const number = Number(part)
    if (number > 255) return null
    numbers.push(number)
  }
  return numbers.join('.')
}

function canonicalIpv6(value: string): string | null {
  let address = value.toLowerCase()
  if (address.includes('%')) return null

  const lastColon = address.lastIndexOf(':')
  if (lastColon >= 0 && address.slice(lastColon + 1).includes('.')) {
    const embedded = canonicalIpv4(address.slice(lastColon + 1))
    if (!embedded) return null
    const [a, b, c, d] = embedded.split('.').map(Number)
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const compressions = address.match(/::/g) ?? []
  if (compressions.length > 1) return null
  const compressed = compressions.length === 1
  const [left = '', right = ''] = address.split('::')
  const leftGroups = left ? left.split(':') : []
  const rightGroups = right ? right.split(':') : []
  if ([...leftGroups, ...rightGroups].some((group) => group === '')) return null
  if ([...leftGroups, ...rightGroups].some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  const explicitCount = leftGroups.length + rightGroups.length
  if (compressed ? explicitCount > 7 : explicitCount !== 8) return null

  const groups = [
    ...leftGroups.map((group) => Number.parseInt(group, 16)),
    ...Array(compressed ? 8 - explicitCount : 0).fill(0),
    ...rightGroups.map((group) => Number.parseInt(group, 16)),
  ]
  if (groups.length !== 8) return null

  let bestStart = -1
  let bestLength = 0
  let currentStart = -1
  let currentLength = 0
  for (let index = 0; index < groups.length; index++) {
    if (groups[index] === 0) {
      if (currentStart < 0) { currentStart = index; currentLength = 1 }
      else currentLength++
      if (currentLength > bestLength) { bestLength = currentLength; bestStart = currentStart }
    } else {
      currentStart = -1
      currentLength = 0
    }
  }
  const hex = (group: number) => group.toString(16)
  if (bestLength < 2) return groups.map(hex).join(':')
  return `${groups.slice(0, bestStart).map(hex).join(':')}::${groups.slice(bestStart + bestLength).map(hex).join(':')}`
}

export function canonicalizeClientIp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!candidate) return null
  return candidate.includes(':') ? canonicalIpv6(candidate) : canonicalIpv4(candidate)
}

export function getRateLimitClientIp(event: any): string {
  return canonicalizeClientIp(getHeader(event, 'cf-connecting-ip'))
    ?? canonicalizeClientIp(getRequestIP(event))
    ?? 'unknown'
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

/**
 * Handler-level check. The caller passes the already-resolved account database
 * so counters always stay in the same environment as the account mutation.
 */
export async function checkAuthRateLimit(
  event: any,
  endpoint: AuthRateLimitEndpoint,
  db: any,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RateLimitResult> {
  const env = getLanternAuthEnv(event)
  const secret = env.LANTERN_NUXT_SESSION_SECRET
  if (typeof secret !== 'string' || secret.length < 32) {
    throw createError({ statusCode: 503, statusMessage: 'Local Nuxt session secret is not configured. Restart the dev server after creating .dev.vars.' })
  }
  if (!db) {
    throw createError({ statusCode: 503, statusMessage: 'Authentication is temporarily unavailable. Please try again.' })
  }

  try {
    return await recordAuthAttempt(db, secret, endpoint, getRateLimitClientIp(event), nowSeconds)
  } catch (error) {
    throw createError({ statusCode: 503, statusMessage: 'Authentication is temporarily unavailable. Please try again.' })
  }
}
