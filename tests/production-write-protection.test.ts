import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import registerHandler from '../server/api/auth/register.post'
import loginHandler from '../server/api/auth/login.post'
import verifyHandler from '../server/api/auth/verify.post'
import verifyLinkHandler from '../server/api/auth/verify.get'
import resetPasswordLinkHandler from '../server/api/auth/reset-password/[token].get'
import studioWorksHandler from '../server/api/studio/works.post'
import studioDeleteHandler from '../server/api/studio/works/[workId]/delete.post'
import studioVideoStartHandler from '../server/api/studio/works/[workId]/video-multipart/start.post'
import comicEpisodesHandler from '../server/api/comic/works/[workId]/episodes.post'
import discussionHandler from '../server/api/discussions/[kind]/[targetId].post'
import dashboardThumbnailHandler from '../server/api/dashboard/works/[id]/thumbnail.post'
import {
  PRODUCTION_WRITE_FLAG,
  assertProductionWritesEnabled,
  getAnonymousMutationDatabase,
  getAnonymousMutationTarget,
  getLoginMutationDatabase,
  getMutationDatabase,
  getMutationMediaBucket,
  isProductionWritesEnabled,
  resolveMutationTarget,
} from '../server/utils/lantern-writes'
import {
  parseJsonc,
  validateProductionConfig,
} from '../scripts/release-provenance.mjs'
import { callHandler } from './helpers/handler'
import { createFakeD1 } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { csrfHeaders, makeSession, testEnv, TEST_CSRF } from './helpers/session'

const DEFAULT_DISABLED_MESSAGE = 'Production writes are disabled in this environment.'
const GUARD_MARKERS = /\b(assertStudioWritable|assertComicWritable|assertProductionWritesEnabled|resolveMutationTarget|getMutationDatabase|getMutationMediaBucket|getAnonymousMutationDatabase|getAnonymousMutationTarget|getLoginMutationDatabase)\s*\(/
const MUTATION_SELECTORS = /\b(resolveMutationTarget|getMutationDatabase|getMutationMediaBucket|getAnonymousMutationDatabase|getAnonymousMutationTarget|getLoginMutationDatabase)\b/
const SQL_MUTATION = /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_][\w]*\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i
const STORAGE_MUTATION = /\.(?:put|delete|createMultipartUpload|resumeMultipartUpload)\s*\(/
const MUTATION_CALL = /\.(prepare|batch|put|delete|createMultipartUpload|resumeMultipartUpload)\s*\(/

function isRegexStart(source: string, index: number) {
  const before = source.slice(0, index).replace(/\s+$/, '')
  if (!before) return true
  const last = before[before.length - 1]
  if (/[\w$)]/.test(last)) {
    return /(?:return|case|throw|typeof|instanceof|in|of|new|delete|void|yield|await)$/.test(before)
  }
  return '(,=:[!&|?{};+-*%'.includes(last)
}

function stripComments(source: string) {
  let result = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      result += '  '
      index += 2
      while (index < source.length && source[index] !== '\n') {
        result += ' '
        index += 1
      }
      continue
    }

    if (char === '/' && next === '*') {
      result += '  '
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' '
        index += 1
      }
      if (index < source.length) {
        result += '  '
        index += 2
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      result += char
      index += 1
      while (index < source.length) {
        const current = source[index]
        result += current
        index += 1
        if (current === '\\') {
          if (index < source.length) {
            result += source[index]
            index += 1
          }
          continue
        }
        if (current === quote) break
      }
      continue
    }

    if (char === '/' && isRegexStart(source, index)) {
      result += char
      index += 1
      let inCharacterClass = false
      while (index < source.length) {
        const current = source[index]
        result += current
        index += 1
        if (current === '\\') {
          if (index < source.length) {
            result += source[index]
            index += 1
          }
          continue
        }
        if (current === '[') inCharacterClass = true
        else if (current === ']') inCharacterClass = false
        else if (current === '/' && !inCharacterClass) break
      }
      while (index < source.length && /[a-z]/i.test(source[index])) {
        result += source[index]
        index += 1
      }
      continue
    }

    result += char
    index += 1
  }
  return result
}

