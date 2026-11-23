import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

import registerHandler from '../server/api/auth/register.post'
import loginHandler from '../server/api/auth/login.post'
import logoutHandler from '../server/api/auth/logout.post'
import forgotHandler from '../server/api/auth/forgot-password.post'
import resendHandler from '../server/api/auth/resend-verification.post'
import resetHandler from '../server/api/auth/reset-password/[token].post'
import verifyHandler from '../server/api/auth/verify.post'
import verifyGetHandler from '../server/api/auth/verify.get'

import studioWorkCreate from '../server/api/studio/works.post'
import studioWorkUpdate from '../server/api/studio/works/[workId].put'
import studioChapterCreate from '../server/api/studio/works/[workId]/chapters.post'
import studioChapterUpdate from '../server/api/studio/chapters/[chapterId].put'
import studioAutosave from '../server/api/studio/chapters/[chapterId]/autosave.post'
import studioProfile from '../server/api/studio/profile.put'
import studioWorkDelete from '../server/api/studio/works/[workId]/delete.post'
import studioNovelPublish from '../server/api/studio/works/[workId]/novel/publish.post'
import studioVideoPublish from '../server/api/studio/works/[workId]/video/publish.post'
import studioThumbnailDirect from '../server/api/studio/works/[workId]/thumbnail-direct.put'
import studioVideoDirect from '../server/api/studio/works/[workId]/video-direct.put'
import studioUploadStart from '../server/api/studio/works/[workId]/video-multipart/start.post'
import studioUploadPart from '../server/api/studio/works/[workId]/video-multipart/part.put'
import studioUploadComplete from '../server/api/studio/works/[workId]/video-multipart/complete.post'
import studioUploadAbort from '../server/api/studio/works/[workId]/video-multipart/abort.post'

import comicEpisodeUpdate from '../server/api/comic/episodes/[episodeId].put'
import comicPageUpload from '../server/api/comic/episodes/[episodeId]/pages.put'
import comicEpisodePublish from '../server/api/comic/episodes/[episodeId]/publish.post'
import comicWorkPublish from '../server/api/comic/works/[workId]/publish.post'
import comicEpisodeCreate from '../server/api/comic/works/[workId]/episodes.post'
import comicPageDelete from '../server/api/comic/pages/[pageId]/delete.post'

import dashboardWorkDelete from '../server/api/dashboard/works/[id]/delete.post'
import dashboardThumbnail from '../server/api/dashboard/works/[id]/thumbnail.post'
import dashboardThumbnailPut from '../server/api/dashboard/works/[id]/thumbnail.put'

import discussionPost from '../server/api/discussions/[kind]/[targetId].post'
import discussionAction from '../server/api/discussions/[kind]/[targetId]/[commentId]/[action].post'

import { callHandler } from './helpers/handler'
import { createFakeD1, type FakeD1, type FakeWork } from './helpers/fake-d1'
import { createFakeR2 } from './helpers/fake-r2'
import { csrfHeaders, makeSession, TEST_CSRF, TEST_SECRET, testEnv } from './helpers/session'
import { combineTripwires, tripwireD1, tripwireR2, type Tripwire } from './helpers/write-tripwire'
import { createLanternPasswordHash, hashLanternVerificationToken } from '../server/utils/lantern-auth'
import { PRODUCTION_WRITE_FLAG } from '../server/utils/lantern-writes'

const USER_ID = 7
const WORK_ID = 10
const VIDEO_WORK_ID = 12
const COMIC_WORK_ID = 13
const CHAPTER_ID = 20
const EPISODE_ID = 30
const PAGE_ID = 40
const COMMENT_ID = 50
const NOW = '2026-01-01T00:00:00.000Z'
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const VIDEO_KEY = `uploads/videos/${VIDEO_WORK_ID}/video-0123456789abcdef01234567.mp4`
const PAGE_KEY = `uploads/comics/${COMIC_WORK_ID}/${EPISODE_ID}/page-1.png`
const OLD_COVER_KEY = `uploads/covers/${WORK_ID}/old.png`

type Category = 'creator' | 'account'
type Signal = 'db' | 'r2' | 'either' | 'none'

type Fixture = {
  production: FakeD1
  staging: FakeD1
  productionMedia: any
  stagingMedia: any
}

type MutationCase = {
  id: string
  file: string
  category: Category
  handler: any
  method: 'POST' | 'PUT' | 'GET'
  status: number
  signal: Signal
  params?: Record<string, string>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  rawBody?: string | Uint8Array
  path?: string
  /** Creator handlers: resources are seeded into both D1 databases before arming tripwires. */
  resources?: (db: FakeD1, bucket: any, userId: number) => void
  /** Account handlers: custom per-database state used to prove the write target. */
  seed?: (fixture: Fixture) => void | Promise<void>
  /** Extra per-case assertion after a successful staging invocation. */
  assertStaging?: (fixture: Fixture, result: any) => void
}

let validHash = ''

