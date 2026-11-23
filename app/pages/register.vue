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
  // Flask validates username, then password length, then confirmation on the
  // server (lantern_auth.py:90-123). A client-side mismatch check here would
  // show the wrong message when both errors are present, so let the API report
  // the first Flask error. Native `minlength` still blocks normal short input.
  pending.value = true
  try {
    await $fetch<{ ok: boolean; emailSent: boolean; message: string }>('/api/auth/register', {
      method: 'POST',
      body: { username: username.value, email: email.value, password: password.value, confirmPassword: confirmPassword.value, csrfToken: csrfToken.value },
    })
    // Flask redirects to /verification-sent after registration
    // (lantern_auth.py:250-254).
    await navigateTo('/verification-sent')
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
      <p class="auth-subtitle">Create your free creator account.</p>
      <div v-if="message" class="flash error" role="alert" aria-live="polite">{{ message }}</div>
      <form @submit.prevent="submitRegistration">
        <div class="form-group">
          <label for="username">Username</label>
          <input id="username" v-model.trim="username" type="text" name="username" autocomplete="username" minlength="3" required placeholder="yourname">
        </div>
        <div class="form-group">
          <label for="email">Email</label>
          <input id="email" v-model.trim="email" type="email" name="email" autocomplete="email" required placeholder="you@example.com">
          <small>Your email stays private.</small>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input id="password" v-model="password" type="password" name="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters">
        </div>
        <div class="form-group">
          <label for="confirm_password">Confirm Password</label>
          <input id="confirm_password" v-model="confirmPassword" type="password" name="confirm_password" autocomplete="new-password" minlength="8" required placeholder="Enter your password again">
        </div>
        <button type="submit" class="button button-gold button-full" :disabled="pending || !csrfToken">
          {{ pending ? 'Creating Account…' : 'Create Free Account' }}
        </button>
      </form>
      <p class="auth-footer">Already have an account? <NuxtLink to="/login">Log in</NuxtLink></p>
    </div>
  </section>
</template>
