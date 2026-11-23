<script setup lang="ts">
defineOptions({ name: 'LanternCommentNode' })
type CommentNode = { id:number;parent_id:number|null;body:string;created_at:string;username:string;display_name:string;avatar:string;like_count:number;liked_by_current_user:boolean;is_mine:boolean;reported?:boolean;reportMessage?:string;children:CommentNode[] }
const props=defineProps<{
  comment:CommentNode
  writable:boolean
  loggedIn:boolean
  source:'production'|'staging'
  submitHandler:(comment:CommentNode,mode:'edit'|'reply',body:string)=>Promise<void>
  actionHandler:(comment:CommentNode,name:'like'|'delete'|'report')=>Promise<void>
}>()
const mode=ref<'edit'|'reply'|null>(null);const body=ref('');const sending=ref(false);const status=ref('');const statusError=ref(false)
function errText(cause:any){return cause?.data?.statusMessage||cause?.statusMessage||cause?.message||'Could not save. Try again.'}
function open(next:'edit'|'reply'){mode.value=mode.value===next?null:next;body.value=next==='edit'?props.comment.body:'';status.value='';statusError.value=false}
// Await the parent handler so a failed POST keeps the draft open and shows the
// exact server error inline, matching work_discussion.html:268-282.
async function submit(){if(sending.value||!mode.value)return;const text=body.value.trim();if(!text){status.value='Write something before submitting.';statusError.value=true;return}const currentMode=mode.value;sending.value=true;status.value='Saving…';statusError.value=false;try{await props.submitHandler(props.comment,currentMode,text);mode.value=null;body.value='';status.value=''}catch(cause:any){status.value=errText(cause);statusError.value=true}finally{sending.value=false}}
async function doAction(name:'like'|'delete'|'report'){try{await props.actionHandler(props.comment,name);status.value='';statusError.value=false}catch(cause:any){status.value=errText(cause);statusError.value=true}}
function askDelete(){if(window.confirm('Delete this comment and any replies to it?'))void doAction('delete')}
function askReport(){const reason=window.prompt('Why are you reporting this comment?');if(reason===null)return;if(!reason.trim()){status.value='Please provide a reason for the report.';statusError.value=true;return}void doActionWith(Object.assign({},props.comment,{reportReason:reason.trim()}) as any,'report')}
async function doActionWith(target:CommentNode,name:'like'|'delete'|'report'){try{await props.actionHandler(target,name);status.value='';statusError.value=false}catch(cause:any){status.value=errText(cause);statusError.value=true}}
</script>
<template>
  <article class="comment-item" :class="comment.parent_id ? 'comment-reply' : ''">
    <div class="comment-header">
      <div class="comment-avatar"><img v-if="comment.avatar" :src="comment.avatar" alt=""><template v-else>{{ (comment.display_name || comment.username || 'U').charAt(0).toUpperCase() }}</template></div>
      <div><div class="comment-name">{{ comment.display_name || comment.username || 'User' }}</div><div class="comment-handle">@{{ comment.username }}</div></div>
    </div>
    <div class="comment-body">{{ comment.body }}</div>
    <div v-if="loggedIn && writable" class="comment-actions">
      <button type="button" class="comment-action" :aria-pressed="comment.liked_by_current_user ? 'true' : 'false'" @click="doAction('like')">{{ comment.liked_by_current_user ? `♥ Liked (${comment.like_count || 0})` : `♡ Like (${comment.like_count || 0})` }}</button>
      <button type="button" class="comment-action" @click="open('reply')">Reply</button>
      <template v-if="comment.is_mine"><button type="button" class="comment-action" @click="open('edit')">Edit</button><button type="button" class="comment-action comment-delete" @click="askDelete">Delete</button></template>
      <button v-else type="button" class="comment-action" :disabled="comment.reported" @click="askReport">{{ comment.reported ? 'Reported' : 'Report' }}</button>
    </div>
    <div v-if="mode" class="comment-inline-form">
      <textarea v-model="body" rows="3" maxlength="5000" required :aria-label="mode==='edit'?'Edit comment':'Write a reply'" :placeholder="mode==='edit'?'Edit your comment…':'Write a reply…'"></textarea>
      <div class="comment-inline-form-footer"><span class="comment-inline-status" :class="statusError?'error':''" role="status">{{ status }}</span><button type="button" class="comment-action" @click="mode=null">Cancel</button><button type="button" class="button button-gold" :disabled="sending" @click="submit">{{ mode==='edit'?'Save Edit':'Post Reply' }}</button></div>
    </div>
    <p v-if="(!mode && status) || comment.reportMessage" class="comment-inline-status" :class="statusError?'error':''" role="status">{{ status || comment.reportMessage }}</p>
    <div v-if="comment.children?.length" class="comment-replies"><LanternCommentNode v-for="child in comment.children" :key="child.id" :comment="child" :writable="writable" :logged-in="loggedIn" :source="source" :submit-handler="submitHandler" :action-handler="actionHandler" /></div>
  </article>
</template>
