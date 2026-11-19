import { createError, getRouterParam } from 'h3'
import { getLanternSessionIdentity } from '../../../utils/lantern-auth'
import { studioPublicContext, studioPublicMediaUrl } from '../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const username=String(getRouterParam(event,'username')??'').trim()
  if(!username||username.length>80) throw createError({statusCode:400,statusMessage:'Invalid creator.'})
  const {db,staging}=await studioPublicContext(event)
  const identity=await getLanternSessionIdentity(event)
  const profile=await db.prepare('SELECT id,username,display_name,bio,avatar,created_at FROM users WHERE username=? LIMIT 1').bind(username).first<any>()
  if(!profile) throw createError({statusCode:404,statusMessage:'Creator not found.'})
  const result=await db.prepare("SELECT id,title,description,type,status,cover,video_path,updated_at FROM works WHERE creator_id=? AND status='published' ORDER BY updated_at DESC").bind(profile.id).all<any>()
  const works=(result.results??[]).map((row:any)=>({...row,coverUrl:studioPublicMediaUrl(row.cover,staging),videoUrl:studioPublicMediaUrl(row.video_path,staging)}))
  const isOwner=Boolean(identity&&identity.database===(staging?'staging':'production')&&Number(identity.userId)===Number(profile.id))
  return {profile,works,isOwner,source:staging?'staging':'production'}
})
