import process from 'node:process'

// Smoke check for the staging rehearsal Worker (wrangler.rehearsal.jsonc).
// That config intentionally binds no production database or media bucket, so
// production-backed endpoints are expected to return 503. Those are reported
// as EXPECTED, not as failures. Use scripts/smoke-check.mjs against a
// production-shaped, locally seeded Worker for the full runbook §6 checks.

const base = (process.argv[2] ?? 'http://127.0.0.1:8799').replace(/\/$/, '')

const checks = [
  { name: 'Rehearsal health (production DB intentionally unbound)', path: '/api/public/health', expect: [503] },
  { name: 'Application shell', path: '/', expect: [200] },
  { name: 'Login page', path: '/login', expect: [200] },
  { name: 'Discovery page', path: '/discover', expect: [200] },
  { name: 'Public works API (production DB intentionally unbound)', path: '/api/public/works', expect: [503] },
  { name: 'Anonymous session state', path: '/api/auth/me', expect: [200, 401] },
  { name: 'Legacy verification alias', path: '/verify/invalid-smoke-token', expect: [200, 302, 303, 307, 308, 400, 404] },
  { name: 'Logout parity', path: '/logout', expect: [405] },
  { name: 'Media (production bucket intentionally unbound)', path: '/media/smoke-missing-object', headers: { Range: 'bytes=0-10' }, expect: [503] },
]

let failures = 0

async function probe(check) {
  try {
    const response = await fetch(`${base}${check.path}`, {
      headers: check.headers ?? {},
      redirect: 'manual',
    })
    const ok = check.expect.includes(response.status)
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.name}: ${response.status} (expected ${check.expect.join(', ')})`)
  } catch (error) {
    failures++
    console.log(`FAIL  ${check.name}: ${error?.message ?? error}`)
  }
}

console.log(`Lantern staging-rehearsal smoke check against ${base}\n`)
for (const check of checks) await probe(check)
console.log(`\n${failures ? `${failures} required check(s) failed.` : 'All rehearsal checks passed.'}`)
process.exit(failures ? 1 : 0)
