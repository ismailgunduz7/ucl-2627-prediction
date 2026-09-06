<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import { ordinal } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import JokerIcon from '@/components/JokerIcon.vue';
import TrophyMark from '@/components/TrophyMark.vue';

interface ReplayWeek { matchweekId: string; label: string; points: number; cumulative: number }
interface ReplayJoker { code: string; weekLabel: string }
interface SeasonReplay {
  finished: boolean;
  rank: number | null;
  total: number;
  bestWeek: { label: string; points: number } | null;
  worstWeek: { label: string; points: number } | null;
  captainHits: number;
  captainWeeks: number;
  jokers: ReplayJoker[];
  transfer: 'committed' | 'expired' | 'unavailable';
  timeline: ReplayWeek[];
  podium: { userId: string; displayName: string; total: number; rank: number }[];
}

const { t } = useI18n();
const auth = useAuthStore();
const data = ref<SeasonReplay | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const meOnPodium = computed(
  () => data.value?.podium.some((p) => p.userId === auth.user?.id) ?? false,
);

// --- Cumulative line, drawn by hand so the page stays dependency-free ------
const W = 640;
const H = 180;
const PAD = 14;

const chart = computed(() => {
  const weeks = data.value?.timeline ?? [];
  if (weeks.length === 0) return null;
  const values = weeks.map((w) => w.cumulative);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const stepX = weeks.length > 1 ? (W - PAD * 2) / (weeks.length - 1) : 0;
  const x = (i: number) => PAD + i * stepX;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const points = weeks.map((w, i) => ({ x: x(i), y: y(w.cumulative), week: w }));
  return {
    points,
    polyline: points.map((p) => `${p.x},${p.y}`).join(' '),
    zeroY: y(0),
  };
});

function signed(n: number) { return n > 0 ? `+${n}` : `${n}`; }

