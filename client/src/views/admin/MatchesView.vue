<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import { groupMatchweeks, matchweekTitle, type MatchweekMenu } from '@/lib/matchweeks';

interface MatchRow {
  id: string; matchweek_id: string; status: string;
  home_name: string; home_short: string; away_name: string; away_short: string;
  home_score: number | null; away_score: number | null; is_manual_override: boolean;
}
interface MwOption { id: string; label: string; menu: MatchweekMenu }

const toast = useToast();
const matchweeks = ref<MwOption[]>([]);
const weekGroups = computed(() => groupMatchweeks(matchweeks.value));
const selectedMw = ref<string | null>(null);
const matches = ref<MatchRow[]>([]);
const loading = ref(false);
const savingId = ref<string | null>(null);

const statusOptions = [
  { label: 'Planlandı', value: 'scheduled' }, { label: 'Canlı', value: 'live' },
  { label: 'Bitti', value: 'finished' }, { label: 'Ertelendi', value: 'postponed' }, { label: 'İptal', value: 'cancelled' },
];

async function loadMatchweeks() {
  const res = await api.get<{ matchweeks: MwOption[] }>('/api/tournament/status');
  matchweeks.value = res.matchweeks.map((m) => ({ id: m.id, label: m.label, menu: m.menu }));
  if (!selectedMw.value && weekGroups.value.length) {
    selectedMw.value = weekGroups.value[0]!.items[0]!.value;
  }
}
async function loadMatches() {
  if (!selectedMw.value) return;
  loading.value = true;
  try {
    const res = await api.get<{ matches: MatchRow[] }>(`/api/admin/matches?matchweek=${encodeURIComponent(selectedMw.value)}`);
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
    await api.put(`/api/admin/matches/${m.id}/result`, { homeScore: m.home_score, awayScore: m.away_score, status: m.status });
    toast.add({ severity: 'success', summary: 'Kaydedildi', life: 2000 });
    await loadMatches();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4000 });
  } finally {
    savingId.value = null;
  }
}
async function clearOverride(m: MatchRow) {
  try {
    await api.post(`/api/admin/matches/${m.id}/clear-override`);
    toast.add({ severity: 'success', summary: 'Override kaldırıldı', life: 2000 });
    await loadMatches();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
onMounted(async () => { await loadMatchweeks(); await loadMatches(); });
watch(selectedMw, loadMatches);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Maçlar" subtitle="Bir maçı bitirdiğinde kulüp puanları otomatik hesaplanır. Elle girdiğin sonucu sync ezmez.">
      <template #actions>
        <Select
          v-model="selectedMw"
          :options="weekGroups"
          option-group-label="label"
          option-group-children="items"
          option-label="label"
          option-value="value"
          placeholder="Hafta"
          style="min-width: 200px"
        >
          <template #value="{ value }">{{ matchweekTitle(matchweeks, value) || 'Hafta' }}</template>
        </Select>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <div v-else class="page-stack" style="gap: 0.75rem">
      <div v-for="m in matches" :key="m.id" class="surface-card match-row">
        <div class="teams">
          <span class="side home">{{ m.home_name }}</span>
          <div class="score">
            <InputNumber v-model="m.home_score" :min="0" :use-grouping="false" :input-style="{ width: '2.6rem', textAlign: 'center' }" />
            <span class="text-muted">–</span>
            <InputNumber v-model="m.away_score" :min="0" :use-grouping="false" :input-style="{ width: '2.6rem', textAlign: 'center' }" />
          </div>
          <span class="side away">{{ m.away_name }}</span>
        </div>
        <div class="controls">
          <Select v-model="m.status" :options="statusOptions" option-label="label" option-value="value" class="status-select" />
          <Tag v-if="m.is_manual_override" severity="warn" value="elle girildi" />
          <Button v-if="m.is_manual_override" label="Geri al" size="small" severity="secondary" text @click="clearOverride(m)" />
          <Button label="Kaydet" size="small" :loading="savingId === m.id" @click="saveResult(m)" />
        </div>
      </div>
      <p v-if="!matches.length" class="empty-state">Bu hafta için maç yok.</p>
    </div>
  </div>
</template>

<style scoped>
.match-row { padding: 0.85rem 1.1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.status-select { min-width: 140px; }
.teams { display: flex; align-items: center; gap: 0.75rem; }
.side { min-width: 140px; font-size: 0.92rem; font-weight: 600; }
.side.home { text-align: right; }
.score { display: flex; align-items: center; gap: 0.4rem; }
.controls { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
</style>
