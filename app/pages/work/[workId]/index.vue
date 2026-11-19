<script setup lang="ts">
const route = useRoute()
await navigateTo(
  { path: `/works/${route.params.workId}`, query: route.query },
  { redirectCode: 302 }
)
</script>
<template><div class="container">Opening work…</div></template>
