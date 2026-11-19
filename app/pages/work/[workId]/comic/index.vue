<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

import type { FetchError } from 'ofetch'

const route = useRoute()
const workId = computed(() => String(route.params.workId))
const { data, pending, error, refresh } = await useFetch<any>(() => `/api/comic/works/${workId.value}`)
const work = computed(() => data.value?.work ?? null)
const episodes = computed(() => data.value?.episodes ?? [])
const writable = computed(() => data.value?.writable === true)
const busy = ref(false)
const creationFlash = useLanternFlash().consume()
const message = ref(creationFlash?.message ?? '')
const messageType = ref<'success' | 'error'>('success')
const csrfToken = ref('')

useHead({ title: computed(() => work.value ? `${work.value.title} — Comic Workspace — Lantern` : 'Comic Workspace') })

onMounted(async () => {
  try {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    messageType.value = 'error'
    message.value = 'The security check is unavailable. Refresh and try again.'
  }
})

async function publishComic() {
  if (!writable.value || busy.value || !csrfToken.value) return
  if (!window.confirm('Publish this comic on Lantern?')) return
  busy.value = true
  message.value = ''
  try {
    await $fetch<{ message: string }>(`/api/comic/works/${workId.value}/publish`, {
      method: 'POST', body: { csrfToken: csrfToken.value },
    })
    // Flask redirects to the public comic immediately after successful publication.
    await navigateTo({ path: `/comics/${workId.value}`, query: { source: 'staging' } })
  } catch (error: unknown) {
    messageType.value = 'error'
    message.value = (error as FetchError)?.data?.statusMessage || 'The comic could not be published.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="comic-workspace-page">
    <div class="container">
      <div v-if="pending" class="auth-card"><div class="auth-icon">🏮</div></div>
      <div v-else-if="error || !work" class="auth-card">
        <h1>Comic unavailable</h1>
        <p class="auth-subtitle">We couldn't load this comic workspace.</p>
        <NuxtLink to="/dashboard" class="button button-outline">Dashboard</NuxtLink>
      </div>
      <template v-else>
        <div class="workspace-top">
          <div>
            <div class="section-eyebrow">COMIC · {{ work.status.toUpperCase() }}</div>
            <h1>{{ work.title }}</h1>
            <p>{{ work.description || 'Build your comic episode by episode.' }}</p>
          </div>
          <div class="workspace-actions">
            <NuxtLink v-if="work.status === 'published' && episodes.length" :to="`/comics/${work.id}?source=staging`" class="button button-gold">View Published Comic</NuxtLink>
            <NuxtLink :to="`/work/${work.id}/edit`" class="button button-outline">Edit Details</NuxtLink>
            <NuxtLink to="/dashboard" class="button button-outline">Dashboard</NuxtLink>
          </div>
        </div>

        <div v-if="message" class="flash" :class="messageType" role="status">{{ message }}</div>
        <div v-if="!writable" class="flash">
          Production content is displayed read-only in this staging build. Editing and publishing are disabled; the original Lantern remains unchanged.
        </div>
        <div class="workspace-divider"></div>

        <div class="comic-workspace-heading">
          <div>
            <div class="section-eyebrow">YOUR COMIC</div>
            <h2>Episodes</h2>
          </div>
          <div class="workspace-actions">
            <span class="comic-episode-count">{{ episodes.length }} episode{{ episodes.length === 1 ? '' : 's' }}</span>
            <NuxtLink v-if="writable" :to="`/work/${work.id}/comic/episode/new`" class="button button-gold">+ Add Episode</NuxtLink>
            <button v-else type="button" class="button button-gold" disabled>+ Add Episode</button>
          </div>
        </div>

        <div v-if="episodes.length" class="comic-episode-list">
          <NuxtLink v-for="episode in episodes" :key="episode.id" :to="`/comic/episode/${episode.id}/edit`" class="comic-episode-item">
            <div class="comic-episode-number">{{ String(episode.episodeNumber).padStart(2, '0') }}</div>
            <div class="comic-episode-info">
              <h3>{{ episode.title }}</h3>
              <p>{{ episode.pageCount }} page{{ episode.pageCount === 1 ? '' : 's' }} · {{ episode.status.charAt(0).toUpperCase() + episode.status.slice(1) }}</p>
            </div>
            <div class="comic-episode-arrow">→</div>
          </NuxtLink>
        </div>
        <div v-else class="comic-empty-state">
          <div class="comic-empty-icon">🏮</div>
          <h2>Nothing here yet</h2>
          <p>Create your first episode.</p>
          <p>Upload your comic pages and turn them into a readable episode on Lantern.</p>
          <NuxtLink v-if="writable" :to="`/work/${work.id}/comic/episode/new`" class="button button-gold">Create Episode One</NuxtLink>
        </div>

        <section v-if="work.status !== 'published' && episodes.length" style="margin-top: 3rem; padding: 2rem; border: 1px solid var(--border); background: rgba(13, 27, 42, 0.55);">
          <div class="section-eyebrow">READY TO RELEASE?</div>
          <h2 style="margin: 0.35rem 0 0.75rem;">Publish {{ work.title }}</h2>
          <p style="max-width: 720px; color: var(--muted); line-height: 1.7;">
            Publishing makes the comic visible to readers. Every episode must contain at least one page. You can continue editing your comic afterward.
          </p>
          <button type="button" class="button button-gold" style="margin-top: 1.25rem;" :disabled="!writable || busy || !csrfToken" @click="publishComic">
            {{ busy ? 'Publishing…' : 'Publish Comic' }}
          </button>
        </section>
      </template>
    </div>
  </section>
</template>
