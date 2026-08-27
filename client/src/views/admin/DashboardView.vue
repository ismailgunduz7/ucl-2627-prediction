<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { Users, Network, Calculator, Flag, RefreshCw, Settings, ChevronRight } from '@lucide/vue';
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
  { to: '/yonetim/kullanicilar', label: 'Kullanıcılar', icon: Users, desc: 'Hesap aç, şifre değiştir, joker haklarını düzelt' },
  { to: '/yonetim/yarismalar', label: 'Yarışmalar', icon: Network, desc: 'Kim kimin sıralamasında görünüyor' },
  { to: '/yonetim/kurallar', label: 'Kurallar', icon: Calculator, desc: 'Hangi sonuç hangi pota kaç puan yazıyor' },
  { to: '/yonetim/maclar', label: 'Maçlar', icon: Flag, desc: 'Skor gir, elle girdiğin sonucu geri al' },
  { to: '/yonetim/sync', label: 'Skor çekme', icon: RefreshCw, desc: 'Sağlayıcıdan skorları getir' },
  { to: '/yonetim/ayarlar', label: 'Ayarlar', icon: Settings, desc: 'Sağlayıcı, joker dağıtımı, kilit uyarısı' },
];
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Yönetim paneli" />

    <div class="stat-row">
      <div class="surface-card card-pad stat">
        <span class="stat-num">{{ stats.users }}</span><span class="text-muted">kullanıcı</span>
      </div>
      <div class="surface-card card-pad stat">
        <span class="stat-num">{{ stats.competitions }}</span><span class="text-muted">yarışma</span>
      </div>
    </div>

    <div class="link-grid stagger">
      <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="surface-card card-pad link-card">
        <span class="link-icon"><component :is="l.icon" :size="20" aria-hidden="true" /></span>
        <span class="link-body">
          <span class="link-title">{{ l.label }}</span>
          <span class="text-muted link-desc">{{ l.desc }}</span>
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
