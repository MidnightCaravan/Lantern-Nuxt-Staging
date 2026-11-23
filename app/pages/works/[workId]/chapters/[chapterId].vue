<script setup lang="ts">
const route = useRoute()
const workId = computed(() => String(route.params.workId))
const chapterId = computed(() => String(route.params.chapterId))
const requestedSource = computed(() => {
  const value = route.query.source
  const first = Array.isArray(value) ? value[0] : value
  return first ? String(first) : null
})
const apiUrl = computed(() => {
  const base = `/api/public/works/${workId.value}/chapters/${chapterId.value}`
  return requestedSource.value
    ? `${base}?source=${encodeURIComponent(requestedSource.value)}`
    : base
})
const { data, pending, error, refresh } = await useFetch<any>(apiUrl)

// Flask renders templates/404.html for a missing published novel or chapter
// (lantern_public.py:223,239).
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const source = computed(() => String(data.value?.source ?? requestedSource.value ?? 'production'))
const work = computed(() => data.value?.work ?? null)
const chapter = computed(() => data.value?.chapter ?? null)
useHead(() => ({ title: chapter.value?.title && work.value?.title ? `${chapter.value.title} — ${work.value.title} — Lantern` : 'Chapter' }))
</script>

<template>
  <section class="nuxt-public-page nuxt-reader-page">
    <div class="container nuxt-reader-container">
      <div v-if="pending" class="nuxt-state-card">Loading chapter…</div>
      <div v-else-if="error || !chapter || !work" class="nuxt-state-card"><h2>Chapter not found</h2><p>This chapter may no longer be published.</p><NuxtLink :to="`/discover?source=${encodeURIComponent(source)}`" class="button button-outline">Back to Discover</NuxtLink><button class="button button-outline" @click="refresh()">Retry</button></div>
      <template v-else>
        <NuxtLink :to="`/works/${work.id}?source=${encodeURIComponent(source)}`" class="workspace-back">← Back to {{ work.title }}</NuxtLink>
        <header class="nuxt-reader-heading">
          <div class="section-eyebrow">CHAPTER {{ chapter.chapter_number }} · {{ work.title }}</div>
          <h1>{{ chapter.title }}</h1>
          <p class="profile-joined">By <NuxtLink :to="`/@${encodeURIComponent(work.username)}?source=${source}`">@{{ work.username }}</NuxtLink></p>
        </header>
        <article class="chapter-reader-content nuxt-chapter-content">{{ chapter.content }}</article>
        <nav class="chapter-navigation" aria-label="Chapter navigation">
          <NuxtLink v-if="data.previous" :to="`/works/${work.id}/chapters/${data.previous.id}?source=${encodeURIComponent(source)}`" class="chapter-nav-button chapter-nav-previous"><span class="chapter-nav-direction">← Previous</span><span class="chapter-nav-title">Chapter {{ data.previous.chapter_number }}: {{ data.previous.title }}</span></NuxtLink>
          <div v-else class="chapter-nav-button chapter-nav-disabled" aria-disabled="true"><span class="chapter-nav-direction">← Previous</span><span class="chapter-nav-title">Beginning</span></div>
          <NuxtLink :to="`/works/${work.id}?source=${encodeURIComponent(source)}`" class="chapter-nav-center">Chapter List</NuxtLink>
          <NuxtLink v-if="data.next" :to="`/works/${work.id}/chapters/${data.next.id}?source=${encodeURIComponent(source)}`" class="chapter-nav-button chapter-nav-next"><span class="chapter-nav-direction">Next →</span><span class="chapter-nav-title">Chapter {{ data.next.chapter_number }}: {{ data.next.title }}</span></NuxtLink>
          <div v-else class="chapter-nav-button chapter-nav-disabled" aria-disabled="true"><span class="chapter-nav-direction">Next →</span><span class="chapter-nav-title">End of Novel</span></div>
        </nav>
      </template>
      <LanternDiscussionPanel v-if="work" kind="work" :target-id="Number(route.params.workId)" :source="source === 'staging' ? 'staging' : 'production'" />
    </div>
  </section>
</template>
