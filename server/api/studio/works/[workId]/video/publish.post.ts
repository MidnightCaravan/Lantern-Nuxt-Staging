import { createError, getRouterParam, readBody } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, ownedStudioWork, requireStudioIdentity, studioNow } from '../../../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid video.' })
  const body = await readBody<{ csrfToken?: unknown }>(event)
  assertSameOriginAndCsrf(event, body?.csrfToken)
  assertStudioWritable(event, identity)
  const { db, work } = await ownedStudioWork(event, identity, workId, 'Video')
  if (!work.video_path) throw createError({ statusCode: 400, statusMessage: 'Upload a video before publishing.' })
  await db.prepare(`UPDATE works SET status = 'published', updated_at = ? WHERE id = ? AND creator_id = ? AND type = 'Video'`).bind(studioNow(), workId, identity.userId).run()
  return { ok: true, message: 'Your video is now published on Lantern.' }
})
