import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Extracted from the original Flask sources with a Python AST walk over every
// flash(...) call on 2026-11-20: 63 distinct messages. Each one must either
// appear verbatim in Nuxt, have a template-syntax equivalent (Flask's `{}`
// placeholders become Vue/TS `${}` or `{{ }}`), or be explicitly recorded as
// an intentional difference in docs/PARITY_AUDIT_20261119.md.
const VERBATIM = [
  'Add at least one episode before publishing your comic.',
  'Add at least one page before publishing this episode.',
  'An account with that email already exists.',
  'Chapter saved.',
  'Chapter title cannot be empty.',
  'Could not remove one or more stored images. Please retry.',
  'Description must be 2,000 characters or fewer.',
  'Display name cannot be empty.',
  'Episode published successfully.',
  'Episode saved.',
  'Episode title cannot be empty.',
  'First comic page is now the thumbnail.',
  'If that email belongs to an unverified Lantern account, a new verification link has been sent.',
  'Invalid email or password.',
  'Only comic works can use their first page as a thumbnail.',
  'Only draft works can be deleted from the dashboard.',
  'Password must be at least 8 characters.',
  'Passwords do not match.',
  'Please choose a thumbnail image.',
  'Please fill in all required fields.',
  'Please give the chapter a title.',
  'Please give the episode a title.',
  'Please give your work a title.',
  'Please log in to continue.',
  'Please verify your email before logging in.',
  'That username is already taken.',
  'The first comic page could not be found.',
  'The first comic page uses an unsupported image format.',
  'The selected thumbnail is empty.',
  'This comic does not have a page yet.',
  'This password reset link is invalid or has expired.',
  'This verification link is invalid or has expired.',
  'Thumbnail removed, but the previous cover could not be deleted.',
  'Thumbnail removed.',
  'Thumbnail updated, but the previous cover could not be removed.',
  'Thumbnail uploaded successfully.',
  'Title cannot be empty.',
  'Title must be 200 characters or fewer.',
  'Too many attempts. Please wait before trying again.',
  'Unsupported thumbnail format.',
  'Upload a video before publishing.',
  'Username must be at least 3 characters.',
  'Write and save at least one chapter with content before publishing your novel.',
  'Your comic is now published on Lantern.',
  'Your draft has been saved.',
  'Your email has been verified. You can now log in.',
  'Your novel and its saved chapters are now published on Lantern.',
  'Your password has been changed. You can now log in.',
  'Your password uses an older password format. Please reset your password before logging in.',
  'Your profile has been updated.',
  'Your video is now published on Lantern.',
]

const TEMPLATE_EQUIVALENT: Record<string, string> = {
  '"{?}" was deleted.': '"${String(work.title)}" was deleted.',
  'Chapter {next_number} created.': 'Chapter ${result.chapterNumber} created.',
  'Episode saved. {uploaded_count} page(s) uploaded.': 'Episode saved. ${completed.size} page(s) uploaded.',
  'Episode {episode_number} created.': 'Episode ${episodeNumber} created.',
  'Episode {numbers} need at least one page before publishing.': 'Episode ${numbers} need at least one page before publishing.',
  'Skipped unsupported image: {original_name}': 'Skipped unsupported image: {{ name }}',
  '{work_label} draft created successfully.': '${type} draft created successfully.',
}

// Intentional differences: the message exists in Flask but not in Nuxt for a
// documented architectural reason. Each is explained in the parity audit.
const DOCUMENTED_DIFFERENCE = [
  'Comic storage is not available.',
  'Could not remove one or more local images. Please retry.',
  'Invalid thumbnail filename.',
  'Thumbnail storage is not available.',
  'You have been logged out.',
]

async function nuxtCorpus(): Promise<string> {
  const dir = path.resolve(process.cwd(), 'app')
  const server = path.resolve(process.cwd(), 'server')
  const files: string[] = []
  async function walk(current: string) {
    const { readdir, stat } = await import('node:fs/promises')
    for (const entry of await readdir(current)) {
      const full = path.join(current, entry)
      const info = await stat(full)
      if (info.isDirectory()) await walk(full)
      else if (/\.(vue|ts)$/.test(entry)) files.push(await readFile(full, 'utf8'))
    }
  }
  await walk(dir)
  await walk(server)
  return files.join('\n')
}

describe('Flask flash-message parity', () => {
  it('enumerates every distinct Flask flash message', () => {
    expect(VERBATIM.length + Object.keys(TEMPLATE_EQUIVALENT).length + DOCUMENTED_DIFFERENCE.length).toBe(63)
    const all = [...VERBATIM, ...Object.keys(TEMPLATE_EQUIVALENT), ...DOCUMENTED_DIFFERENCE]
    expect(new Set(all).size).toBe(all.length)
  })

  it('keeps every verbatim message in the Nuxt source', async () => {
    const corpus = await nuxtCorpus()
    for (const message of VERBATIM) {
      expect(corpus, `missing Flask message: ${message}`).toContain(message)
    }
  })

  it('keeps every dynamic message in equivalent Nuxt form', async () => {
    const corpus = await nuxtCorpus()
    for (const [flask, nuxtEquivalent] of Object.entries(TEMPLATE_EQUIVALENT)) {
      expect(corpus, `missing Nuxt equivalent for: ${flask}`).toContain(nuxtEquivalent)
    }
  })

  it('records every intentional difference in the parity audit', async () => {
    const audit = await readFile(path.resolve(process.cwd(), 'docs/PARITY_AUDIT_20261119.md'), 'utf8')
    for (const message of DOCUMENTED_DIFFERENCE) {
      expect(audit, `undocumented difference: ${message}`).toContain(message)
    }
  })
})
