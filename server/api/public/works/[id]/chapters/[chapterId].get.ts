import { createError, getRouterParam } from 'h3'
import { publicWork } from '../../../../../utils/lantern-public'
import { studioPublicContext, studioPublicMediaUrl } from '../../../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const workId=Number(getRouterParam(event,'id')); const chapterId=Number(getRouterParam(event,'chapterId'))
  if(!Number.isSafeInteger(workId)||workId<=0||!Number.isSafeInteger(chapterId)||chapterId<=0) throw createError({statusCode:400,statusMessage:'Invalid work or chapter ID.'})
  const {db,staging}=await studioPublicContext(event)
  const workRow=await db.prepare(`SELECT works.*,users.username,users.display_name FROM works JOIN users ON users.id=works.creator_id WHERE works.id=? AND works.type='Novel' AND works.status='published' LIMIT 1`).bind(workId).first<any>()
  if(!workRow) throw createError({statusCode:404,statusMessage:'Published novel not found.'})
  const chapter=await db.prepare(`SELECT * FROM chapters WHERE id=? AND work_id=? AND status='published' AND TRIM(COALESCE(title,''))<>'' AND TRIM(COALESCE(content,''))<>'' LIMIT 1`).bind(chapterId,workId).first<any>()
  if(!chapter) throw createError({statusCode:404,statusMessage:'Published chapter not found.'})
  const n=Number(chapter.chapter_number)
  const previous=await db.prepare(`SELECT id,chapter_number,title FROM chapters WHERE work_id=? AND status='published' AND TRIM(COALESCE(title,''))<>'' AND TRIM(COALESCE(content,''))<>'' AND (chapter_number<? OR (chapter_number=? AND id<?)) ORDER BY chapter_number DESC,id DESC LIMIT 1`).bind(workId,n,n,chapterId).first<any>()
  const next=await db.prepare(`SELECT id,chapter_number,title FROM chapters WHERE work_id=? AND status='published' AND TRIM(COALESCE(title,''))<>'' AND TRIM(COALESCE(content,''))<>'' AND (chapter_number>? OR (chapter_number=? AND id>?)) ORDER BY chapter_number ASC,id ASC LIMIT 1`).bind(workId,n,n,chapterId).first<any>()
  const work={...publicWork(workRow),coverUrl:studioPublicMediaUrl(workRow.cover,staging),videoUrl:studioPublicMediaUrl(workRow.video_path,staging),contentSource:staging?'staging':'production'}
  return {work,chapter,previous,next,source:staging?'staging':'production'}
})