const makeWork = (overrides: Partial<FakeWork> = {}): FakeWork => ({
  id: WORK_ID,
  creator_id: USER_ID,
  title: 'Isolation work',
  description: '',
  type: 'Novel',
  status: 'draft',
  cover: null,
  video_path: null,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

const seedMultipart = (bucket: any, key: string, withPart = false) => {
  bucket.uploads.set('upload-1', {
    key,
    uploadId: 'upload-1',
    httpMetadata: { contentType: 'video/mp4' },
    parts: withPart ? new Map([[1, new TextEncoder().encode('video')]]) : new Map(),
  })
}

function creatorCase(definition: Omit<MutationCase, 'category'>): MutationCase {
  return { ...definition, category: 'creator' }
}

function accountCase(definition: Omit<MutationCase, 'category'>): MutationCase {
  return { ...definition, category: 'account' }
}

/**
 * The complete mutation-handler matrix. Add every new server/api POST, PUT,
 * PATCH, or DELETE handler here; the registration test below fails otherwise.
 * The state-changing GET route auth/verify.get.ts is registered explicitly via
 * EXPLICIT_GET_MUTATIONS and is not a blanket GET inclusion.
 *
 * The original tree contains 33 method-suffixed handlers (26 creator + 7
 * account), including auth/logout.post.ts, which clears a session cookie
 * without writing D1 or R2. The canonical Flask email-verification GET link is
 * an additional mutation route, for 34 registered mutation handlers total.
 */
export const MUTATION_MATRIX: MutationCase[] = [
  // ---------------------------------------------------------------- auth (7)
  accountCase({
    id: 'auth-register',
    file: 'auth/register.post.ts',
    handler: registerHandler,
    method: 'POST',
    status: 200,
    signal: 'db',
    body: {
      username: 'isolation-user',
      email: 'isolation-register@example.com',
      password: 'correct horse battery staple',
      confirmPassword: 'correct horse battery staple',
      csrfToken: TEST_CSRF,
    },
    seed: ({ production }) => {
      production.state.users.push({
        id: 99, username: 'production-only', email: 'production-only@example.com',
        password_hash: validHash, display_name: 'Production only', email_verified: 1,
      })
    },
    assertStaging: ({ production, staging }) => {
      expect(staging.state.users.some((user) => user.email === 'isolation-register@example.com')).toBe(true)
      expect(production.state.users.some((user) => user.email === 'isolation-register@example.com')).toBe(false)
      expect(staging.state.emailTokens.length).toBeGreaterThan(0)
    },
  }),
  accountCase({
    id: 'auth-login',
    file: 'auth/login.post.ts',
    handler: loginHandler,
    method: 'POST',
    status: 200,
    signal: 'db', // durable rate-limit counter lives in staging D1
    body: {
      email: 'author@example.com',
      password: 'correct horse battery staple',
      database: 'staging',
      csrfToken: TEST_CSRF,
    },
    seed: ({ production }) => {
      // Wrong hash in production proves the login read the staging database.
      production.state.users[0]!.password_hash = 'scrypt:not-a-valid-login'
    },
    assertStaging: ({ production, staging }) => {
      expect(staging.state.rateLimits.length).toBeGreaterThan(0)
      expect(production.state.rateLimits).toHaveLength(0)
      expect(production.state.users[0]!.password_hash).toBe('scrypt:not-a-valid-login')
    },
  }),
  accountCase({
    id: 'auth-logout',
    file: 'auth/logout.post.ts',
    handler: logoutHandler,
    method: 'POST',
    status: 200,
    signal: 'none',
    body: { csrfToken: TEST_CSRF },
  }),
  accountCase({
    id: 'auth-forgot-password',
    file: 'auth/forgot-password.post.ts',
    handler: forgotHandler,
    method: 'POST',
    status: 200,
    signal: 'db',
    body: { email: 'author@example.com', csrfToken: TEST_CSRF },
    seed: ({ production, staging }) => {
      production.state.users[0]!.email = 'author@example.com'
      staging.state.users[0]!.email = 'author@example.com'
    },
    assertStaging: ({ production, staging }) => {
      expect(staging.state.emailTokens.some((token) => token.token_type === 'password_reset')).toBe(true)
      expect(production.state.emailTokens).toHaveLength(0)
    },
  }),
  accountCase({
    id: 'auth-resend-verification',
    file: 'auth/resend-verification.post.ts',
    handler: resendHandler,
    method: 'POST',
    status: 200,
    signal: 'db',
    body: { email: 'author@example.com', csrfToken: TEST_CSRF },
    seed: ({ production, staging }) => {
      production.state.users[0]!.email = 'author@example.com'
      production.state.users[0]!.email_verified = 0
      staging.state.users[0]!.email = 'author@example.com'
      staging.state.users[0]!.email_verified = 0
      staging.state.emailTokens.push({
        id: 1, user_id: USER_ID, token_hash: 'old-verification-hash',
        token_type: 'email_verification', expires_at: FUTURE, used: 0, created_at: NOW,
      })
    },
    assertStaging: ({ production, staging }) => {
      expect(staging.state.emailTokens.some((token) => token.token_type === 'email_verification' && token.used === 0 && token.token_hash !== 'old-verification-hash')).toBe(true)
      expect(production.state.emailTokens).toHaveLength(0)
    },
  }),
  accountCase({
    id: 'auth-reset-password',
    file: 'auth/reset-password/[token].post.ts',
    handler: resetHandler,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { token: 'isolation-reset-token' },
    body: {
      password: 'a brand new password',
      confirm_password: 'a brand new password',
      csrfToken: TEST_CSRF,
    },
    seed: ({ staging }) => {
      staging.state.emailTokens.push({
        id: 1, user_id: USER_ID, token_hash: 'unused',
        token_type: 'password_reset', expires_at: FUTURE, used: 0, created_at: NOW,
      })
    },
    // The handler hashes the supplied token before lookup; seed the hashed
    // value instead of the raw token for this case.
    assertStaging: ({ staging }) => {
      expect(staging.state.users[0]!.password_hash).not.toBe(validHash)
      expect(staging.state.emailTokens.some((token) => token.token_type === 'password_reset' && token.used === 1)).toBe(true)
    },
  }),
  accountCase({
    id: 'auth-verify-email',
    file: 'auth/verify.post.ts',
    handler: verifyHandler,
    method: 'POST',
    status: 200,
    signal: 'db',
    body: { token: 'isolation-verify-token', csrfToken: TEST_CSRF },
    seed: ({ production, staging }) => {
      production.state.users[0]!.email_verified = 0
      staging.state.users[0]!.email_verified = 0
    },
    assertStaging: ({ production, staging }) => {
      expect(staging.state.users[0]!.email_verified).toBe(1)
      expect(production.state.users[0]!.email_verified).toBe(0)
    },
  }),
  accountCase({
    id: 'auth-verify-email-get',
    file: 'auth/verify.get.ts',
    handler: verifyGetHandler,
    method: 'GET',
    status: 200,
    signal: 'db',
    path: '/api/test?token=isolation-verify-token',
    seed: ({ production, staging }) => {
      production.state.users[0]!.email_verified = 0
      staging.state.users[0]!.email_verified = 0
    },
    assertStaging: ({ production, staging }) => {
      expect(staging.state.users[0]!.email_verified).toBe(1)
      expect(production.state.users[0]!.email_verified).toBe(0)
    },
  }),

  // ------------------------------------------------ studio / novel / video (15)
  creatorCase({
    id: 'studio-work-create',
    file: 'studio/works.post.ts',
    handler: studioWorkCreate,
    method: 'POST',
    status: 200,
    signal: 'db',
    body: { title: 'Isolation work', description: '', type: 'novel', csrfToken: TEST_CSRF },
  }),
  creatorCase({
    id: 'studio-work-update',
    file: 'studio/works/[workId].put.ts',
    handler: studioWorkUpdate,
    method: 'PUT',
    status: 200,
    signal: 'db',
    params: { workId: String(WORK_ID) },
    body: { title: 'Renamed isolation work', description: 'Updated', csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork()) },
  }),
  creatorCase({
    id: 'studio-chapter-create',
    file: 'studio/works/[workId]/chapters.post.ts',
    handler: studioChapterCreate,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { workId: String(WORK_ID) },
    body: { title: 'Chapter one', content: 'Chapter body', csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork({ type: 'Novel' })) },
  }),
  creatorCase({
    id: 'studio-chapter-update',
    file: 'studio/chapters/[chapterId].put.ts',
    handler: studioChapterUpdate,
    method: 'PUT',
    status: 200,
    signal: 'db',
    params: { chapterId: String(CHAPTER_ID) },
    body: { title: 'Edited chapter', content: 'Edited body', csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ type: 'Novel' }))
      db.state.chapters.push({ id: CHAPTER_ID, work_id: WORK_ID, chapter_number: 1, title: 'Chapter one', content: 'Body', status: 'draft', created_at: NOW, updated_at: NOW })
    },
  }),
  creatorCase({
    id: 'studio-chapter-autosave',
    file: 'studio/chapters/[chapterId]/autosave.post.ts',
    handler: studioAutosave,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { chapterId: String(CHAPTER_ID) },
    body: { title: 'Autosaved chapter', content: 'Autosaved body', csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ type: 'Novel' }))
      db.state.chapters.push({ id: CHAPTER_ID, work_id: WORK_ID, chapter_number: 1, title: 'Chapter one', content: 'Body', status: 'draft', created_at: NOW, updated_at: NOW })
    },
  }),
  creatorCase({
    id: 'studio-profile-update',
    file: 'studio/profile.put.ts',
    handler: studioProfile,
    method: 'PUT',
    status: 200,
    signal: 'db',
    body: { username: 'author', display_name: 'Author', bio: 'Isolation bio', avatar: '', csrfToken: TEST_CSRF },
  }),
  creatorCase({
    id: 'studio-work-delete',
    file: 'studio/works/[workId]/delete.post.ts',
    handler: studioWorkDelete,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { workId: String(WORK_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork({ status: 'draft' })) },
  }),
  creatorCase({
    id: 'studio-novel-publish',
    file: 'studio/works/[workId]/novel/publish.post.ts',
    handler: studioNovelPublish,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { workId: String(WORK_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ type: 'Novel', status: 'draft' }))
      db.state.chapters.push({ id: CHAPTER_ID, work_id: WORK_ID, chapter_number: 1, title: 'Chapter one', content: 'Publishable body', status: 'draft', created_at: NOW, updated_at: NOW })
    },
  }),
  creatorCase({
    id: 'studio-video-publish',
    file: 'studio/works/[workId]/video/publish.post.ts',
    handler: studioVideoPublish,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { workId: String(VIDEO_WORK_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ id: VIDEO_WORK_ID, type: 'Video', video_path: `/media/${VIDEO_KEY}` }))
    },
  }),
  creatorCase({
    id: 'studio-thumbnail-direct',
    file: 'studio/works/[workId]/thumbnail-direct.put.ts',
    handler: studioThumbnailDirect,
    method: 'PUT',
    status: 200,
    signal: 'either',
    params: { workId: String(WORK_ID) },
    headers: { 'x-lantern-extension': 'png' },
    rawBody: 'cover-bytes',
    resources: (db) => { db.state.works.push(makeWork()) },
  }),
  creatorCase({
    id: 'studio-video-direct',
    file: 'studio/works/[workId]/video-direct.put.ts',
    handler: studioVideoDirect,
    method: 'PUT',
    status: 201,
    signal: 'either',
    params: { workId: String(VIDEO_WORK_ID) },
    headers: { 'x-lantern-extension': 'mp4', 'content-length': '5' },
    rawBody: 'video',
    resources: (db) => { db.state.works.push(makeWork({ id: VIDEO_WORK_ID, type: 'Video' })) },
  }),
  creatorCase({
    id: 'studio-upload-start',
    file: 'studio/works/[workId]/video-multipart/start.post.ts',
    handler: studioUploadStart,
    method: 'POST',
    status: 201,
    signal: 'r2',
    params: { workId: String(VIDEO_WORK_ID) },
    body: { extension: 'mp4', size: 5, csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork({ id: VIDEO_WORK_ID, type: 'Video' })) },
  }),
  creatorCase({
    id: 'studio-upload-part',
    file: 'studio/works/[workId]/video-multipart/part.put.ts',
    handler: studioUploadPart,
    method: 'PUT',
    status: 200,
    signal: 'r2',
    params: { workId: String(VIDEO_WORK_ID) },
    headers: {
      'x-lantern-video-key': VIDEO_KEY,
      'x-lantern-upload-id': 'upload-1',
      'x-lantern-file-size': '5',
      'x-lantern-part-number': '1',
      'content-length': '5',
    },
    rawBody: 'video',
    resources: (db, bucket) => {
      db.state.works.push(makeWork({ id: VIDEO_WORK_ID, type: 'Video' }))
      seedMultipart(bucket, VIDEO_KEY)
    },
  }),
  creatorCase({
    id: 'studio-upload-complete',
    file: 'studio/works/[workId]/video-multipart/complete.post.ts',
    handler: studioUploadComplete,
    method: 'POST',
    status: 200,
    signal: 'either',
    params: { workId: String(VIDEO_WORK_ID) },
    body: {
      key: VIDEO_KEY, uploadId: 'upload-1', size: 5,
      parts: [{ partNumber: 1, etag: 'etag-1' }], csrfToken: TEST_CSRF,
    },
    resources: (db, bucket) => {
      db.state.works.push(makeWork({ id: VIDEO_WORK_ID, type: 'Video' }))
      seedMultipart(bucket, VIDEO_KEY, true)
    },
  }),
  creatorCase({
    id: 'studio-upload-abort',
    file: 'studio/works/[workId]/video-multipart/abort.post.ts',
    handler: studioUploadAbort,
    method: 'POST',
    status: 200,
    signal: 'r2',
    params: { workId: String(VIDEO_WORK_ID) },
    body: { key: VIDEO_KEY, uploadId: 'upload-1', csrfToken: TEST_CSRF },
    resources: (db, bucket) => {
      db.state.works.push(makeWork({ id: VIDEO_WORK_ID, type: 'Video' }))
      seedMultipart(bucket, VIDEO_KEY)
    },
  }),

  // ---------------------------------------------------------------- comic (6)
  creatorCase({
    id: 'comic-episode-update',
    file: 'comic/episodes/[episodeId].put.ts',
    handler: comicEpisodeUpdate,
    method: 'PUT',
    status: 200,
    signal: 'db',
    params: { episodeId: String(EPISODE_ID) },
    body: { title: 'Renamed episode', csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic' }))
      db.state.comicEpisodes.push({ id: EPISODE_ID, work_id: COMIC_WORK_ID, episode_number: 1, title: 'Episode one', status: 'draft', created_at: NOW, updated_at: NOW })
    },
  }),
  creatorCase({
    id: 'comic-page-upload',
    file: 'comic/episodes/[episodeId]/pages.put.ts',
    handler: comicPageUpload,
    method: 'PUT',
    status: 200,
    signal: 'either',
    params: { episodeId: String(EPISODE_ID) },
    headers: { 'x-lantern-extension': 'png' },
    rawBody: 'page-bytes',
    resources: (db) => {
      db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic' }))
      db.state.comicEpisodes.push({ id: EPISODE_ID, work_id: COMIC_WORK_ID, episode_number: 1, title: 'Episode one', status: 'draft', created_at: NOW, updated_at: NOW })
    },
  }),
  creatorCase({
    id: 'comic-episode-publish',
    file: 'comic/episodes/[episodeId]/publish.post.ts',
    handler: comicEpisodePublish,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { episodeId: String(EPISODE_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic' }))
      db.state.comicEpisodes.push({ id: EPISODE_ID, work_id: COMIC_WORK_ID, episode_number: 1, title: 'Episode one', status: 'draft', created_at: NOW, updated_at: NOW })
      db.state.comicPages.push({ id: PAGE_ID, episode_id: EPISODE_ID, page_number: 1, image_path: PAGE_KEY, created_at: NOW })
    },
  }),
  creatorCase({
    id: 'comic-page-delete',
    file: 'comic/pages/[pageId]/delete.post.ts',
    handler: comicPageDelete,
    method: 'POST',
    status: 200,
    signal: 'either',
    params: { pageId: String(PAGE_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db, bucket) => {
      db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic' }))
      db.state.comicEpisodes.push({ id: EPISODE_ID, work_id: COMIC_WORK_ID, episode_number: 1, title: 'Episode one', status: 'draft', created_at: NOW, updated_at: NOW })
      db.state.comicPages.push({ id: PAGE_ID, episode_id: EPISODE_ID, page_number: 1, image_path: PAGE_KEY, created_at: NOW })
      bucket.objects.set(PAGE_KEY, { bytes: new TextEncoder().encode('page-bytes'), httpMetadata: {} })
    },
  }),
  creatorCase({
    id: 'comic-episode-create',
    file: 'comic/works/[workId]/episodes.post.ts',
    handler: comicEpisodeCreate,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { workId: String(COMIC_WORK_ID) },
    body: { title: 'Episode one', csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic' })) },
  }),
  creatorCase({
    id: 'comic-work-publish',
    file: 'comic/works/[workId]/publish.post.ts',
    handler: comicWorkPublish,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { workId: String(COMIC_WORK_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic', status: 'draft' }))
      db.state.comicEpisodes.push({ id: EPISODE_ID, work_id: COMIC_WORK_ID, episode_number: 1, title: 'Episode one', status: 'draft', created_at: NOW, updated_at: NOW })
      db.state.comicPages.push({ id: PAGE_ID, episode_id: EPISODE_ID, page_number: 1, image_path: PAGE_KEY, created_at: NOW })
    },
  }),

  // ------------------------------------------------------------- dashboard (3)
  creatorCase({
    id: 'dashboard-work-delete',
    file: 'dashboard/works/[id]/delete.post.ts',
    handler: dashboardWorkDelete,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { id: String(WORK_ID) },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork({ status: 'draft' })) },
  }),
  creatorCase({
    id: 'dashboard-thumbnail-remove',
    file: 'dashboard/works/[id]/thumbnail.post.ts',
    handler: dashboardThumbnail,
    method: 'POST',
    status: 200,
    signal: 'db',
    params: { id: String(WORK_ID) },
    body: { mode: 'remove', csrfToken: TEST_CSRF },
    resources: (db, bucket) => {
      db.state.works.push(makeWork({ cover: `/media/${OLD_COVER_KEY}` }))
      bucket.objects.set(OLD_COVER_KEY, { bytes: new TextEncoder().encode('old'), httpMetadata: {} })
    },
  }),
  creatorCase({
    id: 'dashboard-thumbnail-upload',
    file: 'dashboard/works/[id]/thumbnail.put.ts',
    handler: dashboardThumbnailPut,
    method: 'PUT',
    status: 200,
    signal: 'db',
    params: { id: String(WORK_ID) },
    headers: { 'x-lantern-extension': 'png' },
    rawBody: 'cover-bytes',
    resources: (db) => { db.state.works.push(makeWork()) },
    assertStaging: ({ staging, stagingMedia }, result) => {
      const key = `uploads/covers/${WORK_ID}/cover.png`
      expect(result.json).toMatchObject({ ok: true, message: 'Thumbnail uploaded successfully.' })
      expect(stagingMedia.text(key)).toBe('cover-bytes')
      expect(staging.state.works[0]).toMatchObject({ cover: `/media/${key}` })
    },
  }),

  // ----------------------------------------------------------- discussions (2)
  creatorCase({
    id: 'discussion-post',
    file: 'discussions/[kind]/[targetId].post.ts',
    handler: discussionPost,
    method: 'POST',
    status: 201,
    signal: 'db',
    path: '/api/test?source=staging',
    params: { kind: 'work', targetId: String(WORK_ID) },
    body: { body: 'An isolation comment', csrfToken: TEST_CSRF },
    resources: (db) => { db.state.works.push(makeWork({ type: 'Novel', status: 'published' })) },
  }),
  creatorCase({
    id: 'discussion-action',
    file: 'discussions/[kind]/[targetId]/[commentId]/[action].post.ts',
    handler: discussionAction,
    method: 'POST',
    status: 200,
    signal: 'db',
    path: '/api/test?source=staging',
    params: { kind: 'work', targetId: String(WORK_ID), commentId: String(COMMENT_ID), action: 'like' },
    body: { csrfToken: TEST_CSRF },
    resources: (db) => {
      db.state.works.push(makeWork({ type: 'Novel', status: 'published' }))
      db.state.comments.push({ id: COMMENT_ID, user_id: USER_ID, parent_id: null, body: 'Existing comment', content_type: 'novel', content_id: WORK_ID })
    },
  }),
]

/** Only state-changing GET routes with explicit Flask-parity evidence belong here. */
const EXPLICIT_GET_MUTATIONS = new Set(['auth/verify.get.ts'])

function collectMutationFiles(directory: string, relative = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) {
      files.push(...collectMutationFiles(absolute, relative ? `${relative}/${entry}` : entry))
      continue
    }
    const path = relative ? `${relative}/${entry}` : entry
    if (/\.(post|put|patch|delete)\.ts$/.test(entry) || EXPLICIT_GET_MUTATIONS.has(path)) {
      files.push(path)
    }
  }
  return files
}

