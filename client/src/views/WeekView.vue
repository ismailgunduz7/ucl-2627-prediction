<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { Crown, Armchair, House, Plane, ArrowUp, ArrowDown, Minus } from '@lucide/vue';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import JokerIcon from '@/components/JokerIcon.vue';
import CaptainBadge from '@/components/CaptainBadge.vue';
import FixtureLine from '@/components/FixtureLine.vue';
import OctopusMark from '@/components/OctopusMark.vue';
import { JOKER_ICONS, JOKER_NAMES } from '@/lib/jokers';
import { groupMatchweeks, matchweekTitle, type MatchweekMenu } from '@/lib/matchweeks';

interface Mw { id: string; label: string; status: string; editable: boolean; opened: boolean; locked: boolean; menu: MatchweekMenu }
interface SquadClub { teamId: string; tierId: number; name: string; shortName: string; eliminated: boolean }
interface Lineup { benchTeamId: string; captainTeamId: string; saved: boolean; lockAt: string | null; locked: boolean; opened: boolean; editable: boolean }
interface ScoreLine { teamId: string; name: string; basePoints: number; benched: boolean; captain: boolean; multiplier: number; contributed: number }
interface WeekScore { total: number; final: boolean; lines: ScoreLine[]; jokerCode: string | null; predictions: { settled: number; correct: number; points: number } }
interface Inventory { code: string; name: string; remaining: number }
interface ActiveJoker { code: string; payload: Record<string, unknown> }
interface BriefingClub { teamId: string; name: string; fixtures: { opponentName: string; opponentTierId: number; home: boolean }[]; difficulty: string | null }
interface OpenPick { userId: string; displayName: string; benchName: string; captainName: string; jokerCode: string | null }
interface Pot { tierId: number; teams: { id: string; name: string; eliminated: boolean; isActive: boolean }[] }
type Pick = 'home' | 'draw' | 'away';
interface PredictionMatch {
  matchId: string; homeName: string; awayName: string; kickoffAt: string | null; status: string;
  homeScore: number | null; awayScore: number | null; pick: Pick | null; result: Pick | null;
}
interface WeekPredictions {
  matches: PredictionMatch[]; editable: boolean; lockAt: string | null;
  pointsPerCorrect: number; tally: { settled: number; correct: number; points: number };
}
interface DeltaEvent { ruleCode: string; label: string; points: number; provisional: boolean }
interface ClubDeltas { teamId: string; name: string; shortName: string; captain: boolean; events: DeltaEvent[] }
interface WeekDeltas { matchweekId: string; live: boolean; clubs: ClubDeltas[] }
interface RankMove { rank: number; prevRank: number | null }

/** MS1 / MS0 / MS2, written the way a coupon writes them. */
const PICK_OPTIONS: { value: Pick; label: string }[] = [
  { value: 'home', label: 'MS1' },
  { value: 'draw', label: 'MS0' },
  { value: 'away', label: 'MS2' },
];

const toast = useToast();

const matchweeks = ref<Mw[]>([]);
const selectedMw = ref<string | null>(null);
const squad = ref<SquadClub[]>([]);
const lineup = ref<Lineup | null>(null);
const score = ref<WeekScore | null>(null);
const inventory = ref<Inventory[]>([]);
const activeJoker = ref<ActiveJoker | null>(null);
const briefing = ref<BriefingClub[]>([]);
const openPicks = ref<{ available: boolean; picks: OpenPick[] }>({ available: false, picks: [] });
const pots = ref<Pot[]>([]);
const predictions = ref<WeekPredictions | null>(null);
const deltas = ref<WeekDeltas | null>(null);
const rankMove = ref<RankMove | null>(null);
const loading = ref(true);
const busy = ref(false);
const now = ref(Date.now());
let timer: number | undefined;
let livePoller: number | undefined;

const benchId = ref<string | null>(null);
const captainId = ref<string | null>(null);
const dragId = ref<string | null>(null);
const dragOverBench = ref(false);

const swapDialog = ref(false);
const swapFrom = ref<SquadClub | null>(null);
const benchConflict = ref(false);


const currentMw = computed(() => matchweeks.value.find((m) => m.id === selectedMw.value) ?? null);

/**
 * Weeks worth picking from: everything already under way plus the one still
 * open for edits. Weeks further out have nothing to show yet.
 */
