<script setup lang="ts">
const route = useRoute()
const flash = useLanternFlash()
const token = computed(() => String(route.params.token || ''))
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref('')
const valid = ref(false)

useHead({ title: 'Reset Password' })

onMounted(async () => {
  try {
    await $fetch(`/api/auth/reset-password/${encodeURIComponent(token.value)}`)
    valid.value = true
  } catch (cause: any) {
    // Flask flashes the invalid-link message and redirects to login
    // (lantern_auth.py:666-675).
    flash.set(
      cause?.data?.message || cause?.data?.statusMessage || 'This password reset link is invalid or has expired.',
      'error',
    )
    await navigateTo('/login', { replace: true })
  }
})

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const csrf = (await $fetch<{ csrfToken: string }>('/api/auth/csrf')).csrfToken
    await $fetch(`/api/auth/reset-password/${encodeURIComponent(token.value)}`, {
      method: 'POST',
      body: { password: password.value, confirm_password: confirm.value, csrfToken: csrf },
    })
    // Flask flashes the success message and returns to login
    // (lantern_auth.py:741-749).
    flash.set('Your password has been changed. You can now log in.', 'success')
    await navigateTo('/login', { replace: true })
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || cause?.data?.message || cause?.message || 'Password could not be reset.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">🔐</div>
      <h1>Reset Password</h1>
      <p class="auth-subtitle">Choose a new password for your Lantern account.</p>
      <p v-if="error" class="flash error">{{ error }}</p>
      <form v-if="valid" @submit.prevent="submit">
        <div class="form-group">
          <label for="password">New Password</label>
          <input id="password" v-model="password" type="password" name="password" placeholder="At least 8 characters" minlength="8" autocomplete="new-password" required>
        </div>
        <div class="form-group">
          <label for="confirm_password">Confirm Password</label>
          <input id="confirm_password" v-model="confirm" type="password" name="confirm_password" placeholder="Enter it again" minlength="8" autocomplete="new-password" required>
        </div>
        <button type="submit" class="button button-gold button-full" :disabled="busy">{{ busy ? 'Saving…' : 'Change Password' }}</button>
      </form>
    </div>
  </section>
</template>
