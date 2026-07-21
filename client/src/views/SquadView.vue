<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { useTournamentStore } from '@/stores/tournament';
import { ApiRequestError } from '@/lib/api';

const store = useTournamentStore();
const toast = useToast();
const router = useRouter();

const loading = ref(true);
const saving = ref(false);
// tierId -> selected teamId
const picks = ref<Record<number, string | null>>({});
const now = ref(Date.now());
let timer: number | undefined;

const lockAt = computed(() => store.status?.selectionLock.lockAt ?? null);
const locked = computed(
  () => store.squadLocked || (lockAt.value ? now.value >= new Date(lockAt.value).getTime() : false),
);

const countdown = computed(() => {
  if (!lockAt.value) return null;
  const ms = new Date(lockAt.value).getTime() - now.value;
  if (ms <= 0) return 'Kilitlendi';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return d > 0 ? `${d}g ${h}s ${m}dk` : `${h}s ${m}dk ${s}sn`;
});

const allPicked = computed(() => store.pots.length > 0 && store.pots.every((p) => picks.value[p.tierId]));

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase();
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([store.loadTeams(), store.loadStatus(), store.loadSquad()]);
    // Pre-fill from existing squad.
    for (const entry of store.squad) picks.value[entry.tierId] = entry.teamId;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}

function select(tierId: number, teamId: string) {
  if (locked.value) return;
  picks.value[tierId] = picks.value[tierId] === teamId ? null : teamId;
}

async function save() {
  if (!allPicked.value) return;
  saving.value = true;
  try {
    const teamIds = store.pots.map((p) => picks.value[p.tierId]!).filter(Boolean);
    await store.saveSquad(teamIds);
    toast.add({ severity: 'success', summary: 'Kadro kaydedildi', life: 2500 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 5000 });
  } finally {
    saving.value = false;
  }
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata';
}

onMounted(() => {
  load();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <div class="page stack">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h1 style="margin: 0">Kadro seçimi</h1>
      <Button label="Geri" icon="pi pi-arrow-left" text @click="router.push('/')" />
    </div>

    <Message v-if="lockAt && !locked" severity="info" :closable="false">
      Seçim kilidi: <strong>{{ countdown }}</strong> (MW1 ilk maçından 5 dk önce)
    </Message>
    <Message v-else-if="locked" severity="warn" :closable="false">
      Kadro seçim süresi kilitlendi. Değişiklik yapılamaz.
    </Message>

    <p style="color: #556; margin: 0">
      Her pottan tam olarak bir kulüp seç (toplam {{ store.status?.squadSize ?? 4 }}). Kadro sezon
      boyunca kalıcıdır; haftalık bench/kaptan ve jokerlerle yönetilir.
    </p>

    <div v-if="loading">Yükleniyor…</div>

    <div v-else class="pot-grid">
      <div v-for="pot in store.pots" :key="pot.tierId" class="pot-col">
        <div class="pot-head">
          <strong>{{ pot.tierName }}</strong>
          <Tag v-if="picks[pot.tierId]" severity="success" value="✓" />
        </div>
        <button
          v-for="team in pot.teams"
          :key="team.id"
          type="button"
          class="team-row"
          :class="{ selected: picks[pot.tierId] === team.id, disabled: locked }"
          :disabled="locked"
          @click="select(pot.tierId, team.id)"
        >
          <span class="crest">{{ initials(team.name) }}</span>
          <span class="team-name">
            {{ team.name }}
            <small v-if="team.country" style="color: #889">· {{ team.country }}</small>
          </span>
          <Tag v-if="team.eliminated" severity="danger" value="Elendi" style="margin-left: auto" />
        </button>
      </div>
    </div>

    <div v-if="!loading" style="position: sticky; bottom: 0; padding: 0.75rem 0; background: #f4f6fb">
      <Button
        :label="locked ? 'Kilitli' : 'Kadroyu kaydet'"
        icon="pi pi-check"
        :disabled="locked || !allPicked"
        :loading="saving"
        @click="save"
      />
      <span v-if="!allPicked && !locked" style="margin-left: 0.75rem; color: #a55">
        {{ store.pots.filter((p) => picks[p.tierId]).length }}/{{ store.pots.length }} pot seçildi
      </span>
    </div>
  </div>
</template>

<style scoped>
.pot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}
.pot-col {
  background: #fff;
  border-radius: 10px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.pot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid #eef;
  margin-bottom: 0.25rem;
}
.team-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #f7f8fc;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.team-row:hover:not(.disabled) {
  background: #eef2ff;
}
.team-row.selected {
  border-color: var(--brand-accent);
  background: #e5edff;
}
.team-row.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.crest {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
}
.team-name {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  font-size: 0.9rem;
}
</style>
