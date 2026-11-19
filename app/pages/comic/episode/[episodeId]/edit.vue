<script setup lang="ts">
import type { FetchError } from 'ofetch'

definePageMeta({ middleware: ['auth'] })

type ComicPage = { id: number; pageNumber: number; imageUrl: string }
const route = useRoute()
const episodeId = computed(() => String(route.params.episodeId))
const { data, pending: loading, error, refresh } = await useFetch<any>(() => `/api/comic/episodes/${episodeId.value}`)

// Flask renders templates/404.html for a missing or unowned episode
// (lantern_comic_editor.py:61).
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const work = computed(() => data.value?.work ?? null)
const episode = computed(() => data.value?.episode ?? null)
const pages = computed<ComicPage[]>(() => data.value?.pages ?? [])
const writable = computed(() => data.value?.writable === true)
const creationFlash = useLanternFlash().consume()
const title = ref('')
const csrfToken = ref('')
const busy = ref(false)
const saving = ref(false)
const selected = ref<Array<{ file: File; url: string }>>([])
// Flask flashes one message per skipped file (lantern_comic_editor.py:199-204).
const skippedImages = ref<string[]>([])
const uploadStatus = ref('')
const message = ref(creationFlash?.message ?? '')
const messageType = ref<'success' | 'error'>(creationFlash?.category ?? 'success')
const fileInput = ref<HTMLInputElement | null>(null)

watch(episode, (value) => { if (value) title.value = value.title }, { immediate: true })
useHead({ title: computed(() => episode.value ? `Episode ${episode.value.episodeNumber} — ${work.value?.title || 'Lantern'} — Lantern` : 'Comic Episode') })

onMounted(async () => {
  try {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    messageType.value = 'error'
    message.value = 'The security check is unavailable. Refresh and try again.'
  }
})

onBeforeUnmount(() => selected.value.forEach((entry) => URL.revokeObjectURL(entry.url)))

const allowedPageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function pageFileKey(file: File) {
  return JSON.stringify([file.name, file.size, file.lastModified])
}

function setSelected(files: FileList | File[]) {
  selected.value.forEach((entry) => URL.revokeObjectURL(entry.url))
  const all = Array.from(files)
  skippedImages.value = [...skippedImages.value, ...all.filter((file) => !allowedPageTypes.has(file.type)).map((file) => file.name)]
  const next = all.filter((file) => allowedPageTypes.has(file.type))
  selected.value = next.map((file) => ({ file, url: URL.createObjectURL(file) }))
  uploadStatus.value = next.length ? `${next.length} file${next.length === 1 ? '' : 's'} ready to upload` : 'No new pages selected.'
}

function addSelected(files: FileList | File[]) {
  const seen = new Set(selected.value.map((entry) => pageFileKey(entry.file)))
  const additions: File[] = []
  for (const file of Array.from(files)) {
    if (!allowedPageTypes.has(file.type)) {
      skippedImages.value = [...skippedImages.value, file.name]
      continue
    }
    const key = pageFileKey(file)
    if (seen.has(key)) continue
    seen.add(key)
    additions.push(file)
  }
  if (additions.length) {
    selected.value = [...selected.value, ...additions.map((file) => ({ file, url: URL.createObjectURL(file) }))]
  }
  uploadStatus.value = selected.value.length
    ? `${selected.value.length} file${selected.value.length === 1 ? '' : 's'} ready to upload`
    : 'No new pages selected.'
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) addSelected(input.files)
  input.value = ''
}

function onDrop(event: DragEvent) {
  if (!writable.value || busy.value) return
  event.preventDefault()
  if (event.dataTransfer?.files) addSelected(event.dataTransfer.files)
}

async function saveEpisode() {
  if (!writable.value || !csrfToken.value || saving.value) return
  saving.value = true
  message.value = ''
  try {
    const result = await $fetch<{ message: string }>(`/api/comic/episodes/${episodeId.value}`, {
      method: 'PUT', body: { title: title.value, csrfToken: csrfToken.value },
    })
    messageType.value = 'success'
    message.value = result.message
    await refresh()
  } catch (error: unknown) {
    messageType.value = 'error'
    message.value = (error as FetchError)?.data?.statusMessage || 'Episode could not be saved.'
  } finally {
    saving.value = false
  }
}

