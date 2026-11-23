import { readBody } from 'h3'
import { assertSameOriginAndCsrf, clearLanternSession } from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  clearLanternSession(event)
  // Flask flashes this message after clearing the session
  // (lantern_auth.py:539-552). Return it so the client can preserve the
  // same one-time message for the next page that renders flashes.
  return { ok: true, message: 'You have been logged out.' }
})
