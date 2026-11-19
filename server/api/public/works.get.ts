import { getQuery } from 'h3'
import { publicWork } from '../../utils/lantern-public'
import {
  studioPublicContext,
  studioPublicMediaUrl,
} from '../../utils/lantern-studio'

const ALLOWED_TYPES = new Set(['novel', 'comic', 'video'])

export default defineEventHandler(async (event) => {
  const { db, staging } = await studioPublicContext(event)
  const query = getQuery(event)

  const requestedType = String(query.type ?? '').trim().toLowerCase()
  const type = ALLOWED_TYPES.has(requestedType) ? requestedType : ''

  const baseSql = `
    SELECT works.*, users.username, users.display_name
    FROM works
    JOIN users ON users.id = works.creator_id
    WHERE works.status = 'published'
  `

  // The original Flask homepage requests its six newest published works.
  // Discover omits `limit`, so it continues to return the complete result set.
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit
  const parsedLimit = rawLimit == null ? NaN : Number(rawLimit)
  const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
    ? parsedLimit
    : null

  const orderedSql = type
    ? `${baseSql}
       AND LOWER(works.type) = ?
       ORDER BY works.updated_at DESC`
    : `${baseSql}
       ORDER BY works.updated_at DESC`

  const sql = limit === null ? orderedSql : `${orderedSql}\n       LIMIT ?`
  const params: Array<string | number> = []
  if (type) params.push(type)
  if (limit !== null) params.push(limit)

  const statement = db.prepare(sql)
  const result = params.length
    ? await statement.bind(...params).all<any>()
    : await statement.all<any>()

  const works = (result.results ?? []).map((row: any) => ({
    ...publicWork(row),
    coverUrl: studioPublicMediaUrl(row.cover, staging),
    videoUrl: studioPublicMediaUrl(row.video_path, staging),
    contentSource: staging ? 'staging' : 'production',
  }))

  return {
    works,
    type: type || 'all',
    source: staging ? 'staging' : 'production',
  }
})
