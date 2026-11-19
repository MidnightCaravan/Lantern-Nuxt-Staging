<script setup lang="ts">
const route = useRoute()
const episodeId = computed(() => String(route.params.episodeId))
const previewQuery = computed(() => route.query.preview === '1' ? '?preview=1' : '')
const { data, pending, error } = await useFetch<any>(() => `/api/comic/episodes/${episodeId.value}/read${previewQuery.value}`)
const episode = computed(() => data.value?.episode ?? null)
const pages = computed(() => data.value?.pages ?? [])
const discussionSource = computed(() => data.value?.source === 'staging' ? 'staging' : 'production')
useHead({ title: computed(() => episode.value ? `${episode.value.workTitle} — ${episode.value.title} — Lantern` : 'Read Comic Episode') })
</script>

<template>
  <section class="comic-reader-page">
    <div class="comic-reader-container">
      <header v-if="!pending && episode" class="comic-reader-header">
        <NuxtLink v-if="data?.isPreview" :to="`/work/${episode.workId}/comic`" class="button button-outline">← Back to Comic Workspace</NuxtLink>
        <NuxtLink v-else :to="`/comics/${episode.workId}`" class="button button-outline">← Back to Comic</NuxtLink>
        <div class="comic-reader-heading">
          <p class="section-eyebrow">{{ episode.workTitle }} · EPISODE {{ episode.episodeNumber }}</p>
          <h1>{{ episode.title }}</h1>
          <p>Episode {{ episode.episodeNumber }} · {{ pages.length }} page{{ pages.length === 1 ? '' : 's' }}</p>
          <p v-if="data?.isPreview">Preview · Not yet publicly published</p>
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
        <NuxtLink v-if="data?.isPreview" :to="`/comic/episode/${episode.id}/edit`" class="button button-gold">Back to Episode Editor</NuxtLink>
      </div>
      <nav v-if="episode && (data?.previous || data?.next)" class="comic-reader-navigation">
        <NuxtLink v-if="data.previous" :to="`/comic/episode/${data.previous.id}/read`" class="button button-outline">← Episode {{ data.previous.episode_number }}</NuxtLink>
        <span v-else></span>
        <NuxtLink :to="`/comics/${episode.workId}`" class="button button-gold">Episode List</NuxtLink>
        <NuxtLink v-if="data.next" :to="`/comic/episode/${data.next.id}/read`" class="button button-outline">Episode {{ data.next.episode_number }} →</NuxtLink>
      </nav>
      <LanternDiscussionPanel v-if="episode" kind="episode" :target-id="Number(episode.id)" :source="discussionSource" />
    </div>
  </section>
</template>
