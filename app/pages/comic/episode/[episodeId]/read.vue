<script setup lang="ts">
const route = useRoute()
const episodeId = computed(() => String(route.params.episodeId))
const readerQuery = computed(() => {
  const params = new URLSearchParams()
  if (route.query.preview === '1') params.set('preview', '1')
  const sourceValue = route.query.source
  const source = Array.isArray(sourceValue) ? sourceValue[0] : sourceValue
  if (source) params.set('source', String(source))
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
})
const { data, pending, error } = await useFetch<any>(() => `/api/comic/episodes/${episodeId.value}/read${readerQuery.value}`)

// Flask renders templates/404.html for a missing episode, or an unpublished
// episode the viewer does not own (lantern_comic_views.py:94,108).
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const episode = computed(() => data.value?.episode ?? null)
const pages = computed(() => data.value?.pages ?? [])
const discussionSource = computed(() => data.value?.source === 'staging' ? 'staging' : 'production')
useHead({ title: computed(() => episode.value ? `${episode.value.workTitle} — ${episode.value.title} — Lantern` : 'Read Comic Episode') })
</script>

<template>
  <section class="comic-reader-page">
    <div class="comic-reader-container">
      <header v-if="!pending && episode" class="comic-reader-header">
        <NuxtLink :to="`/work/${episode.workId}/comic`" class="button button-outline">← Back to Comic Workspace</NuxtLink>
        <div class="comic-reader-heading">
          <p class="section-eyebrow">{{ episode.workTitle }}</p>
          <h1>{{ episode.title }}</h1>
          <p>Episode {{ episode.episodeNumber }} · {{ pages.length }} page{{ pages.length === 1 ? '' : 's' }}</p>
        </div>
      </header>
      <div v-if="pending" class="auth-card"><div class="auth-icon">🏮</div></div>
      <div v-else-if="error || !episode" class="comic-reader-empty">
        <h2>Episode unavailable</h2>
        <p>This episode is not published or is no longer available.</p>
        <NuxtLink to="/discover" class="button button-gold">Discover Lantern</NuxtLink>
      </div>
      <main v-else-if="pages.length" class="comic-reader-pages">
        <figure v-for="(page, index) in pages" :key="page.id" class="comic-reader-page-image"><img :src="page.imageUrl || ''" :alt="`${episode.workTitle} — ${episode.title} — Page ${page.pageNumber}`" :loading="index === 0 ? 'eager' : 'lazy'"></figure>
      </main>
      <div v-else class="comic-reader-empty">
        <div class="comic-empty-icon">🏮</div>
        <h2>No pages yet</h2>
        <p>Upload the comic pages from the episode editor before previewing the episode.</p>
        <NuxtLink :to="`/comic/episode/${episode.id}/edit`" class="button button-gold">Back to Episode Editor</NuxtLink>
      </div>
      <nav v-if="episode" class="comic-reader-navigation" aria-label="Episode navigation">
        <NuxtLink v-if="data.previous" :to="`/comic/episode/${data.previous.id}/read${readerQuery}`" class="button button-outline">← Episode {{ data.previous.episodeNumber }}</NuxtLink>
        <span v-else></span>
        <NuxtLink :to="`/comics/${episode.workId}${readerQuery}`" class="button button-gold">Episode List</NuxtLink>
        <NuxtLink v-if="data.next" :to="`/comic/episode/${data.next.id}/read${readerQuery}`" class="button button-outline">Episode {{ data.next.episodeNumber }} →</NuxtLink>
        <span v-else></span>
      </nav>
      <LanternDiscussionPanel v-if="episode" kind="episode" :target-id="Number(episode.id)" :source="discussionSource" />
    </div>
  </section>
</template>
