<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { useToast } from 'primevue/usetoast';
import { Calculator, CalendarDays, Shield, Zap } from '@lucide/vue';
import BallLoader from '@/components/BallLoader.vue';
import PageHeader from '@/components/PageHeader.vue';
import CaptainBadge from '@/components/CaptainBadge.vue';
import TeamCrest from '@/components/TeamCrest.vue';
import { api, ApiRequestError } from '@/lib/api';
import { roundKeyOf, type MatchweekMenu, type RoundOption } from '@/lib/matchweeks';
import { formatDayLong, formatTime } from '@/lib/format';
import { pickLabel, type Pick } from '@/lib/predictions';
import {
  calcFixture,
  ruleLabelsFrom,
  tierRulesFrom,
  type RuleRow,
  type SideOutcome,
} from '@/lib/calculator';
import type { TierRules } from '@domain/scoring.ts';

interface Mw { id: string; label: string; status: string; opened: boolean; menu: MatchweekMenu }
interface Side {
  teamId: string; name: string; shortName: string; crestUrl: string | null;
  tierId: number; score: number | null;
  mine: boolean; benched: boolean; captain: boolean; counts: boolean; points: number | null;
}
interface Fixture {
  matchId: string; kickoffAt: string | null; status: string; stage: string;
  result: Pick | null; pick: Pick | null; home: Side; away: Side;
}
interface Section {
  matchweekId: string; legLabel: string | null; fixtures: Fixture[];
  captainMultiplier: 2 | 3; benchBoost: boolean;
}
interface RoundFixtures {
  roundKey: string; roundLabel: string; sections: Section[]; lastSyncAt: string | null;
}

const { t } = useI18n();
const toast = useToast();
const matchweeks = ref<Mw[]>([]);
const rounds = ref<RoundOption[]>([]);
const selectedRound = ref<string | null>(null);
const data = ref<RoundFixtures | null>(null);
const loading = ref(true);
let poller: number | undefined;

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

// --- What-if calculator (§18.10) ------------------------------------------
// Everything below is worked out in the browser from the rules matrix. The
// arithmetic itself is the server's own domain code, imported not copied.

/** A club's role in the calculator, one of each per matchweek. */
type CalcRole = { teamId: string; multiplier: 2 | 3 } | null;

const calcOn = ref(false);
const rules = ref<TierRules | null>(null);
/** What each rule is called. The API sends the words; we never write them. */
const ruleLabels = ref(new Map<string, string>());
const rulesLoading = ref(false);
/** Typed scorelines, per match. */
const calcScores = ref(new Map<string, { home: number; away: number }>());
/** The captain, and the shielded club, per matchweek: both are one a week. */
const calcCaptain = ref(new Map<string, CalcRole>());
const calcShield = ref(new Map<string, string>());

/** The rules matrix is only worth fetching once somebody opens the calculator. */
async function ensureRules() {
  if (rules.value || rulesLoading.value) return;
  rulesLoading.value = true;
  try {
    const res = await api.get<{ rules: RuleRow[] }>('/api/scoring-rules');
    rules.value = tierRulesFrom(res.rules, [1, 2, 3, 4]);
    ruleLabels.value = ruleLabelsFrom(res.rules);
  } catch (e) {
    calcOn.value = false;
    toast.add({
      severity: 'error',
      summary: t('fixtures.calcFailed'),
      detail: e instanceof ApiRequestError ? e.message : t('common.unexpectedError'),
      life: 4000,
    });
  } finally {
    rulesLoading.value = false;
  }
}

/** Open on the real score where there is one, so the sums start from the truth. */
function seedScores() {
  const seeded = new Map<string, { home: number; away: number }>();
  for (const f of fixtures.value) {
    const held = calcScores.value.get(f.matchId);
    seeded.set(f.matchId, held ?? { home: f.home.score ?? 0, away: f.away.score ?? 0 });
  }
  calcScores.value = seeded;
}

function scoreOf(matchId: string) {
  return calcScores.value.get(matchId) ?? { home: 0, away: 0 };
}
function setScore(matchId: string, side: 'home' | 'away', raw: string) {
  const parsed = Number.parseInt(raw, 10);
  const current = { ...scoreOf(matchId) };
  current[side] = Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(30, parsed));
  calcScores.value.set(matchId, current);
}