function r2WriteCount(bucket: any): number {
  return ['put', 'delete', 'createMultipartUpload', 'resumeMultipartUpload', 'write', 'copy']
    .reduce((total, method) => total + (bucket?.[method]?.mock?.calls?.length ?? 0), 0)
}

const stateSnapshot = (db: FakeD1) => JSON.stringify(db.state)

const noTripwire: Tripwire = { attempts: () => [], assertClean: () => {} }

type BuildOptions = {
  /** Where creator session mutations are expected to write. Defaults to identity. */
  target?: 'staging' | 'production'
  /** Explicit server-side production-write flag. Missing means disabled. */
  productionWriteValue?: unknown
  /** Convenience: `true` supplies the exact enabling value. */
  productionWrites?: boolean
  /** Explicit anonymous account target. Defaults to target. */
  anonymousTarget?: 'staging' | 'production'
  /** Raw anonymous target value for missing/invalid configuration tests. */
  anonymousTargetValue?: unknown
  /** Remove the anonymous target setting to test fail-closed behavior. */
  omitAnonymousTarget?: boolean
  /** Deliberately reject writes on one selected binding to test failure paths. */
  failureBinding?: 'productionD1' | 'productionR2' | 'stagingD1' | 'stagingR2'
  /** Remove a binding entirely to test fail-closed behavior. */
  missingBinding?: 'productionD1' | 'productionR2' | 'stagingD1' | 'stagingR2'
  /** Override the signed session user for ownership tests. */
  sessionUserId?: number
  /** Override request headers for CSRF/origin failure tests. */
  headers?: Record<string, string>
  /** Override the request path, for example the discussion source query. */
  pathOverride?: string
  /** Override request body fields, for example the explicit login database. */
  bodyOverride?: Record<string, unknown>
}