const pickableMatchweeks = computed(() => {
  const all = matchweeks.value;
  let last = -1;
  all.forEach((m, i) => {
    if (m.opened || m.editable) last = i;
  });
  if (last < 0) last = 0;
  return all.slice(0, last + 1);
});
const weekGroups = computed(() => groupMatchweeks(pickableMatchweeks.value));
const editable = computed(() => lineup.value?.editable ?? false);
const isComplete = computed(() => currentMw.value?.status === 'complete');
const benchBoost = computed(() => activeJoker.value?.code === 'bench_boost');
const capMult = computed(() => (activeJoker.value?.code === 'triple_boost' ? 3 : 2));
const swappedInId = computed(() =>
  activeJoker.value?.code === 'weekly_swap' ? String(activeJoker.value.payload.toTeamId ?? '') : null,
);

const benchClub = computed(() => squad.value.find((c) => c.teamId === benchId.value) ?? null);
const pitchClubs = computed(() => squad.value.filter((c) => c.teamId !== benchId.value));

const lockAt = computed(() => lineup.value?.lockAt ?? null);
const countdownMs = computed(() => (lockAt.value ? new Date(lockAt.value).getTime() - now.value : null));
const countdown = computed(() => {
  const ms = countdownMs.value;
  if (ms === null || ms <= 0) return null;
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return d > 0 ? `${d}g ${h}s ${m}dk` : `${h}s ${m}dk ${s}sn`;
});
const drama = computed(() => countdownMs.value !== null && countdownMs.value > 0 && countdownMs.value < 7200_000);

function initials(name: string) { return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase(); }
function signed(n: number) { return n > 0 ? `+${n}` : `${n}`; }
function difficultySeverity(d: string | null) { return d === 'zor' ? 'danger' : d === 'orta' ? 'warn' : 'success'; }
function lineFor(teamId: string) { return score.value?.lines.find((l) => l.teamId === teamId); }
/** Benched and not boosted: the club played, but none of it counted. */
function sittingOut(l: ScoreLine) { return l.benched && score.value?.jokerCode !== 'bench_boost'; }
function remaining(code: string) { return inventory.value.find((i) => i.code === code)?.remaining ?? 0; }
/** Clubs with no fixture this week, so the wrap can explain their zero (§18.3). */
const byeIds = computed(() => new Set(briefing.value.filter((b) => !b.fixtures.length).map((b) => b.teamId)));
function wrapEventsFor(teamId: string) {
  return deltas.value?.clubs.find((c) => c.teamId === teamId)?.events ?? [];
}
const moveDir = computed(() => {
  const m = rankMove.value;
  if (!m || m.prevRank === null) return 'new';
  return m.rank < m.prevRank ? 'up' : m.rank > m.prevRank ? 'down' : 'same';
});

/** Which slot shows the active joker's (highlighted) button. */
const activeSlot = computed(() => {
  const j = activeJoker.value;
  if (!j) return null;
  if (j.code === 'triple_boost') return captainId.value;
  if (j.code === 'bench_boost') return benchId.value;
  if (j.code === 'clean_sheet_shield') return String(j.payload.teamId ?? '');
  if (j.code === 'weekly_swap') return String(j.payload.toTeamId ?? '');
  return null;
});

/**
 * Joker buttons for a slot. While a joker is live only that one shows (on its
 * own slot) and doubles as the cancel button; otherwise every joker with stock
 * left shows on the slots it can apply to.
 */
function jokersFor(club: SquadClub, isBench: boolean) {
  if (!editable.value) return [];
  if (activeJoker.value) {
    return activeSlot.value === club.teamId ? [{ code: activeJoker.value.code, active: true }] : [];
  }
  const codes = isBench ? ['bench_boost'] : ['triple_boost', 'clean_sheet_shield', 'weekly_swap'];
  return codes.filter((c) => remaining(c) > 0).map((code) => ({ code, active: false }));
}

async function onJokerClick(code: string, club: SquadClub, active: boolean) {
  if (busy.value) return;
  if (active) { await cancelJoker(); return; }
  if (code === 'weekly_swap') { swapFrom.value = club; swapDialog.value = true; return; }
  if (code === 'triple_boost') {
    // Triple boost rides with the captain, so captain that club first.
    if (captainId.value !== club.teamId) { captainId.value = club.teamId; await persist(); }
    await activateJoker('triple_boost', {});
    return;
  }
  if (code === 'clean_sheet_shield') { await activateJoker('clean_sheet_shield', { teamId: club.teamId }); return; }
  await activateJoker('bench_boost', {});
}

function swapOptions() {
  const from = swapFrom.value;
  if (!from) return [];
  const ids = new Set(squad.value.map((c) => c.teamId));
  const pot = pots.value.find((p) => p.tierId === from.tierId);
  return (pot?.teams ?? []).filter((t) => !ids.has(t.id) && !t.eliminated && t.isActive);
}
async function chooseSwap(toTeamId: string) {
  swapDialog.value = false;
  await activateJoker('weekly_swap', { fromTeamId: swapFrom.value?.teamId, toTeamId });
}

