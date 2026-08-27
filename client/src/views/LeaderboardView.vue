<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';

interface SquadClub { teamId: string; tierId: number; name: string; shortName: string }
interface Entry {
  userId: string;
  displayName: string;
  finalPoints: number;
  provisionalPoints: number;
  total: number;
  rank: number;
  squad: SquadClub[];
}

const rows = ref<Entry[]>([]);
const meId = ref<string | null>(null);
const loading = ref(true);
const hasProvisional = computed(() => rows.value.some((e) => e.provisionalPoints !== 0));

const POTS = [1, 2, 3, 4];
function clubOf(e: Entry, pot: number) {
  return e.squad.find((c) => c.tierId === pot) ?? null;
}

onMounted(async () => {
  try {
    const res = await api.get<{ leaderboard: Entry[]; meId: string }>('/api/leaderboard');
    rows.value = res.leaderboard;
    meId.value = res.meId ?? null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Puan durumu" />

    <BallLoader v-if="loading" />
    <Message v-else-if="!rows.length" severity="secondary" :closable="false">Bu yarışmada henüz oyuncu yok.</Message>

    <template v-else>
      <div class="surface-card" style="overflow-x: auto">
        <table class="lb">
          <thead>
            <tr>
              <th>#</th>
              <th style="text-align: left">Oyuncu</th>
              <th v-for="pot in POTS" :key="pot" class="pot-col">Pot {{ pot }}</th>
              <th>Kesin</th>
              <th v-if="hasProvisional">Anlık</th>
              <th>Toplam</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in rows" :key="e.userId" :class="{ me: e.userId === meId }">
              <td class="rank">{{ e.rank }}</td>
              <td style="text-align: left">
                <RouterLink :to="`/oyuncu/${e.userId}`" class="player-link">{{ e.displayName }}</RouterLink>
                <span v-if="e.userId === meId" class="you"> · sen</span>
              </td>
              <td v-for="pot in POTS" :key="pot" class="pot-col">
                <RouterLink
                  v-if="clubOf(e, pot)"
                  :to="`/takim/${clubOf(e, pot)!.teamId}`"
                  class="club-link"
                  :title="clubOf(e, pot)!.name"
                >{{ clubOf(e, pot)!.shortName }}</RouterLink>
                <span v-else class="text-muted">—</span>
              </td>
              <td>{{ e.finalPoints }}</td>
              <td v-if="hasProvisional" class="text-muted">
                {{ e.provisionalPoints !== 0 ? (e.provisionalPoints > 0 ? '+' : '') + e.provisionalPoints : '—' }}
              </td>
              <td><strong>{{ e.total }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lb { width: 100%; border-collapse: collapse; }
.lb th, .lb td { padding: 0.7rem 0.85rem; text-align: center; border-bottom: 1px solid var(--color-border); }
.lb thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.lb tbody tr:last-child td { border-bottom: none; }
.lb tr.me { background: var(--color-primary-soft); }
.rank { font-weight: 800; color: var(--color-primary); }
.you { color: var(--color-primary); font-size: 0.8rem; font-weight: 600; }
.player-link { color: var(--color-text); font-weight: 600; }
.player-link:hover { color: var(--color-primary); }
.pot-col { font-variant-numeric: normal; }
.club-link { color: var(--color-text-secondary); font-weight: 600; font-size: 0.85rem; }
.club-link:hover { color: var(--color-primary); }
</style>
