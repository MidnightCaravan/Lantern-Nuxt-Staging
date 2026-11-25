import {
  REQUIRED_SIGNOFF_ROLES,
  evaluateReleaseState,
  validateControlCheckout,
  validateSignoff,
} from './release-provenance.mjs'

export { REQUIRED_SIGNOFF_ROLES }

/**
 * Pure gate evaluation. Returns a list of unmet release conditions.
 *
 * The approved source is the full `sourceCommit` recorded in the release
 * state. It is never inferred from the control checkout's HEAD, so recording
 * sign-off in a later documentation commit does not change the candidate.
 */
export function evaluateReleaseGates(state, signoff, options = {}) {
  const {
    root = process.cwd(),
    checkRef = false,
    controlFiles = [],
    checkDocs = true,
    controlSha = null,
  } = options

  return [
    ...evaluateReleaseState(state, {
      root,
      checkRef,
      controlFiles,
      checkDocs,
    }),
    ...validateSignoff(signoff, state?.sourceCommit, state?.sourceRef),
    ...(controlSha ? validateControlCheckout(root, controlSha) : []),
  ]
}
