export type FakeUser = {
  id: number
  username: string
  email: string
  password_hash: string
  display_name: string
  bio?: string
  email_verified: number
  avatar?: string | null
  created_at?: string
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
  created_at?: string
  updated_at?: string
}

export type FakeEmailToken = {
  id?: number
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

export type FakeRateLimit = {
  key_hash: string
  window_started_at: number
  attempts: number
  expires_at: number
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
  rateLimits: FakeRateLimit[]
}

export type FakeD1Statement = {
  first: <T = any>() => Promise<T | null>
  all: <T = any>() => Promise<{ results: T[] }>
  run: () => Promise<{ meta: { last_row_id: number; changes: number } }>
  bind: (...params: any[]) => FakeD1Statement
}

export type FakeD1 = {
  state: FakeD1State
  prepare: (sql: string) => FakeD1Statement
  batch: (statements: FakeD1Statement[]) => Promise<Array<{ meta: { last_row_id: number; changes: number } }>>
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
    rateLimits: initial.rateLimits ? [...initial.rateLimits] : [],
  }
  let nextUserId = Math.max(0, ...state.users.map((user) => user.id)) + 1
  let nextTokenId = Math.max(0, ...state.emailTokens.map((token) => token.id ?? 0)) + 1
  let nextWorkId = Math.max(0, ...state.works.map((work) => work.id)) + 1
  let nextChapterId = Math.max(0, ...state.chapters.map((chapter) => chapter.id)) + 1
  let nextPageId = Math.max(0, ...state.comicPages.map((page) => page.id ?? 0)) + 1
  let nextReportId = Math.max(0, ...state.commentReports.map((report) => report.id ?? 0)) + 1


  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()
  const snapshot = <T>(value: T): T => value == null ? value : structuredClone(value)

  function first(sqlText: string, params: any[]): any | null {
    const sql = normalize(sqlText)
    if (sql.startsWith('INSERT INTO auth_rate_limits') && sql.includes('RETURNING attempts')) {
      const [keyHash, windowStart, expiresAt] = params
      let row = state.rateLimits.find((item) => item.key_hash === String(keyHash))
      if (!row) {
        row = {
          key_hash: String(keyHash),
          window_started_at: Number(windowStart),
          attempts: 1,
          expires_at: Number(expiresAt),
        }
        state.rateLimits.push(row)
      } else {
        row.attempts = row.window_started_at === Number(windowStart) ? row.attempts + 1 : 1
        row.window_started_at = Number(windowStart)
        row.expires_at = Number(expiresAt)
      }
      return { attempts: row.attempts }
    }
    if (sql.includes('FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?')) {
      const [email, username] = params.map((value) => String(value).toLowerCase())
      return state.users.find((user) => user.email.toLowerCase() === email || user.username.toLowerCase() === username) ?? null
    }
    if (/FROM users WHERE lower\(email\) = \? LIMIT 1/i.test(sql)) {
      const email = String(params[0]).toLowerCase()
      return state.users.find((user) => user.email.toLowerCase() === email) ?? null
    }
    if (sql.includes('FROM users WHERE email = ?')) {
      const email = String(params[0])
      return state.users.find((user) => user.email === email) ?? null
    }
    if (sql.includes('SELECT id, username, email, display_name, bio, avatar, created_at, email_verified FROM users WHERE id = ? LIMIT 1')) {
      const user = state.users.find((item) => item.id === Number(params[0]))
      if (!user) return null
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        bio: user.bio ?? '',
        avatar: user.avatar ?? null,
        created_at: user.created_at ?? null,
        email_verified: user.email_verified,
      }
    }
    if (sql.includes('SELECT username,display_name,avatar FROM users WHERE id = ?')) {
      const user = state.users.find(item => item.id === Number(params[0]))
      return user
        ? { username: user.username, display_name: user.display_name, avatar: user.avatar ?? null }
        : null
    }
    if (sql.includes('FROM users WHERE id = ? LIMIT 1')) {
      return state.users.find((user) => user.id === Number(params[0])) ?? null
    }
    if (sql.includes('FROM users WHERE username = ? AND id != ?')) {
      return state.users.find((user) => user.username === String(params[0])
        && user.id !== Number(params[1])) ?? null
    }
    if (sql.startsWith('INSERT INTO works (creator_id,title,description,type,status,created_at,updated_at) VALUES') && sql.includes('RETURNING id')) {
      const [creatorId, title, description, type, createdAt, updatedAt] = params
      const work = {
        id: nextWorkId++,
        creator_id: Number(creatorId),
        title: String(title),
        description: String(description),
        type: String(type),
        status: 'draft',
        cover: null,
        video_path: null,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      }
      state.works.push(work)
      return { id: work.id }
    }
    if (sql.includes('SELECT comic_pages.image_path FROM comic_pages JOIN comic_episodes')) {
      const workId = Number(params[0])
      const pages = state.comicPages
        .flatMap((page) => {
          const episode = state.comicEpisodes.find((item) => item.id === page.episode_id && item.work_id === workId)
          return episode ? [{ page, episode }] : []
        })
        .sort((a, b) => (a.episode.episode_number ?? 0) - (b.episode.episode_number ?? 0)
          || (a.page.page_number ?? 0) - (b.page.page_number ?? 0))
      return pages[0] ? { image_path: pages[0].page.image_path } : null
    }
    if (sql.includes("FROM works WHERE id=? AND lower(type) IN ('novel','video')")
      || sql.includes("FROM works WHERE id = ? AND lower(type) IN ('novel','video')")) {
      const work = state.works.find(item => item.id === Number(params[0])
        && ['novel', 'video'].includes(item.type.toLowerCase())
        && item.status === 'published')
      return work ? { id: work.id, type: work.type, status: work.status } : null
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
      const now = new Date().toISOString()
      const token = state.emailTokens.find((item) => item.token_hash === String(params[0])
        && (!sql.includes("token_type = 'email_verification'") || item.token_type === 'email_verification')
        && (!sql.includes("token_type = 'password_reset'") || item.token_type === 'password_reset')
        && (!sql.includes('used = 0') || item.used === 0)
        && (!sql.includes('expires_at > ?') || item.expires_at > String(params[1]))
        && (!sql.includes("datetime(expires_at) > datetime('now')") || item.expires_at > now))
      return token ? { id: token.id, user_id: token.user_id, token_type: token.token_type } : null
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
    if (sql.includes('SELECT MAX(episode_number) AS latest_number FROM comic_episodes WHERE work_id = ?')) {
      const numbers = state.comicEpisodes
        .filter((episode) => episode.work_id === Number(params[0]))
        .map((episode) => episode.episode_number ?? 0)
      return { latest_number: numbers.length ? Math.max(...numbers) : null }
    }
    if (sql.includes('INSERT INTO comic_episodes') && sql.includes('RETURNING id')) {
      const [workId, episodeNumber, title, createdAt, updatedAt] = params
      const episode: FakeComicEpisode = {
        id: Math.max(0, ...state.comicEpisodes.map(item => item.id)) + 1,
        work_id: Number(workId),
        episode_number: Number(episodeNumber),
        title: String(title),
        status: 'draft',
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      }
      state.comicEpisodes.push(episode)
      return { id: episode.id }
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
    if (sql.includes('FROM comments WHERE id=? AND content_type=? AND content_id=?')
      || sql.includes('FROM comments WHERE id = ? AND content_type = ? AND content_id = ?')) {
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
    if (sql.includes('SELECT video_path FROM works WHERE id = ? AND creator_id = ? AND type = \'Video\'')) {
      const work = state.works.find((item) => item.id === Number(params[0])
        && item.creator_id === Number(params[1])
        && item.type === 'Video')
      return work ? { video_path: work.video_path ?? null } : null
    }
    if (sql.includes('SELECT 1 AS found FROM works WHERE (creator_id = ? OR status = \'published\')')) {
      const userId = Number(params[0])
      const paths = params.slice(1).map(String)
      const found = state.works.some((item) => (item.creator_id === userId || item.status === 'published')
        && (paths.includes(String(item.cover ?? '')) || paths.includes(String(item.video_path ?? ''))))
      return found ? { found: 1 } : null
    }
    if (sql.includes('SELECT 1 AS found FROM comic_pages p JOIN comic_episodes e')) {
      const userId = Number(params[0])
      const imagePath = String(params[1])
      const found = state.comicPages.some((page) => {
        if (page.image_path !== imagePath) return false
        const episode = state.comicEpisodes.find((item) => item.id === page.episode_id)
        const work = episode ? state.works.find((item) => item.id === episode.work_id) : null
        return Boolean(work && (work.creator_id === userId
          || (work.status === 'published' && episode?.status === 'published')))
      })
      return found ? { found: 1 } : null
    }
    if (sql.includes('FROM works JOIN users ON users.id=works.creator_id') && sql.includes("works.status='published'")) {
      const work = state.works.find((item) => item.id === Number(params[0]) && item.status === 'published')
      const user = work ? state.users.find((item) => item.id === work.creator_id) : null
      return work && user ? { ...work, username: user.username, display_name: user.display_name } : null
    }
    if (sql.startsWith('SELECT * FROM chapters WHERE id=? AND work_id=? AND status=\'published\'')) {
      return state.chapters.find((chapter) => chapter.id === Number(params[0])
        && chapter.work_id === Number(params[1])
        && chapter.status === 'published'
        && chapter.title.trim()
        && chapter.content.trim()) ?? null
    }
    if (sql.startsWith('SELECT id,chapter_number,title FROM chapters WHERE work_id=? AND status=\'published\'')) {
      const [workId, chapterNumber, , currentId] = params.map(Number)
      const candidates = state.chapters.filter((chapter) => chapter.work_id === workId
        && chapter.status === 'published'
        && chapter.title.trim()
        && chapter.content.trim()
        && (sql.includes('chapter_number<?')
          ? chapter.chapter_number < chapterNumber || (chapter.chapter_number === chapterNumber && chapter.id < currentId)
          : chapter.chapter_number > chapterNumber || (chapter.chapter_number === chapterNumber && chapter.id > currentId)))
      candidates.sort((a, b) => sql.includes('chapter_number<?')
        ? b.chapter_number - a.chapter_number || b.id - a.id
        : a.chapter_number - b.chapter_number || a.id - b.id)
      const chapter = candidates[0]
      return chapter ? { id: chapter.id, chapter_number: chapter.chapter_number, title: chapter.title } : null
    }
    if (sql.includes('FROM comic_episodes JOIN works ON works.id = comic_episodes.work_id') && sql.includes("works.status = 'published'")) {
      const episode = state.comicEpisodes.find((item) => item.id === Number(params[0])
        && item.status === 'published')
      const work = episode ? state.works.find((item) => item.id === episode.work_id
        && item.type === 'Comic' && item.status === 'published') : null
      if (!episode || !work) return null
      return { ...episode, creator_id: work.creator_id, work_title: work.title, work_status: work.status, work_id: work.id }
    }
    if (sql.includes('FROM comic_episodes e JOIN works w ON w.id=e.work_id JOIN users u ON u.id=w.creator_id')) {
      const episode = state.comicEpisodes.find((item) => item.id === Number(params[0]))
      const work = episode ? state.works.find((item) => item.id === episode.work_id
        && item.type === 'Comic' && item.status === 'published'
        && episode.status === 'published') : null
      const user = work ? state.users.find((item) => item.id === work.creator_id) : null
      if (!episode || !work || !user) return null
      return {
        ...episode,
        work_title: work.title,
        creator_id: work.creator_id,
        work_status: work.status,
        work_id: work.id,
        work_description: work.description,
        work_cover: work.cover ?? null,
        username: user.username,
        display_name: user.display_name,
      }
    }
    if (sql.startsWith('SELECT COUNT(*) AS count FROM comic_pages WHERE episode_id = ?')) {
      return { count: state.comicPages.filter((page) => page.episode_id === Number(params[0])).length }
    }
    if (sql.startsWith('SELECT id,episode_number,title FROM comic_episodes WHERE work_id=? AND episode_number<?')) {
      const [workId, currentNumber] = params.map(Number)
      const episode = state.comicEpisodes.filter((item) => item.work_id === workId
        && item.status === 'published'
        && (item.episode_number ?? 0) < currentNumber)
        .sort((a, b) => (b.episode_number ?? 0) - (a.episode_number ?? 0))[0]
      return episode ? { id: episode.id, episode_number: episode.episode_number, title: episode.title } : null
    }
    if (sql.startsWith('SELECT id,episode_number,title FROM comic_episodes WHERE work_id=? AND episode_number>?')) {
      const [workId, currentNumber] = params.map(Number)
      const episode = state.comicEpisodes.filter((item) => item.work_id === workId
        && item.status === 'published'
        && (item.episode_number ?? 0) > currentNumber)
        .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))[0]
      return episode ? { id: episode.id, episode_number: episode.episode_number, title: episode.title } : null
    }
    if (sql.startsWith('SELECT id, episode_number, title FROM comic_episodes') && sql.includes("? = 0 OR status = 'published'")) {
      const [workId, currentNumber, publishedOnly] = params.map(Number)
      const candidates = state.comicEpisodes.filter((item) => item.work_id === workId
        && (publishedOnly === 0 || item.status === 'published')
        && (sql.includes('episode_number < ?')
          ? (item.episode_number ?? 0) < currentNumber
          : (item.episode_number ?? 0) > currentNumber))
      candidates.sort((a, b) => sql.includes('episode_number < ?')
        ? (b.episode_number ?? 0) - (a.episode_number ?? 0)
        : (a.episode_number ?? 0) - (b.episode_number ?? 0))
      const episode = candidates[0]
      return episode ? { id: episode.id, episode_number: episode.episode_number, title: episode.title } : null
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
    if (sql.includes('SELECT works.*, users.username, users.display_name') && sql.includes("works.status = 'published'")) {
      const hasType = sql.includes('LOWER(works.type) = ?')
      const hasLimit = sql.includes('LIMIT ?')
      const type = hasType ? String(params[0]).toLowerCase() : ''
      const limit = hasLimit ? Number(params[hasType ? 1 : 0]) : null
      let rows = state.works.filter((work) => work.status === 'published'
        && (!type || work.type.toLowerCase() === type))
      rows = rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      if (limit !== null) rows = rows.slice(0, limit)
      return rows.map((work) => {
        const user = state.users.find((item) => item.id === work.creator_id)
        return { ...work, username: user?.username ?? '', display_name: user?.display_name ?? '' }
      })
    }
    if (sql.startsWith('SELECT id FROM chapters WHERE work_id = ? AND TRIM(COALESCE(title')) {
      return state.chapters.filter((chapter) => chapter.work_id === Number(params[0])
        && chapter.title.trim() && chapter.content.trim())
        .map((chapter) => ({ id: chapter.id }))
    }
    if (sql.includes('SELECT comic_episodes.id, comic_episodes.episode_number, COUNT(comic_pages.id) AS page_count')) {
      return state.comicEpisodes.filter((episode) => episode.work_id === Number(params[0]))
        .map((episode) => ({
          id: episode.id,
          episode_number: episode.episode_number,
          title: episode.title,
          page_count: state.comicPages.filter((page) => page.episode_id === episode.id).length,
        }))
        .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
    }
    if (sql.startsWith('SELECT id,chapter_number,title,updated_at FROM chapters WHERE work_id=? AND status=\'published\'')) {
      return state.chapters.filter((chapter) => chapter.work_id === Number(params[0])
        && chapter.status === 'published'
        && chapter.title.trim()
        && chapter.content.trim())
        .map((chapter) => ({
          id: chapter.id,
          chapter_number: chapter.chapter_number,
          title: chapter.title,
          updated_at: chapter.updated_at,
        }))
        .sort((a, b) => a.chapter_number - b.chapter_number)
    }
    if (sql.includes('FROM comic_episodes e WHERE e.work_id=? AND e.status=\'published\'')) {
      return state.comicEpisodes.filter((episode) => episode.work_id === Number(params[0])
        && episode.status === 'published')
        .map((episode) => ({
          id: episode.id,
          episode_number: episode.episode_number,
          title: episode.title,
          updated_at: episode.updated_at,
          page_count: state.comicPages.filter((page) => page.episode_id === episode.id).length,
        }))
        .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0))
    }
    if (sql.startsWith('SELECT id, episode_id, page_number, image_path FROM comic_pages WHERE episode_id')) {
      return state.comicPages.filter((page) => page.episode_id === Number(params[0]))
        .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))
        .map((page) => ({ id: page.id, episode_id: page.episode_id, page_number: page.page_number, image_path: page.image_path }))
    }
    if (sql.startsWith('SELECT id,page_number,image_path FROM comic_pages WHERE episode_id')) {
      return state.comicPages.filter((page) => page.episode_id === Number(params[0]))
        .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))
        .map((page) => ({ id: page.id, page_number: page.page_number, image_path: page.image_path }))
    }
    if (sql.includes('FROM comments c JOIN users u ON u.id=c.user_id')) {
      const [viewerId, contentType, contentId] = params
      return state.comments
        .filter((comment) => comment.content_type === String(contentType) && comment.content_id === Number(contentId))
        .sort((a, b) => a.id - b.id)
        .map((comment) => {
          const user = state.users.find((item) => item.id === comment.user_id)
          const likes = state.commentLikes.filter((item) => item.comment_id === comment.id)
          return {
            id: comment.id,
            user_id: comment.user_id,
            parent_id: comment.parent_id,
            body: comment.body,
            created_at: '2026-01-01T00:00:00.000Z',
            username: user?.username ?? '',
            display_name: user?.display_name ?? '',
            avatar: user?.avatar ?? null,
            like_count: likes.length,
            liked_by_current_user: likes.some((item) => item.user_id === Number(viewerId)),
          }
        })
    }
    throw new Error(`FakeD1.all: unhandled SQL: ${sql}`)
  }

  function run(sqlText: string, params: any[]): { meta: { last_row_id: number; changes: number } } {
    const sql = normalize(sqlText)
    if (sql.startsWith('DELETE FROM auth_rate_limits WHERE expires_at <= ?')) {
      const before = state.rateLimits.length
      state.rateLimits = state.rateLimits.filter((item) => item.expires_at > Number(params[0]))
      return { meta: { last_row_id: 0, changes: before - state.rateLimits.length } }
    }
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
      const now = new Date().toISOString()
      let changes = 0
      for (const token of state.emailTokens) {
        if (sql.includes('WHERE id = ?') && token.id !== Number(params[0])) continue
        if (sql.includes('WHERE user_id = ?') && token.user_id !== Number(params[0])) continue
        if (sql.includes('used = 0') && token.used !== 0) continue
        if (sql.includes("token_type = 'email_verification'") && token.token_type !== 'email_verification') continue
        if (sql.includes("token_type = 'password_reset'") && token.token_type !== 'password_reset') continue
        if (sql.includes("datetime(expires_at) > datetime('now')") && token.expires_at <= now) continue
        token.used = 1
        changes++
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('INSERT INTO email_tokens')) {
      // Handlers use literal values for token_type and used, so the bound
      // parameters are (user_id, token_hash, expires_at, created_at).
      const [userId, tokenHash, expiresAt, createdAt] = params
      const token: FakeEmailToken = {
        id: nextTokenId++,
        user_id: Number(userId),
        token_hash: String(tokenHash),
        token_type: sql.includes("'password_reset'") ? 'password_reset' : 'email_verification',
        expires_at: String(expiresAt),
        used: 0,
        created_at: String(createdAt),
      }
      state.emailTokens.push(token)
      return { meta: { last_row_id: token.id!, changes: 1 } }
    }
    if (sql.startsWith('UPDATE users SET email_verified = 1 WHERE id = ?')) {
      const user = state.users.find((item) => item.id === Number(params[0]))
      if (!user) return { meta: { last_row_id: 0, changes: 0 } }
      user.email_verified = 1
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('UPDATE users SET password_hash = ? WHERE id = ?')) {
      const user = state.users.find((item) => item.id === Number(params[1]))
      if (!user) return { meta: { last_row_id: 0, changes: 0 } }
      user.password_hash = String(params[0])
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    if (sql.startsWith('UPDATE users SET username = ?, display_name = ?, bio = ?, avatar = ? WHERE id = ?')) {
      const [username, displayName, bio, avatar, id] = params
      const user = state.users.find((item) => item.id === Number(id))
      if (!user) return { meta: { last_row_id: 0, changes: 0 } }
      user.username = String(username)
      user.display_name = String(displayName)
      user.bio = String(bio)
      user.avatar = avatar === null || avatar === undefined ? null : String(avatar)
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
    if (sql.startsWith('UPDATE works SET cover = NULL, updated_at = ?')) {
      const [updatedAt, id, creatorId] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id) && work.creator_id === Number(creatorId)) {
          work.cover = null
          work.updated_at = String(updatedAt)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('UPDATE works SET cover = ?, updated_at = ?')) {
      const [cover, updatedAt, id, creatorId] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id) && work.creator_id === Number(creatorId)) {
          work.cover = String(cover)
          work.updated_at = String(updatedAt)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('UPDATE works SET video_path = ?')) {
      const [videoPath, updatedAt, id, creatorId] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id) && work.creator_id === Number(creatorId) && work.type === 'Video') {
          work.video_path = String(videoPath)
          work.updated_at = String(updatedAt)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith('DELETE FROM comic_pages WHERE episode_id IN')) {
      const workId = Number(params[0])
      const episodeIds = new Set(state.comicEpisodes.filter((episode) => episode.work_id === workId).map((episode) => episode.id))
      const before = state.comicPages.length
      state.comicPages = state.comicPages.filter((page) => !episodeIds.has(page.episode_id))
      return { meta: { last_row_id: 0, changes: before - state.comicPages.length } }
    }
    if (sql.startsWith('DELETE FROM comic_episodes WHERE work_id = ?')) {
      const workId = Number(params[0])
      const before = state.comicEpisodes.length
      state.comicEpisodes = state.comicEpisodes.filter((episode) => episode.work_id !== workId)
      return { meta: { last_row_id: 0, changes: before - state.comicEpisodes.length } }
    }
    if (sql.startsWith('DELETE FROM chapters WHERE work_id = ?')) {
      const workId = Number(params[0])
      const before = state.chapters.length
      state.chapters = state.chapters.filter((chapter) => chapter.work_id !== workId)
      return { meta: { last_row_id: 0, changes: before - state.chapters.length } }
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
    if (sql.startsWith('UPDATE comic_episodes SET title = ?')) {
      const [title, updatedAt, id] = params
      const episode = state.comicEpisodes.find((item) => item.id === Number(id))
      if (!episode) return { meta: { last_row_id: 0, changes: 0 } }
      episode.title = String(title)
      episode.updated_at = String(updatedAt)
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
    if (sql.startsWith('INSERT INTO comments')) {
      const [userId, contentType, contentId, parentId, body] = params
      const comment: FakeComment = {
        id: Math.max(0, ...state.comments.map(item => item.id)) + 1,
        user_id: Number(userId),
        parent_id: parentId === null || parentId === undefined ? null : Number(parentId),
        body: String(body),
        content_type: String(contentType),
        content_id: Number(contentId),
      }
      state.comments.push(comment)
      return { meta: { last_row_id: comment.id, changes: 1 } }
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
    if (sql.startsWith("UPDATE chapters SET status = 'draft', updated_at = ? WHERE work_id = ?")) {
      const [now, workId] = params
      let changes = 0
      for (const chapter of state.chapters) {
        if (chapter.work_id === Number(workId)
          && (!chapter.title.trim() || !chapter.content.trim())) {
          chapter.status = 'draft'
          chapter.updated_at = String(now)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith("UPDATE chapters SET status = 'published', updated_at = ? WHERE work_id = ?")) {
      const [now, workId] = params
      let changes = 0
      for (const chapter of state.chapters) {
        if (chapter.work_id === Number(workId) && chapter.title.trim() && chapter.content.trim()) {
          chapter.status = 'published'
          chapter.updated_at = String(now)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith("UPDATE works SET status = 'draft', updated_at = ? WHERE id = ?")) {
      const [now, id, creatorId] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id) && work.creator_id === Number(creatorId)) {
          work.status = 'draft'
          work.updated_at = String(now)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith("UPDATE works SET status = 'published', updated_at = ? WHERE id = ?")) {
      const [now, id, creatorId] = params
      let changes = 0
      for (const work of state.works) {
        if (work.id === Number(id) && work.creator_id === Number(creatorId)) {
          work.status = 'published'
          work.updated_at = String(now)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith("UPDATE comic_episodes SET status = 'published', updated_at = ? WHERE work_id = ?")) {
      const [now, workId] = params
      let changes = 0
      for (const episode of state.comicEpisodes) {
        if (episode.work_id === Number(workId)) {
          episode.status = 'published'
          episode.updated_at = String(now)
          changes++
        }
      }
      return { meta: { last_row_id: 0, changes } }
    }
    if (sql.startsWith("UPDATE comic_episodes SET status = 'published', updated_at = ? WHERE id = ?")) {
      const [now, id] = params
      const episode = state.comicEpisodes.find((item) => item.id === Number(id))
      if (!episode) return { meta: { last_row_id: 0, changes: 0 } }
      episode.status = 'published'
      episode.updated_at = String(now)
      return { meta: { last_row_id: 0, changes: 1 } }
    }
    throw new Error(`FakeD1.run: unhandled SQL: ${sql}`)
  }

  function statement(sql: string, params: any[] = []): FakeD1Statement {
    return {
      async first<T = any>() { return snapshot(first(sql, params)) as T | null },
      async all<T = any>() { return { results: snapshot(all(sql, params)) as T[] } },
      async run() { return run(sql, params) },
      bind(...nextParams: any[]) { return statement(sql, nextParams) },
    }
  }

  return {
    state,
    prepare(sql: string) { return statement(sql) },
    async batch(statements: FakeD1Statement[]) {
      const results: Array<{ meta: { last_row_id: number; changes: number } }> = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }
}