// A club swapped in for this week is here to play — it cannot be benched.
function canBench(club: SquadClub) {
  return editable.value && club.teamId !== swappedInId.value;
}

async function setBench(teamId: string) {
  if (!editable.value || teamId === benchId.value) return;
  const club = squad.value.find((c) => c.teamId === teamId);
  if (club && !canBench(club)) {
    toast.add({ severity: 'warn', summary: 'Takasla gelen kulüp yedeğe çekilemez', life: 3000 });
    return;
  }
  const oldBench = benchId.value;
  benchId.value = teamId;
  // Captaincy follows the club coming off the bench.
  if (captainId.value === teamId && !benchBoost.value) captainId.value = oldBench;
  await persist();
}
async function setCaptain(teamId: string) {
  if (!editable.value) return;
  if (teamId === benchId.value && !benchBoost.value) return;
  captainId.value = teamId;
  await persist();
}

async function persist(force = false) {
  if (!selectedMw.value || !benchId.value || !captainId.value) return;
  busy.value = true;
  try {
    await api.put(`/api/matchweeks/${selectedMw.value}/lineup`, { benchTeamId: benchId.value, captainTeamId: captainId.value });
    await loadWeek();
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'joker_bench_conflict' && !force) {
      benchConflict.value = true;
      await loadWeek();
    } else {
      toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4000 });
      await loadWeek();
    }
  } finally {
    busy.value = false;
  }
}

function onDragStart(teamId: string) { if (editable.value) dragId.value = teamId; }
function onDropBench() { dragOverBench.value = false; if (dragId.value) setBench(dragId.value); dragId.value = null; }
function onDropPitch(targetTeamId: string) {
  if (dragId.value && dragId.value === benchId.value) setBench(targetTeamId);
  dragId.value = null;
}

async function confirmBenchConflict() {
  benchConflict.value = false;
  await cancelJoker(true);
  await persist(true);
}

