import { createCsrfCookie } from '../../utils/lantern-auth'

export default defineEventHandler((event) => ({ csrfToken: createCsrfCookie(event) }))