async function buildFixture(
  testCase: MutationCase,
  identity: 'staging' | 'production',
  options: BuildOptions = {},
) {
  const target = options.target ?? identity
  const production = createFakeD1()
  const staging = createFakeD1()
  const productionMedia = createFakeR2()
  const stagingMedia = createFakeR2()

  for (const db of [production, staging]) {
    db.state.users.push({
      id: USER_ID,
      username: 'author',
      email: 'author@example.com',
      password_hash: validHash,
      display_name: 'Author',
      email_verified: 1,
    })
  }

  if (testCase.category === 'creator') {
    for (const [db, bucket] of [[production, productionMedia], [staging, stagingMedia]] as const) {
      testCase.resources?.(db, bucket, USER_ID)
    }
  } else {
    await testCase.seed?.({ production, staging, productionMedia, stagingMedia })
    // The login case intentionally seeds a legacy production hash. Restore a
    // valid production hash when the test targets production authentication.
    if (testCase.id === 'auth-login' && target === 'production') {
      production.state.users[0]!.password_hash = validHash
    }
  }

  // After seeding, arm tripwires only on the environment that must not receive
  // writes. The selected target keeps its real in-memory bindings.
  const productionD1 = target === 'production' && options.failureBinding !== 'productionD1'
    ? { database: production, tripwire: noTripwire }
    : tripwireD1(production, 'lantern_db')
  const productionR2 = target === 'production' && options.failureBinding !== 'productionR2'
    ? { bucket: productionMedia, tripwire: noTripwire }
    : tripwireR2(productionMedia, 'lantern_media')
  const stagingD1 = target === 'staging' && options.failureBinding !== 'stagingD1'
    ? { database: staging, tripwire: noTripwire }
    : tripwireD1(staging, 'lantern_staging_db')
  const stagingR2 = target === 'staging' && options.failureBinding !== 'stagingR2'
    ? { bucket: stagingMedia, tripwire: noTripwire }
    : tripwireR2(stagingMedia, 'lantern_staging_media')
  const tripwire = combineTripwires(
    productionD1.tripwire,
    productionR2.tripwire,
    stagingD1.tripwire,
    stagingR2.tripwire,
  )
  const anonymousTarget = options.anonymousTargetValue !== undefined
    ? options.anonymousTargetValue
    : (options.anonymousTarget ?? target)
  const env: Record<string, any> = {
    ...testEnv(productionD1.database, stagingD1.database, stagingR2.bucket, productionR2.bucket),
    LANTERN_ANONYMOUS_WRITE_DATABASE: anonymousTarget,
    ...(options.productionWrites ? { [PRODUCTION_WRITE_FLAG]: true } : {}),
    ...(options.productionWriteValue !== undefined
      ? { [PRODUCTION_WRITE_FLAG]: options.productionWriteValue }
      : {}),
    LANTERN_BREVO_API_KEY: 'test-brevo-key',
    LANTERN_MAIL_FROM: 'Lantern <no-reply@example.com>',
    LANTERN_PUBLIC_BASE_URL: 'http://localhost:3000',
  }
  if (options.omitAnonymousTarget) delete env.LANTERN_ANONYMOUS_WRITE_DATABASE
  if (options.missingBinding === 'productionD1') env.lantern_db = undefined
  if (options.missingBinding === 'productionR2') env.lantern_media = undefined
  if (options.missingBinding === 'stagingD1') env.lantern_staging_db = undefined
  if (options.missingBinding === 'stagingR2') env.lantern_staging_media = undefined

  const session = testCase.category === 'creator'
    ? await makeSession(options.sessionUserId ?? USER_ID, identity, env)
    : ''
  const headers = {
    ...csrfHeaders(session, { 'x-csrf-token': TEST_CSRF, ...(testCase.headers ?? {}) }),
    'cf-connecting-ip': `isolation-${testCase.id}-${identity}-${target}`,
    ...(options.headers ?? {}),
  }

  let requestPath = testCase.path ?? '/api/test'
  let requestBody = testCase.body
  if (testCase.id === 'auth-login') {
    requestBody = { ...(requestBody ?? {}), database: target }
  }
  if (testCase.id.startsWith('discussion-')) {
    requestPath = `/api/test?source=${target}`
  }
  requestPath = options.pathOverride ?? requestPath
  requestBody = options.bodyOverride ? { ...(requestBody ?? {}), ...options.bodyOverride } : requestBody

  const productionBefore = stateSnapshot(production)
  const stagingBefore = stateSnapshot(staging)
  const productionR2Before = r2WriteCount(productionMedia)
  const stagingR2Before = r2WriteCount(stagingMedia)

  const result = await callHandler(testCase.handler, {
    env,
    method: testCase.method,
    path: requestPath,
    headers,
    params: testCase.params ?? {},
    ...(requestBody ? { body: requestBody } : {}),
    ...(testCase.rawBody !== undefined ? { rawBody: testCase.rawBody } : {}),
  })

  return {
    result,
    tripwire,
    fixture: { production, staging, productionMedia, stagingMedia } as Fixture,
    productionBefore,
    stagingBefore,
    productionR2Before,
    stagingR2Before,
    env,
    headers,
    requestPath,
    requestBody,
    params: testCase.params ?? {},
  }
}

