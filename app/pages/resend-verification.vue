<script setup lang="ts">
const route = useRoute()
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const csrfToken = ref('')
const pending = ref(false)
const message = ref('')
const messageType = ref<'error' | 'success'>('success')

useHead({ title: 'Verify Your Email' })

onMounted(async () => {
  try {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    messageType.value = 'error'
    message.value = 'This page is temporarily unavailable. Refresh and try again.'
  }
})

async function resend() {
  if (!csrfToken.value) return
  pending.value = true
  message.value = ''
  try {
    const result = await $fetch<{ message: string }>('/api/auth/resend-verification', {
      method: 'POST', body: { email: email.value, csrfToken: csrfToken.value },
    })
    messageType.value = 'success'
    message.value = result.message
  } catch (error: any) {
    messageType.value = 'error'
    message.value = error?.data?.message || error?.data?.statusMessage || 'Unable to resend the verification email.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">🏮</div>
      <h1>Resend Verification</h1>
      <p class="auth-subtitle">Enter the email address used for your new staging account.</p>
      <div v-if="message" class="flash" :class="messageType" role="status" aria-live="polite">{{ message }}</div>
      <form @submit.prevent="resend">
        <div class="form-group">
          <label for="email">Email</label>
          <input id="email" v-model.trim="email" type="email" name="email" autocomplete="email" maxlength="320" required placeholder="you@example.com">
        </div>
        <button type="submit" class="button button-gold button-full" :disabled="pending || !csrfToken">
          {{ pending ? 'Sending…' : 'Send New Verification Link' }}
        </button>
      </form>
      <p class="auth-footer"><NuxtLink to="/login">Back to Log In</NuxtLink></p>
    </div>
  </section>
</template>
