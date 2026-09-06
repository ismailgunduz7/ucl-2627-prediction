<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Select from 'primevue/select';
import BallLoader from '@/components/BallLoader.vue';
import PageHeader from '@/components/PageHeader.vue';
import CaptainBadge from '@/components/CaptainBadge.vue';
import { api } from '@/lib/api';
import { roundKeyOf, type MatchweekMenu, type RoundOption } from '@/lib/matchweeks';
import { formatDayLong, formatTime } from '@/lib/format';

interface Mw { id: string; label: string; status: string; opened: boolean; menu: MatchweekMenu }
type Outcome = 'home' | 'draw' | 'away';
interface Side {
  teamId: string; name: string; shortName: string; tierId: number; score: number | null;
  mine: boolean; benched: boolean; captain: boolean; counts: boolean; points: number | null;
}
interface Fixture {
  matchId: string; kickoffAt: string | null; status: string; stage: string;
  result: Outcome | null; pick: Outcome | null; home: Side; away: Side;
}
interface Section {
  matchweekId: string; legLabel: string | null; fixtures: Fixture[];
  captainMultiplier: 2 | 3; benchBoost: boolean;
}
interface RoundFixtures {
  roundKey: string; roundLabel: string; sections: Section[]; lastSyncAt: string | null;
}

const { t } = useI18n();
const matchweeks = ref<Mw[]>([]);
const rounds = ref<RoundOption[]>([]);
const selectedRound = ref<string | null>(null);
const data = ref<RoundFixtures | null>(null);
const loading = ref(true);
let poller: number | undefined;

const PICK_LABEL: Record<Outcome, string> = { home: 'MS1', draw: 'MS0', away: 'MS2' };

const sections = computed(() => data.value?.sections ?? []);
const fixtures = computed(() => sections.value.flatMap((s) => s.fixtures));
const liveOnes = computed(() => fixtures.value.filter((f) => f.status === 'live'));
const mineCount = computed(() => fixtures.value.filter(isMine).length);

/** Matches of one section, grouped by the calendar day they are played. */
function daysOf(section: Section) {
  const groups = new Map<string, Fixture[]>();
  for (const f of section.fixtures) {
    const key = f.kickoffAt ? new Date(f.kickoffAt).toDateString() : 'tbd';
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key: `${section.matchweekId}:${key}`,
    label: key === 'tbd' ? t('fixtures.dateUnknown') : formatDayLong(list[0]!.kickoffAt!),
    fixtures: list,
  }));
}

function isMine(f: Fixture) { return f.home.mine || f.away.mine; }
function timeLabel(iso: string | null) { return formatTime(iso); }
function syncLabel(iso: string | null) { return iso ? formatTime(iso) : null; }
function signed(n: number) { return n > 0 ? `+${n}` : `${n}`; }
function tone(n: number) { return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }

async function loadWeeks() {
  const status = await api.get<{
    matchweeks: Mw[];
    rounds: { key: string; label: string }[];
    currentMatchweekId: string | null;
  }>('/api/tournament/status');
  matchweeks.value = status.matchweeks;
  rounds.value = status.rounds.map((r) => ({ value: r.key, label: r.label }));
  selectedRound.value =
    roundKeyOf(status.matchweeks, status.currentMatchweekId) ?? rounds.value[0]?.value ?? null;
}

async function loadFixtures() {
  if (!selectedRound.value) return;
  data.value = await api.get<RoundFixtures>(`/api/rounds/${selectedRound.value}/fixtures`);
}

/**
 * While a match is in play the page refreshes itself from our own API. It never
 * calls the provider. Only the sync job does that.
 */
function schedulePoll() {
  window.clearInterval(poller);
  if (!liveOnes.value.length) return;
  poller = window.setInterval(() => void loadFixtures(), 60_000);
}