/** The armband is a plain on and off. Tripling it is its own button (§18.10). */
function toggleCaptain(mwId: string, teamId: string) {
  const held = calcCaptain.value.get(mwId) ?? null;
  if (held && held.teamId === teamId) calcCaptain.value.set(mwId, null);
  else calcCaptain.value.set(mwId, { teamId, multiplier: 2 });
}
/** Only ever offered on the club already wearing the armband. */
function toggleTriple(mwId: string) {
  const held = calcCaptain.value.get(mwId) ?? null;
  if (!held) return;
  calcCaptain.value.set(mwId, { teamId: held.teamId, multiplier: held.multiplier === 3 ? 2 : 3 });
}
function toggleShield(mwId: string, teamId: string) {
  if (calcShield.value.get(mwId) === teamId) calcShield.value.delete(mwId);
  else calcShield.value.set(mwId, teamId);
}
function captainOf(mwId: string, teamId: string): 2 | 3 | null {
  const held = calcCaptain.value.get(mwId) ?? null;
  return held && held.teamId === teamId ? held.multiplier : null;
}
function isShielded(mwId: string, teamId: string) {
  return calcShield.value.get(mwId) === teamId;
}

/** Back to the real scores, with no captain and no shield anywhere. */
function clearCalc() {
  calcCaptain.value.clear();
  calcShield.value.clear();
  calcScores.value.clear();
  seedScores();
}

/**
 * Every fixture's outcome in one pass, keyed by match. A row refers to its
 * figures several times over (the number, its colour, its tooltip) and each
 * keystroke rerenders the lot, so the arithmetic happens once per fixture here
 * rather than once per mention in the template.
 */
const calcResults = computed(() => {
  const out = new Map<string, { home: SideOutcome; away: SideOutcome }>();
  if (!calcOn.value || !rules.value) return out;
  for (const section of sections.value) {
    const mw = section.matchweekId;
    for (const f of section.fixtures) {
      const score = scoreOf(f.matchId);
      out.set(
        f.matchId,
        calcFixture(
          {
            teamId: f.home.teamId, tierId: f.home.tierId,
            goalsFor: score.home, goalsAgainst: score.away,
            multiplier: captainOf(mw, f.home.teamId) ?? 1,
            shielded: isShielded(mw, f.home.teamId),
          },
          {
            teamId: f.away.teamId, tierId: f.away.tierId,
            goalsFor: score.away, goalsAgainst: score.home,
            multiplier: captainOf(mw, f.away.teamId) ?? 1,
            shielded: isShielded(mw, f.away.teamId),
          },
          rules.value,
        ),
      );
    }
  }
  return out;
});
function calcOf(f: Fixture) {
  return calcResults.value.get(f.matchId) ?? null;
}

/** The working behind a figure, as a tooltip: every line, then the extras. */
function workingOf(out: SideOutcome): string {
  const parts = out.lines
    .filter((l) => l.points !== 0)
    .map((l) => `${ruleLabels.value.get(l.ruleCode) ?? l.ruleCode} ${signed(l.points)}`);
  if (out.shieldDelta !== 0) parts.push(`${t('joker.clean_sheet_shield')} ${signed(out.shieldDelta)}`);
  if (out.multiplier > 1) parts.push(`x${out.multiplier}`);
  return parts.join('  ');
}

