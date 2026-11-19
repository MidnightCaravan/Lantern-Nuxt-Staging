import process from 'node:process'

const base = (process.argv[2] ?? 'http://127.0.0.1:8799').replace(/\/$/, '')

const checks = [
  { name: 'Worker health', path: '/api/public/health', expect: [200] },
  { name: 'Application shell', path: '/', expect: [200] },
  { name: 'Login page', path: '/login', expect: [200] },
  { name: 'Discovery page', path: '/discover', expect: [200] },
  { name: 'Public works API', path: '/api/public/works', expect: [200] },
  { name: 'Anonymous session state', path: '/api/auth/me', expect: [200, 401] },
  { name: 'Legacy verification alias', path: '/verify/invalid-smoke-token', expect: [200, 302, 303, 307, 308, 400, 404] },
  { name: 'Logout parity', path: '/logout', expect: [405] },
]

const dataDependent = [
  { name: 'Public work detail', path: '/api/public/works/1' },
  { name: 'Media delivery', path: '/media/smoke-missing-object', headers: { Range: 'bytes=0-10' } },
]

let failures = 0

async function probe(check) {
  try {
    const response = await fetch(`${base}${check.path}`, {
      headers: check.headers ?? {},
      redirect: 'manual',
    })
    const status = response.status
    if (check.expect) {
      const ok = check.expect.includes(status)
      if (!ok) failures++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.name}: ${status} (expected ${check.expect.join(', ')})`)
    } else {
      console.log(`INFO  ${check.name}: ${status}`)
    }
    return status
  } catch (error) {
    failures++
    console.log(`FAIL  ${check.name}: ${error?.message ?? error}`)
    return null
  }
}

console.log(`Lantern smoke check against ${base}\n`)
for (const check of checks) await probe(check)
console.log('')
for (const check of dataDependent) await probe(check)

console.log(`\n${failures ? `${failures} required check(s) failed.` : 'All required checks passed.'}`)
process.exit(failures ? 1 : 0)
