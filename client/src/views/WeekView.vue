<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { Crown, Armchair, House, Plane, ArrowUp, ArrowDown, Minus } from '@lucide/vue';
import { api, ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import JokerIcon from '@/components/JokerIcon.vue';
import CaptainBadge from '@/components/CaptainBadge.vue';
import FixtureLine from '@/components/FixtureLine.vue';
import OctopusMark from '@/components/OctopusMark.vue';
import TeamCrest from '@/components/TeamCrest.vue';
import { JOKER_CODES, JOKER_ICONS, jokerName } from '@/lib/jokers';
import { PICK_VALUES, pickLabel, type Pick } from '@/lib/predictions';
import { groupMatchweeks, matchweekTitle, type MatchweekMenu } from '@/lib/matchweeks';
import { usePointerDrag } from '@/composables/usePointerDrag';
import { lower, ordinal } from '@/lib/format';

interface Mw { id: string; label: string; status: string; editable: boolean; opened: boolean; locked: boolean; menu: MatchweekMenu }
interface SquadClub {
  teamId: string; tierId: number; name: string; shortName: string;
  crestUrl: string | null; eliminated: boolean;
}
interface Lineup { benchTeamId: string; captainTeamId: string; saved: boolean; lockAt: string | null; locked: boolean; opened: boolean; editable: boolean }
interface ScoreLine { teamId: string; name: string; basePoints: number; benched: boolean; captain: boolean; multiplier: number; contributed: number }
interface PredictionTally { settled: number; correct: number; points: number; provisional: number }
interface WeekScore { total: number; final: boolean; lines: ScoreLine[]; jokerCode: string | null; predictions: PredictionTally }
interface Inventory { code: string; name: string; remaining: number; playedWeeks: string[] }
interface ActiveJoker { code: string; payload: Record<string, unknown> }
interface ClubFixture { opponentName: string; opponentTierId: number; home: boolean }
interface ClubWeek { teamId: string; fixtures: ClubFixture[]; difficulty: string | null }
interface BriefingClub extends ClubWeek { name: string }
interface OpenPick { userId: string; displayName: string; benchName: string; captainName: string; jokerCode: string | null; jokerDetail: string | null }
interface Pot {
  tierId: number;
  teams: { id: string; name: string; crestUrl: string | null; eliminated: boolean; isActive: boolean }[];
}
interface PredictionMatch {
  matchId: string; homeName: string; awayName: string; kickoffAt: string | null; status: string;
  homeScore: number | null; awayScore: number | null; pick: Pick | null; result: Pick | null;
}
interface WeekPredictions {
  matches: PredictionMatch[]; editable: boolean; lockAt: string | null;
  pointsPerCorrect: number; tally: PredictionTally;
}
interface DeltaEvent { ruleCode: string; label: string; points: number; provisional: boolean }
interface ClubDeltas { teamId: string; name: string; shortName: string; captain: boolean; events: DeltaEvent[] }
interface WeekDeltas { matchweekId: string; live: boolean; clubs: ClubDeltas[] }
interface RankMove { rank: number; prevRank: number | null }

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();

const matchweeks = ref<Mw[]>([]);
const entryMatchweekId = ref<string | null>(null);
const selectedMw = ref<string | null>(null);
const squad = ref<SquadClub[]>([]);
const lineup = ref<Lineup | null>(null);
const score = ref<WeekScore | null>(null);
const inventory = ref<Inventory[]>([]);
const activeJoker = ref<ActiveJoker | null>(null);
const briefing = ref<BriefingClub[]>([]);
/** Every club's fixtures this week, so the swap picker can show what it is buying. */
const clubWeeks = ref<Map<string, ClubWeek>>(new Map());
const openPicks = ref<{ available: boolean; picks: OpenPick[] }>({ available: false, picks: [] });
const pots = ref<Pot[]>([]);
const predictions = ref<WeekPredictions | null>(null);
/** The coupon as it is being filled in, before the save button sends it. */
const draft = ref(new Map<string, Pick | null>());
/** Which week the draft belongs to, so switching weeks starts a clean coupon. */
const draftMw = ref<string | null>(null);
/** Where the player was heading when an unsaved coupon stopped them. */
const leaveTo = ref<{ week: string } | { path: string } | null>(null);
const deltas = ref<WeekDeltas | null>(null);
const rankMove = ref<RankMove | null>(null);
const loading = ref(true);
const busy = ref(false);
const now = ref(Date.now());
let timer: number | undefined;
let livePoller: number | undefined;

const benchId = ref<string | null>(null);
const captainId = ref<string | null>(null);

const swapDialog = ref(false);
const swapFrom = ref<SquadClub | null>(null);
const benchConflict = ref(false);
// The lineup the user was trying to save when the shield got in the way;
// re-applied after they confirm, since the view resets to the stored state.
const pendingLineup = ref<{ bench: string; captain: string } | null>(null);


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

// A player who built their squad late sat this week out, so there is nothing to
// show for it: no lineup was ever theirs and no points were ever scored.
const entryIndex = computed(() =>
  entryMatchweekId.value ? matchweeks.value.findIndex((m) => m.id === entryMatchweekId.value) : -1,
);
const beforeEntry = computed(() => {
  if (entryIndex.value < 0) return false;
  const here = matchweeks.value.findIndex((m) => m.id === selectedMw.value);
  return here >= 0 && here < entryIndex.value;
});
const entryWeekLabel = computed(() => matchweeks.value[entryIndex.value]?.label ?? '');
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
  return d > 0 ? t('common.countdownFull', { d, h, m }) : t('common.countdownShort', { h, m, s });
});
const drama = computed(() => countdownMs.value !== null && countdownMs.value > 0 && countdownMs.value < 7200_000);