watch(calcOn, async (on) => {
  if (!on) return;
  await ensureRules();
  seedScores();
});
watch(fixtures, () => { if (calcOn.value) seedScores(); });

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
        <div class="view-switch">
          <span class="view-lead">{{ $t('fixtures.viewLead') }}</span>
          <button
            type="button"
            class="view-opt"
            :class="{ on: !calcOn }"
            :aria-pressed="!calcOn"
            @click="calcOn = false"
          >{{ $t('fixtures.viewFixtures') }}</button>
          <ToggleSwitch v-model="calcOn" :aria-label="$t('fixtures.viewLead')">
            <template #handle="{ checked }">
              <Calculator v-if="checked" :size="12" />
              <CalendarDays v-else :size="12" />
            </template>
          </ToggleSwitch>
          <button
            type="button"
            class="view-opt"
            :class="{ on: calcOn }"
            :aria-pressed="calcOn"
            @click="calcOn = true"
          >{{ $t('fixtures.viewCalc') }}</button>
        </div>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <template v-else>
      <div class="fx-toolbar">
        <Select
          v-model="selectedRound"
          :options="rounds"
          option-label="label"
          option-value="value"
          :placeholder="$t('fixtures.pickRound')"
          class="select-filter round-picker"
        />
        <span v-if="liveOnes.length" class="live-pill">
          <span class="dot" />{{ $t('fixtures.livePill', { count: liveOnes.length }) }}
        </span>
        <span v-if="mineCount" class="text-muted">{{ $t('fixtures.mineCount', { count: mineCount }) }}</span>
        <span v-if="syncLabel(data?.lastSyncAt ?? null)" class="text-muted sync">
          {{ $t('fixtures.lastSync', { time: syncLabel(data?.lastSyncAt ?? null) }) }}
        </span>
      </div>

      <div v-if="calcOn" class="surface-card card-pad calc-note">
        <p class="flush">{{ $t('fixtures.calcLead') }}</p>
        <button type="button" class="calc-reset" :disabled="!rules" @click="clearCalc">
          {{ $t('fixtures.calcReset') }}
        </button>
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
            :class="{ mine: isMine(f), live: f.status === 'live', calc: calcOn }"
          >
            <span class="fx-time">
              <span v-if="f.status === 'live'" class="live-tag">
                <span class="dot" aria-hidden="true" />{{ $t('fixtures.liveTag') }}
              </span>
              <span v-else-if="f.status === 'postponed'" class="text-muted">{{ $t('matchStatus.postponed') }}</span>
              <span v-else-if="f.status === 'cancelled'" class="text-muted">{{ $t('matchStatus.cancelled') }}</span>
              <span v-else>{{ timeLabel(f.kickoffAt) }}</span>
            </span>

            <div class="fx-side home">
            <RouterLink :to="`/takim/${f.home.teamId}`" class="fx-club home" :class="{ own: f.home.mine }">
                <TeamCrest :name="f.home.name" :crest-url="f.home.crestUrl" :fallback="f.home.shortName" size="xs" />
                <span class="fx-name">{{ f.home.name }}</span>
                <span class="fx-name-short">{{ f.home.shortName }}</span>
              </RouterLink>
            <span class="fx-extra home">
                <template v-if="calcOn">
                  <span class="calc-roles">
                    <button
                      type="button"
                      class="calc-role press"
                      :class="{ on: captainOf(section.matchweekId, f.home.teamId) }"
                      :aria-pressed="captainOf(section.matchweekId, f.home.teamId) !== null"
                      :title="$t('fixtures.calcCaptainHint')"
                      @click="toggleCaptain(section.matchweekId, f.home.teamId)"
                    ><CaptainBadge :multiplier="2" :size="16" /></button>
                    <button
                      v-if="captainOf(section.matchweekId, f.home.teamId)"
                      type="button"
                      class="calc-role press"
                      :class="{ on: captainOf(section.matchweekId, f.home.teamId) === 3 }"
                      :aria-pressed="captainOf(section.matchweekId, f.home.teamId) === 3"
                      :title="$t('fixtures.calcTripleHint')"
                      @click="toggleTriple(section.matchweekId)"
                    ><Zap :size="15" /></button>
                    <button
                      type="button"
                      class="calc-role press"
                      :class="{ on: isShielded(section.matchweekId, f.home.teamId) }"
                      :aria-pressed="isShielded(section.matchweekId, f.home.teamId)"
                      :title="$t('fixtures.calcShieldHint')"
                      @click="toggleShield(section.matchweekId, f.home.teamId)"
                    ><Shield :size="15" /></button>
                  </span>
                  <span
                    v-if="calcOf(f)"
                    class="fx-pts calc-pts"
                    :class="tone(calcOf(f)!.home.total)"
                    :title="workingOf(calcOf(f)!.home)"
                  >{{ signed(calcOf(f)!.home.total) }}</span>
                </template>
                <template v-else>
                  <CaptainBadge v-if="f.home.captain" :multiplier="section.captainMultiplier" :size="18" />
                  <span v-else-if="f.home.benched && !section.benchBoost" class="role-chip">{{ $t('week.bench') }}</span>
                  <span v-if="f.home.points !== null" class="fx-pts" :class="tone(f.home.points)">
                    {{ signed(f.home.points) }}
                  </span>
                </template>
            </span>
            </div>

            <span class="fx-score" :class="{ 'is-calc': calcOn }">
              <template v-if="calcOn">
                <input
                  class="score-box"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max="30"
                  :value="scoreOf(f.matchId).home"
                  :aria-label="`${f.home.name} ${$t('fixtures.calcGoals')}`"
                  @focus="($event.target as HTMLInputElement).select()"
                  @input="setScore(f.matchId, 'home', ($event.target as HTMLInputElement).value)"
                />
                <span class="score-dash">-</span>
                <input
                  class="score-box"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max="30"
                  :value="scoreOf(f.matchId).away"
                  :aria-label="`${f.away.name} ${$t('fixtures.calcGoals')}`"
                  @focus="($event.target as HTMLInputElement).select()"
                  @input="setScore(f.matchId, 'away', ($event.target as HTMLInputElement).value)"
                />
              </template>
              <template v-else-if="f.home.score !== null && f.away.score !== null">
                {{ f.home.score }}-{{ f.away.score }}
              </template>
              <span v-else class="fx-vs">{{ $t('common.versus') }}</span>
            </span>

            <div class="fx-side away">
            <RouterLink :to="`/takim/${f.away.teamId}`" class="fx-club away" :class="{ own: f.away.mine }">
                <TeamCrest :name="f.away.name" :crest-url="f.away.crestUrl" :fallback="f.away.shortName" size="xs" />
                <span class="fx-name">{{ f.away.name }}</span>
                <span class="fx-name-short">{{ f.away.shortName }}</span>
              </RouterLink>
            <span class="fx-extra away">
                <template v-if="calcOn">
                  <span class="calc-roles">
                    <button
                      type="button"
                      class="calc-role press"
                      :class="{ on: captainOf(section.matchweekId, f.away.teamId) }"
                      :aria-pressed="captainOf(section.matchweekId, f.away.teamId) !== null"
                      :title="$t('fixtures.calcCaptainHint')"
                      @click="toggleCaptain(section.matchweekId, f.away.teamId)"
                    ><CaptainBadge :multiplier="2" :size="16" /></button>
                    <button
                      v-if="captainOf(section.matchweekId, f.away.teamId)"
                      type="button"
                      class="calc-role press"
                      :class="{ on: captainOf(section.matchweekId, f.away.teamId) === 3 }"
                      :aria-pressed="captainOf(section.matchweekId, f.away.teamId) === 3"
                      :title="$t('fixtures.calcTripleHint')"
                      @click="toggleTriple(section.matchweekId)"
                    ><Zap :size="15" /></button>
                    <button
                      type="button"
                      class="calc-role press"
                      :class="{ on: isShielded(section.matchweekId, f.away.teamId) }"
                      :aria-pressed="isShielded(section.matchweekId, f.away.teamId)"
                      :title="$t('fixtures.calcShieldHint')"
                      @click="toggleShield(section.matchweekId, f.away.teamId)"
                    ><Shield :size="15" /></button>
                  </span>
                  <span
                    v-if="calcOf(f)"
                    class="fx-pts calc-pts"
                    :class="tone(calcOf(f)!.away.total)"
                    :title="workingOf(calcOf(f)!.away)"
                  >{{ signed(calcOf(f)!.away.total) }}</span>
                </template>
                <template v-else>
                  <CaptainBadge v-if="f.away.captain" :multiplier="section.captainMultiplier" :size="18" />
                  <span v-else-if="f.away.benched && !section.benchBoost" class="role-chip">{{ $t('week.bench') }}</span>
                  <span v-if="f.away.points !== null" class="fx-pts" :class="tone(f.away.points)">
                    {{ signed(f.away.points) }}
                  </span>
                </template>
            </span>
            </div>

            <span class="fx-tail">
              <span
                v-if="f.pick"
                class="pick-chip"
                :class="f.result ? (f.result === f.pick ? 'hit' : 'miss') : ''"
              >{{ pickLabel(f.pick) }}</span>
            </span>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* ---- View switch: two words with the toggle between them (§18.10) ---- */
