<script setup lang="ts">
import { onMounted } from 'vue';
import Toast from 'primevue/toast';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

// Kick off the silent refresh early; the router guard also awaits it.
onMounted(() => {
  if (!auth.ready) void auth.bootstrap();
});
</script>

<template>
  <Toast />
  <RouterView v-if="auth.ready" />
  <div v-else class="center-screen">
    <p>Yükleniyor…</p>
  </div>
</template>
