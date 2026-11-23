<script setup lang="ts">
type Comment={id:number;user_id?:number;parent_id:number|null;body:string;created_at:string;username:string;display_name:string;avatar:string;like_count:number;liked_by_current_user:boolean;is_mine:boolean;children:Comment[]}
const props=defineProps<{kind:'work'|'episode';targetId:number;source?:'production'|'staging'}>()
const comments=ref<Comment[]>([]);const loading=ref(true);const error=ref('');const draft=ref('');const submitting=ref(false);const loggedIn=ref(false);const writable=ref(false);const csrfToken=ref('');const rootStatus=ref<{text:string;error:boolean}>({text:'',error:false});const currentUser=ref<{display_name?:string;username?:string;avatar?:string}|null>(null)
const endpoint=computed(()=>`/api/discussions/${props.kind}/${props.targetId}?source=${props.source||'production'}`)
const source=computed(()=>(props.source||'production') as 'production'|'staging')
const commentCount=computed(()=>{const count=(items:Comment[]):number=>items.reduce((sum,item)=>sum+1+count(item.children||[]),0);return count(comments.value)})
async function ensureCsrf(){if(!csrfToken.value)csrfToken.value=(await $fetch<{csrfToken:string}>('/api/auth/csrf')).csrfToken;return csrfToken.value}
function makeTree(rows:Comment[]){const nodes=rows.map(row=>({...row,children:[]} as Comment));const byId=new Map(nodes.map(item=>[String(item.id),item]));const roots:Comment[]=[];for(const item of nodes){const parent=item.parent_id!==null?byId.get(String(item.parent_id)):undefined;if(parent&&parent.id!==item.id)parent.children.push(item);else roots.push(item)}return roots}
async function load(){loading.value=true;error.value='';try{const [session,result]=await Promise.all([$fetch<any>('/api/auth/me').catch(()=>null),$fetch<{comments:Comment[];writable:boolean}>(endpoint.value)]);loggedIn.value=Boolean(session?.user?.id);currentUser.value=session?.user||null;writable.value=Boolean(result.writable);comments.value=makeTree(result.comments||[])}catch(cause:any){error.value=cause?.data?.statusMessage||cause?.message||'Discussion could not be loaded.'}finally{loading.value=false}}
function findComment(items:Comment[],id:number):Comment|null{for(const item of items){if(item.id===id)return item;const found=findComment(item.children||[],id);if(found)return found}return null}
async function post(body:string,parentId:number|null){const csrf=await ensureCsrf();await $fetch(endpoint.value,{method:'POST',body:{body,parent_id:parentId,csrfToken:csrf}});await load()}
// Action errors propagate to the originating node so Flask's per-comment
// inline status is preserved. Only load failures use the panel-level banner.
async function action(comment:Comment,name:'like'|'delete'|'report'){const csrf=await ensureCsrf();const payload:any={csrfToken:csrf};if(name==='report')payload.reason=(comment as any).reportReason;const result=await $fetch<{message?:string}>(`${endpoint.value.split('?')[0]}/${comment.id}/${name}?source=${source.value}`,{method:'POST',body:payload});if(name==='report'){const node=findComment(comments.value,comment.id);if(node){(node as any).reported=true;(node as any).reportMessage=result?.message||'Report submitted.'}return}await load()}
async function nodeSubmit(comment:Comment,mode:'edit'|'reply',body:string){const csrf=await ensureCsrf();if(mode==='reply')await $fetch(endpoint.value,{method:'POST',body:{body,parent_id:comment.id,csrfToken:csrf}});else await $fetch(`${endpoint.value.split('?')[0]}/${comment.id}/edit?source=${source.value}`,{method:'POST',body:{body,csrfToken:csrf}});await load()}
async function submitRoot(){if(submitting.value)return;const body=draft.value.trim();if(!body){rootStatus.value={text:'Write something before posting.',error:true};return}submitting.value=true;rootStatus.value={text:'',error:false};try{await post(body,null);draft.value='';rootStatus.value={text:'Comment posted.',error:false}}catch(cause:any){rootStatus.value={text:cause?.data?.statusMessage||cause?.message||'Comment could not be posted.',error:true}}finally{submitting.value=false}}
onMounted(load);watch(()=>[props.kind,props.targetId,props.source],load)
</script>
<template>
<section class="work-discussion" :class="{ 'episode-discussion': kind === 'episode' }" id="work-discussion" aria-labelledby="work-discussion-title">
  <div class="discussion-header"><div><p class="section-eyebrow">{{kind === 'work' ? 'COMMUNITY' : 'Community'}}</p><h2 id="work-discussion-title">{{kind === 'episode' ? 'Episode Discussion' : 'Discussion'}}</h2><p v-if="kind === 'episode'" class="discussion-subtitle">Share your thoughts about this episode.</p></div><span class="discussion-count">{{commentCount}} {{commentCount===1?'comment':'comments'}}</span></div>
  <form v-if="loggedIn && writable" class="comment-form" @submit.prevent="submitRoot">
    <div v-if="kind === 'episode'" class="comment-form-user">
      <div class="comment-avatar">{{ (currentUser?.display_name || currentUser?.username || 'U').charAt(0).toUpperCase() }}</div>
      <div><strong>{{ currentUser?.display_name || currentUser?.username || 'User' }}</strong><span>@{{ currentUser?.username }}</span></div>
    </div>
    <label :class="kind === 'episode' ? 'sr-only' : ''" for="lantern-comment-body">{{kind === 'episode' ? 'Write a comment' : 'Join the conversation'}}</label>
    <textarea id="lantern-comment-body" v-model="draft" rows="4" maxlength="5000" :placeholder="kind === 'episode' ? 'What did you think about this episode?' : 'Share your thoughts…'" required @input="rootStatus.text = ''"></textarea>
    <div class="comment-form-footer"><span class="comment-status" :class="{success:rootStatus.text && !rootStatus.error,error:rootStatus.error}" role="status" aria-live="polite">{{ rootStatus.text }}</span><button type="submit" class="button button-gold" :disabled="submitting">{{submitting?'Posting…':'Post Comment'}}</button></div>
  </form>
  <div v-else-if="!loggedIn" class="discussion-login-card">
    <template v-if="kind === 'episode'"><div class="discussion-login-icon" aria-hidden="true">💬</div><div><h3>Join the discussion</h3><p>Log in to leave a comment and talk with other Lantern readers.</p></div></template>
    <template v-else><div><strong>Join the discussion</strong><p>Log in to comment, reply, and react to the community.</p></div></template>
    <NuxtLink to="/login" class="button button-gold">Log In</NuxtLink>
  </div>
  <div v-else class="discussion-login-card"><div><strong>Discussion</strong><p>Production discussions are read-only in this staging preview.</p></div></div>
  <div v-if="error" class="comments-loading error" role="alert">{{error}} <button type="button" class="comment-action" @click="load">Retry loading discussion</button></div>
  <div v-if="loading" class="comments-loading" role="status">Loading discussion…</div>
  <div v-else-if="!comments.length" class="comments-empty"><div class="comments-empty-icon" aria-hidden="true">{{ kind === 'episode' ? '🏮' : '💬' }}</div><h3>{{kind === 'episode' ? 'No comments yet' : 'Start the conversation.'}}</h3><p>{{kind === 'episode' ? 'Be the first reader to start the conversation.' : 'Be the first to share a thought about this work.'}}</p></div>
  <div v-else class="comments-list" aria-live="polite"><LanternCommentNode v-for="comment in comments" :key="comment.id" :comment="comment" :writable="writable" :logged-in="loggedIn" :source="source" :submit-handler="nodeSubmit" :action-handler="action" /></div>