beforeAll(async () => {
  validHash = await createLanternPasswordHash('correct horse battery staple')
  // Token lookups hash the supplied token before querying the target database.
  const reset = MUTATION_MATRIX.find((item) => item.id === 'auth-reset-password')!
  const resetSeed = reset.seed!
  reset.seed = async (fixture) => {
    await resetSeed(fixture)
    const tokenHash = await hashLanternVerificationToken('isolation-reset-token')
    for (const db of [fixture.production, fixture.staging]) {
      if (!db.state.emailTokens.length) {
        db.state.emailTokens.push({
          id: 1, user_id: USER_ID, token_hash: tokenHash,
          token_type: 'password_reset', expires_at: FUTURE, used: 0, created_at: NOW,
        })
        continue
      }
      db.state.emailTokens[0]!.token_hash = tokenHash
    }
  }
  for (const id of ['auth-verify-email', 'auth-verify-email-get']) {
    const verifyCase = MUTATION_MATRIX.find((item) => item.id === id)!
    const verifySeed = verifyCase.seed!
    verifyCase.seed = async (fixture) => {
      await verifySeed(fixture)
      for (const db of [fixture.production, fixture.staging]) {
        db.state.emailTokens.push({
          id: 2, user_id: USER_ID, token_hash: await hashLanternVerificationToken('isolation-verify-token'),
          token_type: 'email_verification', expires_at: FUTURE, used: 0, created_at: NOW,
        })
      }
    }
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mutation handler matrix registration', () => {
  it('lists every server/api mutation handler exactly once', () => {
    const filesystem = collectMutationFiles(join(process.cwd(), 'server', 'api'))
    const matrix = MUTATION_MATRIX.map((item) => item.file).sort()
    expect([...filesystem].sort()).toEqual(matrix)
    expect(new Set(matrix).size).toBe(matrix.length)
  })

  it('keeps creator mutations and account mutations in separate categories', () => {
    const creators = MUTATION_MATRIX.filter((item) => item.category === 'creator')
    const accounts = MUTATION_MATRIX.filter((item) => item.category === 'account')
    expect(creators.map((item) => item.id)).toEqual(expect.arrayContaining([
      'studio-work-create', 'comic-page-upload', 'discussion-action',
    ]))
    expect(accounts.map((item) => item.id).sort()).toEqual([
      'auth-forgot-password', 'auth-login', 'auth-logout', 'auth-register',
      'auth-resend-verification', 'auth-reset-password', 'auth-verify-email',
      'auth-verify-email-get',
    ])
    expect(MUTATION_MATRIX.filter((item) => item.method === 'GET').map((item) => item.file))
      .toEqual([...EXPLICIT_GET_MUTATIONS])
    expect(creators.length).toBeGreaterThan(0)
    expect(creators.filter((item) => item.signal === 'none').map((item) => item.id)).toEqual([])
  })
})

describe('production mutations are read-only when the gate is disabled', () => {
  it.each(MUTATION_MATRIX.map((item) => [item.id, item] as const))('%s writes nothing', async (_id, testCase) => {
    const state = await buildFixture(testCase, 'production')

    // Logout only clears a cookie; every D1/R2-writing handler must be blocked.
    expect(state.result.status).toBe(testCase.id === 'auth-logout' ? 200 : 409)
    state.tripwire.assertClean()
    expect(state.tripwire.attempts()).toHaveLength(0)
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expect(stateSnapshot(state.fixture.staging)).toBe(state.stagingBefore)
    expect(r2WriteCount(state.fixture.productionMedia)).toBe(state.productionR2Before)
    expect(r2WriteCount(state.fixture.stagingMedia)).toBe(state.stagingR2Before)
  })
})

describe('staging mutations write only to staging bindings', () => {
  it.each(MUTATION_MATRIX.map((item) => [item.id, item] as const))('%s writes only staging D1/R2', async (_id, testCase) => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '{"messageId":"test"}' }))
    vi.stubGlobal('fetch', fetchMock)

    const state = await buildFixture(testCase, 'staging')
    const { result, tripwire, fixture } = state

    expect(result.status, typeof result.json === 'string' ? result.json : JSON.stringify(result.json)).toBe(testCase.status)
    tripwire.assertClean()
    expect(stateSnapshot(fixture.production)).toBe(state.productionBefore)
    expect(r2WriteCount(fixture.productionMedia)).toBe(state.productionR2Before)

    const dbChanged = stateSnapshot(fixture.staging) !== state.stagingBefore
    const r2Changed = r2WriteCount(fixture.stagingMedia) !== state.stagingR2Before
    if (testCase.signal === 'db') expect(dbChanged).toBe(true)
    if (testCase.signal === 'r2') expect(r2Changed).toBe(true)
    if (testCase.signal === 'either') expect(dbChanged || r2Changed).toBe(true)
    if (testCase.signal === 'none') {
      expect(dbChanged).toBe(false)
      expect(r2Changed).toBe(false)
    }

    testCase.assertStaging?.(fixture, result)
  })
})

