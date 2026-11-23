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
const flash = useLanternFlash()
const initialFlash = flash.consume()
if (initialFlash) {
  message.value = initialFlash.message
  messageType.value = initialFlash.category
}
const databaseQuery = route.query.database
const databaseExplicit = databaseQuery === 'staging' || databaseQuery === 'production'
const database = ref<'production' | 'staging'>(databaseQuery === 'staging' ? 'staging' : 'production')
// Do not allow a submit before the deployment default is known: a fast client
// would otherwise log a staging registration into the production database.
const configResolved = ref(databaseExplicit)
if (!initialFlash && route.query.reason === 'login-required') {
  message.value = 'Please log in to continue.'
}

useHead({ title: 'Log In' })

onMounted(async () => {
  try {
    if (!databaseExplicit) {
      const config = await $fetch<{ defaultDatabase: 'production' | 'staging' }>('/api/public/config')
      if (config.defaultDatabase === 'staging' || config.defaultDatabase === 'production') {
        database.value = config.defaultDatabase
      }
    }
  } catch {
    // Keep the safe production default when deployment config is unavailable.
  } finally {
    configResolved.value = true
  }

  try {
    // Flask's GET /login always renders the form, even for a signed-in user
    // (lantern_auth.py:430,521-523). Do not silently redirect to the dashboard
    // here; the header already swaps in the Dashboard link when signed in.
    const result = await $fetch<{ csrfToken: string }>('/api/auth/csrf')
    csrfToken.value = result.csrfToken
  } catch {
    message.value = 'Lantern sign-in is temporarily unavailable. Please refresh and try again.'
  }
})

async function submitLogin() {
  message.value = ''
  recoveryLink.value = ''
  if (!configResolved.value) {
    message.value = 'Sign-in is still initializing. Please wait a moment and try again.'
    return
  }
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
          <NuxtLink :to="recoveryLink">Continue here</NuxtLink>
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

        <button type="submit" class="button button-gold button-full" :disabled="pending || !csrfToken || !configResolved">
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
