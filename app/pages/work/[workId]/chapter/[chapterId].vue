<script setup lang="ts">
const route=useRoute()
await navigateTo({ path: `/works/${route.params.workId}/chapters/${route.params.chapterId}`, query: route.query }, { redirectCode: 302 })
</script>
<template><div class="container">Opening chapter…</div></template>