function signed(n: number) { return n > 0 ? `+${n}` : `${n}`; }
function difficultySeverity(d: string | null) { return d === 'hard' ? 'danger' : d === 'medium' ? 'warn' : 'success'; }
/** The week a club is walking into: who it meets, where, and how hard (§18.1). */
function weekOf(teamId: string): ClubWeek | null { return clubWeeks.value.get(teamId) ?? null; }
function lineFor(teamId: string) { return score.value?.lines.find((l) => l.teamId === teamId); }
/** Benched and not boosted: the club played, but none of it counted. */
function sittingOut(l: ScoreLine) { return l.benched && score.value?.jokerCode !== 'bench_boost'; }
function remaining(code: string) { return inventory.value.find((i) => i.code === code)?.remaining ?? 0; }
function playedWeeks(code: string) { return inventory.value.find((i) => i.code === code)?.playedWeeks ?? []; }
/** Where a joker went, in words. A bare count says nothing about the season. */
function jokerHistory(code: string): string {
  const weeks = playedWeeks(code);
  // The labels already carry the word "hafta", so the sentence around them
  // names no week of its own. Turkish cannot agree a suffix with "Final" and
  // "Hafta 7" in the same phrase anyway.
  return weeks.length === 0
    ? t('week.walletNever')
    : t('week.walletPlayed', { weeks: weeks.join(', ') });
}
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

// A club swapped in for this week came to play. It cannot be benched.
function canBench(club: SquadClub) {
  return editable.value && club.teamId !== swappedInId.value;
}

async function setBench(teamId: string) {
  if (!editable.value || teamId === benchId.value) return;
  const club = squad.value.find((c) => c.teamId === teamId);
  if (club && !canBench(club)) {
    toast.add({ severity: 'warn', summary: t('week.swapCannotBench'), life: 3000 });
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
      pendingLineup.value = { bench: benchId.value!, captain: captainId.value! };
      benchConflict.value = true;
      await loadWeek();
    } else {
      toast.add({ severity: 'error', summary: t('common.saveFailed'), detail: msg(e), life: 4000 });
      await loadWeek();
    }
  } finally {
    busy.value = false;
  }
}

/**
 * Moving a club is a drag with a mouse and a press-and-drag with a finger.
 * Dropping on the bench box benches that club; dragging the benched club onto
 * one on the pitch swaps the two.
 */
const { dragId, overZone, press: startDrag } = usePointerDrag({
  enabled: () => editable.value,
  onDrop: (teamId, zone) => {
    if (zone === 'bench') { void setBench(teamId); return; }
    if (teamId === benchId.value) void setBench(zone);
  },
});
const dragOverBench = computed(() => overZone.value === 'bench' && dragId.value !== null);
/** The pitch club the benched one would change places with if dropped now. */
const dropTarget = computed(() => (dragId.value === benchId.value ? overZone.value : null));

async function confirmBenchConflict() {
  benchConflict.value = false;
  const pending = pendingLineup.value;
  pendingLineup.value = null;
  await cancelJoker(true);
  // loadWeek reset the roles while the dialog was open; put the intended
  // lineup back before saving, or the confirm would save the old one.
  if (pending) {
    benchId.value = pending.bench;
    captainId.value = pending.captain;
  }
  await persist(true);
}

async function activateJoker(code: string, payload: Record<string, unknown>) {
  busy.value = true;
  try {
    await api.post(`/api/matchweeks/${selectedMw.value}/jokers`, { code, payload });
    toast.add({ severity: 'success', summary: t('week.jokerLive', { joker: jokerName(code) }), life: 2500 });
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('week.jokerFailed'), detail: msg(e), life: 4500 });
  } finally {
    busy.value = false;
  }
}
async function cancelJoker(silent = false) {
  busy.value = true;
  try {
    await api.del(`/api/matchweeks/${selectedMw.value}/jokers`);
    if (!silent) { toast.add({ severity: 'success', summary: t('week.jokerReturned'), life: 2500 }); await loadWeek(); }
  } catch (e) {
    if (!silent) toast.add({ severity: 'error', summary: t('week.undoFailed'), detail: msg(e), life: 4000 });
  } finally {
    busy.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  try {
    const [status, teams] = await Promise.all([
      api.get<{ matchweeks: Mw[]; currentMatchweekId: string | null; entryMatchweekId: string | null }>(
        '/api/tournament/status',
      ),
      api.get<{ pots: Pot[] }>('/api/teams'),
    ]);
    matchweeks.value = status.matchweeks;
    entryMatchweekId.value = status.entryMatchweekId;
    pots.value = teams.pots;
    if (!selectedMw.value) selectedMw.value = status.currentMatchweekId ?? status.matchweeks[0]?.id ?? null;
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.loadFailed'), detail: msg(e), life: 4000 });
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
    api.get<{ briefing: BriefingClub[]; clubs: ClubWeek[] }>(`/api/matchweeks/${id}/briefing`),
    api.get<{ available: boolean; picks: OpenPick[] }>(`/api/matchweeks/${id}/open-picks`),
    api.get<WeekPredictions>(`/api/matchweeks/${id}/predictions`),
    api.get<WeekDeltas>(`/api/matchweeks/${id}/deltas`),
  ]);
  const [lu, sc, jk, br, op, pr, dl] = results;
  // A live week re-reads itself once a minute; that must not wipe a coupon the
  // player is still filling in.
  const keepDraft = draftMw.value === id && couponDirty.value;
  lineup.value = lu.lineup; squad.value = lu.squad; score.value = sc.score;
  rankMove.value = sc.rankMove;
  inventory.value = jk.inventory; activeJoker.value = jk.active;
  briefing.value = br.briefing;
  clubWeeks.value = new Map(br.clubs.map((c) => [c.teamId, c])); openPicks.value = op; predictions.value = pr;
  if (!keepDraft) seedDraft(id, pr);
  deltas.value = dl;
  benchId.value = lu.lineup?.benchTeamId ?? null;
  captainId.value = lu.lineup?.captainTeamId ?? null;
}

