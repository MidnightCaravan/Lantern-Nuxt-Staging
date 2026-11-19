<script setup lang="ts">
const route = useRoute()

const requestedSource = computed(() => {
  const value = route.query.source
  const first = Array.isArray(value) ? value[0] : value
  return first ? String(first) : null
})

const apiUrl = computed(() => {
  const base = `/api/public/comic-episodes/${route.params.id}`
  return requestedSource.value
    ? `${base}?source=${encodeURIComponent(requestedSource.value)}`
    : base
})

const { data, pending, error, refresh } = await useFetch<any>(apiUrl)

const source = computed(() =>
  String(data.value?.source ?? requestedSource.value ?? 'production')
)
const work = computed(() => data.value?.work ?? null)
const episode = computed(() => data.value?.episode ?? null)
const pages = computed(() => data.value?.pages ?? [])
useHead(() => ({ title: episode.value?.title && work.value?.title ? `${work.value.title} — ${episode.value.title} — Lantern` : 'Comic Episode' }))

const lanternDiscussionRoute = useRoute()
</script>

<template>
  <section class="nuxt-public-page nuxt-comic-reader-page">
    <div class="container nuxt-reader-container">
      <div v-if="pending" class="nuxt-state-card">Loading comic pages…</div>
      <div v-else-if="error || !episode || !work" class="nuxt-state-card"><h2>Episode not found</h2><p>This episode may no longer be published.</p><NuxtLink :to="`/discover?type=comic&source=${encodeURIComponent(source)}`" class="button button-outline">Back to Comics</NuxtLink><button class="button button-outline" @click="refresh()">Retry</button></div>
      <template v-else>
        <header class="nuxt-reader-heading">
          <NuxtLink :to="`/comics/${work.id}?source=${encodeURIComponent(source)}`" class="workspace-back">← Back to {{ work.title }}</NuxtLink>
          <div class="section-eyebrow">{{ work.title }}</div>
          <h1>{{ episode.title }}</h1>
          <p>Episode {{ episode.episode_number }} · {{ pages.length }} page{{ pages.length === 1 ? '' : 's' }}</p>
        </header>
        <main v-if="pages.length" class="nuxt-comic-pages">
          <figure v-for="(page, index) in pages" :key="page.id" class="nuxt-comic-page-image">
            <img :src="page.imageUrl" :alt="`${work.title} — ${episode.title} — Page ${page.page_number}`" :loading="index === 0 ? 'eager' : 'lazy'">
          </figure>
        </main>
        <div v-else class="comic-reader-empty"><div class="comic-empty-icon">🏮</div><h2>No pages yet</h2><p>This published episode does not currently have any pages.</p></div>
        <nav class="comic-reader-navigation" aria-label="Episode navigation">
          <NuxtLink v-if="data.previous" :to="`/comic-episodes/${data.previous.id}?source=${encodeURIComponent(source)}`" class="button button-outline">← Episode {{ data.previous.episode_number }}</NuxtLink>
          <span v-else></span>
          <NuxtLink :to="`/comics/${work.id}?source=${encodeURIComponent(source)}`" class="button button-gold">Episode List</NuxtLink>
          <NuxtLink v-if="data.next" :to="`/comic-episodes/${data.next.id}?source=${encodeURIComponent(source)}`" class="button button-outline">Episode {{ data.next.episode_number }} →</NuxtLink>
          <span v-else></span>
        </nav>
      
  <LanternDiscussionPanel v-if="episode && work" kind="episode" :target-id="Number(episode.id)" :source="source === 'staging' ? 'staging' : 'production'" />
</template>
    </div>
  </section>
</template>
