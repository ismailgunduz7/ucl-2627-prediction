<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import { Home, Users, CalendarDays, Trophy, BookOpen, LayoutGrid, Network, Calculator, Flag, RefreshCw, Menu, X, LogOut } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import AppCursor from '@/components/AppCursor.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const mobileNavOpen = ref(false);
const isLoginRoute = computed(() => route.name === 'login');
const showShell = computed(() => auth.ready && auth.isAuthenticated && !isLoginRoute.value);

const participantNav = [
  { to: '/', label: 'Ana Sayfa', icon: Home },
  { to: '/kadro', label: 'Kadrom', icon: Users },
  { to: '/hafta', label: 'Bu Hafta', icon: CalendarDays },
  { to: '/puan-durumu', label: 'Puan Durumu', icon: Trophy },
  { to: '/kurallar', label: 'Kurallar', icon: BookOpen },
];
const adminNav = [
  { to: '/yonetim', label: 'Panel', icon: LayoutGrid },
  { to: '/yonetim/kullanicilar', label: 'Kullanıcılar', icon: Users },
  { to: '/yonetim/yarismalar', label: 'Yarışmalar', icon: Network },
  { to: '/yonetim/kurallar', label: 'Kurallar', icon: Calculator },
  { to: '/yonetim/maclar', label: 'Maçlar', icon: Flag },
  { to: '/yonetim/sync', label: 'Sync', icon: RefreshCw },
];

const navItems = computed(() => (auth.isAdmin ? adminNav : participantNav));
const homeHref = computed(() => (auth.isAdmin ? '/yonetim' : '/'));

onMounted(() => {
  if (!auth.ready) void auth.bootstrap();
});

watch(() => route.fullPath, () => (mobileNavOpen.value = false));

async function logout() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <AppCursor />
  <Toast />

  <div v-if="showShell" class="app-shell">
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink :to="homeHref" class="brand">
          <span class="brand-badge">⚽</span>
          <span>ŞL Fantazi</span>
        </RouterLink>

        <nav class="main-nav" aria-label="Ana menü">
          <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">
            <component :is="item.icon" :size="17" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>

        <div class="header-end">
          <span class="user-chip"><span class="role-dot" />{{ auth.user?.displayName }}</span>
          <Button severity="secondary" text rounded aria-label="Çıkış" @click="logout">
            <LogOut :size="18" />
          </Button>
          <Button class="nav-toggle" severity="secondary" text rounded aria-label="Menü" @click="mobileNavOpen = !mobileNavOpen">
            <component :is="mobileNavOpen ? X : Menu" :size="20" />
          </Button>
        </div>
      </div>
    </header>

    <button v-if="mobileNavOpen" class="mobile-nav-backdrop" aria-label="Menüyü kapat" @click="mobileNavOpen = false" />
    <nav class="mobile-nav" :class="{ 'is-open': mobileNavOpen }" aria-label="Mobil menü">
      <RouterLink v-for="item in navItems" :key="`m-${item.to}`" :to="item.to" class="mobile-nav-link" @click="mobileNavOpen = false">
        <component :is="item.icon" :size="18" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>
  </div>

  <main v-else-if="auth.ready" class="app-main app-main--bare">
    <RouterView />
  </main>
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-enter-from { opacity: 0; transform: translateY(8px); }
.page-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
