<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

useHead({ title: 'Create Work — Lantern' })
</script>
<template>
  <section class="create-page"><div class="container">
    <div class="create-header"><div class="section-eyebrow">CREATE</div><h1>What Are You Creating?</h1><p>Choose a format to begin your new Lantern work. Everything starts as a private draft.</p></div>
    <div class="create-options">
      <NuxtLink to="/create/novel" class="create-option"><div class="create-option-icon">📖</div><h2>Novel</h2><p>Create stories, chapters, serials, and full-length novels.</p></NuxtLink>
      <NuxtLink to="/create/comic" class="create-option"><div class="create-option-icon">🎨</div><h2>Comic</h2><p>Build comics, graphic stories, webtoons, and illustrated works.</p></NuxtLink>
      <NuxtLink to="/create/video" class="create-option"><div class="create-option-icon">🎬</div><h2>Video</h2><p>Create a home for animations, films, trailers, and other videos.</p></NuxtLink>
    </div>
  </div></section>
</template>
