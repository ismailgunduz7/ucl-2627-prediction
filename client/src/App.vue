<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import { useAuthStore } from '@/stores/auth';
import { useDarkMode } from '@/composables/useDarkMode';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { isDark, toggle: toggleTheme } = useDarkMode();

const mobileNavOpen = ref(false);

const isLoginRoute = computed(() => route.name === 'login');
const showShell = computed(() => auth.ready && auth.isAuthenticated && !isLoginRoute.value);

const participantNav = [
  { to: '/', label: 'Ana Sayfa', icon: 'pi pi-home' },
  { to: '/kadro', label: 'Kadrom', icon: 'pi pi-users' },
  { to: '/hafta', label: 'Bu Hafta', icon: 'pi pi-calendar' },
  { to: '/puan-durumu', label: 'Puan Durumu', icon: 'pi pi-chart-bar' },
  { to: '/kurallar', label: 'Kurallar', icon: 'pi pi-book' },
];
const adminNav = [
  { to: '/yonetim', label: 'Panel', icon: 'pi pi-th-large' },
  { to: '/yonetim/kullanicilar', label: 'Kullanıcılar', icon: 'pi pi-users' },
  { to: '/yonetim/yarismalar', label: 'Yarışmalar', icon: 'pi pi-sitemap' },
  { to: '/yonetim/kurallar', label: 'Kurallar', icon: 'pi pi-calculator' },
  { to: '/yonetim/maclar', label: 'Maçlar', icon: 'pi pi-flag' },
  { to: '/yonetim/sync', label: 'Sync', icon: 'pi pi-sync' },
];

const navItems = computed(() => (auth.isAdmin ? adminNav : participantNav));
const homeHref = computed(() => (auth.isAdmin ? '/yonetim' : '/'));

onMounted(() => {
  if (!auth.ready) void auth.bootstrap();
});

watch(
  () => route.fullPath,
  () => (mobileNavOpen.value = false),
);

async function logout() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <Toast />
  <div v-if="showShell" class="app-shell">
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink :to="homeHref" class="brand">
          <span class="brand-badge">★</span>
          <span>ŞL Fantazi <span class="text-muted" style="font-weight: 600">26/27</span></span>
        </RouterLink>

        <nav class="main-nav" aria-label="Ana menü">
          <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">
            <i :class="item.icon" /><span>{{ item.label }}</span>
          </RouterLink>
        </nav>

        <div class="header-end">
          <span class="user-chip"><span class="role-dot" />{{ auth.user?.displayName }}</span>
          <Button
            :icon="isDark() ? 'pi pi-sun' : 'pi pi-moon'"
            severity="secondary"
            text
            rounded
            aria-label="Tema"
            @click="toggleTheme"
          />
          <Button icon="pi pi-sign-out" severity="secondary" text rounded aria-label="Çıkış" @click="logout" />
          <Button
            class="nav-toggle"
            :icon="mobileNavOpen ? 'pi pi-times' : 'pi pi-bars'"
            severity="secondary"
            text
            rounded
            aria-label="Menü"
            @click="mobileNavOpen = !mobileNavOpen"
          />
        </div>
      </div>
    </header>

    <button
      v-if="mobileNavOpen"
      class="mobile-nav-backdrop"
      aria-label="Menüyü kapat"
      @click="mobileNavOpen = false"
    />
    <nav class="mobile-nav" :class="{ 'is-open': mobileNavOpen }" aria-label="Mobil menü">
      <RouterLink
        v-for="item in navItems"
        :key="`m-${item.to}`"
        :to="item.to"
        class="mobile-nav-link"
        @click="mobileNavOpen = false"
      >
        <i :class="item.icon" /><span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <main class="app-main">
      <RouterView />
    </main>
  </div>

  <main v-else-if="auth.ready" class="app-main app-main--bare">
    <RouterView />
  </main>
</template>