async function uploadPages() {
  if (!writable.value || busy.value || !selected.value.length || !csrfToken.value) return
  busy.value = true
  message.value = ''
  const files = [...selected.value]
  const completed = new Set<File>()
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!.file
      const extension = file.name.split('.').pop()?.toLowerCase() || ''
      uploadStatus.value = `Uploading page ${index + 1} of ${files.length}...`
      const response = await fetch(`/api/comic/episodes/${episodeId.value}/pages`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': csrfToken.value,
          'X-Lantern-Extension': extension,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Page ${index + 1} failed (${response.status}): ${detail}`)
      }
      completed.add(file)
    }
    // Flask reports the saved episode and the number of uploaded pages in one
    // flash (lantern_comic_editor.py:224-228).
    uploadStatus.value = `Episode saved. ${completed.size} page(s) uploaded.`
    selected.value.forEach((entry) => URL.revokeObjectURL(entry.url))
    selected.value = []
    if (fileInput.value) fileInput.value.value = ''
    await refresh()
  } catch (error: unknown) {
    // Keep only pages that have not reached the server. Already-uploaded pages
    // stay in the draft and won't be duplicated if the user retries.
    const remaining = selected.value.filter((entry) => {
      if (completed.has(entry.file)) {
        URL.revokeObjectURL(entry.url)
        return false
      }
      return true
    })
    selected.value = remaining
    if (!remaining.length && fileInput.value) fileInput.value.value = ''
    messageType.value = 'error'
    uploadStatus.value = error instanceof Error ? error.message : 'Page upload failed.'
    await refresh()
  } finally {
    busy.value = false
  }
}

async function deletePage(page: ComicPage) {
  if (!writable.value || busy.value || !csrfToken.value) return
  if (!window.confirm('Delete this comic page?')) return
  busy.value = true
  message.value = ''
  try {
    await $fetch(`/api/comic/pages/${page.id}/delete`, {
      method: 'POST', body: { csrfToken: csrfToken.value },
    })
    messageType.value = 'success'
    message.value = 'Comic page deleted.'
    await refresh()
  } catch (error: unknown) {
    messageType.value = 'error'
    message.value = (error as FetchError)?.data?.statusMessage || 'The comic page could not be deleted.'
  } finally {
    busy.value = false
  }
}

async function publishEpisode() {
  if (!writable.value || busy.value || !csrfToken.value) return
  if (!window.confirm('Publish this episode on Lantern?')) return
  busy.value = true
  message.value = ''
  try {
    const result = await $fetch<{ message: string }>(`/api/comic/episodes/${episodeId.value}/publish`, {
      method: 'POST', body: { csrfToken: csrfToken.value },
    })
    messageType.value = 'success'
    message.value = result.message
    await refresh()
  } catch (error: unknown) {
    messageType.value = 'error'
    message.value = (error as FetchError)?.data?.statusMessage || 'The episode could not be published.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="comic-episode-page">
    <div class="container">
      <div v-if="loading" class="auth-card"><div class="auth-icon">🏮</div></div>
      <div v-else-if="error || !episode || !work" class="auth-card">
        <h1>Episode unavailable</h1>
        <p class="auth-subtitle">We couldn't load this comic episode.</p>
        <NuxtLink to="/dashboard" class="button button-outline">Dashboard</NuxtLink>
      </div>
      <template v-else>
        <div class="workspace-top">
          <div>
            <div class="section-eyebrow">COMIC · EPISODE</div>
            <h1>Episode {{ episode.episodeNumber }}</h1>
            <p>{{ work.title }}</p>
          </div>
          <div class="workspace-actions">
            <NuxtLink :to="`/comic/episode/${episode.id}/read?preview=1`" class="button button-gold">▶ Preview Episode</NuxtLink>
            <NuxtLink :to="`/work/${work.id}/comic`" class="button button-outline">← Back to Comic Workspace</NuxtLink>
          </div>
        </div>

        <div v-if="message" class="flash" :class="messageType" role="status">{{ message }}</div>
        <div v-for="(name, index) in skippedImages" :key="`${name}-${index}`" class="flash error" role="status">Skipped unsupported image: {{ name }}</div>
        <div v-if="!writable" class="flash">This production episode is read-only in the Nuxt staging build. Editing, uploads, deletion and publishing are disabled.</div>
        <div class="workspace-divider"></div>

        <form id="comic-episode-form" @submit.prevent="saveEpisode">
          <div class="comic-episode-title-field">
            <label for="episode-title">Episode Title</label>
            <input id="episode-title" v-model.trim="title" type="text" placeholder="Episode title" maxlength="200" required :disabled="!writable">
          </div>
        </form>

        <template v-if="writable">
          <div class="comic-upload-panel" style="margin-top: 2rem;">
            <div>
              <div class="section-eyebrow">PAGES</div>
              <h2>Upload Comic Pages</h2>
              <p>Choose pages, review them, then add them to the draft. Each page uploads separately.</p>
            </div>
            <div id="comic-dropzone" class="comic-upload-dropzone" style="position: relative; cursor: pointer; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 0.55rem; padding: 2rem;" @click="fileInput?.click()" @dragover.prevent @drop="onDrop">
              <div class="comic-upload-icon">＋</div>
              <strong>Add comic pages</strong>
              <span>Click to choose files or drag images here</span>
              <span>PNG, JPG, JPEG, WEBP or GIF</span>
              <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;" @change="onFileChange">
              <button type="button" id="choose-files-button" class="button button-gold" style="margin-top: 1rem;" :disabled="busy" @click.stop="fileInput?.click()">Choose Files</button>
              <div id="selected-files" style="margin-top: 0.5rem; color: var(--gold); font-size: 0.9rem;">{{ selected.length ? `${selected.length} file${selected.length === 1 ? '' : 's'} ready to upload` : 'No new pages selected.' }}</div>
            </div>

            <div v-if="selected.length" id="upload-preview-section" style="margin-top: 2rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap;">
                <div><div class="section-eyebrow">UPLOAD ORDER</div><h3 style="margin: 0;">New Pages</h3></div>
                <span id="preview-count" style="color: var(--muted); font-size: 0.9rem;">{{ selected.length }} page{{ selected.length === 1 ? '' : 's' }}</span>
              </div>
              <div id="preview-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem;">
                <div v-for="(entry, index) in selected" :key="`${entry.file.name}-${entry.file.lastModified}-${index}`" style="position: relative; overflow: hidden; border: 1px solid var(--border); background: var(--black);">
                  <img :src="entry.url" :alt="entry.file.name" style="display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; background: var(--night);">
                  <div style="position: absolute; top: 0.5rem; left: 0.5rem; padding: 0.35rem 0.55rem; background: rgba(3, 4, 5, 0.9); color: var(--gold-light); font-size: 0.75rem; font-weight: 700;">Page {{ index + 1 }}</div>
                  <button type="button" :title="`Remove ${entry.file.name}`" style="position: absolute; top: 0.4rem; right: 0.4rem; width: 32px; height: 32px; border: 1px solid rgba(255,255,255,0.2); background: rgba(3,4,5,0.9); color: white; font-size: 1.2rem; cursor: pointer;" @click="setSelected(selected.filter((_, i) => i !== index).map((item) => item.file))">×</button>
                  <div :title="entry.file.name" style="padding: 0.7rem; color: var(--ivory); font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ entry.file.name }}</div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1.5rem; flex-wrap: wrap;">
                <button type="button" id="add-to-draft-button" class="button button-gold" :disabled="busy || !selected.length || !csrfToken" @click="uploadPages">{{ busy ? 'Uploading pages…' : 'Add to Draft' }}</button>
                <span id="upload-status" style="color: var(--muted); font-size: 0.9rem;">{{ uploadStatus }}</span>
              </div>
            </div>
          </div>
        </template>

        <section class="comic-pages-section" style="margin-top: 2rem;">
          <div class="comic-pages-heading">
            <div><div class="section-eyebrow">CURRENT PAGES</div><h2>Pages</h2></div>
            <span class="comic-episode-count">{{ pages.length }} page{{ pages.length === 1 ? '' : 's' }}</span>
          </div>
          <div v-if="pages.length" class="comic-page-grid">
            <div v-for="page in pages" :key="page.id" class="comic-page-card" style="position: relative; overflow: hidden;">
              <div class="comic-page-image"><img :src="page.imageUrl || ''" :alt="`Page ${page.pageNumber}`" loading="lazy"></div>
              <div class="comic-page-meta" style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
                <strong>Page {{ page.pageNumber }}</strong>
                <button v-if="writable" type="button" class="button button-outline comic-delete-page" :disabled="busy" @click="deletePage(page)">Delete</button>
              </div>
            </div>
          </div>
          <div v-else class="workspace-empty">
            <div class="comic-empty-icon">🏮</div>
            <h2>No pages uploaded yet.</h2>
            <p>Choose your images above, then click Add to Draft.</p>
          </div>
        </section>

        <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 2rem; padding-bottom: 4rem; flex-wrap: wrap;">
          <NuxtLink :to="`/work/${work.id}/comic`" class="button button-outline">Cancel</NuxtLink>
          <button type="submit" form="comic-episode-form" class="button button-gold" :disabled="!writable || saving || !csrfToken">{{ saving ? 'Saving…' : 'Save Episode' }}</button>
          <button v-if="episode.status !== 'published'" type="button" class="button button-gold" :disabled="!writable || busy || !csrfToken" @click="publishEpisode">Publish Episode</button>
        </div>
      </template>
    </div>
  </section>
</template>
