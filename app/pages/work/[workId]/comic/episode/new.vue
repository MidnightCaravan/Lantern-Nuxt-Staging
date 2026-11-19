<script setup lang="ts">
import type { FetchError } from 'ofetch'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const workId = computed(() => String(route.params.workId))
const title = ref('')
const csrfToken = ref('')
const pending = ref(false)
const flash = useLanternFlash()
const creationFlash = flash.consume()
const message = ref(creationFlash?.message ?? '')
const messageType = ref<'success' | 'error'>(creationFlash?.category ?? 'success')
const readOnly = ref(false)
const workTitle = ref('')
const loading = ref(true)

useHead({ title: computed(() => workTitle.value ? `New Comic Episode — ${workTitle.value} — Lantern` : 'New Comic Episode') })

onMounted(async () => {
  try {
    const [csrf, workspace] = await Promise.all([
      $fetch<{ csrfToken: string }>('/api/auth/csrf'),
      $fetch<any>(`/api/comic/works/${workId.value}`),
    ])
    csrfToken.value = csrf.csrfToken
    readOnly.value = workspace.writable !== true
    workTitle.value = workspace.work?.title || ''
  } catch (error: unknown) {
    messageType.value = 'error'
    message.value = (error as FetchError)?.data?.statusMessage || 'The comic workspace could not be loaded.'
  } finally {
    loading.value = false
  }
})

async function createEpisode() {
  if (!title.value.trim() || !csrfToken.value || readOnly.value || pending.value) return
  pending.value = true
  message.value = ''
  try {
    const result = await $fetch<{ episodeId: number; message?: string }>(`/api/comic/works/${workId.value}/episodes`, {
      method: 'POST', body: { title: title.value, csrfToken: csrfToken.value },
    })
    flash.set(result.message || 'Episode created.', 'success')
    await navigateTo(`/comic/episode/${result.episodeId}/edit`)
  } catch (error: unknown) {
    messageType.value = 'error'
    message.value = (error as FetchError)?.data?.statusMessage || 'The episode could not be created.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="comic-episode-page">
    <div class="container">
      <div v-if="loading" class="auth-card"><div class="auth-icon">🏮</div></div>
      <div v-else>
        <div class="workspace-top">
          <div>
            <div class="section-eyebrow">COMIC · EPISODE</div>
            <h1>New Episode</h1>
            <p>{{ workTitle }}</p>
          </div>
          <div class="workspace-actions">
            <NuxtLink :to="`/work/${workId}/comic`" class="button button-outline">← Back to Comic Workspace</NuxtLink>
          </div>
        </div>
        <div v-if="message" class="flash" :class="messageType" role="status">{{ message }}</div>
        <div v-if="readOnly" class="flash">This production comic is read-only in the Nuxt staging build.</div>
        <div class="workspace-divider"></div>
        <form @submit.prevent="createEpisode">
          <div class="comic-episode-title-field">
            <label for="episode-title">Episode Title</label>
            <input id="episode-title" v-model.trim="title" type="text" placeholder="Episode title" maxlength="200" required :disabled="readOnly">
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 2rem; padding-bottom: 4rem; flex-wrap: wrap;">
            <NuxtLink :to="`/work/${workId}/comic`" class="button button-outline">Cancel</NuxtLink>
            <button type="submit" class="button button-gold" :disabled="readOnly || pending || !csrfToken">{{ pending ? 'Creating…' : 'Create Episode' }}</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
