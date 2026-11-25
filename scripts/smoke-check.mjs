import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * A1 post-deployment smoke checks.
 *
 * Every request in this script is a read-only GET. No credentials are sent, no
 * cookies are stored, and no write-capable endpoint is invoked with a mutating
 * method. Inputs that depend on real production data must be supplied
 * explicitly; the script never guesses a published work id or media key.
 *
 * A GET that returns 405 only verifies route/method handling. It is NOT proof
 * that POST/PUT writes are blocked. Handler-level POST guard coverage lives in
 * tests/production-write-protection.test.ts.
 */

export const SMOKE_INPUT_ENV = Object.freeze({
  base: 'LANTERN_SMOKE_BASE_URL',
  source: 'LANTERN_SMOKE_SOURCE',
  workId: 'LANTERN_SMOKE_WORK_ID',
  mediaKey: 'LANTERN_SMOKE_MEDIA_KEY',
  rangeKey: 'LANTERN_SMOKE_RANGE_KEY',
  missingKey: 'LANTERN_SMOKE_MISSING_MEDIA_KEY',
})

const DEFAULT_BASE = 'http://127.0.0.1:8799'
const SOURCES = new Set(['production', 'staging'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov'])
const MEDIA_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, '')
}

function extensionOf(key) {
  return key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : ''
}

