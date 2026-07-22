<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { Crown, Armchair, Zap, Shield, Repeat } from '@lucide/vue';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';

interface Mw { id: string; label: string; status: string; editable: boolean; opened: boolean; locked: boolean }
interface SquadClub { teamId: string; tierId: number; name: string; shortName: string; eliminated: boolean }
interface Lineup { benchTeamId: string; captainTeamId: string; saved: boolean; lockAt: string | null; locked: boolean; opened: boolean; editable: boolean }
interface ScoreLine { teamId: string; name: string; basePoints: number; benched: boolean; captain: boolean; multiplier: number; contributed: number }
interface WeekScore { total: number; final: boolean; lines: ScoreLine[]; jokerCode: string | null }
interface Inventory { code: string; name: string; remaining: number }
interface ActiveJoker { code: string; payload: Record<string, unknown> }
interface BriefingClub { teamId: string; name: string; fixtures: { opponentName: string; opponentTierId: number; home: boolean }[]; risk: string | null }
interface OpenPick { userId: string; displayName: string; benchName: string; captainName: string; jokerCode: string | null }
interface Pot { tierId: number; teams: { id: string; name: string; eliminated: boolean; isActive: boolean }[] }

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
const loading = ref(true);
const busy = ref(false);
const now = ref(Date.now());
let timer: number | undefined;

const benchId = ref<string | null>(null);
const captainId = ref<string | null>(null);
const dragId = ref<string | null>(null);
const dragOverBench = ref(false);

const swapDialog = ref(false);
const swapFrom = ref<SquadClub | null>(null);
const benchConflict = ref(false);

const JOKER_NAMES: Record<string, string> = {
  weekly_swap: 'Haftalık değişim', triple_boost: 'Üçlü kaptan',
  clean_sheet_shield: 'Gol yememe kalkanı', bench_boost: 'Bench boost',
};
const JOKER_ICONS: Record<string, unknown> = {
  weekly_swap: Repeat, triple_boost: Zap, clean_sheet_shield: Shield, bench_boost: Armchair,
};

const currentMw = computed(() => matchweeks.value.find((m) => m.id === selectedMw.value) ?? null);
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
function riskSeverity(r: string | null) { return r === 'yüksek' ? 'danger' : r === 'orta' ? 'warn' : r === 'düşük' ? 'success' : 'secondary'; }
function lineFor(teamId: string) { return score.value?.lines.find((l) => l.teamId === teamId); }
function remaining(code: string) { return inventory.value.find((i) => i.code === code)?.remaining ?? 0; }

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
  const [lu, sc, jk, br, op] = await Promise.all([
    api.get<{ lineup: Lineup | null; squad: SquadClub[] }>(`/api/matchweeks/${id}/lineup`),
    api.get<{ score: WeekScore | null }>(`/api/matchweeks/${id}/score`),
    api.get<{ inventory: Inventory[]; active: ActiveJoker | null }>(`/api/matchweeks/${id}/jokers`),
    api.get<{ briefing: BriefingClub[] }>(`/api/matchweeks/${id}/briefing`),
    api.get<{ available: boolean; picks: OpenPick[] }>(`/api/matchweeks/${id}/open-picks`),
  ]);
  lineup.value = lu.lineup; squad.value = lu.squad; score.value = sc.score;
  inventory.value = jk.inventory; activeJoker.value = jk.active;
  briefing.value = br.briefing; openPicks.value = op;
  benchId.value = lu.lineup?.benchTeamId ?? null;
  captainId.value = lu.lineup?.captainTeamId ?? null;
}

function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }

onMounted(() => { loadAll(); timer = window.setInterval(() => (now.value = Date.now()), 1000); });
onUnmounted(() => window.clearInterval(timer));
watch(selectedMw, () => { if (!loading.value) loadWeek(); });
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Bu hafta" subtitle="Kaptanını seç, birini yedeğe çek, joker oyna.">
      <template #actions>
        <Select v-model="selectedMw" :options="matchweeks" option-label="label" option-value="id" style="min-width: 150px" />
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
        <div class="pitch-grid">
          <div
            v-for="club in pitchClubs"
            :key="club.teamId"
            class="club-card animate-in"
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
              <Tag v-if="club.teamId === captainId" severity="warn" :value="`Kaptan ×${capMult}`" />
              <span v-if="lineFor(club.teamId)" class="pts" :class="lineFor(club.teamId)!.contributed >= 0 ? 'text-positive' : 'text-negative'">
                {{ lineFor(club.teamId)!.contributed >= 0 ? '+' : '' }}{{ lineFor(club.teamId)!.contributed }}
              </span>
            </div>

            <div v-if="editable" class="slot-actions">
              <button class="slot-btn" :class="{ on: club.teamId === captainId }" title="Kaptan yap" @click="setCaptain(club.teamId)">
                <Crown :size="15" />
              </button>
              <button v-if="canBench(club)" class="slot-btn" title="Yedeğe al" @click="setBench(club.teamId)">
                <Armchair :size="15" />
              </button>
              <button
                v-for="j in jokersFor(club, false)"
                :key="j.code"
                class="slot-btn joker"
                :class="{ on: j.active }"
                :title="j.active ? `${JOKER_NAMES[j.code]} — geri al` : JOKER_NAMES[j.code]"
                @click="onJokerClick(j.code, club, j.active)"
              >
                <component :is="JOKER_ICONS[j.code]" :size="15" />
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
            class="club-card bench animate-in"
            :class="{ 'is-captain': benchClub.teamId === captainId }"
            :draggable="editable"
            @dragstart="onDragStart(benchClub.teamId)"
          >
            <RouterLink :to="`/takim/${benchClub.teamId}`" class="crest-link">
              <span class="crest crest-lg" :class="{ dim: !benchBoost }">{{ initials(benchClub.name) }}</span>
            </RouterLink>
            <div class="club-name">{{ benchClub.name }}</div>
            <Tag :severity="benchBoost ? 'warn' : 'secondary'" :value="benchBoost ? 'Boost — puan yazar' : 'Puan yazmaz'" />
            <div v-if="editable" class="slot-actions">
              <button v-if="benchBoost" class="slot-btn" :class="{ on: benchClub.teamId === captainId }" title="Kaptan yap" @click="setCaptain(benchClub.teamId)">
                <Crown :size="15" />
              </button>
              <button
                v-for="j in jokersFor(benchClub, true)"
                :key="j.code"
                class="slot-btn joker"
                :class="{ on: j.active }"
                :title="j.active ? `${JOKER_NAMES[j.code]} — geri al` : JOKER_NAMES[j.code]"
                @click="onJokerClick(j.code, benchClub, j.active)"
              >
                <component :is="JOKER_ICONS[j.code]" :size="15" />
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
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem">
              <b>{{ b.name }}</b>
              <Tag :severity="riskSeverity(b.risk)" :value="b.risk ? `${b.risk} risk` : 'maç yok'" />
            </div>
            <div v-for="(f, i) in b.fixtures" :key="i" class="text-muted" style="font-size: 0.82rem">
              {{ f.home ? 'evinde' : 'deplasmanda' }} · Pot {{ f.opponentTierId }} {{ f.opponentName }}
            </div>
            <div v-if="!b.fixtures.length" class="text-muted" style="font-size: 0.82rem">bu hafta maçı yok</div>
          </div>
        </div>
      </section>

      <section v-if="score" class="surface-card card-pad">
        <div class="section-title" style="display: flex; justify-content: space-between; align-items: center">
          <span>{{ isComplete ? 'Hafta kapanışı' : 'Anlık puan' }}
            <Tag v-if="score.jokerCode" severity="warn" :value="JOKER_NAMES[score.jokerCode]" />
          </span>
          <span class="big-total">{{ score.total }}</span>
        </div>
        <table class="lines">
          <tbody>
            <tr v-for="l in score.lines" :key="l.teamId" :class="{ muted: l.benched && score.jokerCode !== 'bench_boost' }">
              <td>{{ l.name }}</td>
              <td>
                <Tag v-if="l.captain" severity="warn" :value="`K ×${l.multiplier}`" />
                <Tag v-else-if="l.benched" severity="secondary" value="Yedek" />
              </td>
              <td style="text-align: right">
                <span v-if="l.benched && score.jokerCode !== 'bench_boost'" class="text-muted">puan yazmadı</span>
                <span v-else>{{ l.basePoints }} → <strong>{{ l.contributed >= 0 ? '+' : '' }}{{ l.contributed }}</strong></span>
              </td>
            </tr>
          </tbody>
        </table>
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
              <td>{{ p.jokerCode ? JOKER_NAMES[p.jokerCode] : '—' }}</td>
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
.pitch-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 1rem; }
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
.crest-sm { width: 30px; height: 30px; font-size: 0.62rem; }
.crest.dim { filter: grayscale(0.7); opacity: 0.75; }
.club-name { font-size: 0.88rem; font-weight: 700; text-align: center; line-height: 1.25; }
.club-foot { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; min-height: 1.2rem; }
.pts { font-weight: 800; font-size: 0.92rem; }
.slot-actions { display: flex; gap: 0.35rem; margin-top: 0.2rem; flex-wrap: wrap; justify-content: center; }
.slot-btn {
  width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: 50%; border: 1.5px solid var(--color-border-strong);
  background: var(--color-bg-subtle); color: var(--color-text-secondary);
  cursor: pointer; transition: transform 0.14s, background 0.14s, color 0.14s, border-color 0.14s;
}
.slot-btn:hover { transform: translateY(-2px); color: var(--color-text); border-color: var(--color-primary); }
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
.brief-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.85rem; }
.brief-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
.big-total { font-size: 1.9rem; font-weight: 800; color: var(--color-primary); }
.lines { width: 100%; border-collapse: collapse; }
.lines th { font-size: 0.76rem; color: var(--color-text-muted); padding: 0.3rem; font-weight: 700; }
.lines td { padding: 0.55rem 0.35rem; border-bottom: 1px solid var(--color-border); font-size: 0.9rem; }
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
