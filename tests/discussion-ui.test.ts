import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const node = readFileSync(
  path.join(process.cwd(), 'app/components/LanternCommentNode.vue'),
  'utf8',
)
const panel = readFileSync(
  path.join(process.cwd(), 'app/components/LanternDiscussionPanel.vue'),
  'utf8',
)

describe('discussion component UI parity', () => {
  it('awaits the parent handler so failed edits/replies keep the draft and show the error inline', () => {
    expect(node).toContain('submitHandler:(comment:CommentNode,mode:')
    expect(node).toContain('await props.submitHandler(')
    expect(node).toContain('catch(cause:any){status.value=errText(cause);statusError.value=true}')
    expect(node).not.toContain("emit('submit'")
    expect(node).not.toContain("emit('action'")
    expect(node).toContain("@click=\"doAction('like')\"")
    expect(panel).toContain('async function nodeSubmit(comment:Comment,mode:')
    expect(panel).not.toContain("error.value=cause?.data?.statusMessage||cause?.message||'Comment could not be saved.'")
  })

  it('shows inline status once while editing or replying', () => {
    expect(node).toContain('v-if="(!mode && status) || comment.reportMessage"')
  })

  it('marks a reported comment locally with the server message and no reload', () => {
    expect(panel).toContain("if(name==='report'){const node=findComment(comments.value,comment.id);if(node){(node as any).reported=true;(node as any).reportMessage=result?.message||'Report submitted.'}return}")
    expect(node).toContain("comment.reported ? 'Reported' : 'Report'")
    expect(node).toContain('{{ status || comment.reportMessage }}')
  })

  it('shows Flask success feedback for root comments', () => {
    expect(panel).toContain("{text:'Comment posted.',error:false}")
    expect(panel).toContain('{{ rootStatus.text }}')
  })

  it('propagates action errors to the originating comment instead of the panel banner', () => {
    expect(node).toContain('async function doAction(name:')
    expect(panel).toContain('async function action(comment:Comment,name:')
    expect(panel).not.toContain("error.value=cause?.data?.statusMessage||cause?.message||'That action could not be completed.'")
    expect(panel).toContain('Retry loading discussion')
  })

  it('matches the canonical episode presentation details', () => {
    expect(panel).toContain("kind === 'work' ? 'COMMUNITY' : 'Community'")
    expect(panel).toContain("kind === 'episode' ? '🏮' : '💬'")
    expect(panel).toContain('class="discussion-login-icon"')
    expect(panel).toContain('class="comment-form-user"')
    expect(panel).toContain(":class=\"kind === 'episode' ? 'sr-only' : ''\"")
  })
})
