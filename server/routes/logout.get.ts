import { setResponseStatus } from 'h3'

// Flask exposes GET /logout solely to return 405; POST /logout performs the
// logout. Keep the legacy response for compatible clients and smoke tests.
export default defineEventHandler((event) => {
  setResponseStatus(event, 405)
  return 'Method Not Allowed'
})
