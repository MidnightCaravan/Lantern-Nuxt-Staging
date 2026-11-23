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

// Flask renders templates/404.html for a missing or non-comic work
// (lantern_public.py:103-124), so a published Novel/Video is not a valid comic.
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}
if (data.value && String(data.value.work?.type).toLowerCase() !== 'comic') {
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
  <section style="padding:5rem 0 8rem;">
    <div class="container" style="max-width:1050px;">
      <div v-if="pending" class="nuxt-state-card">Loading comic…</div>
      <div v-else-if="error || !work" class="nuxt-state-card"><h2>Comic not found</h2><p>This comic may no longer be published.</p><NuxtLink :to="`/discover?type=comic&source=${encodeURIComponent(source)}`" class="button button-outline">Back to Comics</NuxtLink><button class="button button-outline" @click="refresh()">Retry</button></div>
      <template v-else>
        <header style="display:flex; justify-content:space-between; align-items:flex-end; gap:2rem; margin-bottom:3rem; flex-wrap:wrap;">
          <div>
            <div class="section-eyebrow">COMIC</div>
            <h1 style="margin:0.4rem 0 0.8rem;">{{ work.title }}</h1>
            <p style="max-width:680px;">{{ work.description || 'A comic published on Lantern.' }}</p>
            <p style="margin-top:0.8rem; color:var(--muted-dark); font-size:0.85rem;">By {{ work.display_name }}</p>
          </div>
          <NuxtLink :to="`/@${encodeURIComponent(work.username)}?source=${source}`" class="button button-outline">View Creator</NuxtLink>
        </header>

        <div class="workspace-divider"></div>

        <div v-if="episodes.length" style="display:flex; flex-direction:column; gap:0.75rem;">
          <NuxtLink v-for="episode in episodes" :key="episode.id" :to="`/comic/episode/${episode.id}/read?source=${encodeURIComponent(source)}`" class="comic-episode-item">
            <div class="comic-episode-number">{{ String(episode.episode_number).padStart(2, '0') }}</div>
            <div class="comic-episode-info"><h3>{{ episode.title }}</h3><p>{{ episode.page_count }} page{{ episode.page_count === 1 ? '' : 's' }}</p></div>
            <div class="comic-episode-arrow">Read →</div>
          </NuxtLink>
        </div>
        <div v-else class="comic-empty-state"><div class="comic-empty-icon">🏮</div><h2>No episodes yet</h2><p>This comic has been published, but no episodes are currently available.</p></div>
      </template>
    </div>
  </section>
</template>