function hasGuardBeforeMutation(source: string) {
  const stripped = stripComments(source)
  const guardIndex = stripped.search(GUARD_MARKERS)
  const mutationIndex = stripped.search(MUTATION_CALL)
  return guardIndex >= 0 && (mutationIndex < 0 || guardIndex < mutationIndex)
}

function withCsrf(body: Record<string, unknown> = {}) {
  return { ...body, csrfToken: TEST_CSRF }
}

function trackedD1() {
  const db = createFakeD1({
    users: [{
      id: 1,
      username: 'owner',
      email: 'owner@example.com',
      password_hash: 'pbkdf2-sha256-custom:100000$c2FsdA$aGFzaA',
      display_name: 'Owner',
      email_verified: 1,
    }],
    works: [
      { id: 1, creator_id: 1, title: 'Novel', description: '', type: 'Novel', status: 'draft', cover: null, video_path: null },
      { id: 2, creator_id: 1, title: 'Comic', description: '', type: 'Comic', status: 'draft', cover: null, video_path: null },
      { id: 3, creator_id: 1, title: 'Video', description: '', type: 'Video', status: 'draft', cover: null, video_path: null },
    ],
  })
  return { db, prepare: vi.spyOn(db, 'prepare'), batch: vi.spyOn(db, 'batch') }
}

type TrackedD1 = ReturnType<typeof trackedD1>
type TrackedR2 = ReturnType<typeof createFakeR2>

function setupEnv() {
  const productionDb = trackedD1()
  const stagingDb = trackedD1()
  const productionMedia = createFakeR2()
  const stagingMedia = createFakeR2()
  const env = {
    ...testEnv(productionDb.db, stagingDb.db, stagingMedia, productionMedia),
    LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
    LANTERN_PUBLIC_READ_DATABASE: 'production',
  }
  return { env, productionDb, stagingDb, productionMedia, stagingMedia }
}

function eventFor(env: Record<string, any>) {
  return { context: { cloudflare: { env } } }
}

function anonymousHeaders() {
  return {
    cookie: `lantern_nuxt_csrf=${TEST_CSRF}`,
    'cf-connecting-ip': 'write-protection-test',
  }
}

function expectBlocked(action: () => unknown, message: string) {
  try {
    action()
  } catch (error: any) {
    expect(error.statusCode).toBe(409)
    expect(error.statusMessage).toBe(message)
    return
  }
  throw new Error(`Expected production write guard to reject with: ${message}`)
}

function expectNoDatabaseCalls(db: TrackedD1) {
  expect(db.prepare).not.toHaveBeenCalled()
  expect(db.batch).not.toHaveBeenCalled()
}

function expectNoStorageCalls(bucket: TrackedR2) {
  expect(bucket.put).not.toHaveBeenCalled()
  expect(bucket.delete).not.toHaveBeenCalled()
  expect(bucket.get).not.toHaveBeenCalled()
  expect(bucket.head).not.toHaveBeenCalled()
  expect(bucket.createMultipartUpload).not.toHaveBeenCalled()
  expect(bucket.resumeMultipartUpload).not.toHaveBeenCalled()
  expect(bucket.objects.size).toBe(0)
  expect(bucket.deleted).toEqual([])
  expect(bucket.aborted).toEqual([])
}

function collectPersistentWriteHandlers(directory: string, output: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectPersistentWriteHandlers(fullPath, output)
    } else if (entry.name.endsWith('.ts')) {
      const source = readFileSync(fullPath, 'utf8')
      const persistent = SQL_MUTATION.test(source)
        || STORAGE_MUTATION.test(source)
        || MUTATION_SELECTORS.test(source)
      if (persistent) output.push(fullPath)
    }
  }
  return output
}

type WriteCase = {
  name: string
  handler: any
  body: Record<string, unknown>
  method?: string
  params?: Record<string, string>
  path?: string
  authenticated?: boolean
  expectedMessage: string
}

