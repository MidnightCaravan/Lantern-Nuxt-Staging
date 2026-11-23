import { readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../utils/lantern-auth'
import { consumeLanternEmailVerification } from '../../utils/lantern-email-verification'
import { getAnonymousMutationDatabase } from '../../utils/lantern-writes'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown; csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const db = getAnonymousMutationDatabase(event)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  return consumeLanternEmailVerification(event, token, db)
})