describe('dashboard direct thumbnail upload', () => {
  it('reaches the staging write path in the handler harness', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'dashboard-thumbnail-upload')!
    const state = await buildFixture(testCase, 'staging')

    expect(state.result.status).toBe(200)
    expect(state.result.json).toMatchObject({ ok: true, message: 'Thumbnail uploaded successfully.' })
    state.tripwire.assertClean()
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expect(stateSnapshot(state.fixture.staging)).not.toBe(state.stagingBefore)
    expect(state.fixture.stagingMedia.text(`uploads/covers/${WORK_ID}/cover.png`)).toBe('cover-bytes')
  })
})

describe('account operations use the staging database', () => {
  it('authenticates the staging user against staging D1 and records the rate limit there', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'auth-login')!
    const state = await buildFixture(testCase, 'staging')

    expect(state.result.status).toBe(200)
    expect(state.fixture.staging.state.rateLimits.length).toBeGreaterThan(0)
    expect(state.fixture.production.state.rateLimits).toHaveLength(0)
    state.tripwire.assertClean()
  })

  it('rejects a production-database login without writing production D1', async () => {
    const production = createFakeD1()
    const staging = createFakeD1()
    production.state.users.push({
      id: USER_ID, username: 'author', email: 'author@example.com',
      password_hash: 'scrypt:legacy', display_name: 'Author', email_verified: 1,
    })
    const productionD1 = tripwireD1(production, 'lantern_db')
    const env = {
      ...testEnv(productionD1.database, staging, createFakeR2(), createFakeR2()),
      LANTERN_BREVO_API_KEY: 'test-brevo-key',
    }
    const result = await callHandler(loginHandler, {
      env,
      method: 'POST',
      headers: csrfHeaders('', { 'cf-connecting-ip': 'login-production-routing' }),
      body: {
        email: 'author@example.com', password: 'correct horse battery staple',
        database: 'production', csrfToken: TEST_CSRF,
      },
    })

    expect(result.status).toBe(409)
    productionD1.tripwire.assertClean()
    expect(staging.state.rateLimits).toHaveLength(0)
  })
})

type FixtureState = Awaited<ReturnType<typeof buildFixture>>

function stubEmailFetch() {
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '{"messageId":"test"}' }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function expectNoWritesAnywhere(state: FixtureState) {
  state.tripwire.assertClean()
  expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
  expect(stateSnapshot(state.fixture.staging)).toBe(state.stagingBefore)
  expect(r2WriteCount(state.fixture.productionMedia)).toBe(state.productionR2Before)
  expect(r2WriteCount(state.fixture.stagingMedia)).toBe(state.stagingR2Before)
}

function expectTargetSignal(state: FixtureState, target: 'staging' | 'production', signal: Signal) {
  const targetDb = target === 'production' ? state.fixture.production : state.fixture.staging
  const targetBefore = target === 'production' ? state.productionBefore : state.stagingBefore
  const targetR2 = target === 'production' ? state.fixture.productionMedia : state.fixture.stagingMedia
  const targetR2Before = target === 'production' ? state.productionR2Before : state.stagingR2Before
  const otherDb = target === 'production' ? state.fixture.staging : state.fixture.production
  const otherBefore = target === 'production' ? state.stagingBefore : state.productionBefore
  const otherR2 = target === 'production' ? state.fixture.stagingMedia : state.fixture.productionMedia
  const otherR2Before = target === 'production' ? state.stagingR2Before : state.productionR2Before

  const dbChanged = stateSnapshot(targetDb) !== targetBefore
  const r2Changed = r2WriteCount(targetR2) !== targetR2Before
  if (signal === 'db') expect(dbChanged).toBe(true)
  if (signal === 'r2') expect(r2Changed).toBe(true)
  if (signal === 'either') expect(dbChanged || r2Changed).toBe(true)
  if (signal === 'none') {
    expect(dbChanged).toBe(false)
    expect(r2Changed).toBe(false)
  }

  expect(stateSnapshot(otherDb)).toBe(otherBefore)
  expect(r2WriteCount(otherR2)).toBe(otherR2Before)
}

