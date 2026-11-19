<script setup lang="ts">
defineOptions({ name: 'LanternCommentNode' })
type CommentNode = { id:number;parent_id:number|null;body:string;created_at:string;username:string;display_name:string;avatar:string;like_count:number;liked_by_current_user:boolean;is_mine:boolean;children:CommentNode[] }
const props=defineProps<{comment:CommentNode;writable:boolean;loggedIn:boolean;source:'production'|'staging'}>()
const emit=defineEmits<{action:[comment:CommentNode,name:'like'|'delete'|'report'];submit:[comment:CommentNode,mode:'edit'|'reply',body:string]}>()
const mode=ref<'edit'|'reply'|null>(null);const body=ref('');const sending=ref(false);const status=ref('');const statusError=ref(false)
function open(next:'edit'|'reply'){mode.value=mode.value===next?null:next;body.value=next==='edit'?props.comment.body:'';status.value=''}
async function submit(){if(!body.value.trim()||sending.value||!mode.value)return;sending.value=true;status.value='Saving…';statusError.value=false;try{emit('submit',props.comment,mode.value,body.value.trim());mode.value=null;body.value=''}catch{status.value='Could not save. Try again.';statusError.value=true}finally{sending.value=false}}
function askDelete(){if(window.confirm('Delete this comment and any replies to it?'))emit('action',props.comment,'delete')}
function askReport(){const reason=window.prompt('Why are you reporting this comment?');if(reason===null)return;if(!reason.trim()){status.value='Please provide a reason for the report.';statusError.value=true;return}emit('action',Object.assign({},props.comment,{reportReason:reason.trim()}) as any,'report')}
</script>
<template>
  <article class="comment-item" :class="comment.parent_id ? 'comment-reply' : ''">
    <div class="comment-header">
      <div class="comment-avatar"><img v-if="comment.avatar" :src="comment.avatar" alt=""><template v-else>{{ (comment.display_name || comment.username || 'U').charAt(0).toUpperCase() }}</template></div>
      <div><div class="comment-name">{{ comment.display_name || comment.username || 'User' }}</div><NuxtLink class="comment-handle" :to="`/@${comment.username}${source==='staging'?'?source=staging':''}`">@{{ comment.username }}</NuxtLink></div>
    </div>
    <div class="comment-body">{{ comment.body }}</div>
    <div v-if="loggedIn && writable" class="comment-actions">
      <button type="button" class="comment-action" :aria-pressed="comment.liked_by_current_user ? 'true' : 'false'" @click="emit('action',comment,'like')">{{ comment.liked_by_current_user ? `♥ Liked (${comment.like_count || 0})` : `♡ Like (${comment.like_count || 0})` }}</button>
      <button type="button" class="comment-action" @click="open('reply')">Reply</button>
      <template v-if="comment.is_mine"><button type="button" class="comment-action" @click="open('edit')">Edit</button><button type="button" class="comment-action comment-delete" @click="askDelete">Delete</button></template>
      <button v-else type="button" class="comment-action" @click="askReport">Report</button>
    </div>
    <div v-if="mode" class="comment-inline-form">
      <textarea v-model="body" rows="3" maxlength="5000" required :aria-label="mode==='edit'?'Edit comment':'Write a reply'" :placeholder="mode==='edit'?'Edit your comment…':'Write a reply…'"></textarea>
      <div class="comment-inline-form-footer"><span class="comment-inline-status" :class="statusError?'error':''" role="status">{{ status }}</span><button type="button" class="comment-action" @click="mode=null">Cancel</button><button type="button" class="button button-gold" :disabled="sending || !body.trim()" @click="submit">{{ mode==='edit'?'Save Edit':'Post Reply' }}</button></div>
    </div>
    <p v-if="status && !mode" class="comment-inline-status" :class="statusError?'error':''" role="status">{{ status }}</p>
    <div v-if="comment.children?.length" class="comment-replies"><LanternCommentNode v-for="child in comment.children" :key="child.id" :comment="child" :writable="writable" :logged-in="loggedIn" :source="source" @action="(item,actionName)=>emit('action',item,actionName)" @submit="(item,editMode,text)=>emit('submit',item,editMode,text)" /></div>
  </article>
</template>
