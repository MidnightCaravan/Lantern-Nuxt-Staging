<script setup lang="ts">
// Flask renders templates/404.html both for unmatched URLs and for handlers
// that raise a 404. The catch-all page covers the first case; this covers
// errors raised while a page is being set up (for example an invalid work
// type on the create form).
const props = defineProps<{ error: any }>()
const notFound = computed(() => Number(props.error?.statusCode) === 404)
useHead({ title: notFound.value ? 'Not Found — Lantern' : 'Error — Lantern' })
</script>

<template>
  <NuxtLayout>
    <section class="auth-page">
      <div class="auth-card">
        <div class="auth-icon">🏮</div>
        <h1>{{ notFound ? 'Not Found' : 'Something Went Wrong' }}</h1>
        <p class="auth-subtitle">
          {{ notFound ? "This Lantern doesn't exist." : (error?.statusMessage || 'An unexpected error occurred.') }}
        </p>
        <NuxtLink to="/" class="button button-gold button-full">Return Home</NuxtLink>
      </div>
    </section>
  </NuxtLayout>
</template>
