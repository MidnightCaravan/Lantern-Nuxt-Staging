<script setup lang="ts">

const auth = useLanternAuth()
const user = auth.user
const authLoaded = auth.loaded

const loggingOut = ref(false)
const logoutMessage = ref('')

useHead({
  titleTemplate: (title) => title ? `${title} — Lantern` : 'Lantern — Light Your Story',
  meta: [
    { name: 'description', content: 'A free creative community for novels, comics, videos, and AI-powered stories.' },
    { name: 'theme-color', content: '#101d2e' },
  ],
  link: [
    { rel: 'stylesheet', href: '/css/lantern.css' },
    { rel: 'stylesheet', href: '/css/lantern-nuxt-overrides.css' },
    { rel: 'icon', type: 'image/png', href: '/images/lantern-favicon.png' },
  ],
})

onMounted(() => {
  void auth.refresh()
})

async function logout() {
  if (loggingOut.value) return

  loggingOut.value = true
  logoutMessage.value = ''

  try {
    await auth.logout()
    await navigateTo('/')
  } catch {
    logoutMessage.value = 'Could not log out. Please try again.'
    await auth.refresh(true)
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="lantern-app-shell">
    <header class="site-header">
      <div class="header-inner">
        <NuxtLink to="/" class="logo" aria-label="Lantern home">
          <span class="logo-icon"><img src="/images/lantern-header-icon.png" alt="Lantern"></span>
          <span class="logo-text">LANTERN</span>
        </NuxtLink>

        <nav class="main-nav" aria-label="Main navigation">
          <NuxtLink to="/discover">Discover</NuxtLink>
          <NuxtLink to="/discover?type=novel">Novels</NuxtLink>
          <NuxtLink to="/discover?type=comic">Comics</NuxtLink>
          <NuxtLink to="/discover?type=video">Videos</NuxtLink>
          <span class="nav-disabled" title="Creator directory coming soon">Creators</span>
        </nav>

        <div class="header-actions">
          <template v-if="authLoaded && user">
            <NuxtLink to="/dashboard" class="login-link">Dashboard</NuxtLink>
            <button
              type="button"
              class="button button-small"
              :disabled="loggingOut"
              @click="logout"
            >
              {{ loggingOut ? 'Logging Out…' : 'Log Out' }}
            </button>
          </template>

          <template v-else-if="authLoaded">
            <NuxtLink to="/login" class="login-link">Log In</NuxtLink>
            <NuxtLink to="/register" class="button button-small">Join Free</NuxtLink>
          </template>
        </div>
      </div>
      <p v-if="logoutMessage" class="auth-note" role="alert">
        {{ logoutMessage }}
      </p>
    </header>

    <main>
      <slot />
    </main>

    <footer class="site-footer">
      <div class="container">
        <div class="footer-inner">
          <div class="footer-brand">
            <NuxtLink to="/" class="logo" aria-label="Lantern home">
              <span class="logo-icon"><img src="/images/lantern-logo.png" alt="Lantern"></span>
              <span class="logo-text">LANTERN</span>
            </NuxtLink>
            <p>A free home for creative stories, novels, comics, videos, and AI-powered works.</p>
          </div>
          <div class="footer-links">
            <div class="footer-column">
              <h4>Explore</h4>
              <NuxtLink to="/discover?type=novel">Novels</NuxtLink>
              <NuxtLink to="/discover?type=comic">Comics</NuxtLink>
              <NuxtLink to="/discover?type=video">Videos</NuxtLink>
              <span class="footer-disabled">Creators</span>
            </div>
            <div class="footer-column">
              <h4>Lantern</h4>
              <NuxtLink to="/discover">Discover</NuxtLink>

              <NuxtLink to="/register">Join Free</NuxtLink>

              <NuxtLink to="/login">Log In</NuxtLink>
            </div>
          </div>
        </div>
        <div class="footer-bottom">© 2026 Lantern. A home for creative stories.</div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.footer-auth-button {
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.footer-auth-button:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