function expectOnlyAttemptBindings(state: FixtureState, expected: string[]) {
  const bindings = [...new Set(state.tripwire.attempts().map((attempt) => attempt.binding))].sort()
  expect(bindings).toEqual([...expected].sort())
}

async function signedSessionWithInvalidDatabase(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    v: 1, uid: USER_ID, db: 'invalid', iat: now, exp: now + 3600,
  })).toString('base64url')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(TEST_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = Buffer.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))).toString('base64url')
  return `${payload}.${signature}`
}

describe('production mutations write only to production bindings when explicitly enabled', () => {
  it.each(MUTATION_MATRIX.map((item) => [item.id, item] as const))('%s writes only production D1/R2', async (_id, testCase) => {
    stubEmailFetch()
    const state = await buildFixture(testCase, 'production', {
      target: 'production',
      productionWrites: true,
    })

    expect(state.result.status, typeof state.result.json === 'string' ? state.result.json : JSON.stringify(state.result.json)).toBe(testCase.status)
    state.tripwire.assertClean()
    expectTargetSignal(state, 'production', testCase.signal)
  })
})

describe('staging mutations ignore the production-write flag', () => {
  it.each(MUTATION_MATRIX.map((item) => [item.id, item] as const))('%s still writes only staging D1/R2', async (_id, testCase) => {
    stubEmailFetch()
    const state = await buildFixture(testCase, 'staging', {
      target: 'staging',
      productionWrites: true,
    })

    expect(state.result.status, typeof state.result.json === 'string' ? state.result.json : JSON.stringify(state.result.json)).toBe(testCase.status)
    state.tripwire.assertClean()
    expectTargetSignal(state, 'staging', testCase.signal)
  })
})

describe('production write flag accepts only explicit true', () => {
  const invalidValues: Array<[string, unknown]> = [
    ['missing', undefined],
    ['false boolean', false],
    ['false string', 'false'],
    ['numeric one', 1],
    ['uppercase TRUE', 'TRUE'],
    ['empty string', ''],
  ]
  const cases = [
    MUTATION_MATRIX.find((item) => item.id === 'studio-work-create')!,
    MUTATION_MATRIX.find((item) => item.id === 'auth-register')!,
  ]

  it.each(invalidValues.flatMap(([label, value]) => cases.map((testCase) => [testCase.id, label, value, testCase] as const)))(
    '%s stays read-only with %s',
    async (_id, _label, value, testCase) => {
      const state = await buildFixture(testCase, 'production', {
        target: 'production',
        productionWriteValue: value,
      })

      expect(state.result.status).toBe(409)
      expectNoWritesAnywhere(state)
    },
  )
})

describe('anonymous account target fails closed without an explicit setting', () => {
  const anonymousCases = MUTATION_MATRIX.filter((item) =>
    item.id.startsWith('auth-') && item.id !== 'auth-login' && item.id !== 'auth-logout')

  it.each(anonymousCases.map((item) => [item.id, item] as const))('%s rejects a missing anonymous target', async (_id, testCase) => {
    const state = await buildFixture(testCase, 'staging', { omitAnonymousTarget: true })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })

  it.each(anonymousCases.map((item) => [item.id, item] as const))('%s rejects an invalid anonymous target', async (_id, testCase) => {
    const state = await buildFixture(testCase, 'staging', { anonymousTargetValue: 'PRODUCTION' })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })
})

describe('missing bindings fail closed without cross-environment fallback', () => {
  const workCreate = MUTATION_MATRIX.find((item) => item.id === 'studio-work-create')!
  const thumbnail = MUTATION_MATRIX.find((item) => item.id === 'studio-thumbnail-direct')!

  it('rejects a production mutation when production D1 is missing', async () => {
    const state = await buildFixture(workCreate, 'production', {
      target: 'production', productionWrites: true, missingBinding: 'productionD1',
    })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })

  it('rejects a production media mutation when production R2 is missing', async () => {
    const state = await buildFixture(thumbnail, 'production', {
      target: 'production', productionWrites: true, missingBinding: 'productionR2',
    })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })

  it('rejects a staging mutation when staging D1 is missing', async () => {
    const state = await buildFixture(workCreate, 'staging', {
      target: 'staging', missingBinding: 'stagingD1',
    })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })

  it('rejects a staging media mutation when staging R2 is missing', async () => {
    const state = await buildFixture(thumbnail, 'staging', {
      target: 'staging', missingBinding: 'stagingR2',
    })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })

  it('rejects the verification GET when production D1 is missing', async () => {
    const verifyGet = MUTATION_MATRIX.find((item) => item.id === 'auth-verify-email-get')!
    const state = await buildFixture(verifyGet, 'production', {
      target: 'production', productionWrites: true, missingBinding: 'productionD1',
    })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })

  it('rejects the verification GET when staging D1 is missing', async () => {
    const verifyGet = MUTATION_MATRIX.find((item) => item.id === 'auth-verify-email-get')!
    const state = await buildFixture(verifyGet, 'staging', {
      target: 'staging', missingBinding: 'stagingD1',
    })
    expect(state.result.status).toBe(503)
    expectNoWritesAnywhere(state)
  })
})

describe('binding failures stay inside the selected environment', () => {
  const thumbnail = MUTATION_MATRIX.find((item) => item.id === 'studio-thumbnail-direct')!
  const pageDelete = MUTATION_MATRIX.find((item) => item.id === 'comic-page-delete')!
  const multipartComplete = MUTATION_MATRIX.find((item) => item.id === 'studio-upload-complete')!
  const key = `uploads/covers/${WORK_ID}/cover.png`

  it('keeps a production R2 object when the following production D1 write fails', async () => {
    const state = await buildFixture(thumbnail, 'production', {
      target: 'production', productionWrites: true, failureBinding: 'productionD1',
    })

    expect(state.result.status).toBeGreaterThanOrEqual(500)
    expectOnlyAttemptBindings(state, ['lantern_db'])
    expect(state.fixture.productionMedia.objects.has(key)).toBe(true)
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expectNoWritesOutsideAttempts(state, 'staging')
  })

  it('does not touch production D1 when production R2 rejects an upload', async () => {
    const state = await buildFixture(thumbnail, 'production', {
      target: 'production', productionWrites: true, failureBinding: 'productionR2',
    })

    expect(state.result.status).toBe(502)
    expectOnlyAttemptBindings(state, ['lantern_media'])
    expect(state.fixture.productionMedia.objects.has(key)).toBe(false)
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expectNoWritesOutsideAttempts(state, 'staging')
  })

  it('does not touch production D1 when production R2 rejects a comic page delete', async () => {
    const state = await buildFixture(pageDelete, 'production', {
      target: 'production', productionWrites: true, failureBinding: 'productionR2',
    })

    expect(state.result.status).toBe(503)
    expectOnlyAttemptBindings(state, ['lantern_media'])
    expect(state.fixture.productionMedia.objects.has(PAGE_KEY)).toBe(true)
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expectNoWritesOutsideAttempts(state, 'staging')
  })

  it('cleans up the assembled production object when the production D1 save cannot be verified', async () => {
    const state = await buildFixture(multipartComplete, 'production', {
      target: 'production', productionWrites: true, failureBinding: 'productionD1',
    })

    expect(state.result.status).toBe(500)
    expectOnlyAttemptBindings(state, ['lantern_db'])
    expect(state.fixture.productionMedia.objects.has(VIDEO_KEY)).toBe(false)
    expect(state.fixture.production.state.works[0]!.video_path).toBeNull()
    expectNoWritesOutsideAttempts(state, 'staging')
  })
})

