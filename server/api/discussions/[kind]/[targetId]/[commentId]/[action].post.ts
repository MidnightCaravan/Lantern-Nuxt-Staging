import { createError, getQuery, getRouterParam, readBody, setResponseStatus } from 'h3'
import { assertSameOriginAndCsrf } from '../../../../../utils/lantern-auth'
import { assertStudioWritable, requireStudioIdentity, studioDb, studioNow } from '../../../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const identity=await requireStudioIdentity(event)
  const kind=String(getRouterParam(event,'kind')??''); const targetId=Number(getRouterParam(event,'targetId')); const commentId=Number(getRouterParam(event,'commentId')); const action=String(getRouterParam(event,'action')??''); const source=String(getQuery(event).source??'production')
  if(!['work','episode'].includes(kind)||![targetId,commentId].every(n=>Number.isSafeInteger(n)&&n>0)||!['like','edit','delete','report'].includes(action)) throw createError({statusCode:400,statusMessage:'Invalid comment action.'})
  const body=await readBody<{body?:unknown;reason?:unknown;csrfToken?:unknown}>(event); assertSameOriginAndCsrf(event,body?.csrfToken); assertStudioWritable(event, identity)
  if((identity.database==='staging')!==(source==='staging')) throw createError({statusCode:409,statusMessage:identity.database==='staging'?'Production discussions are read-only in this staging build.':'This staging preview is not available.'})
  const db=studioDb(event,identity); let contentType:string
  if(kind==='episode'){
    const episode=await db.prepare("SELECT e.id,e.status AS episode_status,w.status AS work_status,w.creator_id FROM comic_episodes e JOIN works w ON w.id=e.work_id WHERE e.id=? AND w.type='Comic' LIMIT 1").bind(targetId).first<any>()
    const isOwner=Boolean(episode&&Number(episode.creator_id)===identity.userId)
    const isPublic=Boolean(episode&&episode.work_status==='published'&&episode.episode_status==='published')
    if(!episode||(!isPublic&&!isOwner)) throw createError({statusCode:404,statusMessage:'Episode not found.'})
    contentType='comic_episode'
  } else {
    const work=await db.prepare("SELECT type FROM works WHERE id=? AND status='published' AND lower(type) IN ('novel','video') LIMIT 1").bind(targetId).first<any>()
    if(!work) throw createError({statusCode:404,statusMessage:'Published work not found.'}); contentType=String(work.type).toLowerCase()
  }
  const comment=await db.prepare('SELECT id,user_id,parent_id,body FROM comments WHERE id=? AND content_type=? AND content_id=? LIMIT 1').bind(commentId,contentType,targetId).first<any>()
  if(!comment) throw createError({statusCode:404,statusMessage:'Comment not found.'})
  if(action==='like'){
    const existing=await db.prepare('SELECT 1 AS found FROM comment_likes WHERE comment_id=? AND user_id=?').bind(commentId,identity.userId).first<any>()
    if(existing) await db.prepare('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?').bind(commentId,identity.userId).run()
    else await db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id,user_id,created_at) VALUES (?,?,?)').bind(commentId,identity.userId,studioNow()).run()
    const count=await db.prepare('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id=?').bind(commentId).first<any>()
    return {success:true,liked:!existing,like_count:Number(count?.count??0)}
  }
  if(action==='edit'){
    if(Number(comment.user_id)!==identity.userId) throw createError({statusCode:403,statusMessage:'You can only edit your own comments.'})
    const value=typeof body?.body==='string'?body.body.trim():''
    if(!value) throw createError({statusCode:400,statusMessage:'Comment cannot be empty.'})
    if(value.length>5000) throw createError({statusCode:400,statusMessage:'Comment is too long.'})
    await db.prepare('UPDATE comments SET body=? WHERE id=?').bind(value,commentId).run(); return {success:true,body:value}
  }
  if(action==='delete'){
    if(Number(comment.user_id)!==identity.userId) throw createError({statusCode:403,statusMessage:'You can only delete your own comments.'})
    await db.prepare('DELETE FROM comments WHERE id=?').bind(commentId).run(); return {success:true}
  }
  if(Number(comment.user_id)===identity.userId) throw createError({statusCode:400,statusMessage:'You cannot report your own comment.'})
  const reason=typeof body?.reason==='string'?body.reason.trim():''
  if(!reason) throw createError({statusCode:400,statusMessage:'Please provide a reason for the report.'})
  if(reason.length>1000) throw createError({statusCode:400,statusMessage:'Report reason is too long.'})
  try{await db.prepare('INSERT INTO comment_reports (comment_id,reporter_id,reason,created_at) VALUES (?,?,?,?)').bind(commentId,identity.userId,reason,studioNow()).run()}catch{throw createError({statusCode:409,statusMessage:'You have already reported this comment.'})}
  setResponseStatus(event,201)
  return {success:true,message:'Thank you. Your report was submitted.'}
})
