import { getQuery } from 'h3'
import { consumeLanternEmailVerification } from '../../utils/lantern-email-verification'
import { getAnonymousMutationDatabase } from '../../utils/lantern-writes'

// Flask verifies email tokens on GET /verify/<token> and redirects to login.
// The emailed token is the authorization, so no CSRF token is required.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const token = typeof query.token === 'string' ? query.token.trim() : ''
  return consumeLanternEmailVerification(event, token, getAnonymousMutationDatabase(event))
})
