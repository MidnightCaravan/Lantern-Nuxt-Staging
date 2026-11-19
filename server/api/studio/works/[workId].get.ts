import { createError, getRouterParam } from 'h3'
import { requireStudioIdentity, ownedStudioWork } from '../../../utils/lantern-studio'
import { lanternMediaUrl } from '../../../utils/lantern-public'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  const { work } = await ownedStudioWork(event, identity, workId)
  return { work: { ...work, id: Number(work.id), creator_id: Number(work.creator_id), coverUrl: lanternMediaUrl(work.cover), videoUrl: lanternMediaUrl(work.video_path) }, writable: identity.database === 'staging' }
})
