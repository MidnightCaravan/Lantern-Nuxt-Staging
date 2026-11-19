<script setup lang="ts">
const username = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const csrfToken = ref('')
const pending = ref(false)
const message = ref('')
const messageType = ref<'error' | 'success'>('error')

useHead({ title: 'Join Lantern' })

onMounted(async () => {
  try {
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    message.value = 'Registration is temporarily unavailable. Refresh the page and try again.'
  }
})

async function submitRegistration() {
  message.value = ''
  if (!csrfToken.value) {
    message.value = 'Security token is not ready. Refresh the page and try again.'
    return
  }
  if (password.value !== confirmPassword.value) {
    message.value = 'Your passwords do not match.'
    return
  }
  pending.value = true
  try {
    const result = await $fetch<{ ok: boolean; emailSent: boolean; message: string }>('/api/auth/register', {
      method: 'POST',
      body: { username: username.value, email: email.value, password: password.value, confirmPassword: confirmPassword.value, csrfToken: csrfToken.value },
    })
    await navigateTo({ path: '/verify-email', query: { email: email.value.trim(), sent: result.emailSent ? '1' : '0' } })
  } catch (error: any) {
    messageType.value = 'error'
    message.value = error?.data?.message || error?.data?.statusMessage || 'Unable to create your account. Please try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">🏮</div>
      <h1>Join Lantern</h1>
      <p class="auth-subtitle">Create your account and share your stories.</p>
      <div v-if="message" class="flash error" role="alert" aria-live="polite">{{ message }}</div>
      <form @submit.prevent="submitRegistration">
        <div class="form-group">
          <label for="username">Username</label>
          <input id="username" v-model.trim="username" type="text" name="username" autocomplete="username" minlength="3" maxlength="80" required placeholder="Your creator name">
        </div>
        <div class="form-group">
          <label for="email">Email</label>
          <input id="email" v-model.trim="email" type="email" name="email" autocomplete="email" maxlength="320" required placeholder="you@example.com">
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input id="password" v-model="password" type="password" name="password" autocomplete="new-password" minlength="8" maxlength="1024" required placeholder="At least 8 characters">
        </div>
        <div class="form-group">
          <label for="confirm-password">Confirm password</label>
          <input id="confirm-password" v-model="confirmPassword" type="password" name="confirm-password" autocomplete="new-password" minlength="8" maxlength="1024" required placeholder="Enter your password again">
        </div>
        <button type="submit" class="button button-gold button-full" :disabled="pending || !csrfToken">
          {{ pending ? 'Creating Account…' : 'Create Account' }}
        </button>
      </form>
      <p class="auth-footer">Already have a Lantern account? <NuxtLink to="/login">Log in</NuxtLink></p>
      <p class="auth-note">You will need to verify your email before signing in.</p>
    </div>
  </section>
</template>
