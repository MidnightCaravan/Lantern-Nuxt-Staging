<script setup lang="ts">
const route = useRoute()
await navigateTo(
  { path: `/comics/${route.params.workId}`, query: route.query },
  { redirectCode: 302 }
)
</script>
<template><div class="container">Opening comic…</div></template>
