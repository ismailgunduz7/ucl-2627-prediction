<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import { useToast } from 'primevue/usetoast';
import { api, ApiRequestError } from '@/lib/api';

interface Mw { id: string; label: string; status: string; editable: boolean; opened: boolean; locked: boolean }
interface SquadClub { teamId: string; tierId: number; name: string; shortName: string; eliminated: boolean }
interface Lineup { benchTeamId: string; captainTeamId: string; saved: boolean; lockAt: string | null; locked: boolean; opened: boolean; editable: boolean }
interface ScoreLine { teamId: string; name: string; shortName: string; basePoints: number; benched: boolean; captain: boolean; multiplier: number; contributed: number }
interface WeekScore { total: number; final: boolean; lines: ScoreLine[]; benchTeamId: string; captainTeamId: string; jokerCode: string | null }
interface Inventory { code: string; name: string; remaining: number }
interface ActiveJoker { code: string; payload: Record<string, unknown> }
interface BriefingClub { teamId: string; name: string; tierId: number; benched: boolean; captain: boolean; fixtures: { opponentName: string; opponentTierId: number; home: boolean; kickoffAt: string }[]; risk: string | null }
interface OpenPick { userId: string; displayName: string; benchName: string; captainName: string; jokerCode: string | null }
interface Pot { tierId: number; teams: { id: string; name: string; eliminated: boolean; isActive: boolean }[] }

const toast = useToast();
const router = useRouter();

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
const saving = ref(false);
const now = ref(Date.now());
let timer: number | undefined;

const benchId = ref<string | null>(null);
const captainId = ref<string | null>(null);

// Joker sub-forms
const shieldTarget = ref<string | null>(null);
const swapFrom = ref<string | null>(null);
const swapTo = ref<string | null>(null);
const benchConflict = ref(false);
const cancelConfirm = ref(false);

const JOKER_NAMES: Record<string, string> = {
  weekly_swap: 'Haftalık değişim', triple_boost: 'Üçlü kaptan (×3)',
  clean_sheet_shield: 'Gol yememe kalkanı', bench_boost: 'Bench boost',
};

const currentMw = computed(() => matchweeks.value.find((m) => m.id === selectedMw.value) ?? null);
const editable = computed(() => lineup.value?.editable ?? false);
const lockAt = computed(() => lineup.value?.lockAt ?? null);
const isComplete = computed(() => currentMw.value?.status === 'complete');
const dirty = computed(() => lineup.value && (benchId.value !== lineup.value.benchTeamId || captainId.value !== lineup.value.captainTeamId));

const countdownMs = computed(() => (lockAt.value ? new Date(lockAt.value).getTime() - now.value : null));
const countdown = computed(() => {
  const ms = countdownMs.value;
  if (ms === null || ms <= 0) return null;
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return d > 0 ? `${d}g ${h}s ${m}dk` : `${h}s ${m}dk ${s}sn`;
});
const drama = computed(() => countdownMs.value !== null && countdownMs.value > 0 && countdownMs.value < 7200_000);

// Scoring clubs (non-bench) for shield target + swap-from options
const scoringClubs = computed(() => squad.value.filter((c) => c.teamId !== benchId.value));
function swapToOptions(fromTeamId: string | null) {
  if (!fromTeamId) return [];
  const from = squad.value.find((c) => c.teamId === fromTeamId);
  if (!from) return [];
  const squadIds = new Set(squad.value.map((c) => c.teamId));
  const pot = pots.value.find((p) => p.tierId === from.tierId);
  return (pot?.teams ?? []).filter((t) => !squadIds.has(t.id) && !t.eliminated && t.isActive);
}

function initials(name: string) { return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase(); }
function riskSeverity(r: string | null) { return r === 'yüksek' ? 'danger' : r === 'orta' ? 'warn' : r === 'düşük' ? 'success' : 'secondary'; }

function setBench(teamId: string) {
  if (!editable.value) return;
  benchId.value = teamId;
  if (captainId.value === teamId) {
    const s = squad.value.filter((c) => c.teamId !== teamId).sort((a, b) => a.tierId - b.tierId);
    captainId.value = s[0]?.teamId ?? null;
  }
}
function setCaptain(teamId: string) {
  if (!editable.value || teamId === benchId.value) return;
  captainId.value = teamId;
}