/**
 * While a match of the selected week is in play the page re-reads itself once a
 * minute so the feed, the coupon and the provisional total keep moving. It
 * reads our own API and nothing else. Talking to the provider is the sync job's
 * job (§5.6).
 */
function scheduleLivePoll() {
  window.clearInterval(livePoller);
  livePoller = undefined;
  if (!deltas.value?.live) return;
  livePoller = window.setInterval(() => {
    if (!busy.value) void loadWeek();
  }, 60_000);
}

/** Fill the coupon from what is stored, dropping anything unsaved. */
function seedDraft(mwId: string, pr: WeekPredictions) {
  draftMw.value = mwId;
  draft.value = new Map(pr.matches.map((m) => [m.matchId, m.pick]));
}

/** The call standing on this match right now, saved or not. */
function draftPick(m: PredictionMatch): Pick | null {
  const held = draft.value.get(m.matchId);
  return held === undefined ? m.pick : held;
}

/** Nothing travels on a click. Pressing the standing call again takes it back. */
function togglePick(m: PredictionMatch, value: Pick) {
  // Locked out mid-save too: the reply reseeds the coupon and would eat the tap.
  if (!predictions.value?.editable || busy.value) return;
  draft.value.set(m.matchId, draftPick(m) === value ? null : value);
}

/** The calls the coupon would write, the ones taken back included. */
const couponChanges = computed(() =>
  (predictions.value?.matches ?? [])
    .filter((m) => draftPick(m) !== m.pick)
    .map((m) => ({ matchId: m.matchId, pick: draftPick(m) })),
);
const couponDirty = computed(() => couponChanges.value.length > 0);
/** How much of the coupon is filled in. A blank match is a match left uncalled. */
const couponCalled = computed(
  () => (predictions.value?.matches ?? []).filter((m) => draftPick(m) !== null).length,
);
/** Something to save, a week still open to save it in, and no request in flight. */
const canSaveCoupon = computed(
  () => (predictions.value?.editable ?? false) && couponDirty.value && !busy.value,
);

async function saveCoupon() {
  const id = selectedMw.value;
  if (!id || !canSaveCoupon.value) return;
  const picks = couponChanges.value;
  busy.value = true;
  try {
    const saved = await api.put<WeekPredictions>(`/api/matchweeks/${id}/predictions`, { picks });
    predictions.value = saved;
    seedDraft(id, saved);
    toast.add({ severity: 'success', summary: t('week.couponSaved'), life: 2500 });
  } catch (e) {
    toast.add({ severity: 'error', summary: t('week.couponFailed'), detail: msg(e), life: 4000 });
  } finally {
    busy.value = false;
  }
}

/**
 * Nothing on the coupon is written until the save button, so leaving with an
 * unsent call would quietly throw it away. Both ways out of the page ask first:
 * changing the week in the picker, and navigating off it.
 */
function chooseWeek(next: string) {
  if (next === selectedMw.value) return;
  if (couponDirty.value) {
    leaveTo.value = { week: next };
    return;
  }
  selectedMw.value = next;
}

onBeforeRouteLeave((to) => {
  if (!couponDirty.value) return true;
  leaveTo.value = { path: to.fullPath };
  return false;
});

/**
 * Closing the tab or reloading is the browser's own dialog, and its wording is
 * the browser's too: a page has not been able to supply that text since 2016,
 * when scam sites made it worth taking away. All we decide is whether it opens.
 * Safari and older Chrome still gate that on `returnValue` rather than
 * `preventDefault`, so both are set.
 */
function warnOnUnload(e: BeforeUnloadEvent) {
  if (!couponDirty.value) return;
  e.preventDefault();
  e.returnValue = '';
}

/** Go where they were headed, coupon and all. */
function leaveAnyway() {
  const target = leaveTo.value;
  leaveTo.value = null;
  if (!target) return;
  if ('week' in target) {
    // Drop the unsent calls first, or the re-read would carry them over.
    const current = selectedMw.value;
    if (current && predictions.value) seedDraft(current, predictions.value);
    selectedMw.value = target.week;
  } else {
    draft.value = new Map();
    draftMw.value = null;
    router.push(target.path);
  }
}

async function saveAndLeave() {
  await saveCoupon();
  if (!couponDirty.value) leaveAnyway();
}

function pickState(m: PredictionMatch, value: Pick) {
  const held = draftPick(m);
  if (held !== value) return '';
  if (m.result) return m.result === value ? 'hit' : 'miss';
  // Marked until it is sent, so a call still on the page cannot pass for a saved one.
  return held === m.pick ? 'on' : 'on unsaved';
}

