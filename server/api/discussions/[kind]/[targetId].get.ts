import { createError, getQuery, getRouterParam } from 'h3'
import { getLanternSessionIdentity } from '../../../utils/lantern-auth'
import { getConfiguredPublicReadDatabase } from '../../../utils/lantern-public'
import { studioPublicContext } from '../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const kind=String(getRouterParam(event,'kind')??''); const targetId=Number(getRouterParam(event,'targetId'))
  if(!['work','episode'].includes(kind)||!Number.isSafeInteger(targetId)||targetId<=0) throw createError({statusCode:400,statusMessage:'Invalid discussion.'})
  const requestedSource=String(getQuery(event).source??'').trim().toLowerCase()
  const identity=await getLanternSessionIdentity(event)
  if(requestedSource==='staging'&&identity?.database!=='staging'&&getConfiguredPublicReadDatabase(event)!=='staging') {
    throw createError({statusCode:404,statusMessage:'Staging discussion not found.'})
  }
  const publicContext=await studioPublicContext(event)
  const source=publicContext.staging?'staging':'production'
  const db=publicContext.db
  let entity:any
  if(kind==='work') entity=await db.prepare("SELECT id,type FROM works WHERE id=? AND lower(type) IN ('novel','video') AND status='published' LIMIT 1").bind(targetId).first<any>()
  else {
    entity=await db.prepare("SELECT e.id,e.status AS episode_status,w.status AS work_status,w.creator_id FROM comic_episodes e JOIN works w ON w.id=e.work_id WHERE e.id=? AND w.type='Comic' LIMIT 1").bind(targetId).first<any>()
  }
  if(!entity) throw createError({statusCode:404,statusMessage:kind==='episode'?'Episode not found.':'Published work not found.'})
  if(kind==='episode') {
    const isOwner=Boolean(identity&&identity.database===source&&Number(identity.userId)===Number(entity.creator_id))
    const isPublic=entity.work_status==='published'&&entity.episode_status==='published'
    if(!isPublic&&!isOwner) throw createError({statusCode:404,statusMessage:'Episode not found.'})
  }
  const contentType=kind==='episode'?'comic_episode':String(entity.type).toLowerCase()
  const viewerId=identity&&identity.database===source?Number(identity.userId):-1
  const result=await db.prepare(`SELECT c.id,c.user_id,c.parent_id,c.body,c.created_at,u.username,u.display_name,u.avatar,(SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) AS like_count,(SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) AS liked_by_current_user FROM comments c JOIN users u ON u.id=c.user_id WHERE c.content_type=? AND c.content_id=? ORDER BY c.created_at ASC,c.id ASC`).bind(viewerId,contentType,targetId).all<any>()
  return {success:true,source,writable:source==='staging'&&identity?.database==='staging',comments:(result.results??[]).map((row:any)=>({id:Number(row.id),parent_id:row.parent_id==null?null:Number(row.parent_id),body:String(row.body),created_at:String(row.created_at),username:String(row.username),display_name:String(row.display_name??''),avatar:String(row.avatar??''),like_count:Number(row.like_count??0),liked_by_current_user:Boolean(row.liked_by_current_user),is_mine:viewerId>0&&Number(row.user_id)===viewerId}))}
})
