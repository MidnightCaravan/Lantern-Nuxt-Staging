export type FakeUser = {
  id: number
  username: string
  email: string
  password_hash: string
  display_name: string
  email_verified: number
  avatar?: string | null
}

export type FakeWork = {
  id: number
  creator_id: number
  title: string
  description: string
  type: string
  status: string
  cover?: string | null
  video_path?: string | null
  updated_at?: string
}

export type FakeEmailToken = {
  user_id: number
  token_hash: string
  token_type: string
  expires_at: string
  used: number
  created_at: string
}

export type FakeChapter = {
  id: number
  work_id: number
  chapter_number: number
  title: string
  content: string
  status: string
  created_at: string
  updated_at: string
}

export type FakeComicEpisode = {
  id: number
  work_id: number
  episode_number?: number
  title?: string
  status?: string
  created_at?: string
  updated_at?: string
}

export type FakeComicPage = {
  id?: number
  episode_id: number
  page_number?: number
  image_path: string
  created_at?: string
}

export type FakeComment = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  content_type: string
  content_id: number
}

export type FakeCommentLike = {
  comment_id: number
  user_id: number
  created_at: string
}

export type FakeCommentReport = {
  id?: number
  comment_id: number
  reporter_id: number
  reason: string
  status?: string
  created_at: string
}

export type FakeD1State = {
  users: FakeUser[]
  works: FakeWork[]
  emailTokens: FakeEmailToken[]
  chapters: FakeChapter[]
  comicEpisodes: FakeComicEpisode[]
  comicPages: FakeComicPage[]
  comments: FakeComment[]
  commentLikes: FakeCommentLike[]
  commentReports: FakeCommentReport[]
}

export type FakeD1 = {
  state: FakeD1State
  prepare: (sql: string) => {
    bind: (...params: any[]) => {
      first: <T = any>() => Promise<T | null>
      all: <T = any>() => Promise<{ results: T[] }>
      run: () => Promise<{ meta: { last_row_id: number; changes: number } }>
    }
  }
}

