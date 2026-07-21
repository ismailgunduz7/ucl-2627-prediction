<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';

interface SyncSummary {
  provider: string;
  fixturesSeen: number;
  matchesUpserted: number;
  matchesFinished: number;
  skippedOverride: number;
  unmapped: number;
}
interface SyncRun {
  id: string;
  provider: string;
  status: string;
  started_at: string;
  finished_at: string;
  fixtures_seen: number;
  matches_upserted: number;
  matches_finished: number;
  error: string | null;
}

const toast = useToast();
const provider = ref<'mock' | 'football_data'>('mock');
const simulatedNow = ref<string>(''); // datetime-local value
const running = ref(false);
const lastSummary = ref<SyncSummary | null>(null);
const runs = ref<SyncRun[]>([]);

const providerOptions = [
  { label: 'Mock (simülasyon)', value: 'mock' },
  { label: 'football-data.org', value: 'football_data' },
];

async function loadRuns() {
  const res = await api.get<{ runs: SyncRun[] }>('/api/admin/sync/runs');
  runs.value = res.runs;
}

async function runSync() {
  running.value = true;
  try {
    const body: Record<string, unknown> = { provider: provider.value };
    if (provider.value === 'mock' && simulatedNow.value) {
      body.simulatedNow = new Date(simulatedNow.value).toISOString();
    }
    const res = await api.post<{ summary: SyncSummary }>('/api/admin/sync', body);
    lastSummary.value = res.summary;
    toast.add({
      severity: 'success',
      summary: 'Sync tamamlandı',
      detail: `${res.summary.matchesFinished} maç bitti, ${res.summary.matchesUpserted} güncellendi`,
      life: 3500,
    });
    await loadRuns();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Sync hatası', detail: msg(e), life: 5000 });
  } finally {
    running.value = false;
  }
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata';
}
function fmt(iso: string) {
  return new Date(iso).toLocaleString('tr-TR');
}

onMounted(loadRuns);
</script>

<template>
  <div class="stack">
    <h1 style="margin: 0">Provider sync</h1>

    <Message severity="info" :closable="false">
      Sadece bu sunucu sağlayıcıyı çağırır; katılımcı okumaları hep DB'den gelir (§5.6). Mock
      sağlayıcı, ileri tarihli mock fikstürleri simüle saatle ilerletir — gerçek 2026–27 verisi
      gelene kadar hattı test etmek için. Manuel override'lı maçlar sync'te atlanır (§5.3).
    </Message>

    <div class="controls">
      <div class="field">
        <label>Sağlayıcı</label>
        <Select v-model="provider" :options="providerOptions" option-label="label" option-value="value" style="min-width: 200px" />
      </div>
      <div v-if="provider === 'mock'" class="field">
        <label>Simüle saat (opsiyonel)</label>
        <input v-model="simulatedNow" type="datetime-local" class="dt" />
        <small style="color: #889">Boş = şu an. MW1 ilk maçı: 2026-09-15 16:45 UTC</small>
      </div>
      <Button label="Sync çalıştır" icon="pi pi-sync" :loading="running" @click="runSync" style="align-self: flex-end" />
    </div>

    <div v-if="lastSummary" class="summary">
      <div class="stat"><b>{{ lastSummary.fixturesSeen }}</b><small>fikstür</small></div>
      <div class="stat"><b>{{ lastSummary.matchesUpserted }}</b><small>güncellendi</small></div>
      <div class="stat"><b>{{ lastSummary.matchesFinished }}</b><small>bitti</small></div>
      <div class="stat"><b>{{ lastSummary.skippedOverride }}</b><small>override atlandı</small></div>
      <div class="stat"><b>{{ lastSummary.unmapped }}</b><small>eşleşmeyen</small></div>
    </div>

    <h3 style="margin: 0.5rem 0 0">Son çalışmalar</h3>
    <table class="runs-table">
      <thead>
        <tr>
          <th>Zaman</th>
          <th>Sağlayıcı</th>
          <th>Durum</th>
          <th>Fikstür</th>
          <th>Güncel.</th>
          <th>Bitti</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in runs" :key="r.id">
          <td>{{ fmt(r.finished_at) }}</td>
          <td>{{ r.provider }}</td>
          <td><Tag :severity="r.status === 'success' ? 'success' : 'danger'" :value="r.status" /></td>
          <td>{{ r.fixtures_seen }}</td>
          <td>{{ r.matches_upserted }}</td>
          <td>{{ r.matches_finished }}</td>
        </tr>
        <tr v-if="!runs.length"><td colspan="6" style="color: #889">Henüz sync çalışmadı.</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
  background: #fff;
  padding: 1rem;
  border-radius: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field label {
  font-size: 0.8rem;
  font-weight: 600;
}
.dt {
  padding: 0.5rem;
  border: 1px solid #cdd6e6;
  border-radius: 6px;
  font: inherit;
}
.summary {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.stat {
  background: #fff;
  border-radius: 8px;
  padding: 0.75rem 1.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 90px;
}
.stat b {
  font-size: 1.5rem;
  color: var(--brand);
}
.stat small {
  color: #667;
}
.runs-table {
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}
.runs-table th,
.runs-table td {
  padding: 0.5rem 0.7rem;
  text-align: center;
  border-bottom: 1px solid #eef;
  font-size: 0.88rem;
}
.runs-table thead th {
  background: #f4f6fb;
}
</style>
