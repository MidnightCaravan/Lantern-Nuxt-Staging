import { setResponseStatus } from 'h3'
import { hashLanternVerificationToken } from './lantern-auth'

/**
 * Shared email-token consumption for both the CSRF-protected POST endpoint and
 * Flask's canonical GET verification link. Verification tokens are secret and
 * single-use, so the GET form needs no separate CSRF token.
 */
export async function consumeLanternEmailVerification(event: any, token: string, db: any) {
  if (!token || token.length > 256) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_TOKEN', message: 'This verification link is invalid or has expired.' }
  }

  // One timestamp is captured for the lookup and both writes. The batch is
  // sequential and non-concurrent, so the predicates below remain equivalent
  // throughout: if the first UPDATE changes the user, the same token id, type,
  // unused state, expiry threshold, and user identity still match the second
  // UPDATE. There is no clock drift between the two statements.
  const now = new Date().toISOString()
  const tokenHash = await hashLanternVerificationToken(token)
  const record = await db.prepare(`
    SELECT id, user_id FROM email_tokens
    WHERE token_hash = ? AND token_type = 'email_verification' AND used = 0
      AND expires_at > ?
    LIMIT 1
  `).bind(tokenHash, now).first<any>()

  if (!record) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_OR_EXPIRED', message: 'This verification link is invalid or has expired.' }
  }

  const userId = Number(record.user_id)
  const tokenId = Number(record.id)
  // Flask commits the user update first, then marks the token used. D1 batch
  // statements run in order in one transaction: a statement failure rolls the
  // whole batch back. The result check below does not roll anything back; it
  // only detects an invariant violation that the shared timestamp and
  // equivalent predicates should make impossible.
  const results = await db.batch([
    db.prepare(`
      UPDATE users SET email_verified = 1
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM email_tokens
          WHERE id = ? AND token_type = 'email_verification' AND used = 0
            AND expires_at > ?
        )
    `).bind(userId, tokenId, now),
    db.prepare(`
      UPDATE email_tokens SET used = 1
      WHERE id = ? AND used = 0 AND token_type = 'email_verification'
        AND expires_at > ?
        AND EXISTS (SELECT 1 FROM users WHERE id = ?)
    `).bind(tokenId, now, userId),
  ])
  const userChanges = Number(results[0]?.meta?.changes ?? 0)
  const tokenChanges = Number(results[1]?.meta?.changes ?? 0)

  if (userChanges === 0 && tokenChanges === 0) {
    setResponseStatus(event, 400)
    return { ok: false, code: 'INVALID_OR_EXPIRED', message: 'This verification link is invalid or has expired.' }
  }

  if (userChanges !== 1 || tokenChanges !== 1) {
    // Impossible under the batch invariant. Log it and fail closed; a read of
    // batch results cannot undo writes that D1 already committed.
    console.error('[lantern] email verification token batch invariant violation', { userChanges, tokenChanges })
    setResponseStatus(event, 500)
    return { ok: false, code: 'TOKEN_BATCH_INVARIANT_VIOLATION', message: 'Email verification failed unexpectedly.' }
  }

  return { ok: true, message: 'Your email has been verified. You can now log in.' }
}
