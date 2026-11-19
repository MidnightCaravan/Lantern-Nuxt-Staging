<script setup lang="ts">
const route = useRoute()
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
const email = computed(() => typeof route.query.email === 'string' ? route.query.email : '')
const sent = computed(() => route.query.sent === '1')
const csrfToken = ref('')
const pending = ref(false)
const verified = ref(false)
const message = ref('')
const messageType = ref<'error' | 'success'>('success')

useHead({ title: 'Verify Email' })

onMounted(async () => {
  try {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    messageType.value = 'error'
    message.value = 'The verification page is temporarily unavailable. Refresh and try again.'
  }
})

async function verifyEmail() {
  if (!csrfToken.value || !token.value) {
    messageType.value = 'error'
    message.value = 'The verification link is missing or invalid. Request a new link.'
    return
  }
  pending.value = true
  message.value = ''
  try {
    const result = await $fetch<{ ok: boolean; message: string }>('/api/auth/verify', {
      method: 'POST', body: { token: token.value, csrfToken: csrfToken.value },
    })
    verified.value = true
    messageType.value = 'success'
    message.value = result.message
  } catch (error: any) {
    messageType.value = 'error'
    message.value = error?.data?.message || error?.data?.statusMessage || 'This verification link is invalid or has expired.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">🏮</div>
      <h1>{{ token ? 'Verify Your Email' : 'Check Your Email' }}</h1>
      <p v-if="sent && email" class="auth-subtitle">We have processed your registration for {{ email }}.</p>
      <p v-else-if="sent" class="auth-subtitle">Your Lantern account has been created.</p>
      <p v-else class="auth-subtitle">Confirm your email address to activate your Lantern account.</p>
      <div v-if="message" class="flash" :class="messageType" role="status" aria-live="polite">{{ message }}</div>
      <template v-if="token && !verified">
        <p class="auth-note">For your security, open the link and confirm below. The link expires after 24 hours.</p>
        <button class="button button-gold button-full" type="button" :disabled="pending || !csrfToken" @click="verifyEmail">
          {{ pending ? 'Verifying…' : 'Confirm Email Address' }}
        </button>
      </template>
      <template v-else-if="verified">
        <NuxtLink :to="{ path: '/login', query: { database: 'staging' } }" class="button button-gold button-full">Continue to Log In</NuxtLink>
      </template>
      <template v-else>
        <p v-if="!sent" class="auth-note">Open the verification link from your email to continue.</p>
        <NuxtLink :to="`/resend-verification${email ? `?email=${encodeURIComponent(email)}` : ''}`" class="button button-gold button-full">Resend Verification Email</NuxtLink>
      </template>
      <p class="auth-footer"><NuxtLink to="/login">Back to Log In</NuxtLink></p>
    </div>
  </section>
</template>
