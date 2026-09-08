<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { Users, Network, Calculator, Flag, RefreshCw, Settings, Shirt, ChevronRight } from '@lucide/vue';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';

const stats = ref({ users: 0, competitions: 0 });

onMounted(async () => {
  try {
    const [u, c] = await Promise.all([
      api.get<{ users: unknown[] }>('/api/admin/users'),
      api.get<{ competitions: unknown[] }>('/api/admin/competitions'),
    ]);
    stats.value = { users: u.users.length, competitions: c.competitions.length };
  } catch {
    /* The counters are decoration. The links below work either way. */
  }
});

const links = [
  { to: '/yonetim/kullanicilar', key: 'users', icon: Users },
  { to: '/yonetim/yarismalar', key: 'competitions', icon: Network },
  { to: '/yonetim/kadrolar', key: 'squads', icon: Shirt },
  { to: '/yonetim/kurallar', key: 'rules', icon: Calculator },
  { to: '/yonetim/maclar', key: 'matches', icon: Flag },
  { to: '/yonetim/sync', key: 'sync', icon: RefreshCw },
  { to: '/yonetim/ayarlar', key: 'config', icon: Settings },
];
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('admin.dashboard.title')" />

    <div class="stat-row">
      <div class="surface-card card-pad stat">
        <span class="stat-num">{{ stats.users }}</span><span class="text-muted">{{ $t('admin.dashboard.users') }}</span>
      </div>
      <div class="surface-card card-pad stat">
        <span class="stat-num">{{ stats.competitions }}</span><span class="text-muted">{{ $t('admin.dashboard.competitions') }}</span>
      </div>
    </div>

    <div class="link-grid stagger">
      <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="surface-card card-pad link-card">
        <span class="link-icon"><component :is="l.icon" :size="20" aria-hidden="true" /></span>
        <span class="link-body">
          <span class="link-title">{{ $t(`nav.admin.${l.key}`) }}</span>
          <span class="text-muted link-desc">{{ $t(`admin.dashboard.desc.${l.key}`) }}</span>
        </span>
        <ChevronRight class="link-chevron" :size="18" aria-hidden="true" />
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.stat-row { display: flex; gap: 1rem; flex-wrap: wrap; }
.stat { display: flex; align-items: baseline; gap: 0.5rem; min-width: 140px; }
.stat-num { font-size: 2rem; font-weight: 800; color: var(--color-primary); }
.link-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.link-card {
  display: flex; align-items: center; gap: 1rem;
  text-decoration: none; color: var(--color-text);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.link-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
  text-decoration: none;
}
.link-icon {
  flex-shrink: 0;
  width: 2.4rem; height: 2.4rem;
  display: grid; place-items: center;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: var(--radius-md);
}
.link-body { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.link-title { font-weight: 700; }
.link-desc { font-size: var(--text-xs); }
.link-chevron { flex-shrink: 0; color: var(--color-text-muted); }
.link-card:hover .link-chevron { color: var(--color-primary); }
</style>
