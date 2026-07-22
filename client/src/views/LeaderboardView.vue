<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Message from 'primevue/message';
import { api } from '@/lib/api';

interface Entry {
  userId: string;
  displayName: string;
  finalPoints: number;
  provisionalPoints: number;
  total: number;
  rank: number;
}

const router = useRouter();
const rows = ref<Entry[]>([]);
const meId = ref<string | null>(null);
const loading = ref(true);
const hasProvisional = ref(false);

onMounted(async () => {
  try {
    const res = await api.get<{ leaderboard: Entry[]; meId: string }>('/api/leaderboard');
    rows.value = res.leaderboard;
    meId.value = res.meId ?? null;
    hasProvisional.value = res.leaderboard.some((e) => e.provisionalPoints !== 0);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page stack">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h1 style="margin: 0">Puan durumu</h1>
      <Button label="Geri" icon="pi pi-arrow-left" text @click="router.push('/')" />
    </div>

    <div v-if="loading">Yükleniyor…</div>
    <Message v-else-if="!rows.length" severity="secondary" :closable="false">
      Bu yarışmada henüz sıralama yok.
    </Message>
    <template v-else>
      <Message v-if="hasProvisional" severity="info" :closable="false">
        Devam eden haftalar için puanlar <strong>anlık (provisional)</strong>; hafta bitince kesinleşir.
      </Message>
      <table class="lb">
        <thead>
          <tr>
            <th>#</th>
            <th style="text-align: left">Oyuncu</th>
            <th>Kesin</th>
            <th v-if="hasProvisional">Anlık</th>
            <th>Toplam</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in rows" :key="e.userId" :class="{ me: e.userId === meId }">
            <td class="rank">{{ e.rank }}</td>
            <td style="text-align: left">{{ e.displayName }}<span v-if="e.userId === meId" class="you"> (sen)</span></td>
            <td>{{ e.finalPoints }}</td>
            <td v-if="hasProvisional" style="color: #667">{{ e.provisionalPoints !== 0 ? (e.provisionalPoints > 0 ? '+' : '') + e.provisionalPoints : '—' }}</td>
            <td><strong>{{ e.total }}</strong></td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.lb { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
.lb th, .lb td { padding: 0.6rem 0.8rem; text-align: center; border-bottom: 1px solid #eef; }
.lb thead th { background: #f4f6fb; font-size: 0.85rem; }
.lb tr.me { background: #eef4ff; }
.rank { font-weight: 700; color: var(--brand); }
.you { color: var(--brand-accent); font-size: 0.8rem; }
</style>
