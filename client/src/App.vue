<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import { Home, Users, CalendarDays, BookOpen, LayoutGrid, Network, Calculator, Flag, RefreshCw, Menu, X, LogOut, Table, ListOrdered } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import AppCursor from '@/components/AppCursor.vue';
import StarBall from '@/components/StarBall.vue';
import TrophyMark from '@/components/TrophyMark.vue';

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
  { to: '/fikstur', label: 'Fikstür', icon: ListOrdered },
  { to: '/lig', label: 'Lig Tablosu', icon: Table },
  { to: '/puan-durumu', label: 'Puan Durumu', icon: TrophyMark },
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

// A plain fragment link would go through the router; move focus ourselves.
function skipToContent() {
  const main = document.getElementById('main-content');
  main?.focus();
  main?.scrollIntoView({ block: 'start' });
}

async function logout() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <AppCursor />
  <Toast />

  <div v-if="showShell" class="app-shell">
    <a class="skip-link" href="#main-content" @click.prevent="skipToContent">İçeriğe geç</a>
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink :to="homeHref" class="brand">
          <StarBall class="brand-badge" />
          <span>ŞL Fantazi</span>
        </RouterLink>

        <nav class="main-nav" aria-label="Ana menü">
          <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">
            <component :is="item.icon" :size="17" aria-hidden="true" />
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
        <component :is="item.icon" :size="18" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <main id="main-content" class="app-main" tabindex="-1">
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
.page-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
/* Leaving is quicker than arriving, so navigation feels answered at once. */
.page-leave-active {
  transition: opacity var(--dur-fast) ease-in, transform var(--dur-fast) ease-in;
}
.page-enter-from { opacity: 0; transform: translateY(8px); }
.page-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
