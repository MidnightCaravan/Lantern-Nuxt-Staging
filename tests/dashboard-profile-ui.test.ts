import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dashboard = readFileSync(
  path.join(process.cwd(), 'app/pages/dashboard.vue'),
  'utf8',
)
const editProfile = readFileSync(
  path.join(process.cwd(), 'app/pages/profile/edit.vue'),
  'utf8',
)

describe('dashboard and profile UI parity', () => {
  it('re-renders original profile values and queues the validation flash on failure', () => {
    expect(editProfile).toContain('username.value=profile.value?.username||\'\'')
    expect(editProfile).toContain('displayName.value=profile.value?.display_name||\'\'')
    expect(editProfile).toContain('bio.value=profile.value?.bio||\'\'')
    expect(editProfile).toContain('avatar.value=profile.value?.avatar||\'\'')
    expect(editProfile).toContain("flash.set(message,'error')")
    // The save catch now queues a flash instead of showing an inline error.
    expect(editProfile).toContain("flash.set(message,'error')}finally{busy.value=false}")
  })

  it('renders queued flashes on the dashboard like Flask', () => {
    expect(dashboard).toContain('const queuedFlash = useLanternFlash().consume()')
    expect(dashboard).toContain('ref(queuedFlash?.message ?? \'\')')
    expect(dashboard).toContain("ref<'success' | 'error'>(queuedFlash?.category ?? 'success')")
  })

  it('uses Flask fixed alert and full reload for thumbnail upload', () => {
    expect(dashboard).toContain("window.alert('Thumbnail upload failed. Please try again.')")
    expect(dashboard).toContain('window.location.reload()')
    // The upload catch ignores the server body; other dashboard actions still
    // use their canonical inline flashes.
    expect(dashboard).toContain("} catch {\n    // The canonical uploader ignores the Worker response body and always shows\n    // this fixed modal text (dashboard.html:577-586).\n    window.alert('Thumbnail upload failed. Please try again.')\n  } finally {")
  })
})
