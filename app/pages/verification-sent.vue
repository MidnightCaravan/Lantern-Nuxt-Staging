<script setup lang="ts">
useHead({ title: 'Check Your Email — Lantern' })
</script>
<template>
  <section class="auth-page">
    <div class="auth-card">
      <div class="auth-icon">📧</div>
      <h1>Check Your Email</h1>
      <p class="auth-subtitle">We've sent you a verification link.</p>
      <p>Open the email and click the verification link to activate your Lantern account.</p>
      <p class="auth-note">The link is valid for 24 hours.</p>
      <NuxtLink to="/resend-verification" class="button button-outline button-full">Resend Verification Email</NuxtLink>
    </div>
  </section>
</template>
