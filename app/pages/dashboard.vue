<script setup lang="ts">
const legacyBase = 'https://lantern.midnightcaravans.workers.dev'
const { data, pending, error, refresh } = await useFetch<{
  user: { id: number; username: string; displayName: string; avatar: string | null }
  works: Array<{ id: number; title: string; type: string; status: string; coverUrl: string | null }>
  writable: boolean
}>('/api/dashboard')

const user = computed(() => data.value?.user ?? null)
const works = computed(() => data.value?.works ?? [])
const writable = computed(() => data.value?.writable === true)

const csrfToken = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const busyWork = ref<number | null>(null)
const selectedFiles = ref<Record<number, File>>({})

useHead({ title: 'Dashboard — Lantern' })

onMounted(async () => {
  try {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    messageType.value = 'error'
    message.value = 'Dashboard security check is unavailable. Refresh and try again.'
  }
})

function workHref(work: { id: number; type: string }) {
  if (work.type === 'Comic') return `/work/${work.id}/comic`
  if (work.type === 'Novel') return `/work/${work.id}/novel`
  return `/work/${work.id}/edit`
}

function chooseFile(workId: number, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) selectedFiles.value = { ...selectedFiles.value, [workId]: file }
}

async function uploadThumbnail(workId: number) {
  const file = selectedFiles.value[workId]
  // Flask flashes this when no file was chosen (lantern_works.py:856-860).
  if (!file) {
    messageType.value = 'error'
    message.value = 'Please choose a thumbnail image.'
    return
  }
  if (!csrfToken.value) return

  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  busyWork.value = workId
  message.value = ''

  try {
    const result = await $fetch<{ message: string }>(`/api/dashboard/works/${workId}/thumbnail`, {
      method: 'PUT',
      headers: {
        'X-CSRF-Token': csrfToken.value,
        'X-Lantern-Extension': extension,
      },
      body: file,
    })
    messageType.value = 'success'
    message.value = result.message
    delete selectedFiles.value[workId]
    await refresh()
  } catch (err: any) {
    messageType.value = 'error'
    message.value = err?.data?.statusMessage || err?.data?.message || 'Thumbnail upload failed. Please try again.'
  } finally {
    busyWork.value = null
  }
}

async function thumbnailAction(workId: number, mode: 'first_page' | 'remove') {
  if (!csrfToken.value) return
  busyWork.value = workId
  message.value = ''

  try {
    const result = await $fetch<{ message: string }>(`/api/dashboard/works/${workId}/thumbnail`, {
      method: 'POST',
      body: { mode, csrfToken: csrfToken.value },
    })
    messageType.value = 'success'
    message.value = result.message
    await refresh()
  } catch (err: any) {
    messageType.value = 'error'
    message.value = err?.data?.statusMessage || err?.data?.message || 'The thumbnail could not be updated.'
  } finally {
    busyWork.value = null
  }
}

async function deleteDraft(workId: number, title: string) {
  if (!csrfToken.value) return

  const confirmed = window.confirm('Delete this draft? This will permanently remove the work and its chapters or comic pages.')
  if (!confirmed) return

  busyWork.value = workId
  message.value = ''

  try {
    const result = await $fetch<{ message: string }>(`/api/dashboard/works/${workId}/delete`, {
      method: 'POST',
      body: { csrfToken: csrfToken.value },
    })
    messageType.value = 'success'
    message.value = result.message || `"${title}" was deleted.`
    await refresh()
  } catch (err: any) {
    messageType.value = 'error'
    message.value = err?.data?.statusMessage || err?.data?.message || 'The draft could not be deleted.'
  } finally {
    busyWork.value = null
  }
}

</script>