async function loadAll() {
  loading.value = true;
  try {
    const [status, teams] = await Promise.all([
      api.get<{ matchweeks: Mw[]; currentMatchweekId: string | null }>('/api/tournament/status'),
      api.get<{ pots: Pot[] }>('/api/teams'),
    ]);
    matchweeks.value = status.matchweeks;
    pots.value = status.matchweeks ? teams.pots : [];
    if (!selectedMw.value) selectedMw.value = status.currentMatchweekId ?? status.matchweeks[0]?.id ?? null;
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
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

async function save(force = false) {
  if (!selectedMw.value || !benchId.value || !captainId.value) return;
  saving.value = true;
  try {
    await api.put(`/api/matchweeks/${selectedMw.value}/lineup`, { benchTeamId: benchId.value, captainTeamId: captainId.value });
    toast.add({ severity: 'success', summary: 'Dizi kaydedildi', life: 2500 });
    await loadWeek();
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'joker_bench_conflict' && !force) {
      benchConflict.value = true; // ask to cancel joker + refund
    } else {
      toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4500 });
    }
  } finally {
    saving.value = false;
  }
}

async function confirmBenchConflict() {
  benchConflict.value = false;
  await cancelJoker(true);
  await save(true);
}

async function activate(code: string, payload: Record<string, unknown> = {}) {
  try {
    await api.post(`/api/matchweeks/${selectedMw.value}/jokers`, { code, payload });
    toast.add({ severity: 'success', summary: 'Joker aktif', detail: JOKER_NAMES[code], life: 2500 });
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Joker hatası', detail: msg(e), life: 4500 });
  }
}
async function cancelJoker(silent = false) {
  try {
    await api.del(`/api/matchweeks/${selectedMw.value}/jokers`);
    if (!silent) { toast.add({ severity: 'success', summary: 'Joker iptal + iade', life: 2500 }); await loadWeek(); }
  } catch (e) {
    if (!silent) toast.add({ severity: 'error', summary: 'İptal edilemedi', detail: msg(e), life: 4000 });
  }
}

function remaining(code: string) { return inventory.value.find((i) => i.code === code)?.remaining ?? 0; }
function lineFor(teamId: string) { return score.value?.lines.find((l) => l.teamId === teamId); }
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }

onMounted(() => { loadAll(); timer = window.setInterval(() => (now.value = Date.now()), 1000); });
onUnmounted(() => window.clearInterval(timer));
watch(selectedMw, () => { if (!loading.value) loadWeek(); });
</script>

