<script setup lang="ts">
const route = useRoute()
const publicationFlash = useLanternFlash().consume()
const publicationNotice = ref(publicationFlash?.message ?? '')

const requestedSource = computed(() => {
  const value = route.query.source
  const first = Array.isArray(value) ? value[0] : value
  return first ? String(first) : null
})

const apiUrl = computed(() => {
  const base = `/api/public/works/${route.params.id}`
  return requestedSource.value
    ? `${base}?source=${encodeURIComponent(requestedSource.value)}`
    : base
})

const { data, pending, error, refresh } = await useFetch<any>(apiUrl)

const source = computed(() =>
  String(data.value?.source ?? requestedSource.value ?? 'production')
)
const work = computed(() => data.value?.work ?? null)
const chapters = computed(() => data.value?.chapters ?? [])
const legacyBase = 'https://lantern.midnightcaravans.workers.dev'
useHead(() => ({ title: `${work.value?.title ?? 'Work'} — Lantern` }))

const lanternDiscussionRoute = useRoute()
</script>

<template>
  <section class="nuxt-public-page">
    <div class="container nuxt-public-container">
      <NuxtLink :to="`/discover?source=${encodeURIComponent(source)}`" class="workspace-back">← Back to Discover</NuxtLink>
      <p v-if="publicationNotice" class="flash success">{{ publicationNotice }}</p>
      <div v-if="pending" class="nuxt-state-card">Loading work…</div>
      <div v-else-if="error || !work" class="nuxt-state-card"><h2>Work not found</h2><p>This work may no longer be published.</p><NuxtLink :to="`/discover?source=${encodeURIComponent(source)}`" class="button button-outline">Back to Discover</NuxtLink><button class="button button-outline" @click="refresh()">Retry</button></div>
      <template v-else>
        <header class="nuxt-work-header">
          <div class="nuxt-work-cover"><img v-if="work.coverUrl" :src="work.coverUrl" :alt="`${work.title} cover`"><img v-else src="/images/lantern-logo.png" alt="Lantern"></div>
          <div class="nuxt-work-summary">
            <div class="section-eyebrow">{{ work.type }}</div>
            <h1>{{ work.title }}</h1>
            <p>{{ work.description }}</p>
            <p class="nuxt-work-byline">Created by <NuxtLink :to="`/@${work.username}?source=${source}`">@{{ work.username }}</NuxtLink></p>
          </div>
        </header>

        <section v-if="String(work.type).toLowerCase() === 'novel'" class="nuxt-content-section">
          <div class="chapter-header"><div><div class="section-eyebrow">MANUSCRIPT</div><h2>Chapters</h2></div></div>
          <div v-if="chapters.length" class="chapter-list">
            <NuxtLink v-for="chapter in chapters" :key="chapter.id" :to="`/works/${work.id}/chapters/${chapter.id}?source=${encodeURIComponent(source)}`" class="chapter-item">
              <div class="chapter-number">{{ chapter.chapter_number }}</div>
              <div class="chapter-info"><h3>{{ chapter.title }}</h3><span>READ CHAPTER</span></div>
              <div class="chapter-arrow">→</div>
            </NuxtLink>
          </div>
          <p v-else>No chapters have been published yet.</p>
        </section>

        <section v-else-if="String(work.type).toLowerCase() === 'video'" class="nuxt-content-section">
          <div class="section-eyebrow">VIDEO</div>
          <video v-if="work.videoUrl" class="nuxt-video-player" controls playsinline preload="metadata" :src="work.videoUrl">Your browser does not support HTML video.</video>
          <p v-else>This video is not available yet.</p>
        </section>
      
  <LanternDiscussionPanel v-if="work && ['novel', 'video'].includes(String(work.type).toLowerCase())" kind="work" :target-id="Number(lanternDiscussionRoute.params.id)" :source="source === 'staging' ? 'staging' : 'production'" />
</template>
    </div>
  </section>
</template>
