import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The canonical Flask uploader reports validation/progress in one status area.
// Browser automation is unavailable here, so pin the exact user-visible
// strings and form attributes in the Nuxt component source.
const component = path.resolve(process.cwd(), 'app/components/LanternVideoUploader.vue')
const source = await readFile(component, 'utf8')

describe('video uploader copy parity (templates/edit_work.html:164-271)', () => {
  it('uses Flask validation and progress text verbatim', () => {
    for (const text of [
      'Choose a video file first.',
      'Unsupported format. Choose MP4, WebM, or MOV.',
      'The selected file is empty.',
      'Videos must be 2 GB or smaller.',
      'Security token unavailable. Refresh and try again.',
      'Starting secure video upload…',
      'Assembling video in storage…',
      'Upload complete. Refreshing video preview…',
    ]) {
      expect(source, text).toContain(text)
    }
  })

  it('no longer contains the invented Nuxt-only uploader messages', () => {
    for (const text of [
      'Choose an MP4, WebM, or MOV video.',
      'Video uploaded successfully.',
      'Upload did not finish.',
    ]) {
      expect(source, text).not.toContain(text)
    }
  })

  it('marks the file input required and reports failures in the status area only', () => {
    expect(source).toMatch(/<input[^>]*id="video-file"[^>]*required/)
    expect(source).not.toContain('class="flash error"')
    expect(source).toContain('window.location.reload()')
  })
})