const WRITE_CASES: WriteCase[] = [
  {
    name: 'POST /api/auth/register',
    handler: registerHandler,
    body: withCsrf({
      username: 'new-user',
      email: 'new-user@example.com',
      password: 'correct horse battery staple',
      confirmPassword: 'correct horse battery staple',
    }),
    expectedMessage: DEFAULT_DISABLED_MESSAGE,
  },
  {
    name: 'POST /api/auth/login',
    handler: loginHandler,
    body: withCsrf({ email: 'owner@example.com', password: 'correct horse battery staple' }),
    expectedMessage: 'Production accounts are read-only in this Nuxt staging build.',
  },
  {
    name: 'POST /api/auth/verify',
    handler: verifyHandler,
    body: withCsrf({ token: 'smoke-token' }),
    expectedMessage: DEFAULT_DISABLED_MESSAGE,
  },
  {
    name: 'GET /api/auth/verify',
    handler: verifyLinkHandler,
    body: {},
    method: 'GET',
    path: '/api/test?token=smoke-token',
    expectedMessage: DEFAULT_DISABLED_MESSAGE,
  },
  {
    name: 'GET /api/auth/reset-password/:token',
    handler: resetPasswordLinkHandler,
    body: {},
    method: 'GET',
    params: { token: 'a'.repeat(32) },
    expectedMessage: DEFAULT_DISABLED_MESSAGE,
  },
  {
    name: 'POST /api/studio/works',
    handler: studioWorksHandler,
    body: withCsrf({ type: 'novel', title: 'Uncreated work', description: '' }),
    authenticated: true,
    expectedMessage: 'Production content is read-only in this Nuxt staging build.',
  },
  {
    name: 'POST /api/studio/works/:workId/delete',
    handler: studioDeleteHandler,
    body: withCsrf(),
    params: { workId: '1' },
    authenticated: true,
    expectedMessage: 'Production content is read-only in this Nuxt staging build.',
  },
  {
    name: 'POST /api/studio/works/:workId/video-multipart/start',
    handler: studioVideoStartHandler,
    body: withCsrf({ extension: 'mp4', size: '1024' }),
    params: { workId: '3' },
    authenticated: true,
    expectedMessage: 'Production content is read-only in this Nuxt staging build.',
  },
  {
    name: 'POST /api/comic/works/:workId/episodes',
    handler: comicEpisodesHandler,
    body: withCsrf({ title: 'Uncreated episode' }),
    params: { workId: '2' },
    authenticated: true,
    expectedMessage: 'Production comics are read-only in this Nuxt staging build.',
  },
  {
    name: 'POST /api/discussions/:kind/:targetId',
    handler: discussionHandler,
    body: withCsrf({ body: 'Uncreated comment' }),
    params: { kind: 'work', targetId: '1' },
    authenticated: true,
    expectedMessage: 'Production content is read-only in this Nuxt staging build.',
  },
  {
    name: 'POST /api/dashboard/works/:id/thumbnail',
    handler: dashboardThumbnailHandler,
    body: withCsrf({ mode: 'remove' }),
    params: { id: '1' },
    authenticated: true,
    expectedMessage: 'Production works are read-only in staging.',
  },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('production write guard', () => {
  it('enables production writes only for explicit true values', () => {
    const { env } = setupEnv()
    expect(isProductionWritesEnabled(eventFor(env))).toBe(false)

    for (const value of [false, 'false', 1, 'TRUE', 'yes', '']) {
      expect(isProductionWritesEnabled(eventFor({ ...env, [PRODUCTION_WRITE_FLAG]: value }))).toBe(false)
    }
    expect(isProductionWritesEnabled(eventFor({ ...env, [PRODUCTION_WRITE_FLAG]: true }))).toBe(true)
    expect(isProductionWritesEnabled(eventFor({ ...env, [PRODUCTION_WRITE_FLAG]: 'true' }))).toBe(true)
  })

  it('rejects every production mutation selector before touching D1 or R2', () => {
    const { env, productionDb, stagingDb, productionMedia, stagingMedia } = setupEnv()
    const event = eventFor(env)

    expectBlocked(() => assertProductionWritesEnabled(event), DEFAULT_DISABLED_MESSAGE)
    expectBlocked(() => getMutationDatabase(event, 'production'), DEFAULT_DISABLED_MESSAGE)
    expectBlocked(() => getMutationMediaBucket(event, 'production'), DEFAULT_DISABLED_MESSAGE)
    expectBlocked(() => resolveMutationTarget(event, 'production'), DEFAULT_DISABLED_MESSAGE)
    expectBlocked(() => getAnonymousMutationDatabase(event), DEFAULT_DISABLED_MESSAGE)
    expectBlocked(() => getAnonymousMutationTarget(event), DEFAULT_DISABLED_MESSAGE)
    expectBlocked(
      () => getLoginMutationDatabase(event, undefined),
      'Production accounts are read-only in this Nuxt staging build.',
    )

    expectNoDatabaseCalls(productionDb)
    expectNoDatabaseCalls(stagingDb)
    expectNoStorageCalls(productionMedia)
    expectNoStorageCalls(stagingMedia)
  })

  it.each(WRITE_CASES)('$name blocks before any side effect', async (writeCase) => {
    const { env, productionDb, stagingDb, productionMedia, stagingMedia } = setupEnv()
    const session = writeCase.authenticated
      ? await makeSession(1, 'production', env)
      : null
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected network side effect during a blocked write')
    })

    const result = await callHandler(writeCase.handler, {
      env,
      method: writeCase.method ?? 'POST',
      path: writeCase.path,
      body: writeCase.body,
      params: writeCase.params ?? {},
      headers: session ? csrfHeaders(session) : anonymousHeaders(),
    })

    expect(result.status).toBe(409)
    expect(result.json.statusMessage).toBe(writeCase.expectedMessage)
    expectNoDatabaseCalls(productionDb)
    expectNoDatabaseCalls(stagingDb)
    expectNoStorageCalls(productionMedia)
    expectNoStorageCalls(stagingMedia)
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not count an import or a commented-out guard as a guard invocation', () => {
    const source = `
import { assertProductionWritesEnabled } from '../utils/lantern-writes'
// assertProductionWritesEnabled(event)
/* assertProductionWritesEnabled(event) */
export default async () => {
  await db.prepare('INSERT INTO users (id) VALUES (1)').run()
}
`
    expect(hasGuardBeforeMutation(source)).toBe(false)
  })

  it('recognizes an actual guard invocation before a mutation', () => {
    const source = `
import { assertProductionWritesEnabled } from '../utils/lantern-writes'
export default async () => {
  assertProductionWritesEnabled(event)
  await db.prepare('INSERT INTO users (id) VALUES (1)').run()
}
`
    expect(hasGuardBeforeMutation(source)).toBe(true)
  })

  it('routes every persistent write handler through a guard before mutation', () => {
    const apiRoot = path.resolve(process.cwd(), 'server/api')
    const files = collectPersistentWriteHandlers(apiRoot)
    expect(files.length).toBeGreaterThan(30)
    expect(files).toContain(path.join(apiRoot, 'auth', 'verify.get.ts'))
    expect(files).toContain(path.join(apiRoot, 'auth', 'reset-password', '[token].get.ts'))

    const unguarded: string[] = []
    for (const file of files) {
      const relative = path.relative(process.cwd(), file)
      const source = readFileSync(file, 'utf8')
      if (!hasGuardBeforeMutation(source)) unguarded.push(relative)
    }
    expect(unguarded).toEqual([])
  })

  it('keeps the approved A1 release config free of production write enablement', () => {
    const config = parseJsonc(readFileSync(path.resolve(process.cwd(), 'wrangler.release.jsonc'), 'utf8'))
    expect(config.vars).not.toHaveProperty(PRODUCTION_WRITE_FLAG)
    expect(config.vars).toMatchObject({
      LANTERN_ANONYMOUS_WRITE_DATABASE: 'production',
      LANTERN_PUBLIC_READ_DATABASE: 'production',
    })
    expect(validateProductionConfig(process.cwd())).toEqual([])
  })
})
