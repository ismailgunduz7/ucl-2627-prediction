<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import Button from 'primevue/button';
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
    /* ignore */
  }
});

const links = [
  { to: '/yonetim/kullanicilar', label: 'Kullanıcılar', icon: 'pi pi-users', desc: 'Hesap oluştur, şifre sıfırla, sil' },
  { to: '/yonetim/yarismalar', label: 'Yarışmalar', icon: 'pi pi-sitemap', desc: 'Görünürlük gruplarını yönet' },
  { to: '/yonetim/kurallar', label: 'Kurallar', icon: 'pi pi-calculator', desc: 'Pot bazlı puanları düzenle' },
  { to: '/yonetim/maclar', label: 'Maçlar', icon: 'pi pi-flag', desc: 'Sonuç gir, override yönet' },
  { to: '/yonetim/sync', label: 'Sync', icon: 'pi pi-sync', desc: 'Sağlayıcıdan veri çek' },
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
        <i :class="l.icon" class="link-icon" />
        <div>
          <div class="link-title">{{ l.label }}</div>
          <div class="text-muted" style="font-size: 0.85rem">{{ l.desc }}</div>
        </div>
        <Button icon="pi pi-chevron-right" text rounded aria-hidden="true" />
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.stat-row { display: flex; gap: 1rem; flex-wrap: wrap; }
.stat { display: flex; align-items: baseline; gap: 0.5rem; min-width: 140px; }
.stat-num { font-size: 2rem; font-weight: 800; color: var(--color-primary); }
.link-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
.link-card { display: flex; align-items: center; gap: 1rem; text-decoration: none; color: var(--color-text); transition: border-color 0.15s, box-shadow 0.15s; }
.link-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); text-decoration: none; }
.link-icon { font-size: var(--text-xl); color: var(--color-primary); width: 2.4rem; height: 2.4rem; display: grid; place-items: center; background: var(--color-primary-soft); border-radius: var(--radius-md); }
.link-title { font-weight: 700; }
.link-card > div { flex: 1; }
</style>
