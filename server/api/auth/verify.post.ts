import { readBody, setResponseStatus } from 'h3'
import { getLanternStagingDatabase } from '../../utils/lantern-public'
import { assertSameOriginAndCsrf, hashLanternVerificationToken } from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token || token.length > 256) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_TOKEN', message: 'This verification link is invalid or has expired.' }
  }

  const db = getLanternStagingDatabase(event)
  const tokenHash = await hashLanternVerificationToken(token)
  const record = await db.prepare(`
    SELECT id, user_id FROM email_tokens
    WHERE token_hash = ? AND token_type = 'email_verification' AND used = 0
      AND datetime(expires_at) > datetime('now')
    LIMIT 1
  `).bind(tokenHash).first<any>()

  if (!record) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_OR_EXPIRED', message: 'This verification link is invalid, expired, or has already been used.' }
  }

  const consumed = await db.prepare(`
    UPDATE email_tokens SET used = 1
    WHERE id = ? AND used = 0 AND token_type = 'email_verification'
      AND datetime(expires_at) > datetime('now')
  `).bind(Number(record.id)).run()
  if (Number(consumed.meta?.changes ?? 0) !== 1) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_OR_EXPIRED', message: 'This verification link is invalid, expired, or has already been used.' }
  }

  await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(Number(record.user_id)).run()
  return { ok: true, message: 'Your email has been verified. You can now log in.' }
})
