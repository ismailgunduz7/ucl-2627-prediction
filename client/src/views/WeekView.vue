<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { api, ApiRequestError } from '@/lib/api';

interface Mw { id: string; label: string; status: string; editable: boolean; opened: boolean; locked: boolean }
interface SquadClub { teamId: string; tierId: number; name: string; shortName: string; eliminated: boolean }
interface Lineup { benchTeamId: string; captainTeamId: string; saved: boolean; lockAt: string | null; locked: boolean; opened: boolean; editable: boolean }
interface ScoreLine { teamId: string; name: string; shortName: string; basePoints: number; benched: boolean; captain: boolean; multiplier: number; contributed: number }
interface WeekScore { total: number; final: boolean; lines: ScoreLine[]; benchTeamId: string; captainTeamId: string }

const toast = useToast();
const router = useRouter();

const matchweeks = ref<Mw[]>([]);
const selectedMw = ref<string | null>(null);
const squad = ref<SquadClub[]>([]);
const lineup = ref<Lineup | null>(null);
const score = ref<WeekScore | null>(null);
const loading = ref(true);
const saving = ref(false);
const now = ref(Date.now());
let timer: number | undefined;

// Local editable picks
const benchId = ref<string | null>(null);
const captainId = ref<string | null>(null);

const currentMw = computed(() => matchweeks.value.find((m) => m.id === selectedMw.value) ?? null);
const editable = computed(() => lineup.value?.editable ?? false);
const lockAt = computed(() => lineup.value?.lockAt ?? null);
const isComplete = computed(() => currentMw.value?.status === 'complete');

const dirty = computed(
  () => lineup.value && (benchId.value !== lineup.value.benchTeamId || captainId.value !== lineup.value.captainTeamId),
);

const countdown = computed(() => {
  if (!lockAt.value) return null;
  const ms = new Date(lockAt.value).getTime() - now.value;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return d > 0 ? `${d}g ${h}s ${m}dk` : `${h}s ${m}dk ${s}sn`;
});

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase();
}

function setBench(teamId: string) {
  if (!editable.value) return;
  benchId.value = teamId;
  // A benched club cannot be captain — reassign captaincy to a scoring club.
  if (captainId.value === teamId) {
    const scoring = squad.value.filter((s) => s.teamId !== teamId).sort((a, b) => a.tierId - b.tierId);
    captainId.value = scoring[0]?.teamId ?? null;
  }
}
function setCaptain(teamId: string) {
  if (!editable.value || teamId === benchId.value) return;
  captainId.value = teamId;
}

async function loadAll() {
  loading.value = true;
  try {
    const status = await api.get<{ matchweeks: Mw[]; currentMatchweekId: string | null }>('/api/tournament/status');
    matchweeks.value = status.matchweeks;
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
  const [lu, sc] = await Promise.all([
    api.get<{ lineup: Lineup | null; squad: SquadClub[] }>(`/api/matchweeks/${selectedMw.value}/lineup`),
    api.get<{ score: WeekScore | null }>(`/api/matchweeks/${selectedMw.value}/score`),
  ]);
  lineup.value = lu.lineup;
  squad.value = lu.squad;
  score.value = sc.score;
  benchId.value = lu.lineup?.benchTeamId ?? null;
  captainId.value = lu.lineup?.captainTeamId ?? null;
}

async function save() {
  if (!selectedMw.value || !benchId.value || !captainId.value) return;
  saving.value = true;
  try {
    await api.put(`/api/matchweeks/${selectedMw.value}/lineup`, {
      benchTeamId: benchId.value,
      captainTeamId: captainId.value,
    });
    toast.add({ severity: 'success', summary: 'Dizi kaydedildi', life: 2500 });
    await loadWeek();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4500 });
  } finally {
    saving.value = false;
  }
}

function lineFor(teamId: string): ScoreLine | undefined {
  return score.value?.lines.find((l) => l.teamId === teamId);
}
function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata';
}

