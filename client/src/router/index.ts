import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

// Admin area lives under an obscure base path (mirrors server ADMIN_PATH).
export const ADMIN_BASE = '/yonetim';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },

  // Participant area
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/kadro', name: 'kadro', component: () => import('@/views/SquadView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/hafta', name: 'hafta', component: () => import('@/views/WeekView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/fikstur', name: 'fikstur', component: () => import('@/views/FixturesView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/lig', name: 'lig', component: () => import('@/views/StandingsView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/puan-durumu', name: 'puan-durumu', component: () => import('@/views/LeaderboardView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/kurallar', name: 'kurallar', component: () => import('@/views/RulesView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/oyuncu/:id', name: 'oyuncu', component: () => import('@/views/PlayerPointsView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/takim/:id', name: 'takim', component: () => import('@/views/TeamView.vue'), meta: { requiresAuth: true, participant: true } },
  { path: '/sezon', name: 'sezon', component: () => import('@/views/SeasonReplayView.vue'), meta: { requiresAuth: true, participant: true } },

  // Everyone with an account has one, admins included, so it is not marked
  // `participant`: the guard below would bounce an admin off their own page.
  { path: '/hesap', name: 'hesap', component: () => import('@/views/AccountView.vue'), meta: { requiresAuth: true } },

  // Admin area (flat, rendered in the shell with admin nav)
  { path: ADMIN_BASE, name: 'admin-dashboard', component: () => import('@/views/admin/DashboardView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/kullanicilar`, name: 'admin-users', component: () => import('@/views/admin/UsersView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/yarismalar`, name: 'admin-competitions', component: () => import('@/views/admin/CompetitionsView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/kadrolar`, name: 'admin-squads', component: () => import('@/views/admin/SquadsView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/kurallar`, name: 'admin-rules', component: () => import('@/views/admin/RulesView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/maclar`, name: 'admin-matches', component: () => import('@/views/admin/MatchesView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/sync`, name: 'admin-sync', component: () => import('@/views/admin/SyncView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: `${ADMIN_BASE}/ayarlar`, name: 'admin-config', component: () => import('@/views/admin/ConfigView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },

  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.bootstrap();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'home' };
  }
  // Admins have no business on participant pages. Keep them in the panel.
  if (to.meta.participant && auth.isAdmin) {
    return { name: 'admin-dashboard' };
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return auth.isAdmin ? { name: 'admin-dashboard' } : { name: 'home' };
  }
  return true;
});
