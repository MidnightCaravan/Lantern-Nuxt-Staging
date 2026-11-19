export const REQUIRED_SIGNOFF_ROLES = [
  'applicationOwner',
  'infraCloudflare',
  'authSecurity',
  'releaseManager',
]

/** Pure gate evaluation. Returns a list of unmet release conditions. */
export function evaluateReleaseGates(state, signoff) {
  const problems = []

  for (const [id, gate] of Object.entries(state?.gates ?? {})) {
    if (!gate?.pass) {
      problems.push(`${id}: ${gate?.title ?? id} — ${gate?.evidence ?? 'no evidence recorded'}`)
    }
  }

  for (const [id, blocker] of Object.entries(state?.blockers ?? {})) {
    if (!blocker?.closed) {
      problems.push(`${id}: ${blocker?.title ?? id} is not closed`)
    }
  }

  if (!signoff) {
    problems.push('G3: no release sign-off file was provided')
    return problems
  }

  if (signoff.commit !== state?.sourceCommit) {
    problems.push(`G3: sign-off commit ${signoff.commit ?? 'missing'} does not match release commit ${state?.sourceCommit ?? 'missing'}`)
  }

  for (const role of REQUIRED_SIGNOFF_ROLES) {
    if (!signoff.roles?.[role]?.approved) {
      problems.push(`G3: ${role} has not approved the release`)
    }
  }

  return problems
}
