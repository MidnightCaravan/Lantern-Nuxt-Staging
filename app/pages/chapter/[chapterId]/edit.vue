<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const chapterId = computed(() => Number(route.params.chapterId))
const { data, pending, error: loadError } = await useFetch<any>(() => `/api/studio/chapters/${chapterId.value}`)

// Flask renders templates/404.html for a missing or unowned chapter
// (lantern_chapters.py:256).
if (isLanternNotFound(loadError.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const chapter = computed(() => data.value?.chapter ?? null)
const work = computed(() => data.value?.work ?? null)
const title = ref('')
const content = ref('')
const dirty = ref(false)
const saving = ref(false)
const error = ref('')
// Flask's chapter_editor.html has no flash block (nor does base.html), so
// "Chapter saved." / "Chapter N created." are left in the session and shown
// on the next flash-rendering page (novel workspace or dashboard). Do not
// consume or render them here; the status bar already reports "Saved".
const status = ref('Saved')
const statusState = ref<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
const titleInput = ref<HTMLInputElement | null>(null)
const words = computed(() => content.value.trim() ? content.value.trim().split(/\s+/).length : 0)

watch(chapter, (row) => {
  if (row && !dirty.value) {
    title.value = String(row.title || '')
    content.value = String(row.content || '')
  }
}, { immediate: true })

useHead({ title: computed(() => chapter.value ? `Edit Chapter ${chapter.value.chapter_number} — ${work.value?.title}` : 'Edit Chapter') })

function setStatus(text: string, state: 'saved' | 'unsaved' | 'saving' | 'error') {
  status.value = text
  statusState.value = state
}

function markDirty() {
  dirty.value = true
  setStatus('Unsaved changes', 'unsaved')
}

async function save(automatic = false) {
  // Flask saves on every explicit form submission, even when nothing changed;
  // autosave remains dirty-only (lantern_chapters.py:260-340).
  if (data.value?.writable !== true || saving.value) return
  if (!title.value.trim()) {
    if (automatic) {
      error.value = ''
      setStatus('Chapter title required', 'error')
    } else {
      error.value = 'Chapter title cannot be empty.'
    }
    titleInput.value?.focus()
    return
  }

  saving.value = true
  setStatus('Saving…', 'saving')
  error.value = ''
  try {
    const csrf = (await $fetch<{ csrfToken: string }>('/api/auth/csrf')).csrfToken
    const payload = { title: title.value, content: content.value, csrfToken: csrf }
    if (automatic) {
      await $fetch(`/api/studio/chapters/${chapterId.value}/autosave`, { method: 'POST', body: payload })
      setStatus('Saved just now', 'saved')
    } else {
      await $fetch(`/api/studio/chapters/${chapterId.value}`, { method: 'PUT', body: payload })
      setStatus('Saved', 'saved')
    }
    dirty.value = false
  } catch (cause: any) {
    const messageText = cause?.data?.statusMessage || cause?.statusMessage || cause?.message || 'Unable to save chapter.'
    error.value = messageText
    setStatus('Save failed', 'error')
    if (messageText === 'Chapter title cannot be empty.' && chapter.value) {
      title.value = String(chapter.value.title || '')
      content.value = String(chapter.value.content || '')
      dirty.value = false
      setStatus('Saved', 'saved')
    }
  } finally {
    saving.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined

// Flask intercepts Ctrl/Cmd+S and saves (chapter_editor.html:477-493).
function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save(true)
  }
}

// Flask warns before navigating away with unsaved changes
// (chapter_editor.html:496-510).
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  timer = setInterval(() => {
    if (dirty.value) void save(true)
  }, 10000)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

async function manualSave() {
  if (!title.value.trim()) {
    error.value = 'Chapter title cannot be empty.'
    titleInput.value?.focus()
    return
  }
  await save(false)
}
</script>

<template>
  <section class="workspace-page chapter-editor-page">
    <div class="container" style="max-width:1100px">
      <div v-if="pending">Loading chapter…</div>
      <div v-else-if="loadError || !chapter || !work">
        <h1>Chapter not found</h1>
        <NuxtLink to="/dashboard">Dashboard</NuxtLink>
      </div>
      <template v-else>
        <div class="chapter-editor-top">
          <div>
            <NuxtLink :to="`/work/${work.id}/novel`" class="workspace-back">← Back to Novel Workspace</NuxtLink>
            <p class="eyebrow">{{ work.title }}</p>
            <h1>Chapter {{ chapter.chapter_number }}</h1>
          </div>
          <div class="chapter-editor-actions">
            <NuxtLink :to="`/work/${work.id}/novel`" class="button button-secondary">Chapter List</NuxtLink>
          </div>
        </div>
        <p v-if="data?.writable !== true" class="flash error">Production chapters are read-only in this staging version.</p>
        <p v-if="error" class="flash error">{{ error }}</p>
        <form class="chapter-editor-form" @submit.prevent="manualSave">
          <div class="chapter-writing-shell">
            <div class="chapter-title-field">
              <label for="chapter-title">Chapter Title</label>
              <input ref="titleInput" id="chapter-title" v-model="title" maxlength="200" autocomplete="off" placeholder="Chapter title..." required :disabled="data?.writable !== true" @input="markDirty">
            </div>
            <div class="writing-area">
              <label for="chapter-content">Manuscript</label>
              <textarea id="chapter-content" v-model="content" placeholder="Begin writing your chapter..." spellcheck="true" :disabled="data?.writable !== true" @input="markDirty"></textarea>
            </div>
            <div class="chapter-status-bar">
              <div class="chapter-writing-stats">
                <span><strong>{{ words }}</strong> words</span>
                <span class="status-separator">•</span>
                <span><strong>{{ content.length }}</strong> characters</span>
              </div>
              <div class="chapter-save-status" :class="statusState" aria-live="polite">{{ status }}</div>
            </div>
            <div class="chapter-save-bar">
              <div class="chapter-save-hint">Your chapter autosaves every 10 seconds.</div>
              <button type="submit" class="button button-primary" :disabled="saving || data?.writable !== true">{{ saving ? 'Saving…' : 'Save Draft' }}</button>
            </div>
            <nav class="chapter-navigation">
              <NuxtLink v-if="data?.previous" :to="`/chapter/${data.previous.id}/edit`" class="chapter-nav-button">
                <span class="chapter-nav-direction">← Previous</span><span class="chapter-nav-title">Chapter {{ data.previous.chapter_number }}</span>
              </NuxtLink>
              <div v-else class="chapter-nav-button chapter-nav-disabled"><span class="chapter-nav-direction">← Previous</span><span class="chapter-nav-title">Beginning</span></div>
              <NuxtLink :to="`/work/${work.id}/novel`" class="chapter-nav-center">Chapter List</NuxtLink>
              <NuxtLink v-if="data?.next" :to="`/chapter/${data.next.id}/edit`" class="chapter-nav-button chapter-nav-next">
                <span class="chapter-nav-direction">Next →</span><span class="chapter-nav-title">Chapter {{ data.next.chapter_number }}</span>
              </NuxtLink>
              <div v-else class="chapter-nav-button chapter-nav-disabled"><span class="chapter-nav-direction">Next →</span><span class="chapter-nav-title">End of Novel</span></div>
            </nav>
          </div>
        </form>
      </template>
    </div>
  </section>
</template>
