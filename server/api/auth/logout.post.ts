import { readBody } from 'h3'
import { assertSameOriginAndCsrf, clearLanternSession } from '../../utils/lantern-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  clearLanternSession(event)
  return { ok: true }
})
