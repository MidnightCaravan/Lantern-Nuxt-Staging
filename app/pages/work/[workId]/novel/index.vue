<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const workId = computed(() => Number(route.params.workId))
const { data, pending, error, refresh } = await useFetch<any>(() => `/api/studio/works/${workId.value}/novel`)
const work = computed(() => data.value?.work ?? null)
const chapters = computed(() => data.value?.chapters ?? [])
const flash = useLanternFlash()
const creationFlash = flash.consume()
const busy = ref(false)
const notice = ref(creationFlash?.message ?? '')
const problem = ref('')

useHead({ title: computed(() => work.value ? `${work.value.title} — Novel Workspace` : 'Novel Workspace') })

async function publish() {
  if (typeof window !== 'undefined' && !window.confirm('Publish every chapter that has saved content? Empty chapters will remain drafts.')) return
  if (busy.value || data.value?.writable !== true) return

  busy.value = true
  problem.value = ''
  notice.value = ''
  try {
    const csrf = (await $fetch<{ csrfToken: string }>('/api/auth/csrf')).csrfToken
    const result = await $fetch<any>(`/api/studio/works/${workId.value}/novel/publish`, {
      method: 'POST',
      body: { csrfToken: csrf },
    })
    flash.set(result.message, 'success')
    await navigateTo({ path: `/works/${workId.value}`, query: { source: 'staging' } })
  } catch (cause: any) {
    problem.value = cause?.data?.statusMessage || cause?.message || 'Could not publish novel.'
    await refresh()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="workspace-page" style="padding:4rem 0 7rem">
    <div class="container">
      <div v-if="pending">Loading Novel Workspace…</div>
      <div v-else-if="error || !work">
        <h1>Novel not found</h1>
        <NuxtLink to="/dashboard">Dashboard</NuxtLink>
      </div>
      <template v-else>
        <header class="workspace-top">
          <div>
            <p class="section-eyebrow">NOVEL · {{ String(work.status).toUpperCase() }}</p>
            <h1>{{ work.title }}</h1>
            <p v-if="work.description">{{ work.description }}</p>
          </div>
          <div class="workspace-actions">
            <NuxtLink to="/dashboard" class="button button-outline">Dashboard</NuxtLink>
            <NuxtLink :to="`/work/${workId}/edit`" class="button button-outline">Edit Details</NuxtLink>
            <button class="button button-gold" :disabled="busy || data?.writable !== true" @click="publish">
              {{ busy ? 'Publishing…' : work.status === 'published' ? 'Publish Updates' : 'Publish Novel' }}
            </button>
          </div>
        </header>
        <p v-if="data?.writable !== true" class="flash error">Production novels are read-only in this staging version.</p>
        <p v-if="notice" class="flash success">{{ notice }}</p>
        <p v-if="problem" class="flash error">{{ problem }}</p>
        <div class="workspace-divider"></div>
        <div class="chapter-header">
          <div>
            <div class="section-eyebrow">MANUSCRIPT</div>
            <h2>Chapters</h2>
          </div>
          <NuxtLink v-if="data?.writable === true" :to="`/work/${workId}/chapter/new`" class="button button-gold">+ Add Chapter</NuxtLink>
        </div>
        <div v-if="chapters.length" class="chapter-list">
          <NuxtLink v-for="chapter in chapters" :key="chapter.id" :to="`/chapter/${chapter.id}/edit`" class="chapter-item">
            <div class="chapter-number">{{ chapter.chapter_number }}</div>
            <div class="chapter-info"><h3>{{ chapter.title }}</h3><span>{{ String(chapter.status).toUpperCase() }}</span></div>
            <div class="chapter-arrow">→</div>
          </NuxtLink>
        </div>
        <div v-else class="workspace-empty">
          <div class="workspace-empty-icon">📖</div>
          <h2>Your manuscript is empty.</h2>
          <p>Your first chapter is where the story begins.</p>
          <NuxtLink v-if="data?.writable === true" :to="`/work/${workId}/chapter/new`" class="button button-gold">Write Chapter One</NuxtLink>
        </div>
      </template>
    </div>
  </section>
</template>