.view-switch {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.3rem 0.7rem 0.3rem 0.85rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  font-size: var(--text-sm);
}
.view-lead { color: var(--color-text-muted); font-weight: 600; }
/* Either word switches the view, so the toggle is not the only target. */
.view-opt {
  padding: 0.15rem 0.1rem; border: none; background: none;
  color: var(--color-text-muted); font: inherit; font-weight: 600; cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.view-opt:hover { color: var(--color-text); }
.view-opt.on { color: var(--color-primary); font-weight: 800; }

/* ---- Toolbar: the round, then what is worth knowing about it ---- */
.fx-toolbar {
  display: flex; align-items: center; gap: 0.75rem 1rem; flex-wrap: wrap;
  font-size: var(--text-sm);
}
.fx-toolbar .round-picker { min-width: 15rem; }
.fx-toolbar .sync { margin-left: auto; }
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
  font-size: var(--text-lg); font-weight: 800; letter-spacing: -0.01em;
}
.day-card { overflow: hidden; }
.day-head {
  padding: 0.7rem 1.1rem; background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-text-secondary);
}

/* ---- The fixture itself ----
   Two sides facing a score, which is how a fixture is read. Each side is one
   cell holding the club and whatever hangs off it, and the two cells are equal
   flexible tracks, so the score sits on the same axis down the whole page
   however much either side is carrying. Splitting the extras into columns of
   their own was tried and is wrong twice over: the tracks then sized themselves
   per row and the fixture slid sideways, and a chip that belongs to a club
   ended up at the far end of the row instead of beside its name. */
