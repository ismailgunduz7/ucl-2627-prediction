<script setup lang="ts">
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Card from 'primevue/card';
import { useAuthStore } from '@/stores/auth';
import { ADMIN_BASE } from '@/router';

const auth = useAuthStore();
const router = useRouter();

async function logout() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <div class="page stack">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h1 style="margin: 0">Merhaba, {{ auth.user?.displayName }}</h1>
      <div style="display: flex; gap: 0.5rem">
        <Button
          v-if="auth.isAdmin"
          label="Yönetim"
          icon="pi pi-cog"
          severity="secondary"
          @click="router.push(ADMIN_BASE)"
        />
        <Button label="Çıkış" icon="pi pi-sign-out" severity="secondary" text @click="logout" />
      </div>
    </div>

    <Card>
      <template #title>Sezon henüz başlamadı</template>
      <template #content>
        <p>
          Turnuva verileri ve kadro seçimi sonraki geliştirme aşamalarında (Faz 1+) burada
          görünecek. Şu an temel iskelet ve kimlik doğrulama hazır.
        </p>
      </template>
    </Card>
  </div>
</template>
