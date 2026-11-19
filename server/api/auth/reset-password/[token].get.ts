import { createError, getRouterParam } from 'h3'
import { studioEnv } from '../../../utils/lantern-studio'

async function hash(value: string): Promise<string> { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') ?? '')
  if (token.length < 32 || token.length > 256) throw createError({ statusCode: 400, statusMessage: 'This password reset link is invalid or has expired.' })
  const db = studioEnv(event).lantern_staging_db
  if (!db) throw createError({ statusCode: 503, statusMessage: 'Staging account storage is not connected.' })
  const row = await db.prepare("SELECT id FROM email_tokens WHERE token_hash = ? AND token_type = 'password_reset' AND used = 0 AND expires_at > ? LIMIT 1").bind(await hash(token), new Date().toISOString()).first<any>()
  if (!row) throw createError({ statusCode: 400, statusMessage: 'This password reset link is invalid or has expired.' })
  return { valid: true }
})
