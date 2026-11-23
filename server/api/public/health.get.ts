import {
  getConfiguredPublicReadDatabase,
  getLanternPublicDatabase,
} from '../../utils/lantern-public'

export default defineEventHandler(async (event) => {
  const source = getConfiguredPublicReadDatabase(event)
  const db = getLanternPublicDatabase(event, source)
  const row = await db.prepare("SELECT COUNT(*) AS total FROM works WHERE status = 'published'").first()
  return {
    ok: true,
    publishedWorks: Number(row?.total ?? 0),
    mode: 'read-only',
    source,
  }
})
