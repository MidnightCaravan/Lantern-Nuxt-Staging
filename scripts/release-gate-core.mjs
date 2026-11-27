export const APPROVAL_MODEL = 'single-owner'
export const REQUIRED_SIGNOFF_ROLES = ['applicationOwner']

const FULL_SOURCE_COMMIT = /^[0-9a-f]{40}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  )
}

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

  if (state?.approvalModel !== APPROVAL_MODEL) {
    problems.push(`G3: approvalModel must be ${APPROVAL_MODEL} in release state`)
  }

  if (typeof state?.sourceCommit !== 'string' || !FULL_SOURCE_COMMIT.test(state.sourceCommit)) {
    problems.push('G3: sourceCommit must be a full 40-character lowercase hexadecimal SHA')
  }

  if (!signoff) {
    problems.push('G3: no release sign-off file was provided')
    return problems
  }

  if (signoff.approvalModel !== APPROVAL_MODEL) {
    problems.push(`G3: sign-off approvalModel must be ${APPROVAL_MODEL}`)
  }

  if (signoff.commit !== state?.sourceCommit) {
    problems.push(`G3: sign-off commit ${signoff.commit ?? 'missing'} does not match pinned release commit ${state?.sourceCommit ?? 'missing'}`)
  }

  if (signoff.noIndependentHumanReview !== true) {
    problems.push('G3: noIndependentHumanReview must be true')
  }

  if (signoff.acceptsInfrastructureAndSecurityRisk !== true) {
    problems.push('G3: acceptsInfrastructureAndSecurityRisk must be true')
  }

  if (!isPlainObject(signoff.roles)) {
    problems.push('G3: sign-off roles must contain only applicationOwner')
  } else {
    for (const role of Object.keys(signoff.roles)) {
      if (!REQUIRED_SIGNOFF_ROLES.includes(role)) {
        problems.push(`G3: unsupported legacy role ${role} is not accepted under single-owner approval`)
      }
    }

    const owner = signoff.roles.applicationOwner
    if (!isPlainObject(owner)) {
      problems.push('G3: applicationOwner has not approved the release')
    } else {
      if (owner.approved !== true) {
        problems.push('G3: applicationOwner has not approved the release')
      }
      if (typeof owner.name !== 'string' || owner.name.trim().length === 0) {
        problems.push('G3: applicationOwner name is required')
      }
      if (!isIsoDate(owner.date)) {
        problems.push('G3: applicationOwner date must be a valid ISO date (YYYY-MM-DD)')
      }
    }
  }

  return problems
}