export function validateMediaKey(value, label) {
  if (typeof value !== 'string' || !value.trim()) return `${label} is required`
  const key = value.trim()
  if (key.startsWith('/')) return `${label} must not start with a slash`
  if (/[\\?#]/.test(key)) return `${label} contains an unsafe character`
  const parts = key.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    return `${label} must be a safe media-relative key`
  }
  return null
}

function mediaPath(key) {
  return `/media/${key.split('/').map((part) => encodeURIComponent(part)).join('/')}`
}

function parseFlag(argv, name) {
  const prefix = `--${name}=`
  for (const item of argv) {
    if (item.startsWith(prefix)) return item.slice(prefix.length)
  }
  return null
}

export function validateSmokeOptions(options = {}) {
  const problems = []

  const base = options.base ?? DEFAULT_BASE
  if (typeof base !== 'string' || !base.trim()) {
    problems.push('base URL is required')
  } else {
    try {
      const parsed = new URL(base)
      if (!['http:', 'https:'].includes(parsed.protocol)) problems.push('base URL must use http or https')
      if (parsed.username || parsed.password) problems.push('base URL must not contain credentials')
      if (parsed.search || parsed.hash) problems.push('base URL must not contain a query string or fragment')
      if (parsed.pathname !== '/' && parsed.pathname !== '') problems.push('base URL must be an origin')
    } catch {
      problems.push('base URL is not a valid URL')
    }
  }

  const source = options.source ?? 'production'
  if (!SOURCES.has(source)) problems.push('source must be production or staging')

  const workId = options.workId
  if (!/^[1-9]\d*$/.test(String(workId ?? '')) || !Number.isSafeInteger(Number(workId))) {
    problems.push('workId must be an explicit positive safe integer')
  }

  for (const [field, label] of [
    ['mediaKey', 'mediaKey'],
    ['rangeKey', 'rangeKey'],
    ['missingKey', 'missingKey'],
  ]) {
    const problem = validateMediaKey(options[field], label)
    if (problem) problems.push(problem)
  }

  if (VIDEO_EXTENSIONS.has(extensionOf(String(options.rangeKey ?? ''))) === false) {
    problems.push('rangeKey must name a video object (.mp4, .webm, or .mov)')
  }
  if (options.missingKey && (options.missingKey === options.mediaKey || options.missingKey === options.rangeKey)) {
    problems.push('missingKey must be distinct from mediaKey and rangeKey')
  }

  return problems
}

export function parseSmokeOptions(argv = [], env = process.env) {
  const options = {
    base: argv.find((item) => !item.startsWith('--'))
      ?? parseFlag(argv, 'base')
      ?? env[SMOKE_INPUT_ENV.base]
      ?? DEFAULT_BASE,
    source: parseFlag(argv, 'source') ?? env[SMOKE_INPUT_ENV.source] ?? 'production',
    workId: parseFlag(argv, 'work-id') ?? env[SMOKE_INPUT_ENV.workId] ?? null,
    mediaKey: parseFlag(argv, 'media-key') ?? env[SMOKE_INPUT_ENV.mediaKey] ?? null,
    rangeKey: parseFlag(argv, 'range-key') ?? env[SMOKE_INPUT_ENV.rangeKey] ?? null,
    missingKey: parseFlag(argv, 'missing-media-key') ?? env[SMOKE_INPUT_ENV.missingKey] ?? null,
  }
  options.base = stripTrailingSlashes(String(options.base).trim())

  const unknown = argv.filter((item) => item.startsWith('--') && ![
    '--base', '--source', '--work-id', '--media-key', '--range-key', '--missing-media-key',
  ].some((name) => item === name || item.startsWith(`${name}=`)))
  const problems = [...unknown.map((item) => `unsupported argument ${item}`), ...validateSmokeOptions(options)]
  return { options, problems }
}

function jsonProblems(context) {
  if (!context.json) return ['response body is not valid JSON']
  return []
}

function requireStatus(status, allowed, label) {
  return allowed.includes(status) ? [] : [`expected ${label} status ${allowed.join(', ')}, got ${status}`]
}

function htmlProblems(context, marker, label) {
  if (!/text\/html/i.test(context.headers.get('content-type') ?? '')) {
    return [`${label} did not return text/html`]
  }
  if (!context.text.toLowerCase().includes(marker.toLowerCase())) {
    return [`${label} body did not contain "${marker}"`]
  }
  return []
}

function healthProblems(context, source) {
  const problems = jsonProblems(context)
  if (problems.length) return problems
  if (context.json.ok !== true) problems.push('health ok must be true')
  if (context.json.mode !== 'read-only') problems.push('health mode must be read-only')
  if (context.json.source !== source) problems.push(`health source must be ${source}`)
  if (!Number.isSafeInteger(Number(context.json.publishedWorks)) || Number(context.json.publishedWorks) < 0) {
    problems.push('health publishedWorks must be a non-negative integer')
  }
  return problems
}

function configProblems(context, source) {
  const problems = jsonProblems(context)
  if (problems.length) return problems
  if (context.json.defaultDatabase !== source) {
    problems.push(`public config defaultDatabase must be ${source}`)
  }
  return problems
}

function worksListProblems(context, source) {
  const problems = jsonProblems(context)
  if (problems.length) return problems
  if (!Array.isArray(context.json.works)) problems.push('works must be an array')
  if (context.json.source !== source) problems.push(`works source must be ${source}`)
  for (const [index, work] of (context.json.works ?? []).entries()) {
    if (!Number.isSafeInteger(Number(work?.id)) || Number(work?.id) <= 0) {
      problems.push(`works[${index}] has no valid id`)
    }
    if (typeof work?.title !== 'string' || !work.title.trim()) problems.push(`works[${index}] has no title`)
    if (work?.status !== 'published') problems.push(`works[${index}] is not published`)
  }
  return problems
}

function workDetailProblems(context, source, workId) {
  const problems = jsonProblems(context)
  if (problems.length) return problems
  if (context.json.source !== source) problems.push(`work source must be ${source}`)
  if (Number(context.json.work?.id) !== Number(workId)) problems.push(`work id must be ${workId}`)
  if (context.json.work?.status !== 'published') problems.push('work must be published')
  if (!Array.isArray(context.json.chapters)) problems.push('chapters must be an array')
  if (!Array.isArray(context.json.episodes)) problems.push('episodes must be an array')
  return problems
}

function sessionProblems(context) {
  const problems = jsonProblems(context)
  if (problems.length) return problems
  if (context.json.user !== null) problems.push('anonymous session must return user: null')
  return problems
}

function mediaProblems(context, key, expectedStatus) {
  const problems = requireStatus(context.status, [expectedStatus], 'media delivery')
  const expectedType = MEDIA_TYPES[extensionOf(key)] ?? 'application/octet-stream'
  if ((context.headers.get('content-type') ?? '') !== expectedType) {
    problems.push(`content-type must be ${expectedType}`)
  }
  if ((context.headers.get('cache-control') ?? '') !== 'public, max-age=31536000') {
    problems.push('B5 media response must use public cache-control')
  }
  return problems
}

function rangeProblems(context, key) {
  const problems = requireStatus(context.status, [206], 'video range')
  const contentRange = context.headers.get('content-range') ?? ''
  if (!/^bytes 2-5\/\d+$/.test(contentRange)) problems.push('Content-Range must cover bytes 2-5')
  if ((context.headers.get('content-length') ?? '') !== '4') problems.push('Content-Length must be 4')
  if ((context.headers.get('accept-ranges') ?? '') !== 'bytes') problems.push('Accept-Ranges must be bytes')
  const expectedType = MEDIA_TYPES[extensionOf(key)] ?? 'application/octet-stream'
  if ((context.headers.get('content-type') ?? '') !== expectedType) {
    problems.push(`content-type must be ${expectedType}`)
  }
  return problems
}

export function buildSmokePlan(options = {}) {
  const source = options.source ?? 'production'
  const workId = encodeURIComponent(String(options.workId))
  const mediaKey = String(options.mediaKey)
  const rangeKey = String(options.rangeKey)
  const missingKey = String(options.missingKey)

  return [
    {
      name: 'Worker health',
      path: '/api/public/health',
      expect: [200],
      validate: (context) => healthProblems(context, source),
    },
    {
      name: 'Deployment selectors',
      path: '/api/public/config',
      expect: [200],
      validate: (context) => configProblems(context, source),
    },
    { name: 'Application shell', path: '/', expect: [200], validate: (context) => htmlProblems(context, 'Lantern', 'home page') },
    { name: 'Discovery page', path: '/discover', expect: [200], validate: (context) => htmlProblems(context, 'Lantern', 'discovery page') },
    { name: 'Login page', path: '/login', expect: [200], validate: (context) => htmlProblems(context, 'Log In', 'login page') },
    { name: 'Verification page', path: '/verify-email', expect: [200], validate: (context) => htmlProblems(context, 'Verify', 'verification page') },
    // A raw GET renders the legacy page shell only. The invalid token is never
    // consumed by this request, so no email verification write is performed.
    {
      name: 'Legacy verification alias',
      path: '/verify/invalid-smoke-token',
      expect: [200, 302, 303, 307, 308, 400, 404],
    },
    {
      name: 'Public works API',
      path: '/api/public/works',
      expect: [200],
      validate: (context) => worksListProblems(context, source),
    },
    {
      name: 'Published work detail',
      path: `/api/public/works/${workId}`,
      expect: [200],
      validate: (context) => workDetailProblems(context, source, options.workId),
    },
    {
      name: 'Anonymous session state',
      path: '/api/auth/me',
      expect: [200],
      validate: sessionProblems,
    },
    { name: 'Logout parity', path: '/logout', expect: [405] },
    {
      name: 'Media delivery through approved origin',
      path: mediaPath(mediaKey),
      expect: [200],
      validate: (context) => mediaProblems(context, mediaKey, 200),
    },
    {
      name: 'Media video Range bytes=2-5',
      path: mediaPath(rangeKey),
      headers: { Range: 'bytes=2-5' },
      expect: [206],
      validate: (context) => rangeProblems(context, rangeKey),
    },
    {
      name: 'Missing media response',
      path: mediaPath(missingKey),
      expect: [404],
    },
    // GET-only probes. These labels deliberately do not claim POST protection:
    // a 405 here only shows that Nitro did not route a GET to the write handler.
    {
      name: 'Studio write route GET method guard (not POST protection)',
      path: '/api/studio/works',
      expect: [405, 404, 401],
    },
    {
      name: 'Login write route GET method guard (not POST protection)',
      path: '/api/auth/login',
      expect: [405, 404],
    },
  ]
}

export async function runSmokeChecks(options = {}) {
  const {
    base = DEFAULT_BASE,
    plan = buildSmokePlan(options),
    fetcher = globalThis.fetch,
    logger = () => {},
  } = options

  const results = []
  let failures = 0

  for (const check of plan) {
    const init = {
      method: 'GET',
      headers: { ...(check.headers ?? {}) },
      redirect: 'manual',
      credentials: 'omit',
    }
    try {
      const response = await fetcher(`${base}${check.path}`, init)
      const text = await response.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
      const context = { status: response.status, headers: response.headers, text, json }
      const problems = [...requireStatus(response.status, check.expect, 'check'), ...(check.validate?.(context) ?? [])]
      const ok = problems.length === 0
      if (!ok) failures++
      const detail = problems.length ? ` (${problems.join('; ')})` : ''
      logger(`${ok ? 'PASS' : 'FAIL'}  ${check.name}: ${response.status}${detail}`)
      results.push({ name: check.name, path: check.path, status: response.status, ok, problems })
    } catch (error) {
      failures++
      const message = error?.message ?? String(error)
      logger(`FAIL  ${check.name}: ${message}`)
      results.push({ name: check.name, path: check.path, status: null, ok: false, problems: [message] })
    }
  }

  return { ok: failures === 0, failures, results }
}

async function main() {
  const { options, problems } = parseSmokeOptions(process.argv.slice(2), process.env)
  if (problems.length) {
    console.error('Lantern A1 smoke check cannot start:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(2)
    return
  }

  const plan = buildSmokePlan(options)
  if (plan.some((check) => check.method && check.method !== 'GET')) {
    console.error('Lantern A1 smoke check refuses non-GET requests.')
    process.exit(2)
    return
  }

  console.log(`Lantern A1 smoke check against ${options.base}\n`)
  const result = await runSmokeChecks({
    base: options.base,
    plan,
    fetcher: globalThis.fetch,
    logger: console.log,
  })
  console.log(`\n${result.ok ? 'All required A1 smoke checks passed.' : `${result.failures} required check(s) failed.`}`)
  process.exit(result.ok ? 0 : 1)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Lantern A1 smoke check failed: ${error?.message ?? error}`)
    process.exit(2)
  })
}
