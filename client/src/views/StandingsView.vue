<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Message from 'primevue/message';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';

interface Row {
  teamId: string; name: string; rank: number;
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; goalDifference: number; points: number;
}

const rows = ref<Row[]>([]);
const loading = ref(true);

// Where each finishing position leads once the league phase ends.
function band(rank: number) {
  if (rank <= 8) return 'top8';
  if (rank <= 24) return 'playoff';
  return 'out';
}

onMounted(async () => {
  try {
    const res = await api.get<{ standings: Row[] }>('/api/standings');
    rows.value = res.standings;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('standings.title')" :subtitle="$t('standings.subtitle')" />

    <BallLoader v-if="loading" />
    <Message v-else-if="!rows.length" severity="secondary" :closable="false">
      {{ $t('standings.empty') }}
    </Message>

    <template v-else>
      <div class="legend">
        <span><i class="dot top8" />{{ $t('standings.legendDirect') }}</span>
        <span><i class="dot playoff" />{{ $t('standings.legendPlayoff') }}</span>
        <span><i class="dot out" />{{ $t('standings.legendOut') }}</span>
      </div>

      <div class="surface-card table-scroll">
        <table class="standings freeze-2">
          <thead>
            <tr>
              <th>#</th>
              <th class="text-start">{{ $t('standings.club') }}</th>
              <th :title="$t('standings.played')">{{ $t('standings.playedShort') }}</th>
              <th :title="$t('standings.won')">{{ $t('standings.wonShort') }}</th>
              <th :title="$t('standings.drawn')">{{ $t('standings.drawnShort') }}</th>
              <th :title="$t('standings.lost')">{{ $t('standings.lostShort') }}</th>
              <th :title="$t('standings.goalsFor')">{{ $t('standings.goalsForShort') }}</th>
              <th :title="$t('standings.goalsAgainst')">{{ $t('standings.goalsAgainstShort') }}</th>
              <th :title="$t('standings.goalDifference')">{{ $t('standings.goalDifferenceShort') }}</th>
              <th :title="$t('standings.points')">{{ $t('standings.pointsShort') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.teamId" :class="band(r.rank)">
              <td class="rank">{{ r.rank }}</td>
              <td class="text-start">
                <RouterLink :to="`/takim/${r.teamId}`" class="team-link">{{ r.name }}</RouterLink>
              </td>
              <td>{{ r.played }}</td>
              <td>{{ r.won }}</td>
              <td>{{ r.drawn }}</td>
              <td>{{ r.lost }}</td>
              <td>{{ r.goalsFor }}</td>
              <td>{{ r.goalsAgainst }}</td>
              <td>{{ r.goalDifference > 0 ? '+' : '' }}{{ r.goalDifference }}</td>
              <td><strong>{{ r.points }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.legend { display: flex; gap: 1.2rem; flex-wrap: wrap; font-size: 0.85rem; color: var(--color-text-muted); }
.legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot.top8 { background: var(--color-success); }
.dot.playoff { background: var(--color-primary); }
.dot.out { background: var(--color-danger); }

.standings { width: 100%; border-collapse: collapse; min-width: 620px; }
.standings th, .standings td { padding: 0.55rem 0.7rem; text-align: center; border-bottom: 1px solid var(--color-border); font-size: 0.88rem; }
.standings thead th { background: var(--color-bg-subtle); font-size: 0.78rem; font-weight: 700; color: var(--color-text-secondary); }
.standings tbody tr:last-child td { border-bottom: none; }
.rank { font-weight: 800; position: relative; }
/* A colour bar on the rank cell marks where the club is heading. */
.standings tbody tr td.rank::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
}
.standings tbody tr.top8 td.rank::before { background: var(--color-success); }
.standings tbody tr.playoff td.rank::before { background: var(--color-primary); }
.standings tbody tr.out td.rank::before { background: var(--color-danger); }
.team-link { color: var(--color-text); font-weight: 600; }
.team-link:hover { color: var(--color-primary); }

/* The table is wider than a phone, so it scrolls. Tighter cells shorten the
   trip without shrinking the text out of legibility. */
@media (max-width: 600px) {
  .standings { min-width: 540px; }
  .standings th, .standings td { padding: 0.5rem 0.4rem; font-size: 0.82rem; }
}
</style>