<template>
  <div class="page stack">
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem">
      <h1 style="margin: 0">Hafta</h1>
      <div style="display: flex; gap: 0.5rem; align-items: center">
        <Select v-model="selectedMw" :options="matchweeks" option-label="label" option-value="id" style="min-width: 140px" />
        <Button label="Geri" icon="pi pi-arrow-left" text @click="router.push('/')" />
      </div>
    </div>

    <div v-if="loading">Yükleniyor…</div>
    <Message v-else-if="!squad.length" severity="warn" :closable="false">
      Önce kalıcı kadronu seç. <RouterLink to="/kadro">Kadro seç →</RouterLink>
    </Message>

    <template v-else>
      <Message v-if="isComplete" severity="success" :closable="false">Bu hafta tamamlandı — puanlar kesinleşti.</Message>
      <Message v-else-if="!currentMw?.opened" severity="secondary" :closable="false">Bu hafta henüz düzenlemeye açılmadı.</Message>
      <Message v-else-if="drama" severity="warn" :closable="false">
        ⏰ Son {{ countdown }}! Dizini ve jokerini kontrol et.
      </Message>
      <Message v-else-if="editable && countdown" severity="info" :closable="false">Kilide kalan: <strong>{{ countdown }}</strong></Message>
      <Message v-else-if="!editable" severity="warn" :closable="false">Hafta kilitlendi.</Message>

      <!-- Crest wall -->
      <div class="crest-wall">
        <div v-for="club in squad" :key="club.teamId" class="club" :class="{ benched: club.teamId === benchId && !(activeJoker?.code === 'bench_boost'), captain: club.teamId === captainId }">
          <RouterLink :to="`/takim/${club.teamId}`" class="crest-link"><span class="crest">{{ initials(club.name) }}</span></RouterLink>
          <div class="club-name">{{ club.name }}</div>
          <div class="badges">
            <Tag v-if="club.teamId === captainId" severity="warn" :value="`K ×${activeJoker?.code === 'triple_boost' ? 3 : 2}`" />
            <Tag v-if="club.teamId === benchId" severity="secondary" :value="activeJoker?.code === 'bench_boost' ? 'Bench+' : 'Bench'" />
            <span v-if="lineFor(club.teamId)" class="pts" :style="{ color: lineFor(club.teamId)!.contributed >= 0 ? '#166534' : '#b91c1c' }">
              {{ lineFor(club.teamId)!.benched && !lineFor(club.teamId)!.captain && activeJoker?.code !== 'bench_boost' ? '—' : (lineFor(club.teamId)!.contributed >= 0 ? '+' : '') + lineFor(club.teamId)!.contributed }}
            </span>
          </div>
          <div v-if="editable" class="controls">
            <button class="mini" :class="{ on: club.teamId === benchId }" @click="setBench(club.teamId)">Bench</button>
            <button class="mini" :class="{ on: club.teamId === captainId }" :disabled="club.teamId === benchId" @click="setCaptain(club.teamId)">Kaptan</button>
          </div>
        </div>
      </div>

      <div v-if="editable" style="display: flex; gap: 1rem; align-items: center">
        <Button label="Diziyi kaydet" icon="pi pi-check" :disabled="!dirty" :loading="saving" @click="save()" />
        <span v-if="!lineup?.saved" style="color: #a55; font-size: 0.85rem">Varsayılan dizi</span>
      </div>

      <!-- Jokers -->
      <div class="panel">
        <div class="panel-head">Jokerler <small style="color:#889">(hafta başına 1)</small></div>
        <div v-if="activeJoker" class="active-joker">
          <Tag severity="warn" :value="JOKER_NAMES[activeJoker.code]" /> aktif
          <Button v-if="editable" label="İptal + iade" icon="pi pi-times" size="small" text severity="danger" @click="cancelConfirm = true" />
        </div>
        <div v-else-if="editable" class="joker-grid">
          <div class="joker-card">
            <b>Üçlü kaptan</b><small>Kalan: {{ remaining('triple_boost') }}</small>
            <Button label="Aktifle" size="small" :disabled="remaining('triple_boost') === 0" @click="activate('triple_boost')" />
          </div>
          <div class="joker-card">
            <b>Bench boost</b><small>Kalan: {{ remaining('bench_boost') }}</small>
            <Button label="Aktifle" size="small" :disabled="remaining('bench_boost') === 0" @click="activate('bench_boost')" />
          </div>
          <div class="joker-card">
            <b>Gol yememe kalkanı</b><small>Kalan: {{ remaining('clean_sheet_shield') }}</small>
            <Select v-model="shieldTarget" :options="scoringClubs" option-label="name" option-value="teamId" placeholder="Hedef (skorlayan)" size="small" style="width: 100%" />
            <Button label="Aktifle" size="small" :disabled="!shieldTarget || remaining('clean_sheet_shield') === 0" @click="activate('clean_sheet_shield', { teamId: shieldTarget })" />
          </div>
          <div class="joker-card">
            <b>Haftalık değişim</b><small>Kalan: {{ remaining('weekly_swap') }}</small>
            <Select v-model="swapFrom" :options="squad" option-label="name" option-value="teamId" placeholder="Çıkacak" style="width: 100%" />
            <Select v-model="swapTo" :options="swapToOptions(swapFrom)" option-label="name" option-value="id" placeholder="Girecek (aynı pot)" style="width: 100%" />
            <Button label="Aktifle" size="small" :disabled="!swapFrom || !swapTo || remaining('weekly_swap') === 0" @click="activate('weekly_swap', { fromTeamId: swapFrom, toTeamId: swapTo })" />
          </div>
        </div>
        <div v-else style="color:#889">Hafta kilitli — joker değiştirilemez.</div>
      </div>

      <!-- Briefing -->
      <div class="panel" v-if="briefing.length">
        <div class="panel-head">Hafta brifingi & risk</div>
        <div class="brief-grid">
          <div v-for="b in briefing" :key="b.teamId" class="brief-card">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <b>{{ b.name }}</b>
              <Tag :severity="riskSeverity(b.risk)" :value="b.risk ?? 'maç yok'" />
            </div>
            <div v-for="(f, i) in b.fixtures" :key="i" style="font-size:0.82rem; color:#556">
              {{ f.home ? 'ev' : 'dep' }} · Pot {{ f.opponentTierId }} {{ f.opponentName }}
            </div>
            <div v-if="!b.fixtures.length" style="font-size:0.82rem; color:#99a">bu hafta maç yok — 0</div>
          </div>
        </div>
      </div>

      <!-- Score / wrap -->
      <div v-if="score" class="panel">
        <div class="panel-head" style="display:flex; justify-content:space-between">
          <span>{{ isComplete ? 'Hafta kapanış' : 'Anlık puan' }} <Tag v-if="score.jokerCode" severity="warn" :value="JOKER_NAMES[score.jokerCode]" /></span>
          <span class="wrap-total">{{ score.total }}</span>
        </div>
        <table class="lines">
          <tbody>
            <tr v-for="l in score.lines" :key="l.teamId" :class="{ muted: l.benched && !l.captain && score.jokerCode !== 'bench_boost' }">
              <td>{{ l.name }}</td>
              <td><Tag v-if="l.captain" severity="warn" :value="`K ×${l.multiplier}`" /><Tag v-else-if="l.benched" severity="secondary" value="Bench" /></td>
              <td style="text-align:right">
                <span v-if="l.benched && !l.captain && score.jokerCode !== 'bench_boost'" style="color:#99a">puan yazılmadı</span>
                <span v-else>taban {{ l.basePoints }} → <strong>{{ l.contributed >= 0 ? '+' : '' }}{{ l.contributed }}</strong></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Open picks -->
      <div class="panel" v-if="openPicks.available">
        <div class="panel-head">Açık tercihler (kickoff sonrası)</div>
        <table class="lines">
          <thead><tr><th style="text-align:left">Oyuncu</th><th>Bench</th><th>Kaptan</th><th>Joker</th></tr></thead>
          <tbody>
            <tr v-for="p in openPicks.picks" :key="p.userId">
              <td style="text-align:left">{{ p.displayName }}</td>
              <td>{{ p.benchName }}</td>
              <td>{{ p.captainName }}</td>
              <td>{{ p.jokerCode ? JOKER_NAMES[p.jokerCode] : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Dialogs -->
    <Dialog v-model:visible="benchConflict" modal header="Joker çakışması" :style="{ width: '360px' }">
      <p>Bench’e çektiğin kulüpte aktif <strong>kalkan jokeri</strong> var. Devam edersen joker iptal edilir ve iade edilir. Devam?</p>
      <template #footer>
        <Button label="Vazgeç" text @click="benchConflict = false" />
        <Button label="Devam" severity="danger" @click="confirmBenchConflict" />
      </template>
    </Dialog>
    <Dialog v-model:visible="cancelConfirm" modal header="Jokeri iptal et" :style="{ width: '340px' }">
      <p>Aktif joker iptal edilip envantere iade edilsin mi?</p>
      <template #footer>
        <Button label="Vazgeç" text @click="cancelConfirm = false" />
        <Button label="İptal et" severity="danger" @click="cancelConfirm = false; cancelJoker()" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.crest-wall { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
.club { background: #fff; border-radius: 10px; padding: 1rem 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; border: 2px solid transparent; }
.club.captain { border-color: #f59e0b; }
.club.benched { opacity: 0.55; }
.crest-link { text-decoration: none; }
.crest { width: 54px; height: 54px; border-radius: 50%; background: var(--brand); color: #fff; display: grid; place-items: center; font-weight: 700; }
.club-name { font-size: 0.9rem; text-align: center; font-weight: 600; }
.badges { display: flex; gap: 0.3rem; align-items: center; flex-wrap: wrap; justify-content: center; }
.pts { font-size: 0.8rem; font-weight: 700; }
.controls { display: flex; gap: 0.35rem; margin-top: 0.25rem; }
.mini { font: inherit; font-size: 0.78rem; padding: 0.25rem 0.55rem; border-radius: 6px; border: 1px solid #cdd6e6; background: #f7f8fc; cursor: pointer; }
.mini.on { background: var(--brand-accent); color: #fff; border-color: var(--brand-accent); }
.mini:disabled { opacity: 0.4; cursor: not-allowed; }
.panel { background: #fff; border-radius: 10px; padding: 1rem 1.25rem; }
.panel-head { font-weight: 700; margin-bottom: 0.75rem; }
.active-joker { display: flex; align-items: center; gap: 0.6rem; }
.joker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; }
.joker-card { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.75rem; background: #f7f8fc; border-radius: 8px; }
.joker-card small { color: #889; }
.brief-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
.brief-card { background: #f7f8fc; border-radius: 8px; padding: 0.6rem 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; }
.wrap-total { font-size: 1.8rem; color: var(--brand); }
.lines { width: 100%; border-collapse: collapse; }
.lines th { font-size: 0.8rem; color: #667; padding: 0.3rem; }
.lines td { padding: 0.4rem 0.3rem; border-bottom: 1px solid #eef; font-size: 0.9rem; }
.lines tr.muted td { color: #99a; }
</style>
