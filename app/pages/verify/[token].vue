<script setup lang="ts">
const route = useRoute()
await navigateTo({ path: '/verify-email', query: { token: String(route.params.token || '') } }, { replace: true })
</script>
<template><div class="auth-page"><div class="auth-card">Opening your verification link…</div></div></template>
