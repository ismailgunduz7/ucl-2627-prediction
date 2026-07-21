<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';

interface MatchRow {
  id: string;
  matchweek_id: string;
  matchweek_label: string;
  kickoff_at: string;
  status: string;
  home_name: string;
  home_short: string;
  away_name: string;
  away_short: string;
  home_score: number | null;
  away_score: number | null;
  is_manual_override: boolean;
}
interface MwOption {
  id: string;
  label: string;
}

const toast = useToast();
const matchweeks = ref<MwOption[]>([]);
const selectedMw = ref<string | null>(null);
const matches = ref<MatchRow[]>([]);
const loading = ref(false);
const savingId = ref<string | null>(null);

const statusOptions = [
  { label: 'Planlandı', value: 'scheduled' },
  { label: 'Canlı', value: 'live' },
  { label: 'Bitti', value: 'finished' },
  { label: 'Ertelendi', value: 'postponed' },
  { label: 'İptal', value: 'cancelled' },
];
const statusSeverity: Record<string, string> = {
  scheduled: 'secondary',
  live: 'info',
  finished: 'success',
  postponed: 'warn',
  cancelled: 'danger',
};

async function loadMatchweeks() {
  const res = await api.get<{ matchweeks: { id: string; label: string; act: string }[] }>(
    '/api/tournament/status',
  );
  matchweeks.value = res.matchweeks.map((m) => ({ id: m.id, label: m.label }));
  if (!selectedMw.value && matchweeks.value.length) selectedMw.value = matchweeks.value[0]!.id;
}

async function loadMatches() {
  if (!selectedMw.value) return;
  loading.value = true;
  try {
    const res = await api.get<{ matches: MatchRow[] }>(
      `/api/admin/matches?matchweek=${encodeURIComponent(selectedMw.value)}`,
    );
    matches.value = res.matches;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}

async function saveResult(m: MatchRow) {
  savingId.value = m.id;
  try {
    await api.put(`/api/admin/matches/${m.id}/result`, {
      homeScore: m.home_score,
      awayScore: m.away_score,
      status: m.status,
    });
    toast.add({ severity: 'success', summary: 'Kaydedildi', detail: `${m.home_short}-${m.away_short}`, life: 2000 });
    await loadMatches();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4000 });
  } finally {
    savingId.value = null;
  }
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata';
}

onMounted(async () => {
  await loadMatchweeks();
  await loadMatches();
});
watch(selectedMw, loadMatches);
</script>

<template>
  <div class="stack">
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem">
      <h1 style="margin: 0">Maçlar & sonuç girişi</h1>
      <Select
        v-model="selectedMw"
        :options="matchweeks"
        option-label="label"
        option-value="id"
        placeholder="Hafta"
        style="min-width: 160px"
      />
    </div>

    <p style="color: #889; margin: 0; font-size: 0.85rem">
      Bir maçı “Bitti” yapıp skoru kaydettiğinizde kulüp puanları otomatik hesaplanır (manuel
      override işaretlenir). Sync (Faz 3) bu değerleri ezmeyecek.
    </p>

    <div v-if="loading">Yükleniyor…</div>

    <div v-else class="stack">
      <div v-for="m in matches" :key="m.id" class="match-row">
        <div class="teams">
          <span class="side home">{{ m.home_name }}</span>
          <div class="score">
            <InputNumber v-model="m.home_score" :min="0" :use-grouping="false" :input-style="{ width: '2.6rem', textAlign: 'center' }" />
            <span>–</span>
            <InputNumber v-model="m.away_score" :min="0" :use-grouping="false" :input-style="{ width: '2.6rem', textAlign: 'center' }" />
          </div>
          <span class="side away">{{ m.away_name }}</span>
        </div>
        <div class="controls">
          <Select v-model="m.status" :options="statusOptions" option-label="label" option-value="value" style="min-width: 130px" />
          <Tag :severity="statusSeverity[m.status] ?? 'secondary'" :value="statusOptions.find((s) => s.value === m.status)?.label" />
          <Tag v-if="m.is_manual_override" severity="warn" value="override" />
          <Button
            icon="pi pi-save"
            label="Kaydet"
            size="small"
            :loading="savingId === m.id"
            @click="saveResult(m)"
          />
        </div>
      </div>
      <p v-if="!matches.length" style="color: #889">Bu hafta için maç yok.</p>
    </div>
  </div>
</template>

<style scoped>
.match-row {
  background: #fff;
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.teams {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.side {
  min-width: 150px;
  font-size: 0.92rem;
}
.side.home {
  text-align: right;
}
.score {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
