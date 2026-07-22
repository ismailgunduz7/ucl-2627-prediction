<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import { useToast } from 'primevue/usetoast';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import LoadingState from '@/components/LoadingState.vue';

interface Mw { id: string; label: string; status: string; editable: boolean; opened: boolean; locked: boolean }
interface SquadClub { teamId: string; tierId: number; name: string; shortName: string; eliminated: boolean }
interface Lineup { benchTeamId: string; captainTeamId: string; saved: boolean; lockAt: string | null; locked: boolean; opened: boolean; editable: boolean }
interface ScoreLine { teamId: string; name: string; shortName: string; basePoints: number; benched: boolean; captain: boolean; multiplier: number; contributed: number }
interface WeekScore { total: number; final: boolean; lines: ScoreLine[]; jokerCode: string | null }
interface Inventory { code: string; name: string; remaining: number }
interface ActiveJoker { code: string; payload: Record<string, unknown> }
interface BriefingClub { teamId: string; name: string; tierId: number; fixtures: { opponentName: string; opponentTierId: number; home: boolean }[]; risk: string | null }
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
const now = ref(Date.now());
let timer: number | undefined;

const benchId = ref<string | null>(null);
const captainId = ref<string | null>(null);
const dragId = ref<string | null>(null);
const dragOverBench = ref(false);

const shieldTarget = ref<string | null>(null);
const swapFrom = ref<string | null>(null);
const swapTo = ref<string | null>(null);
const benchConflict = ref(false);
const cancelConfirm = ref(false);

const JOKER_NAMES: Record<string, string> = {
  weekly_swap: 'Haftalık değişim', triple_boost: 'Üçlü kaptan',
  clean_sheet_shield: 'Gol yememe kalkanı', bench_boost: 'Bench boost',
};

const currentMw = computed(() => matchweeks.value.find((m) => m.id === selectedMw.value) ?? null);
const editable = computed(() => lineup.value?.editable ?? false);
const isComplete = computed(() => currentMw.value?.status === 'complete');
const benchBoost = computed(() => activeJoker.value?.code === 'bench_boost');
const capMult = computed(() => (activeJoker.value?.code === 'triple_boost' ? 3 : 2));

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

const scoringForShield = computed(() => squad.value.filter((c) => c.teamId !== benchId.value));
function swapToOptions(fromTeamId: string | null) {
  if (!fromTeamId) return [];
  const from = squad.value.find((c) => c.teamId === fromTeamId);
  if (!from) return [];
  const ids = new Set(squad.value.map((c) => c.teamId));
  const pot = pots.value.find((p) => p.tierId === from.tierId);
  return (pot?.teams ?? []).filter((t) => !ids.has(t.id) && !t.eliminated && t.isActive);
}

function initials(name: string) { return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase(); }
function riskSeverity(r: string | null) { return r === 'yüksek' ? 'danger' : r === 'orta' ? 'warn' : r === 'düşük' ? 'success' : 'secondary'; }
function lineFor(teamId: string) { return score.value?.lines.find((l) => l.teamId === teamId); }
function remaining(code: string) { return inventory.value.find((i) => i.code === code)?.remaining ?? 0; }

// Set bench, keeping the captaincy on a scoring club, then auto-save.
async function setBench(teamId: string) {
  if (!editable.value || teamId === benchId.value) return;
  benchId.value = teamId;
  if (captainId.value === teamId) {
    const s = squad.value.filter((c) => c.teamId !== teamId).sort((a, b) => a.tierId - b.tierId);
    captainId.value = s[0]?.teamId ?? null;
  }
  await persist();
}
async function setCaptain(teamId: string) {
  if (!editable.value || teamId === benchId.value) return;
  captainId.value = teamId;
  await persist();
}

async function persist(force = false) {
  if (!selectedMw.value || !benchId.value || !captainId.value) return;
  try {
    await api.put(`/api/matchweeks/${selectedMw.value}/lineup`, { benchTeamId: benchId.value, captainTeamId: captainId.value });
    await loadWeek();
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'joker_bench_conflict' && !force) {
      benchConflict.value = true;
      await loadWeek(); // revert local state to server truth
    } else {
      toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4000 });
      await loadWeek();
    }
  }
}