onMounted(async () => {
  try {
    data.value = await api.get<SeasonReplay>('/api/season/replay');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : t('common.loadFailed');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('replay.title')" />

    <BallLoader v-if="loading" />
    <p v-else-if="error" class="empty-state">{{ error }}</p>

    <div v-else-if="data && !data.finished" class="surface-card card-pad not-yet">
      <TrophyMark :size="42" class="not-yet-mark" />
      <p style="margin: 0">{{ $t('replay.notYet') }}</p>
    </div>

    <template v-else-if="data">
      <section class="surface-card card-pad hero">
        <TrophyMark :size="52" class="hero-mark" :class="{ gold: data.rank === 1 }" />
        <div>
          <h2 class="hero-line">
            <template v-if="data.rank === 1">{{ $t('replay.champion') }}</template>
            <template v-else-if="data.rank !== null">
              {{ $t('replay.finishedRank', { rank: ordinal(data.rank) }) }}
            </template>
            <template v-else>{{ $t('replay.finished') }}</template>
          </h2>
          <p class="hero-sub text-muted">
            {{ $t('replay.summary', { points: data.total, weeks: data.timeline.length }) }}
          </p>
        </div>
      </section>

      <section v-if="chart" class="surface-card card-pad">
        <div class="section-title">{{ $t('replay.chartTitle') }}</div>
        <svg
          class="timeline-chart"
          :viewBox="`0 0 ${W} ${H}`"
          role="img"
          :aria-label="$t('replay.chartAlt')"
        >
          <line class="zero" x1="0" :y1="chart.zeroY" :x2="W" :y2="chart.zeroY" />
          <polyline class="line" :points="chart.polyline" />
          <g v-for="(p, i) in chart.points" :key="p.week.matchweekId">
            <circle class="dot" :class="{ last: i === chart.points.length - 1 }" :cx="p.x" :cy="p.y" :r="i === chart.points.length - 1 ? 5 : 3">
              <title>
                {{ $t('replay.pointTitle', {
                  week: p.week.label,
                  points: signed(p.week.points),
                  total: p.week.cumulative,
                }) }}
              </title>
            </circle>
          </g>
        </svg>
        <div class="chart-ends text-muted">
          <span>{{ data.timeline[0]?.label }}</span>
          <span>{{ data.timeline[data.timeline.length - 1]?.label }}</span>
        </div>
      </section>

      <div class="stat-row">
        <div v-if="data.bestWeek" class="surface-card card-pad stat">
          <span class="stat-num text-positive">{{ signed(data.bestWeek.points) }}</span>
          <small class="text-muted">{{ $t('replay.bestWeek', { week: data.bestWeek.label }) }}</small>
        </div>
        <div v-if="data.worstWeek" class="surface-card card-pad stat">
          <span class="stat-num" :class="data.worstWeek.points < 0 ? 'text-negative' : ''">{{ signed(data.worstWeek.points) }}</span>
          <small class="text-muted">{{ $t('replay.worstWeek', { week: data.worstWeek.label }) }}</small>
        </div>
        <div v-if="data.captainWeeks" class="surface-card card-pad stat">
          <span class="stat-num">{{ data.captainHits }}/{{ data.captainWeeks }}</span>
          <small class="text-muted">{{ $t('replay.captainHits') }}</small>
        </div>
        <div v-if="data.transfer !== 'unavailable'" class="surface-card card-pad stat">
          <span class="stat-num">{{ data.transfer === 'committed' ? '✓' : '-' }}</span>
          <small class="text-muted">
            {{ data.transfer === 'committed' ? $t('replay.transferUsed') : $t('replay.transferUnused') }}
          </small>
        </div>
      </div>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('replay.jokersTitle') }}</div>
        <div v-if="data.jokers.length" class="joker-list">
          <span v-for="(j, i) in data.jokers" :key="i" class="joker-chip">
            <JokerIcon :code="j.code" :size="15" />
            {{ $t(`joker.${j.code}`) }}
            <small class="text-muted">{{ j.weekLabel }}</small>
          </span>
        </div>
        <p v-else class="text-muted" style="margin: 0">{{ $t('replay.noJokers') }}</p>
      </section>

      <section v-if="data.podium.length" class="surface-card card-pad">
        <div class="section-title">{{ $t('replay.podiumTitle') }}</div>
        <ol class="podium">
          <li
            v-for="p in data.podium"
            :key="p.userId"
            :class="{ me: p.userId === auth.user?.id, first: p.rank === 1 }"
          >
            <span class="podium-rank">{{ p.rank }}</span>
            <RouterLink :to="`/oyuncu/${p.userId}`" class="podium-name">{{ p.displayName }}</RouterLink>
            <span class="podium-pts">{{ p.total }}</span>
          </li>
          <li v-if="!meOnPodium && data.rank !== null" class="me gap">
            <span class="podium-rank">{{ data.rank }}</span>
            <span class="podium-name">{{ auth.user?.displayName }}</span>
            <span class="podium-pts">{{ data.total }}</span>
          </li>
        </ol>
        <Tag v-if="data.rank === 1" severity="warn" :value="$t('replay.championTag')" style="margin-top: 0.75rem" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.not-yet { display: flex; align-items: center; gap: 1rem; color: var(--color-text-secondary); }
.not-yet-mark { color: var(--color-text-muted); flex-shrink: 0; }

.hero { display: flex; align-items: center; gap: 1.25rem; }
.hero-mark { color: var(--color-text-secondary); flex-shrink: 0; }
.hero-mark.gold { color: var(--color-warning); filter: drop-shadow(0 0 12px rgba(251, 191, 36, 0.45)); }
.hero-line { margin: 0; font-size: var(--text-xl); letter-spacing: -0.01em; }
.hero-sub { margin: 0.3rem 0 0; }

.timeline-chart { width: 100%; height: auto; display: block; }
.timeline-chart .zero { stroke: var(--color-border); stroke-width: 1; stroke-dasharray: 4 4; }
.timeline-chart .line {
  fill: none; stroke: var(--color-primary); stroke-width: 2.5;
  stroke-linecap: round; stroke-linejoin: round;
}
.timeline-chart .dot { fill: var(--color-primary); }
.timeline-chart .dot.last { fill: var(--color-warning); }
.chart-ends { display: flex; justify-content: space-between; font-size: var(--text-2xs); margin-top: 0.35rem; }

.stat-row { display: flex; gap: 1rem; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; align-items: center; min-width: 150px; flex: 1; text-align: center; }
.stat-num { font-size: 1.8rem; font-weight: 800; color: var(--color-primary); line-height: 1.15; }
.stat-num.text-positive { color: var(--color-success); }
.stat-num.text-negative { color: var(--color-danger); }

.joker-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.joker-chip {
  display: inline-flex; align-items: center; gap: 0.45rem;
  padding: 0.35rem 0.75rem; border-radius: var(--radius-pill);
  border: 1px solid var(--color-border); background: var(--color-surface-2);
  font-size: var(--text-sm); font-weight: 600;
}
.joker-chip small { font-size: var(--text-2xs); }

.podium { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
.podium li {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.55rem 0.75rem; border-radius: var(--radius-sm);
  background: var(--color-surface-2); border: 1px solid var(--color-border);
}
.podium li.first { border-color: var(--color-warning); }
.podium li.me { background: var(--color-primary-soft); border-color: var(--color-primary); }
.podium li.gap { margin-top: 0.6rem; }
.podium-rank { font-weight: 800; color: var(--color-primary); width: 1.6rem; text-align: center; }
.podium li.first .podium-rank { color: var(--color-warning); }
.podium-name { flex: 1; color: var(--color-text); font-weight: 600; text-decoration: none; }
.podium-name:hover { color: var(--color-primary); }
.podium-pts { font-weight: 800; }
</style>