</section>
</template>
<style>
.work-discussion {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid var(--border);
        }
        .work-discussion .discussion-header {
            display: flex;
            flex-wrap: wrap;
            align-items: end;
            justify-content: space-between;
            gap: .75rem;
            margin-bottom: 1.5rem;
        }
        .work-discussion .discussion-header h2 {
            margin: .2rem 0 0;
            color: var(--ivory);
        }
        .work-discussion .discussion-count {
            color: var(--muted);
            font-size: .9rem;
        }
        .work-discussion .discussion-subtitle {
            margin: .45rem 0 0;
            color: var(--muted);
            line-height: 1.6;
        }
        .work-discussion .comment-form {
            display: grid;
            gap: .7rem;
            padding: 1.2rem;
            border: 1px solid var(--border);
            border-radius: 12px;
            background: rgba(8, 10, 13, .35);
        }
        .work-discussion .comment-form label {
            color: var(--ivory);
            font-weight: 600;
        }
        .work-discussion .comment-form textarea {
            width: 100%;
            min-height: 110px;
            box-sizing: border-box;
            padding: .85rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: rgba(0, 0, 0, .2);
            color: var(--ivory);
            font: inherit;
            line-height: 1.6;
            resize: vertical;
        }
        .work-discussion .comment-form textarea:focus,
        .work-discussion .comment-inline-form textarea:focus {
            outline: none;
            border-color: rgba(210, 170, 90, .65);
            box-shadow: 0 0 0 3px rgba(210, 170, 90, .08);
        }
        .work-discussion .comment-form textarea::placeholder,
        .work-discussion .comment-inline-form textarea::placeholder {
            color: var(--muted);
        }
        .work-discussion .comment-form-footer {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: .7rem;
        }
        .work-discussion .comment-status,
        .work-discussion .comment-inline-status {
            min-height: 1.2em;
            color: var(--muted);
            font-size: .88rem;
        }
        .work-discussion .comment-status.error,
        .work-discussion .comment-inline-status.error {
            color: #e9a2a2;
        }
        .work-discussion .comment-status.success {
            color: #a8d6ad;
        }
        .work-discussion .discussion-login-card {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 1.2rem;
            border: 1px solid var(--border);
            border-radius: 12px;
            background: rgba(8, 10, 13, .35);
        }
        .work-discussion .discussion-login-card p { margin: .25rem 0 0; color: var(--muted); }
        .work-discussion .comments-list { margin-top: 1.5rem; }
        .work-discussion .comments-loading,
        .work-discussion .comments-empty {
            padding: 2.25rem 1rem;
            text-align: center;
            color: var(--muted);
        }
        .work-discussion .comments-empty h3 { margin: 0 0 .45rem; color: var(--ivory); }
        .work-discussion .comments-empty p { margin: 0; }
        .work-discussion .comment-item { padding: 1.25rem 0; border-bottom: 1px solid var(--border); }
        .work-discussion .comment-item:last-child { border-bottom: 0; }
        .work-discussion .comment-header { display: flex; align-items: center; gap: .8rem; }
        .work-discussion .comment-avatar {
            display: grid;
            place-items: center;
            flex: 0 0 42px;
            width: 42px;
            height: 42px;
            overflow: hidden;
            border: 1px solid var(--border);
            border-radius: 50%;
            background: rgba(255,255,255,.05);
            color: var(--ivory);
            font-weight: 700;
        }
        .work-discussion .comment-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .work-discussion .comment-name { color: var(--ivory); font-weight: 650; }
        .work-discussion .comment-handle { color: var(--muted); font-size: .85rem; }
        .work-discussion .comment-body { margin-top: .85rem; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
        .work-discussion .comment-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; margin-top: .7rem; }
        .work-discussion .comment-action {
            padding: .38rem .58rem;
            border: 1px solid transparent;
            border-radius: 8px;
            background: transparent;
            color: var(--muted);
            font: inherit;
            font-size: .88rem;
            cursor: pointer;
        }
        .work-discussion .comment-action:hover,
        .work-discussion .comment-action[aria-pressed="true"] { border-color: var(--border); color: var(--ivory); }
        .work-discussion .comment-action[aria-pressed="true"] { color: #e8a3ae; }
        .work-discussion .comment-action:disabled { opacity: .6; cursor: wait; }
        .work-discussion .comment-replies { margin: 1rem 0 0 .85rem; padding-left: 1rem; border-left: 1px solid var(--border); }
        .work-discussion .comment-inline-form { display: grid; gap: .7rem; margin-top: .85rem; padding: .9rem; border: 1px solid var(--border); border-radius: 10px; background: rgba(0,0,0,.18); }
        .work-discussion .comment-inline-form textarea { width: 100%; min-height: 78px; box-sizing: border-box; padding: .75rem; border: 1px solid var(--border); border-radius: 8px; background: rgba(0,0,0,.25); color: var(--ivory); font: inherit; line-height: 1.5; resize: vertical; }
        .work-discussion .comment-inline-form-footer { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; }
        .work-discussion .comment-editor-slot { margin-top: .5rem; }
        @media (max-width: 640px) {
            .work-discussion .comment-replies { margin-left: .35rem; padding-left: .65rem; }
            .work-discussion .comment-action { padding: .35rem .42rem; }
        }

        /* Episode discussion — canonical rules from templates/comic_reader.html. */
        .episode-discussion {
            width: min(100%, 900px);
            margin: 6rem auto 0;
            padding: 2.5rem;
            border: 1px solid var(--border);
            border-radius: 18px;
            background: rgba(18, 20, 25, 0.92);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
        }
        .episode-discussion .discussion-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 2rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid var(--border);
        }
        .episode-discussion .discussion-header h2 {
            margin: 0.35rem 0 0.5rem;
            color: var(--ivory);
            font-size: clamp(1.8rem, 4vw, 2.5rem);
        }
        .episode-discussion .discussion-subtitle {
            margin: 0;
            color: var(--muted);
            line-height: 1.6;
        }
        .episode-discussion .discussion-count {
            flex: 0 0 auto;
            padding: 0.45rem 0.8rem;
            border: 1px solid var(--border);
            border-radius: 999px;
            color: var(--muted);
            font-size: 0.85rem;
            white-space: nowrap;
        }
        .episode-discussion .comment-form {
            display: block;
            margin-top: 1.75rem;
            padding: 1.4rem;
            border: 1px solid var(--border);
            border-radius: 14px;
            background: rgba(8, 10, 13, 0.55);
        }
        .episode-discussion .comment-form-user {
            display: flex;
            align-items: center;
            gap: 0.8rem;
            margin-bottom: 1rem;
        }
        .episode-discussion .comment-form-user > div:last-child {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
        }
        .episode-discussion .comment-form-user strong { color: var(--ivory); }
        .episode-discussion .comment-form-user span {
            color: var(--muted);
            font-size: 0.82rem;
        }
        .episode-discussion .comment-avatar {
            display: grid;
            place-items: center;
            width: 42px;
            height: 42px;
            flex: 0 0 42px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.06);
            color: var(--ivory);
            font-weight: 700;
        }
        .episode-discussion .comment-form textarea {
            display: block;
            width: 100%;
            min-height: 110px;
            resize: vertical;
            box-sizing: border-box;
            padding: 1rem;
            border: 1px solid var(--border);
            border-radius: 10px;
            outline: none;
            background: rgba(0, 0, 0, 0.24);
            color: var(--ivory);
            font: inherit;
            line-height: 1.6;
        }
        .episode-discussion .comment-form textarea::placeholder { color: var(--muted); }
        .episode-discussion .comment-form-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            margin-top: 1rem;
        }
        .episode-discussion .comment-status {
            min-height: 1.2em;
            color: var(--muted);
            font-size: 0.88rem;
        }
        .episode-discussion .comment-status.error { color: #e9a2a2; }
        .episode-discussion .comment-status.success { color: #a8d6ad; }
        .episode-discussion .discussion-login-card {
            display: grid;
            grid-template-columns: auto 1fr auto;
            align-items: center;
            gap: 1rem;
            margin-top: 1.75rem;
            padding: 1.4rem;
            border: 1px solid var(--border);
            border-radius: 14px;
            background: rgba(8, 10, 13, 0.55);
        }
        .episode-discussion .discussion-login-icon {
            display: grid;
            place-items: center;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.05);
            font-size: 1.35rem;
        }
        .episode-discussion .discussion-login-card h3 {
            margin: 0 0 0.3rem;
            color: var(--ivory);
        }
        .episode-discussion .discussion-login-card p {
            margin: 0;
            color: var(--muted);
            line-height: 1.5;
        }
        .episode-discussion .comments-list { margin-top: 1.75rem; }
        .episode-discussion .comments-loading,
        .episode-discussion .comments-empty {
            padding: 3rem 1rem;
            text-align: center;
            color: var(--muted);
        }
        .episode-discussion .comments-empty-icon {
            margin-bottom: 0.75rem;
            font-size: 1.7rem;
        }
        .episode-discussion .comments-empty h3 {
            margin: 0 0 0.5rem;
            color: var(--ivory);
        }
        .episode-discussion .comments-empty p { margin: 0; }
        .episode-discussion .comment-item {
            padding: 1.35rem 0;
            border-bottom: 1px solid var(--border);
        }
        .episode-discussion .comment-item:last-child { border-bottom: 0; }
        .episode-discussion .comment-meta {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .episode-discussion .comment-meta-text {
            display: flex;
            flex-direction: column;
            gap: 0.1rem;
        }
        .episode-discussion .comment-author {
            color: var(--ivory);
            font-weight: 700;
        }
        .episode-discussion .comment-username,
        .episode-discussion .comment-time {
            color: var(--muted);
            font-size: 0.8rem;
        }
        .episode-discussion .comment-body {
            margin: 0.9rem 0 0 54px;
            color: rgba(245, 241, 231, 0.9);
            line-height: 1.7;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }
        .episode-discussion .comment-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.45rem;
            margin-top: 0.8rem;
        }
        .episode-discussion .comment-action {
            border: 1px solid transparent;
            border-radius: 8px;
            padding: 0.38rem 0.58rem;
            background: transparent;
            color: var(--muted);
            font: inherit;
            font-size: 0.88rem;
            cursor: pointer;
        }
        .episode-discussion .comment-action:hover,
        .episode-discussion .comment-action[aria-pressed="true"] {
            border-color: var(--border);
            color: var(--ivory);
        }
        .episode-discussion .comment-action[aria-pressed="true"] { color: #e8a3ae; }
        .episode-discussion .comment-action:disabled { opacity: 0.6; cursor: wait; }
        .episode-discussion .comment-replies {
            margin: 1rem 0 0 0.85rem;
            padding-left: 1rem;
            border-left: 1px solid var(--border);
        }
        .episode-discussion .comment-inline-form {
            display: grid;
            gap: 0.7rem;
            margin-top: 0.85rem;
            padding: 0.9rem;
            border: 1px solid var(--border);
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.18);
        }
        .episode-discussion .comment-inline-form textarea {
            width: 100%;
            min-height: 78px;
            box-sizing: border-box;
            padding: 0.75rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.25);
            color: var(--ivory);
            font: inherit;
            line-height: 1.5;
            resize: vertical;
        }
        .episode-discussion .comment-inline-form-footer {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.65rem;
        }
        .episode-discussion .comment-inline-status {
            color: var(--muted);
            font-size: 0.85rem;
        }
        .episode-discussion .comment-inline-status.error { color: #e9a2a2; }
        @media (max-width: 700px) {
            .episode-discussion {
                margin-top: 4rem;
                padding: 1.4rem;
                border-radius: 14px;
            }
            .episode-discussion .discussion-header {
                align-items: flex-start;
                flex-direction: column;
                gap: 0.9rem;
            }
            .episode-discussion .discussion-login-card { grid-template-columns: auto 1fr; }
            .episode-discussion .discussion-login-card .button {
                grid-column: 1 / -1;
                width: 100%;
                text-align: center;
            }
            .episode-discussion .comment-form-footer {
                align-items: stretch;
                flex-direction: column;
            }
            .episode-discussion .comment-form-footer .button { width: 100%; }
            .episode-discussion .comment-body { margin-left: 0; }
        }
        @media (max-width: 640px) {
            .episode-discussion .comment-replies {
                margin-left: 0.35rem;
                padding-left: 0.65rem;
            }
            .episode-discussion .comment-action { padding: 0.35rem 0.42rem; }
        }
</style>