onMounted(() => {
  loadAll();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
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
    <template v-else-if="!squad.length">
      <Message severity="warn" :closable="false">
        Önce kalıcı kadronu seç. <RouterLink to="/kadro">Kadro seç →</RouterLink>
      </Message>
    </template>
    <template v-else>
      <!-- Lock / status banner -->
      <Message v-if="isComplete" severity="success" :closable="false">
        Bu hafta tamamlandı — puanlar kesinleşti.
      </Message>
      <Message v-else-if="!currentMw?.opened" severity="secondary" :closable="false">
        Bu hafta henüz düzenlemeye açılmadı (önceki hafta başlayınca açılır).
      </Message>
      <Message v-else-if="editable && countdown" severity="info" :closable="false">
        Kilide kalan: <strong>{{ countdown }}</strong>
      </Message>
      <Message v-else-if="!editable" severity="warn" :closable="false">
        Hafta kilitlendi — dizi değiştirilemez.
      </Message>

      <!-- Crest wall -->
      <div class="crest-wall">
        <div
          v-for="club in squad"
          :key="club.teamId"
          class="club"
          :class="{ benched: club.teamId === benchId, captain: club.teamId === captainId }"
        >
          <RouterLink :to="`/takim/${club.teamId}`" class="crest-link">
            <span class="crest">{{ initials(club.name) }}</span>
          </RouterLink>
          <div class="club-name">{{ club.name }}</div>
          <div class="badges">
            <Tag v-if="club.teamId === captainId" severity="warn" value="K ×2" />
            <Tag v-if="club.teamId === benchId" severity="secondary" value="Bench" />
            <span v-if="lineFor(club.teamId)" class="pts" :style="{ color: (lineFor(club.teamId)!.contributed) >= 0 ? '#166534' : '#b91c1c' }">
              {{ lineFor(club.teamId)!.benched && !lineFor(club.teamId)!.captain ? 'puan yazılmadı' : (lineFor(club.teamId)!.contributed >= 0 ? '+' : '') + lineFor(club.teamId)!.contributed }}
            </span>
          </div>
          <div v-if="editable" class="controls">
            <button class="mini" :class="{ on: club.teamId === benchId }" @click="setBench(club.teamId)">Bench</button>
            <button class="mini" :class="{ on: club.teamId === captainId }" :disabled="club.teamId === benchId" @click="setCaptain(club.teamId)">Kaptan</button>
          </div>
        </div>
      </div>

      <div v-if="editable" style="display: flex; gap: 1rem; align-items: center">
        <Button label="Diziyi kaydet" icon="pi pi-check" :disabled="!dirty" :loading="saving" @click="save" />
        <span v-if="!lineup?.saved" style="color: #a55; font-size: 0.85rem">Varsayılan dizi (henüz kaydetmedin)</span>
      </div>

      <!-- Score / wrap card -->
      <div v-if="score" class="wrap">
        <div class="wrap-head">
          <span>{{ isComplete ? 'Hafta kapanış' : 'Anlık puan' }}</span>
          <span class="wrap-total">{{ score.total }}</span>
        </div>
        <table class="lines">
          <tbody>
            <tr v-for="l in score.lines" :key="l.teamId" :class="{ muted: l.benched && !l.captain }">
              <td>{{ l.name }}</td>
              <td>
                <Tag v-if="l.captain" severity="warn" :value="`K ×${l.multiplier}`" />
                <Tag v-else-if="l.benched" severity="secondary" value="Bench" />
              </td>
              <td style="text-align: right">
                <span v-if="l.benched && !l.captain" style="color: #99a">puan yazılmadı</span>
                <span v-else>taban {{ l.basePoints }} → <strong>{{ l.contributed >= 0 ? '+' : '' }}{{ l.contributed }}</strong></span>
              </td>
            </tr>
          </tbody>
        </table>
        <small v-if="!isComplete" style="color: #889">Hafta bitene kadar sağlanan skorlarla anlık hesaplanır.</small>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crest-wall {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}
.club {
  background: #fff;
  border-radius: 10px;
  padding: 1rem 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  border: 2px solid transparent;
}
.club.captain { border-color: #f59e0b; }
.club.benched { opacity: 0.55; }
.crest-link { text-decoration: none; }
.crest {
  width: 54px; height: 54px; border-radius: 50%;
  background: var(--brand); color: #fff; display: grid; place-items: center; font-weight: 700;
}
.club-name { font-size: 0.9rem; text-align: center; font-weight: 600; }
.badges { display: flex; gap: 0.3rem; align-items: center; flex-wrap: wrap; justify-content: center; }
.pts { font-size: 0.8rem; font-weight: 700; }
.controls { display: flex; gap: 0.35rem; margin-top: 0.25rem; }
.mini {
  font: inherit; font-size: 0.78rem; padding: 0.25rem 0.55rem; border-radius: 6px;
  border: 1px solid #cdd6e6; background: #f7f8fc; cursor: pointer;
}
.mini.on { background: var(--brand-accent); color: #fff; border-color: var(--brand-accent); }
.mini:disabled { opacity: 0.4; cursor: not-allowed; }
.wrap { background: #fff; border-radius: 10px; padding: 1rem 1.25rem; }
.wrap-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 0.5rem; }
.wrap-total { font-size: 1.8rem; color: var(--brand); }
.lines { width: 100%; border-collapse: collapse; }
.lines td { padding: 0.4rem 0.3rem; border-bottom: 1px solid #eef; font-size: 0.9rem; }
.lines tr.muted td { color: #99a; }
</style>