async function activateJoker(code: string, payload: Record<string, unknown>) {
  busy.value = true;
  try {
    await api.post(`/api/matchweeks/${selectedMw.value}/jokers`, { code, payload });
    toast.add({ severity: 'success', summary: `${JOKER_NAMES[code]} aktif`, life: 2500 });
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Olmadı', detail: msg(e), life: 4500 });
  } finally {
    busy.value = false;
  }
}
async function cancelJoker(silent = false) {
  busy.value = true;
  try {
    await api.del(`/api/matchweeks/${selectedMw.value}/jokers`);
    if (!silent) { toast.add({ severity: 'success', summary: 'Joker geri alındı', life: 2500 }); await loadWeek(); }
  } catch (e) {
    if (!silent) toast.add({ severity: 'error', summary: 'Geri alınamadı', detail: msg(e), life: 4000 });
  } finally {
    busy.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  try {
    const [status, teams] = await Promise.all([
      api.get<{ matchweeks: Mw[]; currentMatchweekId: string | null }>('/api/tournament/status'),
      api.get<{ pots: Pot[] }>('/api/teams'),
    ]);
    matchweeks.value = status.matchweeks;
    pots.value = teams.pots;
    if (!selectedMw.value) selectedMw.value = status.currentMatchweekId ?? status.matchweeks[0]?.id ?? null;
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Yüklenemedi', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}
async function loadWeek() {
  if (!selectedMw.value) return;
  const id = selectedMw.value;
  const results = await Promise.all([
    api.get<{ lineup: Lineup | null; squad: SquadClub[] }>(`/api/matchweeks/${id}/lineup`),
    api.get<{ score: WeekScore | null; rankMove: RankMove | null }>(`/api/matchweeks/${id}/score`),
    api.get<{ inventory: Inventory[]; active: ActiveJoker | null }>(`/api/matchweeks/${id}/jokers`),
    api.get<{ briefing: BriefingClub[] }>(`/api/matchweeks/${id}/briefing`),
    api.get<{ available: boolean; picks: OpenPick[] }>(`/api/matchweeks/${id}/open-picks`),
    api.get<WeekPredictions>(`/api/matchweeks/${id}/predictions`),
    api.get<WeekDeltas>(`/api/matchweeks/${id}/deltas`),
  ]);
  const [lu, sc, jk, br, op, pr, dl] = results;
  lineup.value = lu.lineup; squad.value = lu.squad; score.value = sc.score;
  rankMove.value = sc.rankMove;
  inventory.value = jk.inventory; activeJoker.value = jk.active;
  briefing.value = br.briefing; openPicks.value = op; predictions.value = pr;
  deltas.value = dl;
  benchId.value = lu.lineup?.benchTeamId ?? null;
  captainId.value = lu.lineup?.captainTeamId ?? null;
}

/**
 * While a match of the selected week is in play the page re-reads itself once a
 * minute — from our own API only, the provider is the sync job's business
 * (§5.6) — so the feed, the coupon and the provisional total keep moving.
 */
function scheduleLivePoll() {
  window.clearInterval(livePoller);
  livePoller = undefined;
  if (!deltas.value?.live) return;
  livePoller = window.setInterval(() => {
    if (!busy.value) void loadWeek();
  }, 60_000);
}

/** Clicking the live pick again takes it back. */
async function pickOutcome(m: PredictionMatch, value: Pick) {
  if (!predictions.value?.editable || busy.value) return;
  const next = m.pick === value ? null : value;
  const previous = m.pick;
  m.pick = next; // optimistic, so the coupon answers the click at once
  busy.value = true;
  try {
    predictions.value = await api.put<WeekPredictions>(
      `/api/matchweeks/${selectedMw.value}/predictions`,
      { matchId: m.matchId, pick: next },
    );
  } catch (e) {
    m.pick = previous;
    toast.add({ severity: 'error', summary: 'Tahmin kaydedilemedi', detail: msg(e), life: 4000 });
  } finally {
    busy.value = false;
  }
}

function pickState(m: PredictionMatch, value: Pick) {
  if (m.pick !== value) return '';
  if (!m.result) return 'on';
  return m.result === value ? 'hit' : 'miss';
}

function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }

onMounted(() => { loadAll(); timer = window.setInterval(() => (now.value = Date.now()), 1000); });
onUnmounted(() => { window.clearInterval(timer); window.clearInterval(livePoller); });
watch(selectedMw, () => { if (!loading.value) loadWeek(); });
watch(() => deltas.value?.live ?? false, scheduleLivePoll);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Bu hafta" subtitle="Kaptanını seç, birini yedeğe çek, joker oyna.">
      <template #actions>
        <Select
          v-model="selectedMw"
          :options="weekGroups"
          option-group-label="label"
          option-group-children="items"
          option-label="label"
          option-value="value"
          style="min-width: 190px"
        >
          <template #value="{ value }">{{ matchweekTitle(matchweeks, value) || 'Hafta seç' }}</template>
        </Select>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />
    <Message v-else-if="!squad.length" severity="warn" :closable="false">
      Önce kadronu kurmalısın. <RouterLink to="/kadro">Kadroya git →</RouterLink>
    </Message>

    <template v-else>
      <Message v-if="isComplete" severity="success" :closable="false">Hafta bitti, puanlar kesinleşti.</Message>
      <Message v-else-if="!currentMw?.opened" severity="secondary" :closable="false">Bu hafta henüz açılmadı.</Message>
      <Message v-else-if="drama" severity="warn" :closable="false">⏰ Kilide son {{ countdown }}!</Message>
      <Message v-else-if="editable && countdown" severity="info" :closable="false">Kilide {{ countdown }} kaldı.</Message>
      <Message v-else-if="!editable" severity="warn" :closable="false">Hafta kilitli.</Message>

      <section class="pitch surface-card">
        <div class="zone-label">Sahada</div>
        <div class="pitch-grid stagger">
          <div
            v-for="club in pitchClubs"
            :key="club.teamId"
            class="club-card"
            :class="{ 'is-captain': club.teamId === captainId, drag: editable }"
            :draggable="editable"
            @dragstart="onDragStart(club.teamId)"
            @dragover.prevent
            @drop="onDropPitch(club.teamId)"
          >
            <RouterLink :to="`/takim/${club.teamId}`" class="crest-link">
              <span class="crest crest-lg">{{ initials(club.name) }}</span>
            </RouterLink>
            <div class="club-name">{{ club.name }}</div>

            <div class="club-foot">
              <CaptainBadge v-if="club.teamId === captainId" :multiplier="capMult" :joker-code="activeJoker?.code" :size="24" />
              <span v-if="lineFor(club.teamId)" class="pts" :class="lineFor(club.teamId)!.contributed >= 0 ? 'text-positive' : 'text-negative'">
                {{ lineFor(club.teamId)!.contributed >= 0 ? '+' : '' }}{{ lineFor(club.teamId)!.contributed }}
              </span>
            </div>

            <div v-if="editable" class="slot-actions">
              <button
                class="slot-btn press"
                :class="{ on: club.teamId === captainId }"
                :aria-pressed="club.teamId === captainId"
                :aria-label="`${club.name} kaptan olsun`"
                title="Kaptan yap"
                @click="setCaptain(club.teamId)"
              >
                <Crown :size="16" aria-hidden="true" />
              </button>
              <button
                v-if="canBench(club)"
                class="slot-btn press"
                :aria-label="`${club.name} yedeğe geçsin`"
                title="Yedeğe al"
                @click="setBench(club.teamId)"
              >
                <Armchair :size="16" aria-hidden="true" />
              </button>
              <button
                v-for="j in jokersFor(club, false)"
                :key="j.code"
                class="slot-btn joker press"
                :class="{ on: j.active }"
                :aria-pressed="j.active"
                :aria-label="j.active ? `${JOKER_NAMES[j.code]} — geri al` : `${JOKER_NAMES[j.code]} — ${club.name}`"
                :title="j.active ? `${JOKER_NAMES[j.code]} — geri al` : JOKER_NAMES[j.code]"
                @click="onJokerClick(j.code, club, j.active)"
              >
                <component :is="JOKER_ICONS[j.code]" :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div class="zone-label bench-label">Yedek</div>
        <div
          class="bench-slot"
          :class="{ over: dragOverBench, boosted: benchBoost }"
          @dragover.prevent="dragOverBench = editable"
          @dragleave="dragOverBench = false"
          @drop="onDropBench"
        >
          <div
            v-if="benchClub"
            class="club-card bench"
            :class="{ 'is-captain': benchClub.teamId === captainId }"
            :draggable="editable"
            @dragstart="onDragStart(benchClub.teamId)"
          >
            <RouterLink :to="`/takim/${benchClub.teamId}`" class="crest-link">
              <span class="crest crest-lg" :class="{ dim: !benchBoost }">{{ initials(benchClub.name) }}</span>
            </RouterLink>
            <div class="club-name">{{ benchClub.name }}</div>
            <div v-if="editable" class="slot-actions">
              <button
                v-if="benchBoost"
                class="slot-btn press"
                :class="{ on: benchClub.teamId === captainId }"
                :aria-pressed="benchClub.teamId === captainId"
                :aria-label="`${benchClub.name} kaptan olsun`"
                title="Kaptan yap"
                @click="setCaptain(benchClub.teamId)"
              >
                <Crown :size="16" aria-hidden="true" />
              </button>
              <button
                v-for="j in jokersFor(benchClub, true)"
                :key="j.code"
                class="slot-btn joker press"
                :class="{ on: j.active }"
                :aria-pressed="j.active"
                :aria-label="j.active ? `${JOKER_NAMES[j.code]} — geri al` : `${JOKER_NAMES[j.code]} — ${benchClub.name}`"
                :title="j.active ? `${JOKER_NAMES[j.code]} — geri al` : JOKER_NAMES[j.code]"
                @click="onJokerClick(j.code, benchClub, j.active)"
              >
                <component :is="JOKER_ICONS[j.code]" :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>
          <span v-else class="text-muted">Buraya bir kulüp sürükle</span>
        </div>
        <p v-if="editable" class="text-muted drag-hint">
          Bir kulübü yedek kutusuna sürüklersen oradakiyle yer değişir.
        </p>
      </section>

      <section v-if="briefing.length" class="surface-card card-pad">
        <div class="section-title">Kulüplerinin haftası</div>
        <div class="brief-grid">
          <div v-for="b in briefing" :key="b.teamId" class="brief-card">
            <div class="brief-head">
              <b>{{ b.name }}</b>
              <Tag v-if="b.difficulty" :severity="difficultySeverity(b.difficulty)" :value="b.difficulty" />
            </div>
            <div v-for="(f, i) in b.fixtures" :key="i" class="brief-fixture text-muted">
              <component :is="f.home ? House : Plane" :size="13" :aria-label="f.home ? 'Evinde' : 'Deplasmanda'" />
              <span>Pot {{ f.opponentTierId }} · {{ f.opponentName }}</span>
            </div>
            <div v-if="!b.fixtures.length" class="text-muted brief-bye">bu hafta maçı yok</div>
          </div>
        </div>
      </section>

      <section v-if="predictions?.matches.length" class="surface-card card-pad">
        <div class="section-title paul-head">
          <span class="paul-name"><OctopusMark :size="20" /> Ahtapot Paul</span>
          <span v-if="predictions.tally.settled" class="paul-tally">
            {{ predictions.tally.correct }}/{{ predictions.tally.settled }}
            <strong class="text-positive">+{{ predictions.tally.points }}</strong>
          </span>
        </div>

        <div class="paul-list">
          <div v-for="m in predictions.matches" :key="m.matchId" class="paul-row">
            <FixtureLine
              class="paul-fixture"
              :team-name="m.homeName"
              :opponent-name="m.awayName"
              :home="true"
              :team-score="m.homeScore"
              :opponent-score="m.awayScore"
            />
            <div class="paul-picks">
              <button
                v-for="opt in PICK_OPTIONS"
                :key="opt.value"
                type="button"
                class="pick-btn press"
                :class="pickState(m, opt.value)"
                :disabled="!predictions.editable"
                :aria-pressed="m.pick === opt.value"
                :aria-label="`${m.homeName} - ${m.awayName}: ${opt.label}`"
                @click="pickOutcome(m, opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="score" class="surface-card card-pad">
        <div class="section-title" style="display: flex; justify-content: space-between; align-items: center">
          <span>{{ isComplete ? 'Hafta kapanışı' : 'Anlık puan' }}
            <JokerIcon v-if="score.jokerCode" :code="score.jokerCode" :size="17" />
          </span>
          <span class="total-side">
            <span
              v-if="isComplete && rankMove"
              class="rank-move"
              :class="moveDir"
              :title="rankMove.prevRank !== null ? `Geçen hafta ${rankMove.prevRank}. sıradaydın` : 'Sezonun ilk haftası'"
            >
              <ArrowUp v-if="moveDir === 'up'" :size="14" aria-hidden="true" />
              <ArrowDown v-else-if="moveDir === 'down'" :size="14" aria-hidden="true" />
              <Minus v-else-if="moveDir === 'same'" :size="14" aria-hidden="true" />
              {{ rankMove.rank }}.
            </span>
            <span class="big-total">{{ score.total }}</span>
          </span>
        </div>
        <table class="lines">
          <tbody>
            <tr v-for="l in score.lines" :key="l.teamId" :class="{ muted: sittingOut(l) }">
              <td>
                <span class="line-club">
                  {{ l.name }}
                  <CaptainBadge v-if="l.captain" :multiplier="l.multiplier" :joker-code="score.jokerCode" :size="20" />
                  <span v-else-if="l.benched" class="role-chip">Yedek</span>
                </span>
                <div v-if="isComplete && !sittingOut(l) && wrapEventsFor(l.teamId).length" class="wrap-chips">
                  <span
                    v-for="(e, i) in wrapEventsFor(l.teamId)"
                    :key="i"
                    class="delta-chip mini"
                    :class="e.points > 0 ? 'up' : e.points < 0 ? 'down' : 'flat'"
                  >
                    {{ signed(e.points) }} {{ e.label.toLocaleLowerCase('tr') }}
                  </span>
                </div>
              </td>
              <td class="line-points">
                <span v-if="sittingOut(l)" title="Yedek — puan yazılmadı">—</span>
                <span v-else-if="byeIds.has(l.teamId) && l.basePoints === 0" class="text-muted">maç yok — 0</span>
                <span v-else>{{ l.basePoints }} → <strong>{{ l.contributed >= 0 ? '+' : '' }}{{ l.contributed }}</strong></span>
              </td>
            </tr>
            <tr v-if="score.predictions.correct" class="paul-line">
              <td>
                <span class="line-club"><OctopusMark :size="16" /> Ahtapot Paul</span>
              </td>
              <td class="line-points">
                {{ score.predictions.correct }} doğru →
                <strong>+{{ score.predictions.points }}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="deltas?.clubs.length && !isComplete" class="surface-card card-pad">
        <div class="section-title delta-head">
          <span>Puan akışı</span>
          <span v-if="deltas.live" class="live-chip"><span class="dot" />canlı</span>
        </div>
        <div class="delta-list">
          <div v-for="c in deltas.clubs" :key="c.teamId" class="delta-row">
            <span class="delta-club">
              {{ c.name }}
              <CaptainBadge v-if="c.captain" :multiplier="capMult" :joker-code="activeJoker?.code" :size="18" />
            </span>
            <span class="delta-events">
              <span
                v-for="(e, i) in c.events"
                :key="i"
                class="delta-chip"
                :class="[e.points > 0 ? 'up' : e.points < 0 ? 'down' : 'flat', { prov: e.provisional, cap: e.ruleCode === 'captain' }]"
                :title="e.provisional ? 'Maç sürüyor, kesinleşmedi' : undefined"
              >
                <span v-if="e.provisional" class="dot" aria-hidden="true" />
                {{ signed(e.points) }} {{ e.label.toLocaleLowerCase('tr') }}
              </span>
            </span>
          </div>
        </div>
      </section>

      <section v-if="openPicks.available" class="surface-card card-pad">
        <div class="section-title">Rakiplerin tercihleri</div>
        <table class="lines">
          <thead><tr><th style="text-align: left">Oyuncu</th><th>Yedek</th><th>Kaptan</th><th>Joker</th></tr></thead>
          <tbody>
            <tr v-for="p in openPicks.picks" :key="p.userId">
              <td style="text-align: left">{{ p.displayName }}</td>
              <td>{{ p.benchName }}</td>
              <td>{{ p.captainName }}</td>
              <td>
                <JokerIcon v-if="p.jokerCode" :code="p.jokerCode" :size="16" />
                <span v-else class="text-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <Dialog v-model:visible="swapDialog" modal :header="`${swapFrom?.name} yerine kim gelsin?`" :style="{ width: '420px' }">
      <p class="text-muted" style="margin: 0 0 0.75rem">Aynı pottan, sadece bu hafta için.</p>
      <div class="swap-list">
        <button v-for="t in swapOptions()" :key="t.id" class="swap-option" @click="chooseSwap(t.id)">
          <span class="crest crest-sm">{{ initials(t.name) }}</span>{{ t.name }}
        </button>
        <p v-if="!swapOptions().length" class="text-muted" style="margin: 0">Bu potta uygun kulüp kalmadı.</p>
      </div>
    </Dialog>

    <Dialog v-model:visible="benchConflict" modal header="Joker çakışması" :style="{ width: '380px' }">
      <p style="margin: 0">Yedeğe aldığın kulüpte kalkan var. Devam edersen joker geri alınır ve hakkın iade edilir.</p>
      <template #footer>
        <Button label="Vazgeç" text @click="benchConflict = false" />
        <Button label="Devam et" severity="danger" @click="confirmBenchConflict" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.pitch {
  padding: 1.4rem;
  background:
    repeating-linear-gradient(90deg, rgba(52, 211, 153, 0.045) 0 60px, transparent 60px 120px),
    radial-gradient(120% 80% at 50% 0%, rgba(11, 122, 59, 0.22), transparent 62%),
    linear-gradient(180deg, var(--color-surface), var(--color-bg-subtle));
}
.zone-label {
  font-weight: 800; font-size: 0.76rem; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 0.9rem;
}
.bench-label { margin-top: 1.6rem; }
.pitch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: var(--space-4); }
.club-card {
  position: relative;
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem 0.75rem 0.8rem;
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  transition: transform 0.16s ease, border-color 0.16s, box-shadow 0.16s;
}
.club-card:hover { transform: translateY(-3px); border-color: var(--color-border-strong); box-shadow: var(--shadow-md); }
.club-card.drag { cursor: grab; }
.club-card.drag:active { cursor: grabbing; }
.club-card.is-captain { border-color: var(--color-warning); box-shadow: 0 0 0 1px var(--color-warning), 0 0 22px rgba(251, 191, 36, 0.18); }
.crest-link { text-decoration: none; }
.crest-lg { width: 58px; height: 58px; font-size: 0.8rem; }
.crest-sm { width: 30px; height: 30px; font-size: 0.7rem; }
.crest.dim { filter: grayscale(0.7); opacity: 0.75; }
.club-name { font-size: 0.88rem; font-weight: 700; text-align: center; line-height: 1.25; }
.club-foot { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; min-height: 1.2rem; }
.pts { font-weight: 800; font-size: 0.92rem; }
.slot-actions { display: flex; gap: 0.35rem; margin-top: 0.2rem; flex-wrap: wrap; justify-content: center; }
.slot-btn {
  width: 34px; height: 34px; display: grid; place-items: center;
  border-radius: 50%; border: 1.5px solid var(--color-border-control);
  background: var(--color-bg-subtle); color: var(--color-text-secondary);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.slot-btn:hover { transform: translateY(-2px); color: var(--color-text); border-color: var(--color-primary); }
/* Fingers need more than a mouse does. */
@media (pointer: coarse) {
  .slot-btn { width: 44px; height: 44px; }
}
.slot-btn.on {
  background: linear-gradient(135deg, var(--color-warning), #f59e0b);
  border-color: var(--color-warning); color: #17130a;
  box-shadow: 0 0 16px rgba(251, 191, 36, 0.4);
}
.slot-btn.joker.on {
  background: linear-gradient(135deg, var(--color-primary-strong), var(--color-accent));
  border-color: var(--color-primary); color: #fff;
  box-shadow: 0 0 16px rgba(99, 102, 241, 0.5);
}
.bench-slot {
  border: 2px dashed var(--color-border-strong); border-radius: var(--radius-md);
  padding: 1rem; display: grid; place-items: center; min-height: 150px;
  transition: border-color 0.15s, background 0.15s;
}
.bench-slot.over { border-color: var(--color-primary); background: rgba(99, 102, 241, 0.1); }
.bench-slot.boosted { border-style: solid; border-color: var(--color-warning); }
.bench-slot .club-card { min-width: 180px; }
.drag-hint { margin: 0.7rem 0 0; font-size: 0.8rem; }
.brief-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-3); }
.brief-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.brief-bye { font-size: var(--text-xs); }
.brief-fixture { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; }
.brief-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
.total-side { display: inline-flex; align-items: center; gap: 0.7rem; }
.rank-move {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.2rem 0.6rem; border-radius: var(--radius-pill);
  font-size: var(--text-sm); font-weight: 800;
  background: var(--color-surface-2); color: var(--color-text-secondary);
}
.rank-move.up { background: var(--color-success-soft); color: var(--color-success); }
.rank-move.down { background: var(--color-danger-soft); color: var(--color-danger); }
.rank-move.new { background: var(--color-primary-soft); color: var(--color-text); }
.big-total { font-size: var(--text-2xl); font-weight: 800; color: var(--color-primary); }
.lines { width: 100%; border-collapse: collapse; }
.lines th { font-size: var(--text-2xs); color: var(--color-text-muted); padding: 0.3rem; font-weight: 700; }
/* Min height, so a row carrying a badge is no shorter than one without; a
   completed week's rule chips may still grow their row. */
.lines td { height: 2.9rem; padding: 0.35rem; border-bottom: 1px solid var(--color-border); font-size: var(--text-sm); }
.wrap-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.35rem; }
.delta-chip.mini { padding: 0.08rem 0.45rem; font-size: var(--text-2xs); }
.line-club { display: inline-flex; align-items: center; gap: 0.5rem; }
.line-points { text-align: right; white-space: nowrap; }
.paul-line td { color: var(--color-text-secondary); }

