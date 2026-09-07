<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import { Home, Users, CalendarDays, BookOpen, LayoutGrid, Network, Calculator, Flag, RefreshCw, Menu, X, LogOut, Table, ListOrdered, Settings, UserRound } from '@lucide/vue';
import { useAuthStore } from '@/stores/auth';
import AppCursor from '@/components/AppCursor.vue';
import StarBall from '@/components/StarBall.vue';
import LanguagePicker from '@/components/LanguagePicker.vue';
import TrophyMark from '@/components/TrophyMark.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const mobileNavOpen = ref(false);
const isLoginRoute = computed(() => route.name === 'login');
const showShell = computed(() => auth.ready && auth.isAuthenticated && !isLoginRoute.value);

const participantNav = [
  { to: '/', key: 'nav.home', icon: Home },
  { to: '/kadro', key: 'nav.squad', icon: Users },
  { to: '/hafta', key: 'nav.week', icon: CalendarDays },
  { to: '/fikstur', key: 'nav.fixtures', icon: ListOrdered },
  { to: '/lig', key: 'nav.standings', icon: Table },
  { to: '/puan-durumu', key: 'nav.leaderboard', icon: TrophyMark },
  { to: '/kurallar', key: 'nav.rules', icon: BookOpen },
];
const adminNav = [
  { to: '/yonetim', key: 'nav.admin.dashboard', icon: LayoutGrid },
  { to: '/yonetim/kullanicilar', key: 'nav.admin.users', icon: Users },
  { to: '/yonetim/yarismalar', key: 'nav.admin.competitions', icon: Network },
  { to: '/yonetim/kurallar', key: 'nav.admin.rules', icon: Calculator },
  { to: '/yonetim/maclar', key: 'nav.admin.matches', icon: Flag },
  { to: '/yonetim/sync', key: 'nav.admin.sync', icon: RefreshCw },
  { to: '/yonetim/ayarlar', key: 'nav.admin.config', icon: Settings },
];

const navItems = computed(() => (auth.isAdmin ? adminNav : participantNav));
const homeHref = computed(() => (auth.isAdmin ? '/yonetim' : '/'));

watch(() => route.fullPath, () => (mobileNavOpen.value = false));

/**
 * The drawer belongs to the hamburger, so it cannot outlive it. Widen the
 * window past the breakpoint with the menu open and the panel is gone from the
 * screen while the flag says it is open, which is how a menu nobody asked for
 * turns up again on the way back down.
 */
const wideEnoughForLinks = window.matchMedia('(min-width: 901px)');
function closeOnWiden(e: MediaQueryListEvent) {
  if (e.matches) mobileNavOpen.value = false;
}

// Hold the page still behind the open drawer. The document is the scroller, so
// it is the one that stops; the reserved scrollbar gutter keeps it from shifting.
watch(mobileNavOpen, (open) => {
  document.documentElement.classList.toggle('nav-open', open);
});

onMounted(() => {
  if (!auth.ready) void auth.bootstrap();
  wideEnoughForLinks.addEventListener('change', closeOnWiden);
});
onUnmounted(() => {
  wideEnoughForLinks.removeEventListener('change', closeOnWiden);
  document.documentElement.classList.remove('nav-open');
});

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
    <a class="skip-link" href="#main-content" @click.prevent="skipToContent">{{ $t('common.skipToContent') }}</a>
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink :to="homeHref" class="brand">
          <StarBall class="brand-badge" />
          <span>{{ $t('common.brand') }}</span>
        </RouterLink>

        <nav class="main-nav" :aria-label="$t('nav.main')">
          <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link">
            <component :is="item.icon" :size="17" aria-hidden="true" />
            <span>{{ $t(item.key) }}</span>
          </RouterLink>
        </nav>

        <div class="header-end">
          <RouterLink to="/hesap" class="user-chip" :title="$t('account.title')">
            <span class="role-dot" />{{ auth.user?.displayName }}
          </RouterLink>
          <LanguagePicker class="header-lang" />
          <Button severity="secondary" text rounded :aria-label="$t('common.signOut')" @click="logout">
            <LogOut :size="18" />
          </Button>
          <Button
            class="nav-toggle"
            severity="secondary"
            text
            rounded
            :aria-label="$t('nav.menu')"
            @click="mobileNavOpen = !mobileNavOpen"
          >
            <component :is="mobileNavOpen ? X : Menu" :size="20" />
          </Button>
        </div>
      </div>
    </header>

    <button
      v-if="mobileNavOpen"
      class="mobile-nav-backdrop"
      :aria-label="$t('nav.closeMenu')"
      @click="mobileNavOpen = false"
    />
    <nav class="mobile-nav" :class="{ 'is-open': mobileNavOpen }" :aria-label="$t('nav.mobile')">
      <RouterLink v-for="item in navItems" :key="`m-${item.to}`" :to="item.to" class="mobile-nav-link" @click="mobileNavOpen = false">
        <component :is="item.icon" :size="18" aria-hidden="true" />
        <span>{{ $t(item.key) }}</span>
      </RouterLink>
      <RouterLink to="/hesap" class="mobile-nav-link" @click="mobileNavOpen = false">
        <UserRound :size="18" aria-hidden="true" />
        <span>{{ auth.user?.displayName }}</span>
      </RouterLink>
      <div class="mobile-nav-lang">
        <span class="text-muted">{{ $t('common.language') }}</span>
        <LanguagePicker />
      </div>
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
.mobile-nav-lang {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.4rem;
  padding: 0.6rem 1rem 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--text-sm);
  font-weight: 600;
}
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
