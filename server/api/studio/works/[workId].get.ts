import { createError, getRouterParam } from 'h3'
import {
  ownedStudioWork,
  requireStudioIdentity,
  studioPublicMediaUrl,
} from '../../../utils/lantern-studio'

export default defineEventHandler(async (event) => {
  const identity = await requireStudioIdentity(event)
  const workId = Number(getRouterParam(event, 'workId'))
  if (!Number.isSafeInteger(workId) || workId <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid work.' })
  const { work } = await ownedStudioWork(event, identity, workId)
  const staging = identity.database === 'staging'
  return {
    work: {
      ...work,
      id: Number(work.id),
      creator_id: Number(work.creator_id),
      coverUrl: studioPublicMediaUrl(work.cover, staging),
      videoUrl: studioPublicMediaUrl(work.video_path, staging),
    },
    writable: staging,
  }
})
