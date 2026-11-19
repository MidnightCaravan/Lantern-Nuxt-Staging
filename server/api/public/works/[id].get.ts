import { createError, getRouterParam } from 'h3'
import { publicWork } from '../../../utils/lantern-public'
import { studioPublicContext, studioPublicMediaUrl } from '../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const id=Number(getRouterParam(event,'id'))
  if(!Number.isSafeInteger(id)||id<=0) throw createError({statusCode:400,statusMessage:'Invalid work ID.'})
  const {db,staging}=await studioPublicContext(event)
  const row=await db.prepare(`SELECT works.*,users.username,users.display_name FROM works JOIN users ON users.id=works.creator_id WHERE works.id=? AND works.status='published' LIMIT 1`).bind(id).first<any>()
  if(!row) throw createError({statusCode:404,statusMessage:'Published work not found.'})
  const work={...publicWork(row),coverUrl:studioPublicMediaUrl(row.cover,staging),videoUrl:studioPublicMediaUrl(row.video_path,staging),contentSource:staging?'staging':'production'}
  let chapters:any[]=[]; let episodes:any[]=[]
  if(String(work.type).toLowerCase()==='novel'){
    const result=await db.prepare(`SELECT id,chapter_number,title,updated_at FROM chapters WHERE work_id=? AND status='published' AND TRIM(COALESCE(title,''))<>'' AND TRIM(COALESCE(content,''))<>'' ORDER BY chapter_number ASC`).bind(id).all<any>()
    chapters=result.results??[]
  }
  if(String(work.type).toLowerCase()==='comic'){
    const result=await db.prepare(`SELECT e.id,e.episode_number,e.title,e.updated_at,(SELECT COUNT(*) FROM comic_pages p WHERE p.episode_id=e.id) AS page_count FROM comic_episodes e WHERE e.work_id=? AND e.status='published' ORDER BY e.episode_number ASC`).bind(id).all<any>()
    episodes=result.results??[]
  }
  return {work,chapters,episodes,source:staging?'staging':'production'}
})
