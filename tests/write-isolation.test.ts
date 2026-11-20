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
import { csrfHeaders, makeSession, TEST_CSRF, testEnv } from './helpers/session'
import { combineTripwires, tripwireD1, tripwireR2, type Tripwire } from './helpers/write-tripwire'
import { createLanternPasswordHash, hashLanternVerificationToken } from '../server/utils/lantern-auth'

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
  method: 'POST' | 'PUT'
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
 *
 * The current tree contains 33 mutation handlers (26 creator + 7 account),
 * including auth/logout.post.ts, which clears a session cookie without writing
 * D1 or R2. Earlier audit notes counted 32; this matrix follows the tree and
 * the registration test derives its expected set from the filesystem.
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
      production.state.users[0]!.email_verified = 1
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
    resources: (db) => {
      db.state.works.push(makeWork({ id: COMIC_WORK_ID, type: 'Comic' }))
      db.state.comicEpisodes.push({ id: EPISODE_ID, work_id: COMIC_WORK_ID, episode_number: 1, title: 'Episode one', status: 'draft', created_at: NOW, updated_at: NOW })
      db.state.comicPages.push({ id: PAGE_ID, episode_id: EPISODE_ID, page_number: 1, image_path: PAGE_KEY, created_at: NOW })
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
    // h3's readRawBody(event) defaults to utf8 in this harness, so the handler
    // rejects every body as a string before reaching its staging write path.
    // This case still proves the production tripwire is not touched; the
    // unreachable staging write path is called out in its own test below.
    status: 400,
    signal: 'none',
    params: { id: String(WORK_ID) },
    headers: { 'x-lantern-extension': 'png' },
    rawBody: 'cover-bytes',
    resources: (db) => { db.state.works.push(makeWork()) },
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

function collectMutationFiles(directory: string, relative = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) {
      files.push(...collectMutationFiles(absolute, relative ? `${relative}/${entry}` : entry))
      continue
    }
    if (/\.(post|put|patch|delete)\.ts$/.test(entry)) {
      files.push(relative ? `${relative}/${entry}` : entry)
    }
  }
  return files
}

function r2WriteCount(bucket: any): number {
  return ['put', 'delete', 'createMultipartUpload', 'resumeMultipartUpload', 'write', 'copy']
    .reduce((total, method) => total + (bucket?.[method]?.mock?.calls?.length ?? 0), 0)
}

const stateSnapshot = (db: FakeD1) => JSON.stringify(db.state)

async function buildFixture(testCase: MutationCase, identity: 'staging' | 'production') {
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
  }

  // Tripwires are armed only after all fixtures are seeded. Any write from the
  // handler to either production binding throws immediately.
  const productionD1 = tripwireD1(production, 'lantern_db')
  const productionR2 = tripwireR2(productionMedia, 'lantern_media')
  const tripwire = combineTripwires(productionD1.tripwire, productionR2.tripwire)
  const env = {
    ...testEnv(productionD1.database, staging, stagingMedia, productionR2.bucket),
    LANTERN_BREVO_API_KEY: 'test-brevo-key',
    LANTERN_MAIL_FROM: 'Lantern <no-reply@example.com>',
    LANTERN_PUBLIC_BASE_URL: 'http://localhost:3000',
  }

  const session = testCase.category === 'creator'
    ? await makeSession(USER_ID, identity, env)
    : ''
  const headers = {
    ...csrfHeaders(session, { 'x-csrf-token': TEST_CSRF, ...(testCase.headers ?? {}) }),
    'cf-connecting-ip': `isolation-${testCase.id}-${identity}`,
  }

  // Capture the pre-handler baseline before invoking the handler.
  const productionBefore = stateSnapshot(production)
  const stagingBefore = stateSnapshot(staging)
  const productionR2Before = r2WriteCount(productionMedia)
  const stagingR2Before = r2WriteCount(stagingMedia)

  const result = await callHandler(testCase.handler, {
    env,
    method: testCase.method,
    path: testCase.path ?? '/api/test',
    headers,
    params: testCase.params ?? {},
    ...(testCase.body ? { body: testCase.body } : {}),
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
  }
}

beforeAll(async () => {
  validHash = await createLanternPasswordHash('correct horse battery staple')
  // Token lookups hash the supplied token before querying staging D1.
  const reset = MUTATION_MATRIX.find((item) => item.id === 'auth-reset-password')!
  const verify = MUTATION_MATRIX.find((item) => item.id === 'auth-verify-email')!
  const resetSeed = reset.seed!
  reset.seed = async (fixture) => {
    await resetSeed(fixture)
    fixture.staging.state.emailTokens[0]!.token_hash = await hashLanternVerificationToken('isolation-reset-token')
  }
  const verifySeed = verify.seed!
  verify.seed = async (fixture) => {
    await verifySeed(fixture)
    fixture.staging.state.emailTokens.push({
      id: 2, user_id: USER_ID, token_hash: await hashLanternVerificationToken('isolation-verify-token'),
      token_type: 'email_verification', expires_at: FUTURE, used: 0, created_at: NOW,
    })
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
    ])
    expect(creators.length).toBeGreaterThan(0)
    expect(creators.filter((item) => item.signal === 'none').map((item) => item.id)).toEqual([
      'dashboard-thumbnail-upload',
    ])
  })
})

describe('production creator mutations are read-only', () => {
  const creators = MUTATION_MATRIX.filter((item) => item.category === 'creator')

  it.each(creators.map((item) => [item.id, item] as const))('%s returns 409 with zero production writes', async (_id, testCase) => {
    const before = await buildFixture(testCase, 'production')

    expect(before.result.status).toBe(409)
    before.tripwire.assertClean()
    expect(before.tripwire.attempts()).toHaveLength(0)
    expect(stateSnapshot(before.fixture.production)).toBe(before.productionBefore)
    expect(stateSnapshot(before.fixture.staging)).toBe(before.stagingBefore)
    expect(r2WriteCount(before.fixture.productionMedia)).toBe(before.productionR2Before)
    expect(r2WriteCount(before.fixture.stagingMedia)).toBe(before.stagingR2Before)
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

describe('observed handler limitations', () => {
  it('records that the dashboard direct thumbnail PUT does not reach its staging write path in the handler harness', async () => {
    const testCase = MUTATION_MATRIX.find((item) => item.id === 'dashboard-thumbnail-upload')!
    const state = await buildFixture(testCase, 'staging')

    expect(state.result.status).toBe(400)
    expect(state.result.json).toMatchObject({ statusMessage: 'The selected thumbnail is empty.' })
    state.tripwire.assertClean()
    expect(stateSnapshot(state.fixture.production)).toBe(state.productionBefore)
    expect(stateSnapshot(state.fixture.staging)).toBe(state.stagingBefore)
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
    expect(staging.state.rateLimits.length).toBeGreaterThan(0)
  })
})
