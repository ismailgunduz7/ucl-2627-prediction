import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

// The admin area lives under an obscure base path (mirrors server ADMIN_PATH,
// §12). Kept in one constant so it is easy to change.
export const ADMIN_BASE = '/yonetim';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/kadro',
    name: 'kadro',
    component: () => import('@/views/SquadView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: ADMIN_BASE,
    component: () => import('@/views/admin/AdminLayout.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
    children: [
      { path: '', name: 'admin-dashboard', component: () => import('@/views/admin/DashboardView.vue') },
      { path: 'kullanicilar', name: 'admin-users', component: () => import('@/views/admin/UsersView.vue') },
      { path: 'yarismalar', name: 'admin-competitions', component: () => import('@/views/admin/CompetitionsView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // Ensure the initial silent refresh has resolved before deciding.
  if (!auth.ready) await auth.bootstrap();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'home' };
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: auth.isAdmin ? 'admin-dashboard' : 'home' };
  }
  return true;
});