onMounted(async () => {
  try {
    await loadWeeks();
    await loadFixtures();
  } finally {
    loading.value = false;
  }
  schedulePoll();
});
onUnmounted(() => window.clearInterval(poller));
watch(selectedRound, () => { if (!loading.value) void loadFixtures(); });
watch(liveOnes, schedulePoll);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('fixtures.title')">
      <template #actions>
        <Select
          v-model="selectedRound"
          :options="rounds"
          option-label="label"
          option-value="value"
          :placeholder="$t('fixtures.pickRound')"
          style="min-width: 200px"
        />
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <template v-else>
      <div class="fx-meta-row">
        <span v-if="liveOnes.length" class="live-pill">
          <span class="dot" />{{ $t('fixtures.livePill', { count: liveOnes.length }) }}
        </span>
        <span v-if="mineCount" class="text-muted">{{ $t('fixtures.mineCount', { count: mineCount }) }}</span>
        <span v-if="syncLabel(data?.lastSyncAt ?? null)" class="text-muted sync">
          {{ $t('fixtures.lastSync', { time: syncLabel(data?.lastSyncAt ?? null) }) }}
        </span>
      </div>

      <div v-if="!fixtures.length" class="surface-card card-pad empty-state">
        {{ $t('fixtures.empty') }}
      </div>

      <template v-for="section in sections" :key="section.matchweekId">
        <h2 v-if="section.legLabel" class="leg-head">{{ section.legLabel }}</h2>

        <section v-for="day in daysOf(section)" :key="day.key" class="surface-card day-card">
          <div class="day-head">{{ day.label }}</div>
          <div
            v-for="f in day.fixtures"
            :key="f.matchId"
            class="fx-row"
            :class="{ mine: isMine(f), live: f.status === 'live' }"
          >
            <span class="fx-time">
              <span v-if="f.status === 'live'" class="live-tag">{{ $t('fixtures.liveTag') }}</span>
              <span v-else-if="f.status === 'postponed'" class="text-muted">{{ $t('matchStatus.postponed') }}</span>
              <span v-else-if="f.status === 'cancelled'" class="text-muted">{{ $t('matchStatus.cancelled') }}</span>
              <span v-else>{{ timeLabel(f.kickoffAt) }}</span>
            </span>

            <span class="fx-side home">
              <span v-if="f.home.points !== null" class="fx-pts" :class="tone(f.home.points)">
                {{ signed(f.home.points) }}
              </span>
              <CaptainBadge v-if="f.home.captain" :multiplier="section.captainMultiplier" :size="18" />
              <span v-else-if="f.home.benched && !section.benchBoost" class="role-chip">{{ $t('week.bench') }}</span>
              <RouterLink :to="`/takim/${f.home.teamId}`" class="fx-club" :class="{ own: f.home.mine }">
                {{ f.home.name }}
              </RouterLink>
            </span>

            <span class="fx-score">
              <template v-if="f.home.score !== null && f.away.score !== null">
                {{ f.home.score }}-{{ f.away.score }}
              </template>
              <template v-else>{{ $t('common.versus') }}</template>
            </span>

            <span class="fx-side away">
              <RouterLink :to="`/takim/${f.away.teamId}`" class="fx-club" :class="{ own: f.away.mine }">
                {{ f.away.name }}
              </RouterLink>
              <CaptainBadge v-if="f.away.captain" :multiplier="section.captainMultiplier" :size="18" />
              <span v-else-if="f.away.benched && !section.benchBoost" class="role-chip">{{ $t('week.bench') }}</span>
              <span v-if="f.away.points !== null" class="fx-pts" :class="tone(f.away.points)">
                {{ signed(f.away.points) }}
              </span>
            </span>

            <span class="fx-tail">
              <span
                v-if="f.pick"
                class="pick-chip"
                :class="f.result ? (f.result === f.pick ? 'hit' : 'miss') : ''"
              >{{ PICK_LABEL[f.pick] }}</span>
            </span>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.fx-meta-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; font-size: var(--text-sm); }