function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : t('common.unexpectedError'); }

onMounted(() => {
  loadAll();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
  window.addEventListener('beforeunload', warnOnUnload);
});
onUnmounted(() => {
  window.clearInterval(timer);
  window.clearInterval(livePoller);
  window.removeEventListener('beforeunload', warnOnUnload);
});
watch(selectedMw, () => { if (!loading.value) loadWeek(); });
watch(() => deltas.value?.live ?? false, scheduleLivePoll);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('week.title')" :subtitle="$t('week.subtitle')">
      <template #actions>
        <Select
          :model-value="selectedMw"
          :options="weekGroups"
          option-group-label="label"
          option-group-children="items"
          option-label="label"
          option-value="value"
        class="select-filter"
          @update:model-value="chooseWeek"
        >
          <template #value="{ value }">{{ matchweekTitle(matchweeks, value) || $t('week.pickWeek') }}</template>
        </Select>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />
    <Message v-else-if="!squad.length" severity="warn" :closable="false">
      {{ $t('week.noSquad') }} <RouterLink to="/kadro">{{ $t('week.goToSquad') }}</RouterLink>
    </Message>
    <Message v-else-if="beforeEntry" severity="secondary" :closable="false">
      {{ $t('week.beforeEntry', { week: entryWeekLabel }) }}
    </Message>

    <template v-else>
      <Message v-if="isComplete" severity="success" :closable="false">{{ $t('week.complete') }}</Message>
      <Message v-else-if="!currentMw?.opened" severity="secondary" :closable="false">
        {{ $t('week.notOpen') }}
      </Message>
      <Message v-else-if="drama" severity="warn" :closable="false">
        {{ $t('week.drama', { countdown }) }}
      </Message>
      <Message v-else-if="editable && countdown" severity="info" :closable="false">
        {{ $t('week.untilLock', { countdown }) }}
      </Message>
      <Message v-else-if="!editable" severity="warn" :closable="false">{{ $t('week.locked') }}</Message>

      <section class="pitch surface-card">
        <div class="zone-label">{{ $t('week.onPitch') }}</div>
        <div class="pitch-grid stagger">
          <div
            v-for="club in pitchClubs"
            :key="club.teamId"
            class="club-card"
            :class="{
              'is-captain': club.teamId === captainId,
              drag: editable,
              lifted: dragId === club.teamId,
              over: dropTarget === club.teamId,
            }"
            :data-drop-zone="club.teamId"
            @pointerdown="startDrag($event, club.teamId)"
          >
            <RouterLink :to="`/takim/${club.teamId}`" class="crest-link" draggable="false">
              <TeamCrest :name="club.name" :crest-url="club.crestUrl" size="lg" />
            </RouterLink>
            <div class="club-title">
              <span class="club-name">{{ club.name }}</span>
              <CaptainBadge
                v-if="club.teamId === captainId"
                :multiplier="capMult"
                :joker-code="activeJoker?.code"
                :size="19"
              />
            </div>

            <div v-if="weekOf(club.teamId)" class="club-week">
              <span
                v-for="(f, i) in weekOf(club.teamId)!.fixtures"
                :key="i"
                class="club-fixture"
              >
                <span class="club-opp-line">
                  <component
                    :is="f.home ? House : Plane"
                    :size="12"
                    :aria-label="f.home ? $t('week.atHome') : $t('week.away')"
                  />
                  <span class="club-opp">{{ f.opponentName }}</span>
                </span>
                <span
                  v-if="i === 0 && weekOf(club.teamId)!.difficulty"
                  class="club-diff"
                  :class="weekOf(club.teamId)!.difficulty!"
                >{{ $t(`difficulty.${weekOf(club.teamId)!.difficulty}`) }}</span>
              </span>
              <span v-if="!weekOf(club.teamId)!.fixtures.length" class="club-bye">
                {{ $t('week.noFixture') }}
              </span>
            </div>

            <div class="club-foot">
              <span v-if="lineFor(club.teamId)" class="pts" :class="lineFor(club.teamId)!.contributed >= 0 ? 'text-positive' : 'text-negative'">
                {{ lineFor(club.teamId)!.contributed >= 0 ? '+' : '' }}{{ lineFor(club.teamId)!.contributed }}
              </span>
            </div>

            <div v-if="editable" class="slot-actions">
              <button
                class="slot-btn press"
                :class="{ on: club.teamId === captainId }"
                :aria-pressed="club.teamId === captainId"
                :aria-label="$t('week.makeCaptainAria', { club: club.name })"
                :title="$t('week.makeCaptain')"
                @click="setCaptain(club.teamId)"
              >
                <Crown :size="16" aria-hidden="true" />
              </button>
              <button
                v-if="canBench(club)"
                class="slot-btn press"
                :aria-label="$t('week.benchAria', { club: club.name })"
                :title="$t('week.benchAction')"
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
                :aria-label="
                  j.active
                    ? $t('week.undoJokerAria', { joker: $t(`joker.${j.code}`) })
                    : $t('week.playJokerAria', { joker: $t(`joker.${j.code}`), club: club.name })
                "
                :title="j.active ? $t('week.undo') : $t(`joker.${j.code}`)"
                @click="onJokerClick(j.code, club, j.active)"
              >
                <component :is="JOKER_ICONS[j.code]" :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div class="pitch-foot">
          <div class="bench-zone">
            <div class="zone-label bench-label">{{ $t('week.bench') }}</div>
            <div
              class="bench-slot"
          :class="{ over: dragOverBench, boosted: benchBoost }"
          data-drop-zone="bench"
        >
          <div
            v-if="benchClub"
            class="club-card bench"
            :class="{
              'is-captain': benchClub.teamId === captainId,
              drag: editable,
              lifted: dragId === benchClub.teamId,
            }"
            @pointerdown="startDrag($event, benchClub.teamId)"
          >
            <RouterLink :to="`/takim/${benchClub.teamId}`" class="crest-link" draggable="false">
              <TeamCrest
                :name="benchClub.name"
                :crest-url="benchClub.crestUrl"
                size="lg"
                :class="{ dim: !benchBoost }"
              />
            </RouterLink>
            <div class="club-title">
              <span class="club-name">{{ benchClub.name }}</span>
              <CaptainBadge
                v-if="benchClub.teamId === captainId"
                :multiplier="capMult"
                :joker-code="activeJoker?.code"
                :size="19"
              />
            </div>
            <div v-if="weekOf(benchClub.teamId)" class="club-week">
              <span
                v-for="(f, i) in weekOf(benchClub.teamId)!.fixtures"
                :key="i"
                class="club-fixture"
              >
                <span class="club-opp-line">
                  <component
                    :is="f.home ? House : Plane"
                    :size="12"
                    :aria-label="f.home ? $t('week.atHome') : $t('week.away')"
                  />
                  <span class="club-opp">{{ f.opponentName }}</span>
                </span>
                <span
                  v-if="i === 0 && weekOf(benchClub.teamId)!.difficulty"
                  class="club-diff"
                  :class="weekOf(benchClub.teamId)!.difficulty!"
                >{{ $t(`difficulty.${weekOf(benchClub.teamId)!.difficulty}`) }}</span>
              </span>
              <span v-if="!weekOf(benchClub.teamId)!.fixtures.length" class="club-bye">
                {{ $t('week.noFixture') }}
              </span>
            </div>

            <div v-if="editable" class="slot-actions">
              <button
                v-if="benchBoost"
                class="slot-btn press"
                :class="{ on: benchClub.teamId === captainId }"
                :aria-pressed="benchClub.teamId === captainId"
                :aria-label="$t('week.makeCaptainAria', { club: benchClub.name })"
                :title="$t('week.makeCaptain')"
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
                :aria-label="
                  j.active
                    ? $t('week.undoJokerAria', { joker: $t(`joker.${j.code}`) })
                    : $t('week.playJokerAria', { joker: $t(`joker.${j.code}`), club: benchClub.name })
                "
                :title="j.active ? $t('week.undo') : $t(`joker.${j.code}`)"
                @click="onJokerClick(j.code, benchClub, j.active)"
              >
                <component :is="JOKER_ICONS[j.code]" :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>
                  <span v-else class="text-muted bench-empty">{{ $t('week.dropHere') }}</span>
            </div>
          </div>

          <div class="joker-legend">
            <div class="zone-label">{{ $t('week.walletTitle') }}</div>
            <ul class="legend-list">
              <li
                v-for="code in JOKER_CODES"
                :key="code"
                class="legend-item"
                :class="{ live: activeJoker?.code === code, spent: remaining(code) === 0 && activeJoker?.code !== code }"
              >
                <span class="legend-mark"><component :is="JOKER_ICONS[code]" :size="17" aria-hidden="true" /></span>
                <span class="legend-text">
                  <span class="legend-name">{{ $t(`joker.${code}`) }}</span>
                  <span class="legend-history">{{ jokerHistory(code) }}</span>
                  <span class="legend-left">
                    {{
                      activeJoker?.code === code
                        ? $t('week.walletLive')
                        : $t('week.walletLeft', { count: remaining(code) }, remaining(code))
                    }}
                  </span>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <p v-if="editable" class="text-muted drag-hint">
          <span class="hint-fine">{{ $t('week.dragHintFine') }}</span>
          <span class="hint-coarse">{{ $t('week.dragHintCoarse') }}</span>
        </p>
      </section>

      <section v-if="predictions?.matches.length" class="surface-card card-pad">
        <div class="section-title paul-head">
          <span class="paul-name"><OctopusMark :size="20" /> {{ $t('paul.name') }}</span>
          <span v-if="predictions.tally.settled" class="paul-tally">
            {{ predictions.tally.correct }}/{{ predictions.tally.settled }}
            <strong class="text-positive">+{{ predictions.tally.points }}</strong>
            <span
              v-if="predictions.tally.provisional"
              class="live-chip"
              :title="$t('week.tallyLiveHint', { count: predictions.tally.provisional })"
            ><span class="dot" />{{ $t('common.live') }}</span>
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
                v-for="opt in PICK_VALUES"
                :key="opt"
                type="button"
                class="pick-btn press"
                :class="pickState(m, opt)"
                :disabled="!predictions.editable || busy"
                :aria-pressed="draftPick(m) === opt"
                :aria-label="`${m.homeName} - ${m.awayName}: ${pickLabel(opt)}`"
                @click="togglePick(m, opt)"
              >
                {{ pickLabel(opt) }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="predictions.editable" class="paul-actions">
          <span class="paul-count">
            {{ $t('week.couponCalled', { called: couponCalled, total: predictions.matches.length }) }}
          </span>
          <Button
            :label="$t('week.couponSave')"
            :disabled="!canSaveCoupon"
            :loading="busy"
            @click="saveCoupon"
          />
        </div>
      </section>

      <section v-if="score" class="surface-card card-pad">
        <div class="section-title section-title-row">
          <span>{{ isComplete ? $t('week.wrapTitle') : $t('week.liveTitle') }}
            <JokerIcon v-if="score.jokerCode" :code="score.jokerCode" :size="17" />
          </span>
          <span class="total-side">
            <span
              v-if="isComplete && rankMove"
              class="rank-move"
              :class="moveDir"
              :title="
                rankMove.prevRank !== null
                  ? $t('week.wasRanked', { rank: ordinal(rankMove.prevRank) })
                  : $t('week.firstWeek')
              "
            >
              <ArrowUp v-if="moveDir === 'up'" :size="14" aria-hidden="true" />
              <ArrowDown v-else-if="moveDir === 'down'" :size="14" aria-hidden="true" />
              <Minus v-else-if="moveDir === 'same'" :size="14" aria-hidden="true" />
              {{ ordinal(rankMove.rank) }}
            </span>
            <span class="big-total">{{ score.total }}</span>
          </span>
        </div>
        <div class="table-scroll">
          <table class="lines">
            <tbody>
              <tr v-for="l in score.lines" :key="l.teamId" :class="{ muted: sittingOut(l) }">
                <td>
                  <span class="line-club">
                    {{ l.name }}
                    <CaptainBadge v-if="l.captain" :multiplier="l.multiplier" :joker-code="score.jokerCode" :size="20" />
                    <span v-else-if="l.benched" class="role-chip">{{ $t('week.bench') }}</span>
                  </span>
                  <div v-if="isComplete && !sittingOut(l) && wrapEventsFor(l.teamId).length" class="wrap-chips">
                    <span
                      v-for="(e, i) in wrapEventsFor(l.teamId)"
                      :key="i"
                      class="delta-chip mini"
                      :class="e.points > 0 ? 'up' : e.points < 0 ? 'down' : 'flat'"
                    >
                      {{ signed(e.points) }} {{ lower(e.label) }}
                    </span>
                  </div>
                </td>
                <td class="line-points">
                  <span v-if="sittingOut(l)" :title="$t('week.benchedHint')">{{ $t('common.none') }}</span>
                  <span v-else-if="byeIds.has(l.teamId) && l.basePoints === 0" class="text-muted">
                    {{ $t('week.hadNoFixture') }}
                  </span>
                  <span v-else>{{ l.basePoints }} → <strong>{{ l.contributed >= 0 ? '+' : '' }}{{ l.contributed }}</strong></span>
                </td>
              </tr>
              <tr v-if="score.predictions.correct" class="paul-line">
                <td>
                  <span class="line-club"><OctopusMark :size="16" /> {{ $t('paul.name') }}</span>
                </td>
                <td class="line-points">
                  {{ $t('paul.correctCount', { correct: score.predictions.correct }) }} →
                  <strong>+{{ score.predictions.points }}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="deltas?.clubs.length && !isComplete" class="surface-card card-pad">
        <div class="section-title delta-head">
          <span>{{ $t('week.deltaTitle') }}</span>
          <span v-if="deltas.live" class="live-chip"><span class="dot" />{{ $t('common.live') }}</span>
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
                :title="e.provisional ? $t('week.stillMoving') : undefined"
              >
                <span v-if="e.provisional" class="dot" aria-hidden="true" />
                {{ signed(e.points) }} {{ lower(e.label) }}
              </span>
            </span>
          </div>
        </div>
      </section>

      <section v-if="openPicks.available" class="surface-card card-pad">
        <div class="section-title">{{ $t('week.openPicksTitle') }}</div>
        <div class="table-scroll">
          <table class="lines picks-table freeze-1">
            <thead>
              <tr>
                <th>{{ $t('leaderboard.player') }}</th>
                <th>{{ $t('week.captain') }}</th>
                <th>{{ $t('week.joker') }}</th>
                <th>{{ $t('week.bench') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in openPicks.picks" :key="p.userId" :class="{ me: p.userId === auth.user?.id }">
                <td>
                  {{ p.displayName }}
                  <span v-if="p.userId === auth.user?.id" class="you"> · {{ $t('common.you') }}</span>
                </td>
                <td>{{ p.captainName }}</td>
                <td>
                  <span v-if="p.jokerCode" class="pick-joker">
                    <JokerIcon :code="p.jokerCode" :size="16" />
                    <span v-if="p.jokerDetail" class="text-muted">{{ p.jokerDetail }}</span>
                  </span>
                  <span v-else class="text-muted">{{ $t('common.none') }}</span>
                </td>
                <td>{{ p.benchName }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <Dialog
      v-model:visible="swapDialog"
      modal
      :header="$t('week.swapTitle', { club: swapFrom?.name })"
      class="dialog-md"
    >
      <p class="text-muted dialog-lead">{{ $t('week.swapSubtitle') }}</p>
      <div class="swap-list">
        <button v-for="t in swapOptions()" :key="t.id" class="swap-option" @click="chooseSwap(t.id)">
          <TeamCrest :name="t.name" :crest-url="t.crestUrl" size="sm" />
          <span class="swap-text">
            <span class="swap-name">{{ t.name }}</span>
            <span v-for="(f, i) in clubWeeks.get(t.id)?.fixtures ?? []" :key="i" class="swap-fixture text-muted">
              <component
                :is="f.home ? House : Plane"
                :size="13"
                :aria-label="f.home ? $t('week.atHome') : $t('week.away')"
              />
              <span>{{ $t('common.pot', { number: f.opponentTierId }) }} · {{ f.opponentName }}</span>
            </span>
            <span v-if="!clubWeeks.get(t.id)?.fixtures.length" class="swap-fixture text-muted">
              {{ $t('week.noFixture') }}
            </span>
          </span>
          <Tag
            v-if="clubWeeks.get(t.id)?.difficulty"
            :severity="difficultySeverity(clubWeeks.get(t.id)!.difficulty)"
            :value="$t(`difficulty.${clubWeeks.get(t.id)!.difficulty}`)"
          />
        </button>
        <p v-if="!swapOptions().length" class="text-muted flush">{{ $t('week.swapEmpty') }}</p>
      </div>
    </Dialog>

    <Dialog
      class="dialog-sm"
      :visible="leaveTo !== null"
      modal
      :header="$t('week.unsavedTitle')"
      @update:visible="leaveTo = null"
    >
      <p class="flush">{{ $t('week.unsavedBody') }}</p>
      <template #footer>
        <Button :label="$t('week.leaveAnyway')" text severity="danger" @click="leaveAnyway" />
        <Button :label="$t('week.saveAndLeave')" :loading="busy" @click="saveAndLeave" />
      </template>
    </Dialog>

    <Dialog class="dialog-sm" v-model:visible="benchConflict" modal :header="$t('squad.conflictTitle')">
      <p class="flush">{{ $t('week.benchConflictBody') }}</p>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="benchConflict = false" />
        <Button :label="$t('common.continue')" severity="danger" @click="confirmBenchConflict" />
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
@media (hover: hover) {
  .club-card:hover { transform: translateY(-3px); border-color: var(--color-border-strong); box-shadow: var(--shadow-md); }
}
.club-card.drag {
  cursor: grab;
  /* The gesture is ours: no text selection, no iOS callout, no tap delay. */
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.club-card.drag:active { cursor: grabbing; }
/* The card the pointer is carrying stays behind as a hole in the pitch. */
.club-card.lifted { opacity: 0.35; }
.club-card.over { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary), 0 0 22px rgba(99, 102, 241, 0.35); }
.club-card.is-captain { border-color: var(--color-warning); box-shadow: 0 0 0 1px var(--color-warning), 0 0 22px rgba(251, 191, 36, 0.18); }
.crest-link { text-decoration: none; }
.crest.dim { filter: grayscale(0.7); opacity: 0.75; }
/* The armband sits beside the name rather than under it. On its own line it
   made the tallest card in a row, and a grid row is as tall as its tallest
   card, so one captain used to stretch every club on the pitch. */
.club-title {
  display: flex; align-items: center; justify-content: center;
  gap: 0.4rem; min-width: 0;
}
.club-name { font-size: 0.88rem; font-weight: 700; text-align: center; line-height: 1.25; }
/* The week the club is walking into, on the card itself. It used to sit in a
   panel below the pitch, which meant scrolling away from the lineup to find out
   who any of these clubs actually play. The band rides on the first fixture's
   line rather than a line of its own: on its own it simply gave back the height
   the armband had just stopped costing. */
.club-week {
  display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
  width: 100%; min-width: 0;
}
.club-fixture {
  display: flex; align-items: center; justify-content: center; gap: 0.35rem;
  max-width: 100%; min-width: 0;
  color: var(--color-text-muted); font-size: var(--text-2xs);
}
.club-opp-line { display: inline-flex; align-items: center; gap: 0.3rem; min-width: 0; }
.club-fixture svg { flex-shrink: 0; }
.club-opp { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.club-bye { color: var(--color-text-muted); font-size: var(--text-2xs); font-style: italic; }
/* A band, not a badge: it says how hard the week is without shouting a colour
   louder than the club it belongs to. */
.club-diff {
  flex-shrink: 0; padding: 0.05rem 0.4rem;
  border-radius: var(--radius-pill);
  font-size: var(--text-2xs); font-weight: 700; white-space: nowrap;
}
.club-diff.easy { background: var(--color-success-soft); color: var(--color-success); }
.club-diff.medium { background: var(--color-warning-soft); color: var(--color-warning); }
.club-diff.hard { background: var(--color-danger-soft); color: var(--color-danger); }

.club-foot { display: flex; align-items: center; justify-content: center; min-height: 1.2rem; }
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
/* Under the pitch, on the pitch's own three columns: the bench takes one of
   them so a benched club is the same size as a club that plays, and the jokers
   take the other two as a two-by-two block. The bench used to be a narrow box
   in a full-width dashed frame with the wallet in a panel further down, so
   neither the clubs nor the jokers were where the eye expected them. */
.pitch-foot {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4); margin-top: var(--space-5); align-items: stretch;
}
.bench-zone { display: flex; flex-direction: column; min-width: 0; }
.joker-legend { grid-column: span 2; display: flex; flex-direction: column; min-width: 0; }
/* Two across and two down, so a joker is a club wide and half a club tall. */
.legend-list {
  list-style: none; margin: 0; padding: 0; flex: 1;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1fr; gap: var(--space-4);
}
.legend-item {
  display: flex; align-items: center; gap: 0.7rem; min-width: 0;
  padding: 0.7rem 0.85rem; border-radius: var(--radius-md);
  border: 1.5px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
}
.legend-item.live { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }
/* Spent, not gone: knowing a joker is used up is worth as much as knowing it is there. */
.legend-item.spent { opacity: 0.5; }
.legend-mark {
  display: grid; place-items: center; width: 2.2rem; height: 2.2rem; flex-shrink: 0;
  border-radius: 50%; background: var(--color-bg-subtle); color: var(--color-primary);
}
.legend-item.live .legend-mark { background: var(--color-primary); color: #fff; }
.legend-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; line-height: 1.3; }
.legend-name {
  font-size: var(--text-sm); font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.legend-history { font-size: var(--text-2xs); color: var(--color-text-muted); }
.legend-left { font-size: var(--text-2xs); font-weight: 700; color: var(--color-text-secondary); }
.legend-item.live .legend-left { color: var(--color-primary-hover); }

.bench-slot {
  border: 2px dashed var(--color-border-strong); border-radius: var(--radius-md);
  padding: 0.9rem; display: grid; place-items: stretch; flex: 1; min-height: 0;
  transition: border-color 0.15s, background 0.15s;
}
.bench-slot.over { border-color: var(--color-primary); background: rgba(99, 102, 241, 0.1); }
.bench-empty { display: grid; place-items: center; text-align: center; }
.bench-slot.boosted { border-style: solid; border-color: var(--color-warning); }
/* The card fills the frame rather than floating in it, so the bench reads as
   one slot the size of a club rather than a small card in a big box. */
.bench-slot .club-card { width: 100%; justify-content: center; }
.drag-hint { margin: 0.7rem 0 0; font-size: 0.8rem; }
/* A finger has to hold the card first, so it gets told something else. */
.hint-coarse { display: none; }
@media (pointer: coarse) {
  .hint-fine { display: none; }
  .hint-coarse { display: inline; }
}
/* Two clubs to a row on a phone, with a lone third centred under them. */
@media (max-width: 560px) {
  .pitch { padding: 1rem 0.85rem; }
  .pitch-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .pitch-grid > :last-child:nth-child(odd) {
    grid-column: span 2;
    justify-self: center;
    width: calc(50% - var(--space-3) / 2);
  }
  .club-card { padding: 0.8rem 0.5rem 0.7rem; }
  .club-name { font-size: 0.82rem; }
  /* Too narrow for the opponent and the band side by side, so the band drops
     under it. A column rather than a wrap, or the band would stretch the full
     width of the card and read as a stripe instead of a label. */
  .club-fixture { flex-direction: column; gap: 0.15rem; }
  /* No room for three columns, so the bench and the jokers stack, and a joker
     gets the full width rather than half of a half. */
  .pitch-foot { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .joker-legend { grid-column: auto; }
  .legend-list { grid-template-columns: minmax(0, 1fr); grid-auto-rows: auto; gap: var(--space-3); }
  .bench-slot { padding: 0.75rem; }
  /* The card fills the frame rather than floating in it, so the bench reads as
   one slot the size of a club rather than a small card in a big box. */
.bench-slot .club-card { width: 100%; justify-content: center; }
  .slot-actions { gap: 0.3rem; }
  /* The coupon gets its own line, three equal buttons wide. */
  .paul-row { align-items: flex-start; gap: var(--space-2); }
  .paul-picks { width: 100%; margin-left: 0; }
  .pick-btn { flex: 1; min-width: 0; }
  .paul-actions { flex-direction: column; align-items: stretch; }
  .picks-table { min-width: 440px; }
  .delta-club { min-width: 0; }
}
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
.paul-tally { display: inline-flex; align-items: center; gap: 0.4rem; font-size: var(--text-sm); font-weight: 700; color: var(--color-text-muted); }
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
/* Still on the page: this call has not reached the coupon yet. */
.pick-btn.unsaved { border-style: dashed; }
.pick-btn.hit { background: var(--color-success-soft); border-color: var(--color-success); color: var(--color-success); }
.pick-btn.miss { background: var(--color-danger-soft); border-color: var(--color-danger); color: var(--color-danger); }
@media (pointer: coarse) {
  .pick-btn { height: 44px; min-width: 60px; }
}
.paul-actions {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  margin-top: var(--space-4); padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}
.paul-count { font-size: var(--text-sm); color: var(--color-text-muted); }
.lines tr:last-child td { border-bottom: none; }
.lines tr.muted td { color: var(--color-text-muted); }
/* Every column reads left, headers over their values. */
.picks-table th, .picks-table td { text-align: left; padding-left: 0.5rem; }
.picks-table thead th { background: var(--color-bg-subtle); }
.picks-table tr.me { background: var(--color-primary-soft); }
.picks-table .you { color: var(--color-primary); font-size: var(--text-2xs); font-weight: 700; }
.pick-joker { display: inline-flex; align-items: center; gap: 0.45rem; }
.pick-joker .text-muted { font-size: var(--text-xs); }
.swap-list { display: flex; flex-direction: column; gap: 0.45rem; max-height: 320px; overflow-y: auto; }
.swap-option {
  display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-surface-2); color: var(--color-text);
  font: inherit; font-weight: 600; text-align: left; cursor: pointer;
}
.swap-option:hover { border-color: var(--color-primary); background: var(--color-primary-soft); }
/* The name leads, the fixture explains it, and the difficulty tag closes the
   row. The text column takes the room so the tag stays put down the list. */
.swap-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1;
  min-width: 0;
}
.swap-name { line-height: 1.25; }
.swap-fixture {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--text-2xs);
  font-weight: 600;
}

/* The joker wallet: what is left of each one, and which one is out this week. */
/* Nothing left to play. Still listed, because a missing row reads as a bug. */
.section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
