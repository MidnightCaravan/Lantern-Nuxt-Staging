import { createError, getRouterParam } from 'h3'
import { publicWork } from '../../../utils/lantern-public'
import { studioPublicContext, studioPublicMediaUrl } from '../../../utils/lantern-studio'
export default defineEventHandler(async (event) => {
  const episodeId=Number(getRouterParam(event,'id'))
  if(!Number.isSafeInteger(episodeId)||episodeId<=0) throw createError({statusCode:400,statusMessage:'Invalid episode ID.'})
  const {db,staging}=await studioPublicContext(event)
  const episode=await db.prepare(`SELECT e.*,w.title AS work_title,w.creator_id,w.status AS work_status,w.id AS work_id,w.description AS work_description,w.cover AS work_cover,u.username,u.display_name FROM comic_episodes e JOIN works w ON w.id=e.work_id JOIN users u ON u.id=w.creator_id WHERE e.id=? AND w.type='Comic' AND w.status='published' AND e.status='published' LIMIT 1`).bind(episodeId).first<any>()
  if(!episode) throw createError({statusCode:404,statusMessage:'Published comic episode not found.'})
  const pagesResult=await db.prepare('SELECT id,page_number,image_path FROM comic_pages WHERE episode_id=? ORDER BY page_number ASC').bind(episodeId).all<any>()
  const pages=(pagesResult.results??[]).map((page:any)=>({...page,imageUrl:studioPublicMediaUrl(page.image_path,staging)}))
  const base={id:episode.work_id,title:episode.work_title,description:episode.work_description,cover:episode.work_cover,type:'Comic',username:episode.username,display_name:episode.display_name}
  const work={...publicWork(base),coverUrl:studioPublicMediaUrl(episode.work_cover,staging),contentSource:staging?'staging':'production'}
  const previous=await db.prepare("SELECT id,episode_number,title FROM comic_episodes WHERE work_id=? AND episode_number<? AND status='published' ORDER BY episode_number DESC LIMIT 1").bind(episode.work_id,episode.episode_number).first<any>()
  const next=await db.prepare("SELECT id,episode_number,title FROM comic_episodes WHERE work_id=? AND episode_number>? AND status='published' ORDER BY episode_number ASC LIMIT 1").bind(episode.work_id,episode.episode_number).first<any>()
  return {work,episode,pages,previous,next,source:staging?'staging':'production'}
})