.fx-row {
  display: grid;
  grid-template-columns: 4.25rem minmax(0, 1fr) auto minmax(0, 1fr) 3.25rem;
  grid-template-areas: 'time home score away tail';
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1.1rem;
  border-bottom: 1px solid var(--color-border);
  border-left: 3px solid transparent;
}
.fx-row:last-child { border-bottom: none; }
/* Enough tint to find my clubs while scanning, not enough to shout. */
.fx-row.mine { border-left-color: var(--color-primary); background: rgba(99, 102, 241, 0.09); }
.fx-row.live { background: rgba(251, 113, 133, 0.09); }
.fx-row.live.mine { border-left-color: var(--color-primary); }
.fx-row.calc { padding: 0.5rem 1.1rem; }

.fx-time { grid-area: time; font-size: var(--text-2xs); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.live-tag { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--color-danger); font-weight: 800; letter-spacing: 0.04em; }
.live-tag .dot {
  width: 6px; height: 6px; border-radius: 50%; background: currentColor;
  animation: pulse-soft 1.4s ease-in-out infinite;
}

/* Both sides pack against the score, so the fixture reads out from the middle
   and the extras trail away from it just past the club they belong to. */
.fx-side { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.fx-side.home { grid-area: home; flex-direction: row-reverse; justify-content: flex-start; }
.fx-side.away { grid-area: away; justify-content: flex-start; }

/* The crest always faces the score, so the home club reads badge-last. */
.fx-club {
  display: inline-flex; align-items: center; gap: 0.5rem; min-width: 0;
  color: var(--color-text-secondary); font-weight: 500;
}
.fx-club:hover { color: var(--color-primary); }
.fx-club.own { color: var(--color-text); font-weight: 600; }
.fx-club.home { flex-direction: row-reverse; }
.fx-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The phone gets the short name instead: an ellipsised full one is worse than
   the abbreviation every scoreboard already uses. */
.fx-name-short { display: none; white-space: nowrap; }

.fx-extra { display: inline-flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
.fx-extra.home { flex-direction: row-reverse; }

.fx-pts {
  min-width: 2.2rem; padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  font-size: var(--text-2xs); font-weight: 800; text-align: center;
  font-variant-numeric: tabular-nums;
  background: var(--color-surface-2); color: var(--color-text-muted);
}
.fx-pts.up { background: var(--color-success-soft); color: var(--color-success); }
.fx-pts.down { background: var(--color-danger-soft); color: var(--color-danger); }
.calc-pts { cursor: help; }

.fx-score {
  grid-area: score;
  min-width: 3.2rem; text-align: center; font-weight: 700;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.fx-vs { color: var(--color-text-muted); font-weight: 500; }
.fx-score.is-calc { display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; }
.score-dash { color: var(--color-text-muted); }
/* A bare input rather than PrimeVue's: this one has to answer every keystroke,
   and InputNumber deliberately holds its value back until the field is left. */
.score-box {
  width: 2.6rem; height: 2rem; padding: 0 0.25rem;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--color-border-control);
  background: var(--color-bg-subtle); color: var(--color-text);
  font: inherit; font-weight: 800; text-align: center;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}
.score-box::-webkit-outer-spin-button,
.score-box::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.score-box:focus-visible { outline: none; border-color: var(--color-primary); }

.calc-roles { display: inline-flex; align-items: center; gap: 0.25rem; }
.fx-extra.home .calc-roles { flex-direction: row-reverse; }
/* A role is off until it is picked, so an unpicked one reads as an outline. */
.calc-role {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border-radius: 50%; border: 1.5px solid var(--color-border-control);
  background: var(--color-bg-subtle); color: var(--color-text-muted);
  cursor: pointer; opacity: 0.5;
  transition: opacity var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.calc-role:hover { opacity: 1; border-color: var(--color-primary); }
.calc-role.on { opacity: 1; border-color: var(--color-primary); background: var(--color-primary-soft); color: #fff; }

.fx-tail { display: flex; align-items: center; justify-content: flex-end; gap: 0.35rem; }
.pick-chip {
  padding: 0.1rem 0.5rem; border-radius: var(--radius-pill);
  font-size: var(--text-2xs); font-weight: 700; white-space: nowrap;
  background: var(--color-surface-2); color: var(--color-text-muted);
}
.pick-chip.hit { background: var(--color-success-soft); color: var(--color-success); }
.pick-chip.miss { background: var(--color-danger-soft); color: var(--color-danger); }

/* ---- The calculator's own strip ---- */
.calc-note {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-4); flex-wrap: wrap;
}
.calc-note p { color: var(--color-text-muted); font-size: var(--text-sm); }
.calc-reset {
  padding: 0.35rem 0.8rem; border-radius: var(--radius-pill);
  border: 1.5px solid var(--color-border-control); background: var(--color-bg-subtle);
  color: var(--color-text-secondary); font: inherit; font-size: var(--text-xs);
  font-weight: 700; cursor: pointer; flex-shrink: 0;
}
.calc-reset:hover:not(:disabled) { color: var(--color-text); border-color: var(--color-primary); }
.calc-reset:disabled { opacity: 0.5; cursor: default; }

/* ---- Tablet: the pick chip stops earning a column of its own ---- */
@media (max-width: 900px) {
  .fx-row {
    grid-template-columns: 3.75rem minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-areas:
      'time home score away'
      'tail tail tail  tail';
    row-gap: 0.35rem;
  }
  .fx-tail { justify-content: flex-start; }
  .fx-toolbar .sync { margin-left: 0; }
  .fx-toolbar .round-picker { min-width: 0; flex: 1 1 12rem; }
}

/* ---- Phone: the kickoff time takes its own line, the two clubs face the
   score under it, and everything hanging off them drops to a third line. The
   calculator's three roles and a figure per side simply do not fit beside a
   score on a phone, and shrinking them below a fingertip would be worse. ---- */
@media (max-width: 620px) {
  .fx-row {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-areas:
      'time  time  tail'
      'home  score away'
      'xhome xhome xaway';
    gap: 0.35rem 0.5rem;
    padding: 0.7rem 0.8rem;
  }
  .fx-tail { justify-content: flex-end; }
  .fx-side { display: contents; }
  .fx-club.home { grid-area: home; justify-self: end; max-width: 100%; }
  .fx-club.away { grid-area: away; justify-self: start; max-width: 100%; }
  .fx-extra.home { grid-area: xhome; justify-self: start; flex-direction: row; }
  .fx-extra.away { grid-area: xaway; justify-self: end; }
  .fx-extra.home .calc-roles { flex-direction: row; }
  /* The short name is all that fits, and all that is needed. */
  .fx-name { display: none; }
  .fx-name-short { display: inline; font-size: var(--text-sm); font-weight: 600; }
  .fx-score { min-width: 2.6rem; }
  .view-switch { width: 100%; justify-content: center; }
}

/* A finger needs a bigger target than a mouse does. */
@media (pointer: coarse) {
  .calc-role { width: 34px; height: 34px; }
  .score-box { height: 2.35rem; width: 2.9rem; }
}

.empty-state { text-align: center; color: var(--color-text-muted); }
</style>
