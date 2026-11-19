<script setup lang="ts">
const route = useRoute()
const activeType = computed(() => {
  const value = route.query.type
  const first = Array.isArray(value) ? value[0] : value
  return String(first ?? '').trim().toLowerCase()
})
const requestedSource = computed(() => {
  const value = route.query.source
  const first = Array.isArray(value) ? value[0] : value
  return first ? String(first) : null
})
const { data, pending, error, refresh } = await useFetch<any>('/api/public/works', {
  query: computed(() => ({
    type: activeType.value,
    ...(requestedSource.value ? { source: requestedSource.value } : {}),
  })),
})
const source = computed(() => String(data.value?.source ?? requestedSource.value ?? 'production'))
const works = computed(() => data.value?.works ?? [])
useHead({ title: 'Discover — Lantern' })

function workHref(work: any) {
  const path = String(work.type).toLowerCase() === 'comic'
    ? `/comics/${work.id}`
    : `/works/${work.id}`
  return `${path}?source=${encodeURIComponent(source.value)}`
}
</script>

<template>
  <section class="discover-page">
    <div class="container">
      <div class="discover-page-header">
        <div>
          <div class="section-eyebrow">DISCOVER</div>
          <h1>Find Your Next Story.</h1>
          <p>Explore published novels, comics, and videos from creators across Lantern.</p>
        </div>
        <NuxtLink to="/create" class="button button-gold">Create Something</NuxtLink>
      </div>
      <div class="discover-page-divider"></div>
      <nav class="discover-filter-bar" aria-label="Discover filters">
        <NuxtLink :to="`/discover?source=${encodeURIComponent(source)}`" class="discover-filter" :class="{ active: activeType === 'all' }">All</NuxtLink>
        <NuxtLink :to="`/discover?type=novel&source=${encodeURIComponent(source)}`" class="discover-filter" :class="{ active: activeType === 'novel' }">Novels</NuxtLink>
        <NuxtLink :to="`/discover?type=comic&source=${encodeURIComponent(source)}`" class="discover-filter" :class="{ active: activeType === 'comic' }">Comics</NuxtLink>
        <NuxtLink :to="`/discover?type=video&source=${encodeURIComponent(source)}`" class="discover-filter" :class="{ active: activeType === 'video' }">Videos</NuxtLink>
      </nav>

      <div v-if="pending" class="nuxt-state-card">Loading published works…</div>
      <div v-else-if="error" class="nuxt-state-card">
        <h2>We couldn't load the published works.</h2>
        <p>Check the local read-only D1 connection, then try again.</p>
        <button type="button" class="button button-outline" @click="refresh()">Retry</button>
      </div>
      <div v-else-if="works.length" class="discover-page-grid">
        <NuxtLink v-for="work in works" :key="work.id" :to="workHref(work)" class="discover-work-card">
          <div class="discover-work-cover">
            <img v-if="work.coverUrl" :src="work.coverUrl" :alt="`${work.title} cover`" loading="lazy">
            <div v-else class="discover-work-placeholder"><span class="discover-work-lantern">✦</span><span>{{ String(work.type).toUpperCase() }}</span></div>
          </div>
          <div class="discover-work-body">
            <div class="discover-work-type">{{ String(work.type).toUpperCase() }}</div>
            <h2>{{ work.title }}</h2>
            <p>{{ work.description || `A new work from ${work.creatorName}.` }}</p>
            <div class="discover-work-footer"><span>{{ work.creatorName }}</span><span class="discover-arrow">→</span></div>
          </div>
        </NuxtLink>
      </div>
      <div v-else class="discover-empty">
        <div class="discover-empty-icon">🏮</div>
        <div class="section-eyebrow">NOTHING HERE YET</div>
        <h2>The Light Is Waiting.</h2>
        <p>There are no published works in this category yet.</p>
      </div>
    </div>
  </section>
</template>
