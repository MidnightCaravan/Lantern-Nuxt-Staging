import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioBucket } from '../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  assertStudioWritable(identity)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  const { db, work } = await ownedStudioWork(event, identity, workId)
  if (work.status !== 'draft') throw createError({ statusCode: 409, statusMessage: 'Only draft works can be deleted from the dashboard.' })
  const pages = await db.prepare(`SELECT comic_pages.image_path FROM comic_pages JOIN comic_episodes ON comic_episodes.id = comic_pages.episode_id WHERE comic_episodes.work_id = ?`).bind(workId).all<any>()
  const keys = (pages.results ?? []).map((row: any) => String(row.image_path ?? '')).filter((key: string) => key.startsWith(`uploads/comics/${workId}/`))
  const cover = typeof work.cover === 'string' ? work.cover.replace(/^\/media\//, '') : ''
  const video = typeof work.video_path === 'string' ? work.video_path.replace(/^\/media\//, '') : ''
  const cleanup = [...new Set([...keys, ...(cover.startsWith(`uploads/covers/${workId}/`) ? [cover] : []), ...(video.startsWith(`uploads/videos/${workId}/`) ? [video] : [])])]
  if (cleanup.length) {
    const bucket = studioBucket(event)
    for (const key of cleanup) {
      try { await bucket.delete(key) } catch { throw createError({ statusCode: 503, statusMessage: 'Could not remove one or more stored images. Please retry.' }) }
    }
  }
  await db.prepare('DELETE FROM works WHERE id = ? AND creator_id = ? AND status = \'draft\'').bind(workId, identity.userId).run()
  return { ok: true, message: 'Draft deleted.' }
})