.delta-head { display: flex; align-items: center; gap: 0.65rem; }
.live-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.12rem 0.55rem; border-radius: var(--radius-pill);
  background: var(--color-danger-soft); color: var(--color-danger);
  font-size: var(--text-2xs); font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
}
.live-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse-soft 1.4s ease-in-out infinite; }
.delta-list { display: flex; flex-direction: column; }
.delta-row {
  display: flex; align-items: baseline; gap: var(--space-4);
  padding: 0.55rem 0; border-bottom: 1px solid var(--color-border); flex-wrap: wrap;
}
.delta-row:last-child { border-bottom: none; }
.delta-club { display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 700; font-size: var(--text-sm); min-width: 10rem; }
.delta-events { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.delta-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.18rem 0.6rem; border-radius: var(--radius-pill);
  border: 1px solid var(--color-border); background: var(--color-surface-2);
  font-size: var(--text-xs); font-weight: 700; white-space: nowrap;
  font-variant-numeric: tabular-nums; color: var(--color-text-secondary);
}
.delta-chip.up { color: var(--color-success); border-color: transparent; background: var(--color-success-soft); }
.delta-chip.down { color: var(--color-danger); border-color: transparent; background: var(--color-danger-soft); }
.delta-chip.cap { color: var(--color-warning); background: rgba(251, 191, 36, 0.12); border-color: transparent; }
/* Still moving: a live match feeds this line. */
.delta-chip.prov { border: 1.5px dashed var(--color-border-strong); }
.delta-chip.prov .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: pulse-soft 1.4s ease-in-out infinite; }

