<script setup lang="ts">
const route = useRoute()

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

// Flask renders templates/404.html for a missing comic (lantern_public.py:123).
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const source = computed(() =>
  String(data.value?.source ?? requestedSource.value ?? 'production')
)
const work = computed(() => data.value?.work ?? null)
const episodes = computed(() => data.value?.episodes ?? [])
const legacyBase = 'https://lantern.midnightcaravans.workers.dev'
useHead(() => ({ title: `${work.value?.title ?? 'Work'} — Lantern` }))
</script>

<template>
  <section class="nuxt-public-page">
    <div class="container nuxt-public-container">
      <NuxtLink :to="`/discover?type=comic&source=${encodeURIComponent(source)}`" class="workspace-back">← Back to Comics</NuxtLink>
      <div v-if="pending" class="nuxt-state-card">Loading comic…</div>
      <div v-else-if="error || !work" class="nuxt-state-card"><h2>Comic not found</h2><p>This comic may no longer be published.</p><NuxtLink :to="`/discover?type=comic&source=${encodeURIComponent(source)}`" class="button button-outline">Back to Comics</NuxtLink><button class="button button-outline" @click="refresh()">Retry</button></div>
      <template v-else>
        <header class="nuxt-work-header">
          <div class="nuxt-work-cover"><img v-if="work.coverUrl" :src="work.coverUrl" :alt="`${work.title} cover`"><img v-else src="/images/lantern-logo.png" alt="Lantern"></div>
          <div class="nuxt-work-summary">
            <div class="section-eyebrow">COMIC</div>
            <h1>{{ work.title }}</h1>
            <p>{{ work.description || 'A comic published on Lantern.' }}</p>
            <p class="nuxt-work-byline">By {{ work.creatorName }}</p>
          </div>
          <NuxtLink :to="`/@${work.username}?source=${source}`" class="button button-outline">View Creator</NuxtLink>
        </header>

        <section class="nuxt-content-section">
          <div class="chapter-header"><div><div class="section-eyebrow">READING ORDER</div><h2>Episodes</h2></div></div>
          <div v-if="episodes.length" class="comic-episode-list">
            <NuxtLink v-for="episode in episodes" :key="episode.id" :to="`/comic-episodes/${episode.id}?source=${encodeURIComponent(source)}`" class="comic-episode-item">
              <div class="comic-episode-number">{{ String(episode.episode_number).padStart(2, '0') }}</div>
              <div class="comic-episode-info"><h3>{{ episode.title }}</h3><p>{{ episode.page_count }} page{{ episode.page_count === 1 ? '' : 's' }}</p></div>
              <div class="comic-episode-arrow">Read →</div>
            </NuxtLink>
          </div>
          <div v-else class="comic-empty-state"><div class="comic-empty-icon">🏮</div><h2>No episodes yet</h2><p>This comic has been published, but no episodes are currently available.</p></div>
        </section>
      </template>
    </div>
  </section>
</template>
