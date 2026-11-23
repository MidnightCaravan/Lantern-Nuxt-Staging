import process from 'node:process'

// Smoke check for the staging rehearsal Worker (wrangler.rehearsal.jsonc).
// That config binds only staging resources. Public reads are pinned to staging
// by LANTERN_PUBLIC_READ_DATABASE and must report source: "staging"; a missing
// production binding must never be used as a fallback.

const base = (process.argv[2] ?? 'http://127.0.0.1:8799').replace(/\/$/, '')

const checks = [
  { name: 'Rehearsal health (staging DB)', path: '/api/public/health', expect: [200], source: 'staging' },
  { name: 'Application shell', path: '/', expect: [200] },
  { name: 'Login page', path: '/login', expect: [200] },
  { name: 'Discovery page', path: '/discover', expect: [200] },
  { name: 'Public works API (staging DB)', path: '/api/public/works', expect: [200], source: 'staging' },
  { name: 'Anonymous session state', path: '/api/auth/me', expect: [200, 401] },
  { name: 'Legacy verification alias', path: '/verify/invalid-smoke-token', expect: [200, 302, 303, 307, 308, 400, 404] },
  { name: 'Logout parity', path: '/logout', expect: [405] },
  // With LANTERN_MEDIA_ORIGIN bound, a missing object is answered by the Flask
  // media-origin Worker with 404. Without the binding, staging returns 503.
  { name: 'Media (staging media origin)', path: '/media/smoke-missing-object', headers: { Range: 'bytes=0-10' }, expect: [404, 503] },
]

let failures = 0

async function probe(check) {
  try {
    const response = await fetch(`${base}${check.path}`, {
      headers: check.headers ?? {},
      redirect: 'manual',
    })
    let sourceOk = true
    let actualSource = ''
    if (check.source) {
      try {
        actualSource = String((await response.clone().json()).source ?? '')
        sourceOk = actualSource === check.source
      } catch {
        sourceOk = false
      }
    }
    const ok = check.expect.includes(response.status) && sourceOk
    if (!ok) failures++
    const expected = `${check.expect.join(', ')}${check.source ? `, source ${check.source}` : ''}`
    const actual = `${response.status}${check.source ? `, source ${actualSource || 'missing'}` : ''}`
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.name}: ${actual} (expected ${expected})`)
  } catch (error) {
    failures++
    console.log(`FAIL  ${check.name}: ${error?.message ?? error}`)
  }
}

console.log(`Lantern staging-rehearsal smoke check against ${base}\n`)
for (const check of checks) await probe(check)
console.log(`\n${failures ? `${failures} required check(s) failed.` : 'All rehearsal checks passed.'}`)
process.exit(failures ? 1 : 0)