.paul-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.paul-name { display: inline-flex; align-items: center; gap: 0.5rem; }
.paul-tally { font-size: var(--text-sm); font-weight: 700; color: var(--color-text-muted); }
.paul-list { display: flex; flex-direction: column; }
.paul-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-4);
  padding: 0.6rem 0; border-bottom: 1px solid var(--color-border); flex-wrap: wrap;
}
.paul-row:last-child { border-bottom: none; }
.paul-fixture { font-size: var(--text-sm); }
.paul-picks { display: flex; gap: 0.4rem; margin-left: auto; }
.pick-btn {
  min-width: 52px; height: 34px; padding: 0 0.6rem;
  border-radius: var(--radius-pill); border: 1.5px solid var(--color-border-control);
  background: var(--color-bg-subtle); color: var(--color-text-secondary);
  font: inherit; font-size: var(--text-xs); font-weight: 700; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.pick-btn:hover:not(:disabled) { color: var(--color-text); border-color: var(--color-primary); }
.pick-btn:disabled { cursor: default; }
.pick-btn.on { background: var(--color-primary-soft); border-color: var(--color-primary); color: #fff; }
.pick-btn.hit { background: var(--color-success-soft); border-color: var(--color-success); color: var(--color-success); }
.pick-btn.miss { background: var(--color-danger-soft); border-color: var(--color-danger); color: var(--color-danger); }
@media (pointer: coarse) {
  .pick-btn { height: 44px; min-width: 60px; }
}
.lines tr:last-child td { border-bottom: none; }
.lines tr.muted td { color: var(--color-text-muted); }
.swap-list { display: flex; flex-direction: column; gap: 0.45rem; max-height: 320px; overflow-y: auto; }
.swap-option {
  display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-surface-2); color: var(--color-text);
  font: inherit; font-weight: 600; text-align: left; cursor: pointer;
}
.swap-option:hover { border-color: var(--color-primary); background: var(--color-primary-soft); }
</style>
