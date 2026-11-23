import { getLanternAuthEnv } from '../../utils/lantern-auth'

/**
 * Public, non-sensitive deployment defaults for client forms.
 *
 * Anonymous registration/verification are pinned by
 * LANTERN_ANONYMOUS_WRITE_DATABASE. The login form must default to that same
 * environment; otherwise a staging registration sends the user to a production
 * login after verification. Public reads use the same staging signal.
 */
export default defineEventHandler((event) => {
  const env = getLanternAuthEnv(event)
  const anonymousWrite = env.LANTERN_ANONYMOUS_WRITE_DATABASE
  const publicRead = env.LANTERN_PUBLIC_READ_DATABASE
  const defaultDatabase = anonymousWrite === 'staging' || publicRead === 'staging'
    ? 'staging'
    : 'production'

  return { defaultDatabase }
})
