<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), { message: 'Saha hazırlanıyor…' });
</script>

<template>
  <div class="ball-loader" role="status" aria-live="polite">
    <div class="ball" />
    <div class="ball-shadow" />
    <p style="margin: 0; font-size: 0.92rem">{{ message }}</p>
  </div>
</template>
