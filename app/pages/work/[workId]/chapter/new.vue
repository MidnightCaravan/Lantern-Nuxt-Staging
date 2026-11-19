<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const router = useRouter()
const workId = computed(() => Number(route.params.workId))
const { data, pending, error: loadError } = await useFetch<any>(() => `/api/studio/works/${workId.value}/novel`)
const work = computed(() => data.value?.work ?? null)
const writable = computed(() => data.value?.writable === true)
const title = ref('')
const content = ref('')
const busy = ref(false)
const error = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const words = computed(() => content.value.trim() ? content.value.trim().split(/\s+/).length : 0)
const flash = useLanternFlash()

useHead({ title: computed(() => work.value ? `New Chapter — ${work.value.title}` : 'New Chapter') })

async function save() {
  if (!writable.value || busy.value) return
  if (!title.value.trim()) {
    error.value = 'Please give the chapter a title.'
    titleInput.value?.focus()
    return
  }

  busy.value = true
  error.value = ''
  try {
    const csrf = (await $fetch<{ csrfToken: string }>('/api/auth/csrf')).csrfToken
    const result = await $fetch<{ chapterId: number; chapterNumber: number }>(`/api/studio/works/${workId.value}/chapters`, {
      method: 'POST',
      body: { title: title.value, content: content.value, csrfToken: csrf },
    })
    flash.set(`Chapter ${result.chapterNumber} created.`, 'success')
    await router.push(`/chapter/${result.chapterId}/edit`)
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || cause?.message || 'Chapter could not be created.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="workspace-page chapter-editor-page">
    <div class="container" style="max-width:1050px">
      <div v-if="pending">Loading Novel Workspace…</div>
      <div v-else-if="loadError || !work">
        <h1>Novel not found</h1>
        <NuxtLink to="/dashboard">Dashboard</NuxtLink>
      </div>
      <template v-else>
        <div class="chapter-editor-top">
          <div>
            <NuxtLink :to="`/work/${workId}/novel`" class="workspace-back">← Back to Novel Workspace</NuxtLink>
            <p class="eyebrow">{{ work.title }}</p>
            <h1>New Chapter</h1>
          </div>
        </div>
        <p v-if="!writable" class="flash error">Production novels are read-only in this staging version.</p>
        <p v-if="error" class="flash error">{{ error }}</p>
        <form class="chapter-editor-form" @submit.prevent="save">
          <div class="chapter-writing-shell">
            <div class="chapter-title-field">
              <label for="chapter-title">Chapter Title</label>
              <input ref="titleInput" id="chapter-title" v-model="title" maxlength="200" autocomplete="off" placeholder="Chapter title…" required :disabled="!writable">
            </div>
            <div class="writing-area">
              <label for="chapter-content">Manuscript</label>
              <textarea id="chapter-content" v-model="content" placeholder="Begin writing your chapter…" spellcheck="true" :disabled="!writable"></textarea>
            </div>
            <div class="chapter-status-bar">
              <div class="chapter-writing-stats">
                <span><strong>{{ words }}</strong> words</span>
                <span class="status-separator">•</span>
                <span><strong>{{ content.length }}</strong> characters</span>
              </div>
              <div class="chapter-save-status unsaved" aria-live="polite">Not saved yet</div>
            </div>
            <div class="chapter-save-bar">
              <div class="chapter-save-hint">Save the chapter once to begin autosaving.</div>
              <button type="submit" class="button button-primary" :disabled="busy || !writable">{{ busy ? 'Creating…' : 'Save Draft' }}</button>
            </div>
          </div>
        </form>
      </template>
    </div>
  </section>
</template>
