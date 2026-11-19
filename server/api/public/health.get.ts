import { getLanternDatabase } from '../../utils/lantern-public'

export default defineEventHandler(async (event) => {
  const db = getLanternDatabase(event)
  const row = await db.prepare("SELECT COUNT(*) AS total FROM works WHERE status = 'published'").first()
  return { ok: true, publishedWorks: Number(row?.total ?? 0), mode: 'read-only' }
})
