<script setup lang="ts">
// Flask renders templates/404.html for unmatched routes and for resources that
// do not exist. Nuxt's default response for an unmatched route is a raw JSON
// 404, so provide the branded page and set the same HTTP status.
useHead({ title: 'Not Found — Lantern' })
setResponseStatus(404)
</script>

<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">🏮</div>
      <h1>Not Found</h1>
      <p class="auth-subtitle">This Lantern doesn't exist.</p>
      <NuxtLink to="/" class="button button-gold button-full">Return Home</NuxtLink>
    </div>
  </section>
</template>
