<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const router = useRouter()
const type = computed(() => String(route.params.workType || ''))
const labels: Record<string,string> = { novel:'Novel', comic:'Comic', video:'Video' }
const icons: Record<string,string> = { novel:'📖', comic:'🎨', video:'🎬' }
if (!labels[type.value]) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
const title = ref('')
const description = ref('')
const busy = ref(false)
const error = ref('')
const csrfToken = ref('')
const flash = useLanternFlash()
const label = computed(() => labels[type.value] || '')
useHead({ title: computed(() => label.value ? `Create ${label.value} — Lantern` : 'Create Work — Lantern') })
async function submit() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const csrf = csrfToken.value || (await $fetch<{csrfToken:string}>('/api/auth/csrf')).csrfToken
    csrfToken.value = csrf
    const result = await $fetch<{workId:number;type:string;message:string}>('/api/studio/works', { method:'POST', body:{ title:title.value, description:description.value, type:type.value, csrfToken:csrf } })
    flash.set(result.message, 'success')
    const path = result.type === 'Novel' ? `/work/${result.workId}/novel` : result.type === 'Comic' ? `/work/${result.workId}/comic` : `/work/${result.workId}/edit`
    await router.push(path)
  } catch (cause:any) {
    const statusCode = Number(cause?.statusCode ?? cause?.response?.status ?? cause?.data?.statusCode)
    error.value = cause?.data?.statusMessage || cause?.message || 'The draft could not be created.'
    if (statusCode === 400) { title.value = ''; description.value = '' }
  }
  finally { busy.value = false }
}
</script>
<template>
  <section class="auth-page"><div class="auth-card">
    <div class="auth-icon">{{ icons[type] || '🏮' }}</div><h1>New {{ label }}</h1><p class="auth-subtitle">Start your {{ label.toLowerCase() }}. This will be saved as a private draft.</p>
    <p v-if="error" class="flash error">{{ error }}</p>
    <form @submit.prevent="submit">
      <div class="form-group"><label for="title">Title</label><input id="title" v-model="title" type="text" maxlength="200" placeholder="Give your work a title" required autofocus></div>
      <div class="form-group"><label for="description">Description</label><textarea id="description" v-model="description" maxlength="2000" placeholder="Tell readers what your work is about..."></textarea><small>Maximum 2,000 characters.</small></div>
      <button type="submit" class="button button-gold button-full" :disabled="busy || !label">{{ busy ? 'Creating…' : 'Create Draft' }}</button>
    </form>
    <p class="auth-footer"><NuxtLink to="/create">← Choose another format</NuxtLink></p>
  </div></section>
</template>