.fx-meta-row .sync { margin-left: auto; }
.live-pill {
  display: inline-flex; align-items: center; gap: 0.45rem;
  padding: 0.25rem 0.7rem; border-radius: var(--radius-pill);
  background: var(--color-danger-soft); color: var(--color-danger); font-weight: 700;
}
.live-pill .dot {
  width: 7px; height: 7px; border-radius: 50%; background: currentColor;
  animation: pulse-soft 1.4s ease-in-out infinite;
}

.leg-head {
  margin: 0.5rem 0 -0.5rem;
  font-size: var(--text-lg);
  font-weight: 800;
  letter-spacing: -0.01em;
}
.day-card { overflow: hidden; }
.day-head {
  padding: 0.7rem 1.1rem; background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-text-secondary);
}

.fx-row {
  display: grid;
  grid-template-columns: 4.5rem 1fr auto 1fr 3.5rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 1.1rem;
  border-bottom: 1px solid var(--color-border);
  border-left: 3px solid transparent;
}
.fx-row:last-child { border-bottom: none; }
/* Enough tint to find my clubs while scanning, not enough to shout. */
.fx-row.mine { border-left-color: var(--color-primary); background: rgba(99, 102, 241, 0.09); }
.fx-row.live { background: rgba(251, 113, 133, 0.09); }
.fx-row.live.mine { border-left-color: var(--color-primary); }

.fx-time { font-size: var(--text-2xs); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.live-tag { color: var(--color-danger); font-weight: 800; letter-spacing: 0.04em; }

.fx-side { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.fx-side.home { justify-content: flex-end; text-align: right; }
.fx-club { color: var(--color-text-secondary); font-weight: 500; }
.fx-club.own { color: var(--color-text); }

/* What this club put on my scoreboard, on its own side of the fixture. */
.fx-pts {
  min-width: 2.2rem;
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  font-size: var(--text-2xs);
  font-weight: 800;
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: var(--color-surface-2);
  color: var(--color-text-muted);
}
.fx-pts.up { background: var(--color-success-soft); color: var(--color-success); }
.fx-pts.down { background: var(--color-danger-soft); color: var(--color-danger); }
.fx-score {
  min-width: 3.2rem; text-align: center; font-weight: 700;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.fx-tail { display: flex; align-items: center; justify-content: flex-end; gap: 0.35rem; }
.pick-chip {
  padding: 0.1rem 0.5rem; border-radius: var(--radius-pill);
  font-size: var(--text-2xs); font-weight: 700; white-space: nowrap;
  background: var(--color-surface-2); color: var(--color-text-muted);
}
.pick-chip.hit { background: var(--color-success-soft); color: var(--color-success); }
.pick-chip.miss { background: var(--color-danger-soft); color: var(--color-danger); }

@media (max-width: 820px) {
  .fx-row { grid-template-columns: 3.5rem 1fr auto 1fr; row-gap: 0.4rem; }
  .fx-tail { grid-column: 2 / -1; justify-content: flex-start; }
}

/* Below this the two clubs stop fitting side by side, so the fixture stacks:
   kickoff on top, one club per line, the score alongside both. */
@media (max-width: 560px) {
  .fx-row {
    grid-template-columns: 1fr auto;
    gap: 0.2rem 0.6rem;
    padding: 0.7rem 0.85rem;
  }
  .fx-time { grid-column: 1 / -1; grid-row: 1; }
  .fx-side { grid-column: 1; }
  .fx-side.home { grid-row: 2; flex-direction: row-reverse; justify-content: flex-end; text-align: left; }
  .fx-side.away { grid-row: 3; }
  .fx-score { grid-column: 2; grid-row: 2 / 4; min-width: 2.6rem; }
  .fx-tail { grid-column: 1 / -1; grid-row: 4; justify-content: flex-start; }
  .fx-tail:empty { display: none; }
}
</style>
