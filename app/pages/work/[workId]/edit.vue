<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const workId = computed(() => Number(route.params.workId))
const { data, pending, error: loadError, refresh } = await useFetch<any>(() => `/api/studio/works/${workId.value}`)

// Flask renders templates/404.html for a missing or unowned work
// (lantern_works.py:251).
if (isLanternNotFound(loadError.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const work = computed(() => data.value?.work ?? null)
const title = ref('')
const description = ref('')
const busy = ref(false)
const flash = useLanternFlash()
const creationFlash = flash.consume()
const message = ref(creationFlash?.message ?? '')
const error = ref('')
const csrfToken = ref('')
watch(work, (value) => { if (value) { title.value = String(value.title || ''); description.value = String(value.description || '') } }, { immediate:true })
useHead({ title: computed(() => work.value ? `${work.value.title} — Lantern` : 'Edit Work — Lantern') })
async function save() {
  busy.value=true; error.value=''; message.value=''
  try { const csrf=csrfToken.value || (await $fetch<{csrfToken:string}>('/api/auth/csrf')).csrfToken; csrfToken.value=csrf; const result=await $fetch<any>(`/api/studio/works/${workId.value}`,{method:'PUT',body:{title:title.value,description:description.value,csrfToken:csrf}}); message.value=result.message; await refresh() }
  catch(cause:any){
    const messageText = cause?.data?.statusMessage || cause?.statusMessage || cause?.message || 'Could not save work.'
    error.value = messageText
    if (['Title cannot be empty.', 'Title must be 200 characters or fewer.', 'Description must be 2,000 characters or fewer.'].includes(messageText) && work.value) {
      title.value = String(work.value.title || '')
      description.value = String(work.value.description || '')
    }
  }
  finally{busy.value=false}
}
async function handleVideoUploaded() { await refresh() }
async function publishVideo() {
  busy.value=true; error.value=''; message.value=''
  try {
    const csrf=csrfToken.value || (await $fetch<{csrfToken:string}>('/api/auth/csrf')).csrfToken
    csrfToken.value=csrf
    // Flask flashes this success message; work.html does not render flashes,
    // so it surfaces on the next flash-rendering page (lantern_publishing.py:377-378).
    const result = await $fetch<{ message: string }>(`/api/studio/works/${workId.value}/video/publish`,{method:'POST',body:{csrfToken:csrf}})
    flash.set(result.message, 'success')
    await navigateTo({ path: `/work/${workId.value}`, query: { source: 'staging' } })
  }
  catch(cause:any){error.value=cause?.data?.statusMessage || cause?.message || 'Could not publish video.'}
  finally{busy.value=false}
}
</script>
<template>
  <section v-if="pending" class="create-page"><div class="container"><p>Loading work…</p></div></section>
  <section v-else-if="loadError || !work" class="create-page"><div class="container"><h1>Work not found</h1><NuxtLink to="/dashboard" class="button button-gold">Back to Dashboard</NuxtLink></div></section>
  <section v-else class="create-page"><div class="container">
    <div class="create-header"><div class="section-eyebrow">{{ work.type }} · {{ String(work.status).toUpperCase() }}</div><h1>{{ work.title }}</h1><p>Your work is private while it is a draft. Build it here before publishing.</p></div>
    <p v-if="!data?.writable" class="flash error">Production works are read-only in this staging version.</p>
    <p v-if="message" class="flash success">{{ message }}</p><p v-if="error" class="flash error">{{ error }}</p>
    <div class="auth-card"><form @submit.prevent="save">
      <div class="form-group"><label for="work-title">Title</label><input id="work-title" v-model="title" maxlength="200" required :disabled="!data?.writable"></div>
      <div class="form-group"><label for="work-description">Description</label><textarea id="work-description" v-model="description" maxlength="2000" :disabled="!data?.writable"></textarea><small>Maximum 2,000 characters.</small></div>
      <button type="submit" class="button button-gold button-full" :disabled="busy || !data?.writable">{{ busy ? 'Saving…' : 'Save Draft' }}</button>
    </form>
    <LanternVideoUploader v-if="work.type === 'Video' && data?.writable" :work-id="workId" :initial-video-path="work.video_path" :initial-status="work.status" @uploaded="handleVideoUploaded" />
    <div v-if="work.type === 'Video' && work.video_path && work.status !== 'published'" style="margin-top:1rem"><button class="button button-outline" :disabled="busy || !data?.writable" @click="publishVideo">Publish Video</button></div>
    <p v-else-if="work.type === 'Video' && work.status === 'published'" class="flash success" style="margin-top:1rem">This video is published. Uploading a replacement updates the public video.</p>
    <div style="display:flex;justify-content:flex-end;gap:1rem;flex-wrap:wrap;margin-top:2rem"><NuxtLink to="/dashboard" class="button button-outline">← Back to Dashboard</NuxtLink></div>
    </div>
  </div></section>
</template>
