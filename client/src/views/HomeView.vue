<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import { useAuthStore } from '@/stores/auth';
import { useTournamentStore } from '@/stores/tournament';
import { ADMIN_BASE } from '@/router';

const auth = useAuthStore();
const store = useTournamentStore();
const router = useRouter();
const loading = ref(true);

const squadComplete = computed(() => store.squad.length === (store.status?.squadSize ?? 4));

onMounted(async () => {
  try {
    await Promise.all([store.loadStatus(), store.loadSquad()]);
  } finally {
    loading.value = false;
  }
});

async function logout() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <div class="page stack">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h1 style="margin: 0">Merhaba, {{ auth.user?.displayName }}</h1>
      <div style="display: flex; gap: 0.5rem">
        <Button label="Kurallar" icon="pi pi-book" severity="secondary" text @click="router.push('/kurallar')" />
        <Button
          v-if="auth.isAdmin"
          label="Yönetim"
          icon="pi pi-cog"
          severity="secondary"
          @click="router.push(ADMIN_BASE)"
        />
        <Button label="Çıkış" icon="pi pi-sign-out" severity="secondary" text @click="logout" />
      </div>
    </div>

    <Card>
      <template #title>
        Kadron
        <Tag
          v-if="!loading"
          :severity="squadComplete ? 'success' : 'warn'"
          :value="squadComplete ? 'Tamam' : 'Eksik'"
          style="margin-left: 0.5rem"
        />
      </template>
      <template #content>
        <div v-if="loading">Yükleniyor…</div>
        <template v-else>
          <div v-if="squadComplete" class="crest-row">
            <RouterLink
              v-for="s in store.squad"
              :key="s.teamId"
              :to="`/takim/${s.teamId}`"
              class="mini-crest"
            >
              <span class="crest">{{ s.shortName }}</span>
              <small>{{ s.name }}</small>
            </RouterLink>
          </div>
          <p v-else style="margin: 0 0 0.75rem">
            Henüz kalıcı kadronu seçmedin. Her pottan bir kulüp seç.
          </p>
          <Button
            :label="squadComplete ? 'Kadroyu düzenle' : 'Kadro seç'"
            icon="pi pi-users"
            :severity="store.squadLocked ? 'secondary' : 'primary'"
            @click="router.push('/kadro')"
          />
          <span v-if="store.squadLocked" style="margin-left: 0.6rem; color: #a55">Kilitli</span>
        </template>
      </template>
    </Card>

    <Card>
      <template #title>Faz 1 — Domain iskeleti</template>
      <template #content>
        <p>
          Potlar, 36 mock kulüp, matchweek registry, maçlar ve config yüklendi. Kadro seçimi ve
          seçim kilidi aktif. Haftalık dizi, jokerler ve puanlama sonraki fazlarda.
        </p>
        <p style="color: #889; font-size: 0.85rem; margin: 0">
          Not: kulüpler geçen sezonun katılımcılarından placeholder’dır; resmi 2026–27 kurası
          açıklanınca güncellenecek.
        </p>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.crest-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.mini-crest {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  width: 80px;
  text-align: center;
  text-decoration: none;
  color: inherit;
}
.mini-crest:hover .crest {
  outline: 2px solid var(--brand-accent);
}
.mini-crest small {
  font-size: 0.72rem;
  line-height: 1.1;
}
.crest {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 700;
}
</style>
