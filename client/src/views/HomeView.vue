<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';

interface SquadEntry { teamId: string; shortName: string; name: string; eliminated: boolean }
interface Mw { id: string; label: string; status: string }
interface LbEntry { userId: string; displayName: string; total: number; rank: number }

const auth = useAuthStore();
const loading = ref(true);
const squad = ref<SquadEntry[]>([]);
const squadLocked = ref(false);
const currentMw = ref<Mw | null>(null);
const weekTotal = ref<number | null>(null);
const weekFinal = ref(false);
const leaderboard = ref<LbEntry[]>([]);
// The final is done — the season has an ending worth replaying (§18.8).
const seasonOver = ref(false);

const squadComplete = computed(() => squad.value.length === 4);
const myRank = computed(() => leaderboard.value.find((e) => e.userId === auth.user?.id) ?? null);
const topThree = computed(() => leaderboard.value.slice(0, 3));

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase();
}

onMounted(async () => {
  try {
    const [status, sq, lb] = await Promise.all([
      api.get<{ matchweeks: Mw[]; currentMatchweekId: string | null }>('/api/tournament/status'),
      api.get<{ squad: SquadEntry[]; locked: boolean }>('/api/squad'),
      api.get<{ leaderboard: LbEntry[] }>('/api/leaderboard'),
    ]);
    squad.value = sq.squad;
    squadLocked.value = sq.locked;
    leaderboard.value = lb.leaderboard;
    currentMw.value = status.matchweeks.find((m) => m.id === status.currentMatchweekId) ?? null;
    seasonOver.value = status.matchweeks.some((m) => m.id === 'final' && m.status === 'complete');
    if (currentMw.value) {
      const sc = await api.get<{ score: { total: number; final: boolean } | null }>(
        `/api/matchweeks/${currentMw.value.id}/score`,
      );
      weekTotal.value = sc.score?.total ?? null;
      weekFinal.value = sc.score?.final ?? false;
    }
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="`Selam ${auth.user?.displayName} 👋`" />

    <BallLoader v-if="loading" />

    <RouterLink v-if="!loading && seasonOver" to="/sezon" class="surface-card card-pad replay-banner">
      <span class="replay-title">🏆 Sezon bitti — filmin hazır</span>
      <span class="text-muted">Sıralaman, en iyi haftan, jokerlerin ve puanının yolculuğu</span>
      <Button label="İzle" icon="pi pi-play" size="small" />
    </RouterLink>

    <div v-if="!loading" class="dash-grid">
      <!-- Squad -->
      <section class="surface-card card-pad">
        <div class="card-top">
          <h2 class="section-title" style="margin: 0">Kadrom</h2>
          <Tag :severity="squadComplete ? 'success' : 'warn'" :value="squadComplete ? 'Hazır' : 'Eksik'" />
        </div>
        <template v-if="squadComplete">
          <div class="crest-row">
            <RouterLink v-for="s in squad" :key="s.teamId" :to="`/takim/${s.teamId}`" class="crest-mini">
              <span class="crest" :class="{ elim: s.eliminated }">{{ s.shortName }}</span>
              <small>{{ s.name }}</small>
            </RouterLink>
          </div>
          <RouterLink to="/kadro">
            <Button :label="squadLocked ? 'Kadroyu gör' : 'Kadroyu düzenle'" icon="pi pi-users" outlined size="small" />
          </RouterLink>
        </template>
        <template v-else>
          <p class="text-muted" style="margin: 0 0 1rem">Her pottan bir kulüp seçerek başla.</p>
          <RouterLink to="/kadro"><Button label="Kadroyu kur" icon="pi pi-plus" /></RouterLink>
        </template>
      </section>

      <!-- This week -->
      <section class="surface-card card-pad">
        <h2 class="section-title" style="margin: 0 0 0.75rem">{{ currentMw?.label ?? 'Hafta' }}</h2>
        <template v-if="currentMw">
          <div class="week-score">
            <span class="big-num">{{ weekTotal ?? '—' }}</span>
            <span class="text-muted">{{ weekFinal ? 'kesin puan' : 'anlık puan' }}</span>
          </div>
          <RouterLink to="/hafta">
            <Button label="Dizilişini ayarla" icon="pi pi-calendar" size="small" />
          </RouterLink>
        </template>
        <p v-else class="text-muted" style="margin: 0">Sezon henüz başlamadı.</p>
      </section>

      <!-- Standings -->
      <section class="surface-card card-pad">
        <div class="card-top">
          <h2 class="section-title" style="margin: 0">Sıralama</h2>
          <Tag v-if="myRank" :value="`${myRank.rank}.`" severity="info" />
        </div>
        <ol v-if="topThree.length" class="mini-lb">
          <li v-for="e in topThree" :key="e.userId" :class="{ me: e.userId === auth.user?.id }">
            <span class="lb-rank">{{ e.rank }}</span>
            <RouterLink :to="`/oyuncu/${e.userId}`" class="lb-name">{{ e.displayName }}</RouterLink>
            <span class="lb-pts">{{ e.total }}</span>
          </li>
        </ol>
        <p v-else class="text-muted" style="margin: 0">Henüz sıralama yok.</p>
        <RouterLink to="/puan-durumu"><Button label="Tüm sıralama" icon="pi pi-chart-bar" text size="small" /></RouterLink>
      </section>
    </div>
  </div>
</template>

<style scoped>
.replay-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  text-decoration: none;
  color: var(--color-text);
  border-color: var(--color-warning);
  transition: box-shadow 0.16s ease, transform 0.16s ease;
}
.replay-banner:hover { box-shadow: 0 0 18px rgba(251, 191, 36, 0.25); transform: translateY(-2px); text-decoration: none; }
.replay-banner .replay-title { font-weight: 800; }
.replay-banner .text-muted { flex: 1; font-size: var(--text-sm); }
.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.crest-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.crest-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  width: 74px;
  text-align: center;
  text-decoration: none;
  color: var(--color-text);
}
.crest-mini small {
  font-size: var(--text-2xs);
  line-height: 1.15;
}
.crest {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
  color: #fff;
  display: grid;
  place-items: center;
  font-size: var(--text-2xs);
  font-weight: 800;
  box-shadow: var(--shadow-sm);
}
.crest.elim {
  filter: grayscale(1);
  opacity: 0.6;
}
.crest-mini:hover .crest {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.week-score {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.big-num {
  font-size: var(--text-3xl);
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1;
}
.mini-lb {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.mini-lb li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
}
.mini-lb li.me {
  background: var(--color-primary-soft);
}
.lb-rank {
  font-weight: 800;
  color: var(--color-primary);
  width: 1.2rem;
}
.lb-name {
  flex: 1;
  color: var(--color-text);
  text-decoration: none;
}
.lb-name:hover { color: var(--color-primary); }
.lb-pts {
  font-weight: 700;
}
</style>
