import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSmokePlan,
  parseSmokeOptions,
  runSmokeChecks,
  validateMediaKey,
} from '../scripts/smoke-check.mjs'
import {
  parseJsonc,
  validateProductionConfig,
} from '../scripts/release-provenance.mjs'

const VALID_ENV = {
  LANTERN_SMOKE_BASE_URL: 'https://lantern.example.test',
  LANTERN_SMOKE_SOURCE: 'production',
  LANTERN_SMOKE_WORK_ID: '42',
  LANTERN_SMOKE_MEDIA_KEY: 'uploads/covers/42/cover.png',
  LANTERN_SMOKE_RANGE_KEY: 'uploads/videos/42/video.mp4',
  LANTERN_SMOKE_MISSING_MEDIA_KEY: 'smoke/missing-object',
}

const VALID_OPTIONS = {
  base: 'https://lantern.example.test',
  source: 'production',
  workId: '42',
  mediaKey: 'uploads/covers/42/cover.png',
  rangeKey: 'uploads/videos/42/video.mp4',
  missingKey: 'smoke/missing-object',
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function html(marker: string, status = 200) {
  return new Response(`<html><body>${marker}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function defaultResponse(pathname: string, range: string | undefined) {
  if (pathname === '/api/public/health') {
    return json({ ok: true, publishedWorks: 3, mode: 'read-only', source: 'production' })
  }
  if (pathname === '/api/public/config') return json({ defaultDatabase: 'production' })
  if (pathname === '/') return html('Lantern')
  if (pathname === '/discover') return html('Discover Lantern')
  if (pathname === '/login') return html('Log In')
  if (pathname === '/verify-email') return html('Verify Email')
  if (pathname === '/verify/invalid-smoke-token') return html('Verifying')
  if (pathname === '/api/public/works') {
    return json({
      works: [{ id: 42, title: 'Published example', type: 'Novel', status: 'published' }],
      source: 'production',
    })
  }
  if (pathname === '/api/public/works/42') {
    return json({
      work: { id: 42, title: 'Published example', status: 'published' },
      chapters: [],
      episodes: [],
      source: 'production',
    })
  }
  if (pathname === '/api/auth/me') return json({ user: null })
  if (pathname === '/logout') return new Response('Method Not Allowed', { status: 405 })
  if (pathname === '/media/uploads/covers/42/cover.png') {
    return new Response('image-bytes', {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000',
      },
    })
  }
  if (pathname === '/media/uploads/videos/42/video.mp4') {
    if (range === 'bytes=2-5') {
      return new Response('cdef', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'cache-control': 'public, max-age=31536000',
          'content-range': 'bytes 2-5/10',
          'content-length': '4',
          'accept-ranges': 'bytes',
        },
      })
    }
    return new Response('video-bytes', {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'cache-control': 'public, max-age=31536000',
      },
    })
  }
  if (pathname === '/media/smoke/missing-object') return new Response('Not Found', { status: 404 })
  if (pathname === '/api/studio/works') return new Response('Method Not Allowed', { status: 405 })
  if (pathname === '/api/auth/login') return new Response('Method Not Allowed', { status: 405 })
  throw new Error(`unexpected smoke request ${pathname}`)
}

function runner(overrides: Record<string, Response | Error> = {}) {
  const calls: Array<{ url: string; init: any }> = []
  const fetcher = async (url: string, init: any) => {
    calls.push({ url, init })
    const pathname = new URL(url).pathname
    const override = overrides[pathname]
    if (override instanceof Error) throw override
    if (override) return override
    return defaultResponse(pathname, init?.headers?.Range)
  }
  return { calls, fetcher }
}

describe('A1 production smoke checks', () => {
  it('requires explicit data-dependent inputs before any request is made', () => {
    const { problems } = parseSmokeOptions([], {})
    expect(problems).toEqual(expect.arrayContaining([
      'workId must be an explicit positive safe integer',
      'mediaKey is required',
      'rangeKey is required',
      'missingKey is required',
    ]))
  })

  it('rejects invented, unsafe, or ambiguous inputs', () => {
    const { problems } = parseSmokeOptions([], {
      LANTERN_SMOKE_BASE_URL: 'https://user:pass@lantern.example.test',
      LANTERN_SMOKE_WORK_ID: '0',
      LANTERN_SMOKE_MEDIA_KEY: '../secret.png',
      LANTERN_SMOKE_RANGE_KEY: 'uploads/covers/42/cover.png',
      LANTERN_SMOKE_MISSING_MEDIA_KEY: 'uploads/covers/42/cover.png',
    })
    expect(problems).toEqual(expect.arrayContaining([
      'base URL must not contain credentials',
      'workId must be an explicit positive safe integer',
      'mediaKey must be a safe media-relative key',
      'rangeKey must name a video object (.mp4, .webm, or .mov)',
      'missingKey must be distinct from mediaKey and rangeKey',
    ]))
    expect(validateMediaKey('/media/cover.png', 'mediaKey')).toBe('mediaKey must not start with a slash')
  })

  it('builds a complete read-only GET plan', () => {
    const plan = buildSmokePlan(VALID_OPTIONS)
    const names = plan.map((check) => check.name)
    expect(names).toEqual(expect.arrayContaining([
      'Worker health',
      'Deployment selectors',
      'Application shell',
      'Discovery page',
      'Login page',
      'Verification page',
      'Legacy verification alias',
      'Public works API',
      'Published work detail',
      'Anonymous session state',
      'Media delivery through approved origin',
      'Media video Range bytes=2-5',
      'Missing media response',
      'Studio write route GET method guard (not POST protection)',
      'Login write route GET method guard (not POST protection)',
    ]))
    expect(plan.every((check) => !check.method || check.method === 'GET')).toBe(true)
    expect(plan.find((check) => check.name === 'Media video Range bytes=2-5')?.headers).toEqual({ Range: 'bytes=2-5' })

    const source = readFileSync(path.resolve(process.cwd(), 'scripts/smoke-check.mjs'), 'utf8')
    expect(source).toContain("method: 'GET'")
    expect(source).not.toMatch(/method: ['"](POST|PUT|PATCH|DELETE)['"]/)
  })

  it('passes with mocked read-only responses and records actual outputs', async () => {
    const { calls, fetcher } = runner()
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })

    expect(result.ok).toBe(true)
    expect(result.failures).toBe(0)
    expect(result.results).toHaveLength(16)
    expect(calls).toHaveLength(16)
    expect(calls.every((call) => call.init.method === 'GET')).toBe(true)
    expect(calls.every((call) => call.init.credentials === 'omit')).toBe(true)
    expect(calls.every((call) => call.init.redirect === 'manual')).toBe(true)
    expect(calls.some((call) => String(call.init.headers.cookie ?? '').length > 0)).toBe(false)
    expect(calls.find((call) => call.init.headers.Range)?.init.headers).toEqual({ Range: 'bytes=2-5' })
    expect(new URL(calls.find((call) => call.url.includes('/works/42'))!.url).pathname).toBe('/api/public/works/42')
    expect(calls.filter((call) => new URL(call.url).pathname.startsWith('/media/'))).toHaveLength(3)
    expect(result.results.every((item) => item.ok)).toBe(true)
  })

  it('fails when health reports the wrong content source', async () => {
    const { fetcher } = runner({
      '/api/public/health': json({ ok: true, publishedWorks: 1, mode: 'read-only', source: 'staging' }),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    expect(result.ok).toBe(false)
    expect(result.results[0]!.problems.join(' ')).toContain('health source must be production')
  })

  it('fails when anonymous session returns a user', async () => {
    const { fetcher } = runner({
      '/api/auth/me': json({ user: { id: 7, username: 'someone' } }),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    const session = result.results.find((item) => item.name === 'Anonymous session state')
    expect(session?.ok).toBe(false)
    expect(session?.problems.join(' ')).toContain('anonymous session must return user: null')
  })

  it('fails when published work detail is not published', async () => {
    const { fetcher } = runner({
      '/api/public/works/42': json({
        work: { id: 42, status: 'draft' },
        chapters: [],
        episodes: [],
        source: 'production',
      }),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    const detail = result.results.find((item) => item.name === 'Published work detail')
    expect(detail?.ok).toBe(false)
    expect(detail?.problems.join(' ')).toContain('work must be published')
  })

  it('fails when media is not served through the approved B5 path', async () => {
    const { fetcher } = runner({
      '/media/uploads/covers/42/cover.png': new Response('image-bytes', {
        status: 200,
        headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' },
      }),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    const media = result.results.find((item) => item.name === 'Media delivery through approved origin')
    expect(media?.ok).toBe(false)
    expect(media?.problems.join(' ')).toContain('B5 media response must use public cache-control')
  })

  it('fails when the video Range response is incomplete', async () => {
    const { fetcher } = runner({
      '/media/uploads/videos/42/video.mp4': new Response('cdef', {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 2-5/10' },
      }),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    const range = result.results.find((item) => item.name === 'Media video Range bytes=2-5')
    expect(range?.ok).toBe(false)
    expect(range?.problems.join(' ')).toContain('Content-Length must be 4')
    expect(range?.problems.join(' ')).toContain('Accept-Ranges must be bytes')
  })

  it('fails when a missing media key unexpectedly resolves', async () => {
    const { fetcher } = runner({
      '/media/smoke/missing-object': new Response('unexpected', { status: 200 }),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    const missing = result.results.find((item) => item.name === 'Missing media response')
    expect(missing?.ok).toBe(false)
    expect(missing?.status).toBe(200)
  })

  it('fails when a write route accepts a read-only GET', async () => {
    const { fetcher } = runner({
      '/api/studio/works': json({ ok: true }, 200),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    const writeRoute = result.results.find((item) => item.name === 'Studio write route GET method guard (not POST protection)')
    expect(writeRoute?.ok).toBe(false)
    expect(writeRoute?.problems.join(' ')).toContain('expected check status 405, 404, 401, got 200')
  })

  it('fails closed on a network error without throwing', async () => {
    const { fetcher, calls } = runner({
      '/api/public/health': new Error('network unavailable'),
    })
    const result = await runSmokeChecks({ ...VALID_OPTIONS, fetcher, logger: () => {} })
    expect(result.ok).toBe(false)
    expect(result.results[0]!.problems).toEqual(['network unavailable'])
    expect(calls).toHaveLength(16)
  })

  it('keeps the approved A1 config free of production write enablement', () => {
    const config = parseJsonc(readFileSync(path.resolve(process.cwd(), 'wrangler.release.jsonc'), 'utf8'))
    expect(config.vars).not.toHaveProperty('LANTERN_ENABLE_PRODUCTION_WRITES')
    expect(config.vars).toMatchObject({
      LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
      LANTERN_PUBLIC_READ_DATABASE: 'production',
    })
    expect(validateProductionConfig(process.cwd())).toEqual([])
  })
})
