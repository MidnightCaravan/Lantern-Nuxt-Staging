<script setup lang="ts">
const route = useRoute()
const flash = useLanternFlash()
const token = computed(() => String(route.params.token || ''))
const message = ref('Verifying your email…')

useHead({ title: 'Verify Email' })

onMounted(async () => {
  try {
    const result = await $fetch<{ ok: boolean; message: string }>(`/api/auth/verify?token=${encodeURIComponent(token.value)}`)
    flash.set(result.message, 'success')
  } catch (error: any) {
    flash.set(error?.data?.message || 'This verification link is invalid or has expired.', 'error')
  }
  await navigateTo('/login', { replace: true })
})
</script>

<template><div class="auth-page"><div class="auth-card">{{ message }}</div></div></template>