export function createFakeD1(initial: Partial<FakeD1State> = {}): FakeD1 {
  const state: FakeD1State = {
    users: initial.users ? [...initial.users] : [],
    works: initial.works ? [...initial.works] : [],
    emailTokens: initial.emailTokens ? [...initial.emailTokens] : [],
    chapters: initial.chapters ? [...initial.chapters] : [],
    comicEpisodes: initial.comicEpisodes ? [...initial.comicEpisodes] : [],
    comicPages: initial.comicPages ? [...initial.comicPages] : [],
    comments: initial.comments ? [...initial.comments] : [],
    commentLikes: initial.commentLikes ? [...initial.commentLikes] : [],
    commentReports: initial.commentReports ? [...initial.commentReports] : [],
  }
  let nextUserId = Math.max(0, ...state.users.map((user) => user.id)) + 1
  let nextChapterId = Math.max(0, ...state.chapters.map((chapter) => chapter.id)) + 1
  let nextPageId = Math.max(0, ...state.comicPages.map((page) => page.id ?? 0)) + 1
  let nextReportId = Math.max(0, ...state.commentReports.map((report) => report.id ?? 0)) + 1

  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

  function first(sqlText: string, params: any[]): any | null {
    const sql = normalize(sqlText)
    if (sql.includes('FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?')) {
      const [email, username] = params.map((value) => String(value).toLowerCase())
      return state.users.find((user) => user.email.toLowerCase() === email || user.username.toLowerCase() === username) ?? null
    }
    if (sql.includes('FROM users WHERE LOWER(email) = ? LIMIT 1')) {
      const email = String(params[0]).toLowerCase()
      return state.users.find((user) => user.email.toLowerCase() === email) ?? null
    }
    if (sql.includes('FROM users WHERE email = ?')) {
      const email = String(params[0])
      return state.users.find((user) => user.email === email) ?? null
    }
    if (sql.includes('FROM users WHERE id = ? LIMIT 1')) {
      return state.users.find((user) => user.id === Number(params[0])) ?? null
    }
    if (sql.includes('FROM works WHERE id = ? AND creator_id = ?')) {
      const [id, creatorId, type] = params
      return state.works.find((work) => work.id === Number(id)
        && work.creator_id === Number(creatorId)
        && (type === undefined || work.type === String(type))) ?? null
    }
    if (sql.includes("SELECT type FROM works WHERE id=? AND status='published'")) {
      const work = state.works.find((item) => item.id === Number(params[0]) && item.status === 'published')
      return work ? { type: work.type } : null
    }
    if (sql.includes('FROM email_tokens WHERE token_hash = ?')) {
      return state.emailTokens.find((token) => token.token_hash === String(params[0])) ?? null
    }
    if (sql.includes('FROM chapters JOIN works') && sql.includes('works.type = \'Novel\'')) {
      const chapter = state.chapters.find((item) => item.id === Number(params[0]))
      const work = chapter ? state.works.find((item) => item.id === chapter.work_id && item.creator_id === Number(params[1]) && item.type === 'Novel') : null
      if (!chapter || !work) return null
      return { ...chapter, creator_id: work.creator_id, work_title: work.title, work_type: work.type }
    }
    if (sql.includes('SELECT MAX(chapter_number) AS latest_number FROM chapters WHERE work_id = ?')) {
      const numbers = state.chapters.filter((chapter) => chapter.work_id === Number(params[0])).map((chapter) => chapter.chapter_number)
      return { latest_number: numbers.length ? Math.max(...numbers) : null }
    }
    if (sql.includes('INSERT INTO chapters') && sql.includes('RETURNING id')) {
      const [workId, chapterNumber, title, content, createdAt, updatedAt] = params
      const chapter: FakeChapter = {
        id: nextChapterId++,
        work_id: Number(workId),
        chapter_number: Number(chapterNumber),
        title: String(title),
        content: String(content),
        status: 'draft',
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      }
      state.chapters.push(chapter)
      return { id: chapter.id }
    }
    if (sql.includes('FROM comic_episodes') && sql.includes('works.creator_id = ?') && sql.includes("works.type = 'Comic'")) {
      const episode = state.comicEpisodes.find((item) => item.id === Number(params[0]))
      const work = episode ? state.works.find((item) => item.id === episode.work_id && item.creator_id === Number(params[1]) && item.type === 'Comic') : null
      if (!episode || !work) return null
      return { ...episode, creator_id: work.creator_id, work_status: work.status }
    }
    if (sql.includes('SELECT comic_pages.id, comic_pages.episode_id, comic_pages.image_path FROM comic_pages JOIN comic_episodes')) {
      const page = state.comicPages.find((item) => item.id === Number(params[0]))
      const episode = page ? state.comicEpisodes.find((item) => item.id === page.episode_id) : null
      const work = episode ? state.works.find((item) => item.id === episode.work_id && item.creator_id === Number(params[1]) && item.type === 'Comic') : null
      if (!page || !episode || !work) return null
      return { id: page.id, episode_id: page.episode_id, image_path: page.image_path }
    }
    if (sql.includes('SELECT MAX(page_number) AS latest_page FROM comic_pages WHERE episode_id = ?')) {
      const numbers = state.comicPages.filter((page) => page.episode_id === Number(params[0])).map((page) => page.page_number ?? 0)
      return { latest_page: numbers.length ? Math.max(...numbers) : null }
    }
    if (sql.includes('SELECT e.id,e.status AS episode_status')) {
      const episode = state.comicEpisodes.find((item) => item.id === Number(params[0]))
      const work = episode ? state.works.find((item) => item.id === episode.work_id && item.type === 'Comic') : null
      if (!episode || !work) return null
      return { id: episode.id, episode_status: episode.status, work_status: work.status, creator_id: work.creator_id }
    }
    if (sql.includes('FROM comments WHERE id=? AND content_type=? AND content_id=?')) {
      return state.comments.find((comment) => comment.id === Number(params[0])
        && comment.content_type === String(params[1])
        && comment.content_id === Number(params[2])) ?? null
    }
    if (sql.includes('SELECT 1 AS found FROM comment_likes')) {
      const like = state.commentLikes.find((item) => item.comment_id === Number(params[0]) && item.user_id === Number(params[1]))
      return like ? { found: 1 } : null
    }
    if (sql.includes('SELECT COUNT(*) AS count FROM comment_likes')) {
      return { count: state.commentLikes.filter((item) => item.comment_id === Number(params[0])).length }
    }
    throw new Error(`FakeD1.first: unhandled SQL: ${sql}`)
  }

  function all(sqlText: string, params: any[]): any[] {
    const sql = normalize(sqlText)
    if (sql.includes('FROM comic_pages JOIN comic_episodes') && sql.includes('comic_episodes.work_id = ?')) {
      const workId = Number(params[0])
      const episodeIds = new Set(state.comicEpisodes.filter((episode) => episode.work_id === workId).map((episode) => episode.id))
      return state.comicPages.filter((page) => episodeIds.has(page.episode_id))
    }
    throw new Error(`FakeD1.all: unhandled SQL: ${sql}`)
  }

  function run(sqlText: string, params: any[]): { meta: { last_row_id: number; changes: number } } {
    const sql = normalize(sqlText)
    if (sql.startsWith('INSERT INTO users')) {
      const [username, email, passwordHash, displayName, verified = 0] = params
      const user: FakeUser = {
        id: nextUserId++,
        username: String(username),
        email: String(email),
        password_hash: String(passwordHash),
        display_name: String(displayName),
        email_verified: Number(verified),
        avatar: null,
      }
      state.users.push(user)
      return { meta: { last_row_id: user.id, changes: 1 } }
    }
    if (sql.startsWith('UPDATE email_tokens SET used = 1')) {
      const userId = Number(params[0])
      let changes = 0
      for (const token of state.emailTokens) {
        if (token.user_id === userId && token.token_type === 'email_verification' && token.used === 0) {
          token.used = 1
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('INSERT INTO email_tokens')) {
      // The migration SQL uses literal values for token_type and used, so the
      // bound parameters are (user_id, token_hash, expires_at, created_at).
      const [userId, tokenHash, expiresAt, createdAt] = params
      state.emailTokens.push({
        user_id: Number(userId),
        token_hash: String(tokenHash),
        token_type: 'email_verification',
        expires_at: String(expiresAt),
        used: 0,
        created_at: String(createdAt),
      })
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('UPDATE works SET title = ?')) {
      const [title, description, updatedAt, id, creatorId] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id) && work.creator_id === Number(creatorId)) {
          work.title = String(title)
          work.description = String(description)
          work.updated_at = String(updatedAt)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('UPDATE works SET updated_at = ?')) {
      const [updatedAt, id] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id)) {
          work.updated_at = String(updatedAt)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('DELETE FROM works WHERE id = ? AND creator_id = ?')) {
      const [id, creatorId] = params
      const index = state.works.findIndex((work) => work.id === Number(id)
        && work.creator_id === Number(creatorId)
        && work.status === 'draft')
      if (index === -1) return { meta: { last_row_id: 0, changes: 0 } }
      state.works.splice(index, 1)
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('UPDATE chapters SET title = ?')) {
      const [title, content, updatedAt, id] = params
      const chapter = state.chapters.find((item) => item.id === Number(id))
      if (!chapter) return { meta: { last_row_id: 0, changes: 0 } }
      chapter.title = String(title)
      chapter.content = String(content)
      chapter.updated_at = String(updatedAt)
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO comic_pages')) {
      const [episodeId, pageNumber, imagePath, createdAt] = params
      const page: FakeComicPage = {
        id: nextPageId++,
        episode_id: Number(episodeId),
        page_number: Number(pageNumber),
        image_path: String(imagePath),
        created_at: String(createdAt),
      }
      state.comicPages.push(page)
      return { meta: { last_row_id: page.id!, changes: 1 } }
    }
    if (sql.startsWith('DELETE FROM comic_pages WHERE id = ?')) {
      const index = state.comicPages.findIndex((page) => page.id === Number(params[0]))
      if (index === -1) return { meta: { last_row_id: 0, changes: 0 } }
      state.comicPages.splice(index, 1)
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('UPDATE comic_episodes SET updated_at = ?')) {
      const [updatedAt, id] = params
      const episode = state.comicEpisodes.find((item) => item.id === Number(id))
      if (!episode) return { meta: { last_row_id: 0, changes: 0 } }
      episode.updated_at = String(updatedAt)
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('UPDATE comments SET body=?')) {
      const [body, id] = params
      const comment = state.comments.find((item) => item.id === Number(id))
      if (!comment) return { meta: { last_row_id: 0, changes: 0 } }
      comment.body = String(body)
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('DELETE FROM comments WHERE id=?')) {
      const parentId = Number(params[0])
      const ids = new Set([parentId, ...state.comments.filter((comment) => comment.parent_id === parentId).map((comment) => comment.id)])
      const before = state.comments.length
      state.comments = state.comments.filter((comment) => !ids.has(comment.id))
      state.commentLikes = state.commentLikes.filter((like) => !ids.has(like.comment_id))
      state.commentReports = state.commentReports.filter((report) => !ids.has(report.comment_id))
      return { meta: { last_row_id: 0, changes: before - state.comments.length } }
    }
    if (sql.startsWith('DELETE FROM comment_likes')) {
      const [commentId, userId] = params
      const before = state.commentLikes.length
      state.commentLikes = state.commentLikes.filter((like) => !(like.comment_id === Number(commentId) && like.user_id === Number(userId)))
      return { meta: { last_row_id: 0, changes: before - state.commentLikes.length } }
    }
    if (sql.startsWith('INSERT OR IGNORE INTO comment_likes')) {
      const [commentId, userId, createdAt] = params
      if (state.commentLikes.some((like) => like.comment_id === Number(commentId) && like.user_id === Number(userId))) {
        return { meta: { last_row_id: 0, changes: 0 } }
      }
      state.commentLikes.push({ comment_id: Number(commentId), user_id: Number(userId), created_at: String(createdAt) })
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('INSERT INTO comment_reports')) {
      const [commentId, reporterId, reason, createdAt] = params
      if (state.commentReports.some((report) => report.comment_id === Number(commentId) && report.reporter_id === Number(reporterId))) {
        throw new Error('UNIQUE constraint failed: comment_reports.comment_id, comment_reports.reporter_id')
      }
      const report: FakeCommentReport = {
        id: nextReportId++,
        comment_id: Number(commentId),
        reporter_id: Number(reporterId),
        reason: String(reason),
        status: 'open',
        created_at: String(createdAt),
      }
      state.commentReports.push(report)
      return { meta: { last_row_id: report.id!, changes: 1 } }
    }
    throw new Error(`FakeD1.run: unhandled SQL: ${sql}`)
  }

  return {
    state,
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first<T = any>() { return first(sql, params) as T | null },
            async all<T = any>() { return { results: all(sql, params) as T[] } },
            async run() { return run(sql, params) },
          }
        },
      }
    },
  }
}
