<script setup lang="ts">
import ProgressSpinner from 'primevue/progressspinner';

withDefaults(defineProps<{ message?: string }>(), { message: 'Yükleniyor…' });
</script>

<template>
  <div class="loading-state" role="status" aria-live="polite">
    <ProgressSpinner style="width: 42px; height: 42px" stroke-width="4" />
    <p>{{ message }}</p>
  </div>
</template>

<style scoped>
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem 1rem;
  color: var(--color-text-muted);
}
.loading-state p {
  margin: 0;
  font-size: 0.95rem;
}
</style>