function expectNoWritesOutsideAttempts(state: FixtureState, untouchedTarget: 'staging' | 'production') {
  const db = untouchedTarget === 'production' ? state.fixture.production : state.fixture.staging
  const before = untouchedTarget === 'production' ? state.productionBefore : state.stagingBefore
  const bucket = untouchedTarget === 'production' ? state.fixture.productionMedia : state.fixture.stagingMedia
  const bucketBefore = untouchedTarget === 'production' ? state.productionR2Before : state.stagingR2Before
  expect(stateSnapshot(db)).toBe(before)
  expect(r2WriteCount(bucket)).toBe(bucketBefore)
}

describe('ownership, CSRF, and session identity fail closed with the gate enabled', () => {
  const ownershipCases = ['studio-work-update', 'comic-episode-update', 'dashboard-work-delete']

  it.each(ownershipCases.map((id) => [id, MUTATION_MATRIX.find((item) => item.id === id)!] as const))(
    '%s rejects a session that does not own the resource',
    async (_id, testCase) => {
      const state = await buildFixture(testCase, 'production', {
        target: 'production', productionWrites: true, sessionUserId: USER_ID + 1,
      })
      expect(state.result.status).toBe(404)
      expectNoWritesAnywhere(state)
    },
  )

  it('rejects a body CSRF token mismatch before consulting the gate', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'studio-work-create')!
    const state = await buildFixture(testCase, 'production', {
      target: 'production', productionWrites: true, bodyOverride: { csrfToken: 'wrong' },
    })
    expect(state.result.status).toBe(403)
    expectNoWritesAnywhere(state)
  })

  it('rejects a header CSRF token mismatch before consulting the gate', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'studio-thumbnail-direct')!
    const state = await buildFixture(testCase, 'production', {
      target: 'production', productionWrites: true, headers: { 'x-csrf-token': 'wrong' },
    })
    expect(state.result.status).toBe(403)
    expectNoWritesAnywhere(state)
  })

  it('rejects a cross-origin request before consulting the gate', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'studio-work-create')!
    const state = await buildFixture(testCase, 'production', {
      target: 'production', productionWrites: true, headers: { origin: 'https://evil.example' },
    })
    expect(state.result.status).toBe(403)
    expectNoWritesAnywhere(state)
  })

  it('rejects a correctly signed session with an invalid database identity', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'studio-work-create')!
    const session = await signedSessionWithInvalidDatabase()
    const state = await buildFixture(testCase, 'production', {
      target: 'production', productionWrites: true,
      headers: { cookie: `lantern_nuxt_session=${session}; lantern_nuxt_csrf=${TEST_CSRF}` },
    })
    expect(state.result.status).toBe(401)
    expectNoWritesAnywhere(state)
  })
})

describe('token replay is rejected on the selected database', () => {
  const tokenCases = [
    MUTATION_MATRIX.find((item) => item.id === 'auth-reset-password')!,
    MUTATION_MATRIX.find((item) => item.id === 'auth-verify-email')!,
    MUTATION_MATRIX.find((item) => item.id === 'auth-verify-email-get')!,
  ]

  it.each((['staging', 'production'] as const).flatMap((target) =>
    tokenCases.map((testCase) => [target, testCase.id, testCase, target] as const)))(
    '%s replay of %s is rejected',
    async (target, _id, testCase) => {
      const state = await buildFixture(testCase, target, {
        target,
        productionWrites: target === 'production',
      })
      expect(state.result.status).toBe(200)

      const replay = await callHandler(testCase.handler, {
        env: state.env,
        method: testCase.method,
        path: state.requestPath,
        headers: state.headers,
        params: state.params,
        ...(state.requestBody ? { body: state.requestBody } : {}),
      })
      expect(replay.status).toBe(400)
      state.tripwire.assertClean()
      expectTargetSignal(state, target, testCase.signal)
    },
  )
})

describe('failed publish and delete paths preserve Flask ordering', () => {
  it('forces an unpublishable novel back to draft without touching production', async () => {
    const base = MUTATION_MATRIX.find((item) => item.id === 'studio-novel-publish')!
    const failing = {
      ...base,
      resources: (db: FakeD1) => {
        db.state.works.push(makeWork({ type: 'Novel', status: 'draft' }))
        db.state.chapters.push({
          id: CHAPTER_ID, work_id: WORK_ID, chapter_number: 1, title: '',
          content: '   ', status: 'draft', created_at: NOW, updated_at: NOW,
        })
      },
    }
    const state = await buildFixture(failing, 'staging')

    expect(state.result.status).toBe(400)
    expect(state.fixture.staging.state.works[0]!.status).toBe('draft')
    expect(state.fixture.staging.state.chapters[0]!.status).toBe('draft')
    state.tripwire.assertClean()
    expect(stateSnapshot(state.fixture.staging)).not.toBe(state.stagingBefore)
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expect(r2WriteCount(state.fixture.productionMedia)).toBe(state.productionR2Before)
    expect(r2WriteCount(state.fixture.stagingMedia)).toBe(state.stagingR2Before)
  })

  it('aborts a draft delete when production R2 cleanup fails', async () => {
    const base = MUTATION_MATRIX.find((item) => item.id === 'studio-work-delete')!
    const failing = {
      ...base,
      resources: (db: FakeD1, bucket: any) => {
        db.state.works.push(makeWork({ status: 'draft', cover: `/media/${OLD_COVER_KEY}` }))
        bucket.objects.set(OLD_COVER_KEY, { bytes: new TextEncoder().encode('old'), httpMetadata: {} })
      },
    }
    const state = await buildFixture(failing, 'production', {
      target: 'production', productionWrites: true, failureBinding: 'productionR2',
    })

    expect(state.result.status).toBe(503)
    expectOnlyAttemptBindings(state, ['lantern_media'])
    expect(state.fixture.production.state.works).toHaveLength(1)
    expect(state.fixture.productionMedia.objects.has(OLD_COVER_KEY)).toBe(true)
    expectNoWritesOutsideAttempts(state, 'staging')
  })
})
