import { createLanternSession } from '../../server/utils/lantern-auth'
import { callHandler, cookieValue } from './handler'

export const TEST_SECRET = 'lantern-test-session-secret-at-least-32-chars'
export const TEST_CSRF = 'lantern-test-csrf-token-at-least-32-chars'

export function testEnv(production: any, staging: any, stagingMediaBucket?: any, productionMediaBucket?: any) {
  return {
    LANTERN_NUXT_SESSION_SECRET: TEST_SECRET,
    LANTERN_ANONYMOUS_WRITE_DATABASE: 'staging',
    lantern_db: production,
    lantern_staging_db: staging,
    lantern_staging_media: stagingMediaBucket,
    lantern_media: productionMediaBucket,
  }
}

export async function makeSession(userId: number, database: 'production' | 'staging', env: Record<string, any>) {
  const response = await callHandler(
    (event: any) => createLanternSession(event, userId, database),
    { env },
  )
  return cookieValue(response.headers.get('set-cookie'), 'lantern_nuxt_session')!
}

export function csrfHeaders(session: string, extra: Record<string, string> = {}) {
  return {
    cookie: `lantern_nuxt_session=${session}; lantern_nuxt_csrf=${TEST_CSRF}`,
    'cf-connecting-ip': 'parity-test',
    ...extra,
  }
}
