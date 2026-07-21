<script setup lang="ts">
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const nav = [
  { label: 'Panel', to: { name: 'admin-dashboard' }, icon: 'pi pi-home' },
  { label: 'Kullanıcılar', to: { name: 'admin-users' }, icon: 'pi pi-users' },
  { label: 'Yarışmalar', to: { name: 'admin-competitions' }, icon: 'pi pi-sitemap' },
];

async function logout() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <div style="display: flex; min-height: 100vh">
    <aside
      style="
        width: 220px;
        background: var(--brand);
        color: #fff;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      "
    >
      <h2 style="font-size: 1rem; margin: 0 0 1rem">Yönetim</h2>
      <RouterLink
        v-for="item in nav"
        :key="item.label"
        :to="item.to"
        style="color: #cdd8ef; text-decoration: none; padding: 0.5rem; border-radius: 6px"
        active-class="admin-nav-active"
      >
        <i :class="item.icon" style="margin-right: 0.5rem" />{{ item.label }}
      </RouterLink>
      <div style="margin-top: auto">
        <Button label="Çıkış" icon="pi pi-sign-out" severity="secondary" text @click="logout" />
      </div>
    </aside>
    <main style="flex: 1; padding: 1.5rem">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.admin-nav-active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff !important;
}
</style>
