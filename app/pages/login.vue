<script setup lang="ts">
const legacyBase = 'https://lantern.midnightcaravans.workers.dev'
const auth = useLanternAuth()
const route = useRoute()
const email = ref('')
const password = ref('')
const csrfToken = ref('')
const pending = ref(false)
const message = ref('')
const messageType = ref<'error' | 'success'>('error')
const recoveryLink = ref('')
const database = ref<'production' | 'staging'>(route.query.database === 'staging' ? 'staging' : 'production')
if (route.query.reason === 'login-required') {
  message.value = 'Please log in to continue.'
}

useHead({ title: 'Log In' })

onMounted(async () => {
  try {
    const sessionUser = await auth.refresh(true)
    if (sessionUser) {
      await navigateTo('/account')
      return
    }
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    message.value = 'Lantern sign-in is temporarily unavailable. Please refresh and try again.'
  }
})

async function submitLogin() {
  message.value = ''
  recoveryLink.value = ''
  if (!csrfToken.value) {
    message.value = 'Security token is not ready. Refresh the page and try again.'
    return
  }

  pending.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
        database: database.value,
        csrfToken: csrfToken.value,
      },
    })

    const signedInUser = await auth.refresh(true)
    if (!signedInUser) {
      throw new Error('Your sign-in was accepted, but your session could not be confirmed. Please refresh and try again.')
    }

    messageType.value = 'success'
    message.value = 'Welcome back. Opening your account…'
    await navigateTo('/account')
  } catch (error: any) {
    const result = error?.data ?? {}
    messageType.value = 'error'
    message.value = result.message || result.statusMessage || 'Unable to log in. Please try again.'
    if (result.code === 'PASSWORD_RESET_REQUIRED') recoveryLink.value = '/forgot-password'
    if (result.code === 'EMAIL_NOT_VERIFIED') recoveryLink.value = '/resend-verification'
    if (result.code === 'STAGING_EMAIL_NOT_VERIFIED') recoveryLink.value = `/resend-verification?email=${encodeURIComponent(email.value)}`
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">🏮</div>
      <h1>Welcome Back</h1>
      <p class="auth-subtitle">Return to your Lantern.</p>

      <div v-if="message" class="flash" :class="messageType" role="status" aria-live="polite">
        {{ message }}
        <p v-if="recoveryLink" class="auth-note">
          <a :href="recoveryLink">Continue to the existing Lantern recovery page</a>
        </p>
      </div>

      <form @submit.prevent="submitLogin">
        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            v-model.trim="email"
            type="email"
            name="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
            maxlength="320"
          >
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            name="password"
            placeholder="Your password"
            autocomplete="current-password"
            required
            maxlength="1024"
          >
        </div>

        <div class="form-group">
          <label for="database">Account environment</label>
          <select id="database" v-model="database" name="database">
            <option value="production">Production — live account (read-only here)</option>
            <option value="staging">Staging — editable testing copy</option>
          </select>
          <p class="auth-note">Choose Staging when testing edits. Production remains unchanged.</p>
        </div>

        <button type="submit" class="button button-gold button-full" :disabled="pending || !csrfToken">
          {{ pending ? 'Logging In…' : 'Log In' }}
        </button>
      </form>

      <p class="auth-footer">
        <NuxtLink to="/forgot-password">Forgot your password?</NuxtLink>
      </p>
      <p class="auth-footer">
        Don't have an account? <NuxtLink to="/register">Join Lantern</NuxtLink>
      </p>
      <p class="auth-note">Use the same account and password. Choose which database to access above.</p>
    </div>
  </section>
</template>