<template>
  <div>
    <section v-if="!pending && user" class="lantern-thumbnail-studio">
      <div class="thumbnail-studio-heading">
        <div>
          <p class="thumbnail-eyebrow">Presentation</p>
          <h2>Work Thumbnails</h2>
          <p class="thumbnail-intro">Give each work a visual identity for your Lantern library and future discovery pages.</p>
        </div>
      </div>

      <div class="thumbnail-grid">
        <article v-for="work in works" :key="work.id" class="thumbnail-card">
          <div class="thumbnail-preview">
            <img v-if="work.coverUrl" :src="work.coverUrl" :alt="`${work.title} thumbnail`">
            <template v-else>
              <img src="/images/lantern-header-icon.png" alt="" class="thumbnail-default">
              <span>No thumbnail</span>
            </template>
          </div>

          <div class="thumbnail-card-body">
            <div class="thumbnail-card-meta">
              <span>{{ work.type }}</span>
              <span>{{ jinjaCapitalize(work.status) }}</span>
            </div>
            <h3>{{ work.title }}</h3>

            <template v-if="writable">
              <form class="thumbnail-upload-form" @submit.prevent="uploadThumbnail(work.id)">
                <label :for="`thumbnail-${work.id}`">Upload custom thumbnail</label>
                <input
                  :id="`thumbnail-${work.id}`"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.gif"
                  required
                  @change="chooseFile(work.id, $event)"
                >
                <button type="submit" class="button button-gold" :disabled="busyWork === work.id || !selectedFiles[work.id]">
                  {{ busyWork === work.id ? 'Uploading...' : 'Upload Thumbnail' }}
                </button>
              </form>

              <form v-if="work.type === 'Comic'" @submit.prevent="thumbnailAction(work.id, 'first_page')">


                <button type="submit" class="button button-outline" :disabled="busyWork === work.id">Use First Comic Page</button>


              </form>

              <form v-if="work.coverUrl" @submit.prevent="thumbnailAction(work.id, 'remove')">


                <button type="submit" class="button button-outline" :disabled="busyWork === work.id">Remove Thumbnail</button>


              </form>
            </template>
          </div>
        </article>
      </div>
    </section>

    <section class="dashboard">
      <div class="container">
        <div v-if="pending" class="auth-card"><div class="auth-icon">🏮</div></div>

        <template v-else-if="user">
          <div class="dashboard-header">
            <div>
              <p class="section-eyebrow">Creator Space</p>
              <h1>Welcome, {{ user.displayName }}.</h1>
              <p>This is your Lantern.</p>
            </div>

            <div class="dashboard-actions">
              <a :href="`/@${encodeURIComponent(user.username)}?source=staging`" class="button button-outline">View Profile</a>
              <a :href="`/profile/edit`" class="button button-outline">Edit Profile</a>
              <a :href="`/create`" class="button button-gold">Create Work</a>
            </div>
          </div>

          <div v-if="message" class="flash" :class="messageType" role="status" aria-live="polite">{{ message }}</div>

          <div v-if="!writable" class="flash">
            Production content is displayed read-only in this staging build. The original Lantern remains available for changes while migration is underway.
          </div>

          <div v-if="works.length" class="work-grid">
            <article v-for="work in works" :key="work.id" class="work-card">
              <a :href="workHref(work)" class="work-card-cover" :aria-label="`Open ${work.title}`">
                <img v-if="work.coverUrl" :src="work.coverUrl" :alt="work.title">
                <span v-else aria-hidden="true">🏮</span>
              </a>

              <div class="work-card-body">
                <a :href="workHref(work)" class="work-card-link">
                  <h3>{{ work.title }}</h3>
                  <p>{{ work.type }} · {{ work.status }}</p>
                </a>

                <button
                  v-if="work.status === 'draft' && writable"
                  type="button"
                  class="button button-outline"
                  :disabled="busyWork === work.id"
                  @click="deleteDraft(work.id, work.title)"
                >{{ busyWork === work.id ? 'Deleting…' : 'Delete Draft' }}</button>

                <span v-else-if="work.status !== 'draft'" class="work-published-label">Published</span>
              </div>
            </article>
          </div>

          <div v-else class="empty-state">
            <div class="empty-state-icon">🏮</div>
            <h2>Your Library Is Empty</h2>
            <p>Your stories, comics, and videos will live here.</p>
            <a :href="`/create`" class="button button-gold">Create Your First Work</a>
          </div>
        </template>

        <div v-else-if="error" class="auth-card">
          <h1>Dashboard unavailable</h1>
          <p class="auth-subtitle">We couldn't load your Lantern dashboard.</p>
          <NuxtLink to="/login" class="button button-gold button-full">Return to Log In</NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lantern-thumbnail-studio {
  margin-top: 4rem;
  padding: 2.5rem;
  background: rgba(10, 18, 30, 0.92);
  border: 1px solid rgba(210, 157, 55, 0.24);
}
.thumbnail-eyebrow {
  margin: 0 0 0.5rem;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  font-weight: 700;
}
.thumbnail-studio-heading h2 { margin: 0; color: var(--ivory); }
.thumbnail-intro {
  max-width: 650px;
  margin: 0.7rem 0 0;
  color: var(--muted);
  line-height: 1.7;
}
.thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 300px));
  justify-content: start;
  gap: 1.5rem;
  margin-top: 2rem;
}
.thumbnail-card {
  overflow: hidden;
  border: 1px solid rgba(210, 157, 55, 0.18);
  background: rgba(5, 8, 13, 0.96);
}
.thumbnail-preview {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: #080d14;
}
.thumbnail-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumbnail-preview .thumbnail-default {
  padding: 28%;
  object-fit: contain;
  opacity: 0.55;
}
.thumbnail-preview span {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  padding: 0.35rem 0.7rem;
  background: rgba(0, 0, 0, 0.72);
  color: var(--muted);
  font-size: 0.76rem;
}
.thumbnail-card-body { padding: 1.25rem; }
.thumbnail-card-meta {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.thumbnail-card h3 {
  margin: 0.7rem 0 1.1rem;
  color: var(--ivory);
  font-size: 1.3rem;
}
.thumbnail-upload-form {
  display: grid;
  gap: 0.7rem;
  margin-bottom: 0.8rem;
}
.thumbnail-upload-form label {
  color: var(--ivory);
  font-size: 0.86rem;
  font-weight: 600;
}
.thumbnail-upload-form input[type="file"] {
  width: 100%;
  padding: 0.65rem;
  border: 1px solid rgba(210, 157, 55, 0.18);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
}
.thumbnail-card-body > form:not(.thumbnail-upload-form) { margin-top: 0.7rem; }
.thumbnail-card-body .button { width: 100%; text-align: center; }
@media (max-width: 700px) {
  .lantern-thumbnail-studio { padding: 1.4rem; }
}
</style>
