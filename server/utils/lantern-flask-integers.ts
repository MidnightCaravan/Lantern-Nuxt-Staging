// The canonical Flask Worker parses Worker headers with Python int()
// (src/worker.py:525-532,555-559,571-575,606-609,771-794). int() accepts
// surrounding whitespace, an optional sign, digit separators and arbitrary
// precision, but rejects decimal, exponent and hex notation. JavaScript's
// Number() accepts those notations and silently loses precision above 2^53,
// which changes the status code on malformed or oversized declarations.
//
// Returning an infinity for an out-of-safe-range integer lets the callers keep
// Flask's ordering: the value is finite for arithmetic/comparison purposes,
// trips the endpoint's existing maximum-size check and therefore produces 413
// instead of the 400 used for a genuinely unparseable value.
const PYTHON_INTEGER = /^[+-]?\d+(?:_\d+)*$/

export function parseFlaskInteger(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!PYTHON_INTEGER.test(text)) return null
  let parsed: bigint
  try {
    parsed = BigInt(text.replaceAll('_', ''))
  } catch {
    return null
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return Number.POSITIVE_INFINITY
  if (parsed < BigInt(Number.MIN_SAFE_INTEGER)) return Number.NEGATIVE_INFINITY
  return Number(parsed)
}

// JSON part numbers arrive as numbers on the canonical client. Python int()
// truncates a float but rejects a string such as "1.9" or "1e0", so keep those
// two paths distinct instead of running every value through Number().
export function parseFlaskPartNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  const parsed = parseFlaskInteger(value)
  return parsed === null ? null : Number.isFinite(parsed) ? Math.trunc(parsed) : parsed
}