// Drag & drop
function onDragStart(teamId: string) { if (editable.value) dragId.value = teamId; }
function onDropBench() {
  dragOverBench.value = false;
  if (dragId.value) setBench(dragId.value);
  dragId.value = null;
}
function onDropPitch(targetTeamId: string) {
  // Dropping the benched club onto a pitch club swaps them.
  if (dragId.value && dragId.value === benchId.value) setBench(targetTeamId);
  dragId.value = null;
}

async function confirmBenchConflict() {
  benchConflict.value = false;
  await cancelJoker(true);
  await persist(true);
}

async function activate(code: string, payload: Record<string, unknown> = {}) {
  try {
    await api.post(`/api/matchweeks/${selectedMw.value}/jokers`, { code, payload });
    toast.add({ severity: 'success', summary: 'Joker aktif', detail: JOKER_NAMES[code], life: 2500 });
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Olmadı', detail: msg(e), life: 4500 });
  }
}
async function cancelJoker(silent = false) {
  try {
    await api.del(`/api/matchweeks/${selectedMw.value}/jokers`);
    if (!silent) { toast.add({ severity: 'success', summary: 'Joker iade edildi', life: 2500 }); await loadWeek(); }
  } catch (e) {
    if (!silent) toast.add({ severity: 'error', summary: 'İptal edilemedi', detail: msg(e), life: 4000 });
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
  shieldTarget.value = null; swapFrom.value = null; swapTo.value = null;
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

    <LoadingState v-if="loading" />
    <Message v-else-if="!squad.length" severity="warn" :closable="false">
      Önce kadronu kurmalısın. <RouterLink to="/kadro">Kadroya git →</RouterLink>
    </Message>

    <template v-else>
      <Message v-if="isComplete" severity="success" :closable="false">Hafta bitti, puanlar kesinleşti.</Message>
      <Message v-else-if="!currentMw?.opened" severity="secondary" :closable="false">Bu hafta henüz açılmadı — önceki hafta başlayınca düzenleyebilirsin.</Message>
      <Message v-else-if="drama" severity="warn" :closable="false">⏰ Kilide son {{ countdown }}! Dizinini gözden geçir.</Message>
      <Message v-else-if="editable && countdown" severity="info" :closable="false">Kilide {{ countdown }} kaldı. Değişikliklerin anında kaydediliyor.</Message>
      <Message v-else-if="!editable" severity="warn" :closable="false">Hafta kilitli, dizin sabit.</Message>

      <!-- Pitch -->
      <section class="surface-card pitch">
        <div class="pitch-label">Sahada <span class="text-muted" style="font-weight: 500">({{ pitchClubs.length }} kulüp puan yazar)</span></div>
        <div class="pitch-grid">
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
            <button v-if="editable" class="armband" :class="{ on: club.teamId === captainId }" title="Kaptan yap" @click="setCaptain(club.teamId)">C</button>
            <RouterLink :to="`/takim/${club.teamId}`" class="crest-link"><span class="crest">{{ initials(club.name) }}</span></RouterLink>
            <div class="club-name">{{ club.name }}</div>
            <div class="club-foot">
              <Tag v-if="club.teamId === captainId" severity="warn" :value="`Kaptan ×${capMult}`" />
              <span v-if="lineFor(club.teamId)" class="pts" :class="lineFor(club.teamId)!.contributed >= 0 ? 'text-positive' : 'text-negative'">
                {{ lineFor(club.teamId)!.contributed >= 0 ? '+' : '' }}{{ lineFor(club.teamId)!.contributed }}
              </span>
            </div>
            <button v-if="editable" class="to-bench" title="Yedeğe al" @click="setBench(club.teamId)"><i class="pi pi-arrow-down" /></button>
          </div>
        </div>

        <!-- Bench slot -->
        <div class="bench-zone">
          <div class="bench-label">Yedek</div>
          <div
            class="bench-slot"
            :class="{ over: dragOverBench, boosted: benchBoost }"
            @dragover.prevent="dragOverBench = editable"
            @dragleave="dragOverBench = false"
            @drop="onDropBench"
          >
            <template v-if="benchClub">
              <div
                class="club-card bench"
                :draggable="editable"
                @dragstart="onDragStart(benchClub.teamId)"
              >
                <RouterLink :to="`/takim/${benchClub.teamId}`" class="crest-link"><span class="crest muted">{{ initials(benchClub.name) }}</span></RouterLink>
                <div class="club-name">{{ benchClub.name }}</div>
                <Tag :severity="benchBoost ? 'warn' : 'secondary'" :value="benchBoost ? 'Boost — puan yazar' : 'Puan yazmaz'" />
              </div>
            </template>
            <span v-else class="text-muted">Buraya bir kulüp sürükle</span>
          </div>
          <p v-if="editable" class="text-muted drag-hint">Bir kulübü yedek kutusuna sürükle; oradaki kulüple yer değişir. Değişiklikler otomatik kaydedilir.</p>
        </div>
      </section>

      <!-- Jokers -->
      <section class="surface-card card-pad">
        <div class="section-title" style="display: flex; justify-content: space-between; align-items: center">
          <span>Jokerler <span class="text-muted" style="font-weight: 500; font-size: 0.85rem">· hafta başına bir tane</span></span>
        </div>
        <div v-if="activeJoker" class="tag-row">
          <Tag severity="warn" :value="JOKER_NAMES[activeJoker.code]" /> <span class="text-muted">bu hafta aktif</span>
          <Button v-if="editable" label="İptal & iade" icon="pi pi-times" size="small" text severity="danger" @click="cancelConfirm = true" />
        </div>
        <div v-else-if="editable" class="joker-grid">
          <div class="joker-card">
            <b>Üçlü kaptan</b><small>Kaptanın puanı ×3. Kalan: {{ remaining('triple_boost') }}</small>
            <Button label="Oyna" size="small" :disabled="!remaining('triple_boost')" @click="activate('triple_boost')" />
          </div>
          <div class="joker-card">
            <b>Bench boost</b><small>Dört kulüp de puan yazar. Kalan: {{ remaining('bench_boost') }}</small>
            <Button label="Oyna" size="small" :disabled="!remaining('bench_boost')" @click="activate('bench_boost')" />
          </div>
          <div class="joker-card">
            <b>Gol yememe kalkanı</b><small>Bir kulübü koru. Kalan: {{ remaining('clean_sheet_shield') }}</small>
            <Select v-model="shieldTarget" :options="scoringForShield" option-label="name" option-value="teamId" placeholder="Sahadaki kulüp" />
            <Button label="Oyna" size="small" :disabled="!shieldTarget || !remaining('clean_sheet_shield')" @click="activate('clean_sheet_shield', { teamId: shieldTarget })" />
          </div>
          <div class="joker-card">
            <b>Haftalık değişim</b><small>Aynı pottan geçici takas. Kalan: {{ remaining('weekly_swap') }}</small>
            <Select v-model="swapFrom" :options="squad" option-label="name" option-value="teamId" placeholder="Çıkacak kulüp" />
            <Select v-model="swapTo" :options="swapToOptions(swapFrom)" option-label="name" option-value="id" placeholder="Girecek (aynı pot)" />
            <Button label="Oyna" size="small" :disabled="!swapFrom || !swapTo || !remaining('weekly_swap')" @click="activate('weekly_swap', { fromTeamId: swapFrom, toTeamId: swapTo })" />
          </div>
        </div>
        <p v-else class="text-muted" style="margin: 0">Hafta kilitli, joker değiştirilemez.</p>
      </section>

      <!-- Briefing -->
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

      <!-- Score -->
      <section v-if="score" class="surface-card card-pad">
        <div class="section-title" style="display: flex; justify-content: space-between; align-items: center">
          <span>{{ isComplete ? 'Hafta kapanışı' : 'Anlık puan' }} <Tag v-if="score.jokerCode" severity="warn" :value="JOKER_NAMES[score.jokerCode]" /></span>
          <span class="big-total">{{ score.total }}</span>
        </div>
        <table class="lines">
          <tbody>
            <tr v-for="l in score.lines" :key="l.teamId" :class="{ muted: l.benched && !l.captain && score.jokerCode !== 'bench_boost' }">
              <td>{{ l.name }}</td>
              <td><Tag v-if="l.captain" severity="warn" :value="`K ×${l.multiplier}`" /><Tag v-else-if="l.benched" severity="secondary" value="Yedek" /></td>
              <td style="text-align: right">
                <span v-if="l.benched && !l.captain && score.jokerCode !== 'bench_boost'" class="text-muted">puan yazmadı</span>
                <span v-else>{{ l.basePoints }} → <strong>{{ l.contributed >= 0 ? '+' : '' }}{{ l.contributed }}</strong></span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Open picks -->
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

    <Dialog v-model:visible="benchConflict" modal header="Joker çakışması" :style="{ width: '380px' }">
      <p style="margin: 0">Yedeğe aldığın kulüpte aktif kalkan jokeri var. Devam edersen joker iptal edilip iade edilir. Devam edilsin mi?</p>
      <template #footer>
        <Button label="Vazgeç" text @click="benchConflict = false" />
        <Button label="Devam et" severity="danger" @click="confirmBenchConflict" />
      </template>
    </Dialog>
    <Dialog v-model:visible="cancelConfirm" modal header="Jokeri iptal et" :style="{ width: '360px' }">
      <p style="margin: 0">Aktif joker iptal edilip envanterine geri eklensin mi?</p>
      <template #footer>
        <Button label="Vazgeç" text @click="cancelConfirm = false" />
        <Button label="İptal et" severity="danger" @click="cancelConfirm = false; cancelJoker()" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.pitch {
  padding: 1.25rem;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--pitch-1) 12%, var(--color-surface)) 0%, var(--color-surface) 55%);
}
.pitch-label, .bench-label {
  font-weight: 700;
  margin-bottom: 0.85rem;
}
.pitch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1rem;
}
.club-card {
  position: relative;
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  box-shadow: var(--shadow-sm);
}
.club-card.drag { cursor: grab; }
.club-card.drag:active { cursor: grabbing; }
.club-card.is-captain { border-color: var(--color-warning); box-shadow: 0 0 0 1px var(--color-warning); }
.crest-link { text-decoration: none; }
.crest {
  width: 56px; height: 56px; border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
  color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 0.8rem;
}
.crest.muted { filter: grayscale(0.6); opacity: 0.85; }
.club-name { font-size: 0.88rem; font-weight: 600; text-align: center; }
.club-foot { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
.pts { font-weight: 800; font-size: 0.9rem; }
.armband {
  position: absolute; top: 0.5rem; left: 0.5rem;
  width: 26px; height: 26px; border-radius: 50%;
  border: 1.5px solid var(--color-border-strong); background: var(--color-surface);
  color: var(--color-text-secondary); font-weight: 800; font-size: 0.75rem; cursor: pointer;
}
.armband.on { background: var(--color-warning); border-color: var(--color-warning); color: #fff; }
.to-bench {
  position: absolute; top: 0.5rem; right: 0.5rem;
  width: 26px; height: 26px; border-radius: 50%;
  border: 1.5px solid var(--color-border); background: var(--color-surface);
  color: var(--color-text-muted); cursor: pointer; display: grid; place-items: center;
}
.to-bench:hover { color: var(--color-primary); border-color: var(--color-primary); }
.bench-zone { margin-top: 1.5rem; }
.bench-slot {
  border: 2px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  padding: 1rem;
  display: grid;
  place-items: center;
  min-height: 130px;
  transition: border-color 0.15s, background 0.15s;
}
.bench-slot.over { border-color: var(--color-primary); background: var(--color-primary-soft); }
.bench-slot.boosted { border-style: solid; border-color: var(--color-warning); }
.bench-slot .club-card { border-style: dashed; }
.drag-hint { margin: 0.65rem 0 0; font-size: 0.82rem; }
.joker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.85rem; }
.joker-card { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.85rem; background: var(--color-surface-2); border-radius: var(--radius-md); border: 1px solid var(--color-border); }
.joker-card small { color: var(--color-text-muted); }
.brief-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.85rem; }
.brief-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.75rem 0.85rem; display: flex; flex-direction: column; gap: 0.35rem; }
.big-total { font-size: 1.8rem; font-weight: 800; color: var(--color-primary); }
.lines { width: 100%; border-collapse: collapse; }
.lines th { font-size: 0.78rem; color: var(--color-text-muted); padding: 0.3rem; font-weight: 600; }
.lines td { padding: 0.5rem 0.35rem; border-bottom: 1px solid var(--color-border); font-size: 0.9rem; }
.lines tr:last-child td { border-bottom: none; }
.lines tr.muted td { color: var(--color-text-muted); }
</style>
