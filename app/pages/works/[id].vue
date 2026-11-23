<script setup lang="ts">
const route = useRoute()
// Flask's view_work template (work.html) has no flash block, so a publication
// flash is left in the session until a later flash-rendering page. Do not
// consume it here; works/[workId]/novel/index.vue and dashboard.vue do.

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

// Flask renders templates/404.html for a missing published work
// (lantern_public.py:181). Reproduce that instead of an in-page card.
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

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
  <section class="profile-page">
    <div class="profile-container">
      <div v-if="pending" class="nuxt-state-card">Loading work…</div>
      <div v-else-if="error || !work" class="nuxt-state-card"><h2>Work not found</h2><p>This work may no longer be published.</p><NuxtLink :to="`/discover?source=${encodeURIComponent(source)}`" class="button button-outline">Back to Discover</NuxtLink><button class="button button-outline" @click="refresh()">Retry</button></div>
      <template v-else>
        <div class="section-eyebrow">{{ work.type }}</div>
        <h1 class="profile-info h1">{{ work.title }}</h1>
        <p class="profile-bio">{{ work.description }}</p>
        <p class="profile-joined">Created by <NuxtLink :to="`/@${encodeURIComponent(work.username)}?source=${source}`">@{{ work.username }}</NuxtLink></p>

        <section v-if="String(work.type).toLowerCase() === 'novel'" class="public-novel-chapters" aria-labelledby="published-chapters-title">
          <div class="chapter-header"><div><div class="section-eyebrow">MANUSCRIPT</div><h2 id="published-chapters-title">Chapters</h2></div></div>
          <div v-if="chapters.length" class="chapter-list">
            <NuxtLink v-for="chapter in chapters" :key="chapter.id" :to="`/works/${work.id}/chapters/${chapter.id}?source=${encodeURIComponent(source)}`" class="chapter-item">
              <div class="chapter-number">{{ chapter.chapter_number }}</div>
              <div class="chapter-info"><h3>{{ chapter.title }}</h3><span>READ CHAPTER</span></div>
              <div class="chapter-arrow">→</div>
            </NuxtLink>
          </div>
          <p v-else>No chapters have been published yet.</p>
        </section>

        <section v-else-if="String(work.type).toLowerCase() === 'video'" class="public-video-player" aria-label="Video player" style="margin-top:2rem;">
          <video v-if="work.videoUrl" controls playsinline preload="metadata" style="display:block; width:100%; max-height:75vh; background:#000; border-radius:12px;" :src="work.videoUrl">Your browser does not support HTML video.</video>
          <p v-else>This video is not available yet.</p>
        </section>

        <LanternDiscussionPanel v-if="['novel', 'video'].includes(String(work.type).toLowerCase())" kind="work" :target-id="Number(lanternDiscussionRoute.params.id)" :source="source === 'staging' ? 'staging' : 'production'" />
      </template>
    </div>
  </section>
</template>
