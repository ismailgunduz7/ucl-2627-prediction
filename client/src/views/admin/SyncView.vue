<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';

interface SyncSummary { provider: string; fixturesSeen: number; matchesUpserted: number; matchesFinished: number; skippedOverride: number; unmapped: number }
interface SyncRun { id: string; provider: string; status: string; trigger: string; finished_at: string; fixtures_seen: number; matches_upserted: number; matches_finished: number }
interface SchedulerStatus { enabled: boolean; polling: boolean; provider: string | null; pausedReason: 'mock_provider' | null; nextRunAt: string | null; lastRunAt: string | null; lastStatus: 'success' | 'error' | null; lastError: string | null; consecutiveFailures: number; throttled: boolean }

const toast = useToast();
const provider = ref<'mock' | 'football_data'>('mock');
const simulatedNow = ref<string>('');
const running = ref(false);
const lastSummary = ref<SyncSummary | null>(null);
const runs = ref<SyncRun[]>([]);
const scheduler = ref<SchedulerStatus | null>(null);
let statusTimer: ReturnType<typeof setInterval> | null = null;

const providerOptions = [
  { label: 'Mock (simülasyon)', value: 'mock' },
  { label: 'football-data.org', value: 'football_data' },
];

async function loadRuns() {
  const res = await api.get<{ runs: SyncRun[]; scheduler: SchedulerStatus }>('/api/admin/sync/runs');
  runs.value = res.runs;
  scheduler.value = res.scheduler;
}

const scheduleLine = computed(() => {
  const s = scheduler.value;
  if (!s) return '';
  if (!s.enabled) return 'Otomatik yoklama kapalı — skorlar yalnızca buradan çektiğinde güncelleniyor.';
  if (s.pausedReason === 'mock_provider') {
    return 'Mock sağlayıcı seçili olduğu için arka planda yoklama yapılmıyor: simülasyon saatini sen veriyorsun. Gerçek sağlayıcıya geçince kendiliğinden başlar.';
  }
  if (s.polling) return 'Şu anda sağlayıcıdan veri çekiliyor.';
  if (s.consecutiveFailures > 0) {
    const reason = s.throttled ? 'Sağlayıcı istek sınırına takıldı' : 'Son yoklama başarısız oldu';
    return `${reason} (${s.consecutiveFailures}. deneme). Yeniden deneme ${time(s.nextRunAt)}.`;
  }
  return `Sıradaki yoklama ${time(s.nextRunAt)}. Maç oynanırken sıklaşır, sakin dönemde seyrelir.`;
});

function time(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—';
}
async function runSync() {
  running.value = true;
  try {
    const body: Record<string, unknown> = { provider: provider.value };
    if (provider.value === 'mock' && simulatedNow.value) body.simulatedNow = new Date(simulatedNow.value).toISOString();
    const res = await api.post<{ summary: SyncSummary }>('/api/admin/sync', body);
    lastSummary.value = res.summary;
    toast.add({ severity: 'success', summary: 'Sync tamam', detail: `${res.summary.matchesFinished} maç bitti`, life: 3500 });
    await loadRuns();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Sync hatası', detail: msg(e), life: 5000 });
  } finally {
    running.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
function fmt(iso: string) { return new Date(iso).toLocaleString('tr-TR'); }
onMounted(() => {
  void loadRuns();
  statusTimer = setInterval(() => void loadRuns(), 30_000);
});
onBeforeUnmount(() => { if (statusTimer) clearInterval(statusTimer); });
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Veri senkronizasyonu" subtitle="Skorları sağlayıcıdan buradan çekiyorsun. Katılımcı sayfaları hep veritabanından okur." />

    <section v-if="scheduler" class="surface-card card-pad schedule">
      <Tag
        :severity="!scheduler.enabled || scheduler.pausedReason ? 'secondary' : scheduler.consecutiveFailures ? 'warn' : 'success'"
        :value="!scheduler.enabled ? 'Kapalı' : scheduler.pausedReason ? 'Beklemede' : 'Otomatik'"
      />
      <p>{{ scheduleLine }}</p>
      <small v-if="scheduler.lastError" class="text-muted">{{ scheduler.lastError }}</small>
    </section>

    <Message severity="info" :closable="false">
      Mock sağlayıcı, ileri tarihli fikstürleri simüle saatle ilerletir — gerçek 2026/27 verisi
      gelene kadar akışı denemek için. Elle sonuç girdiğin maçlar sync'te atlanır.
    </Message>

    <section class="surface-card card-pad">
      <div class="controls">
        <div class="form-field">
          <label>Sağlayıcı</label>
          <Select v-model="provider" :options="providerOptions" option-label="label" option-value="value" style="min-width: 200px" />
        </div>
        <div v-if="provider === 'mock'" class="form-field">
          <label>Simüle saat (opsiyonel)</label>
          <input v-model="simulatedNow" type="datetime-local" class="dt" />
        </div>
        <Button label="Sync çalıştır" icon="pi pi-sync" :loading="running" @click="runSync" />
      </div>
    </section>

    <div v-if="lastSummary" class="summary">
      <div class="surface-card card-pad stat"><b>{{ lastSummary.fixturesSeen }}</b><small class="text-muted">fikstür</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesUpserted }}</b><small class="text-muted">güncellendi</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesFinished }}</b><small class="text-muted">bitti</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.skippedOverride }}</b><small class="text-muted">override atlandı</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.unmapped }}</b><small class="text-muted">eşleşmeyen</small></div>
    </div>

    <section class="surface-card" style="overflow: hidden">
      <div class="card-pad section-title" style="margin: 0; border-bottom: 1px solid var(--color-border)">Son çalışmalar</div>
      <table class="runs">
        <thead>
          <tr><th>Zaman</th><th>Sağlayıcı</th><th>Kaynak</th><th>Durum</th><th>Fikstür</th><th>Güncel.</th><th>Bitti</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id">
            <td>{{ fmt(r.finished_at) }}</td>
            <td>{{ r.provider }}</td>
            <td>{{ r.trigger === 'scheduled' ? 'otomatik' : 'elle' }}</td>
            <td><Tag :severity="r.status === 'success' ? 'success' : 'danger'" :value="r.status" /></td>
            <td>{{ r.fixtures_seen }}</td>
            <td>{{ r.matches_upserted }}</td>
            <td>{{ r.matches_finished }}</td>
          </tr>
          <tr v-if="!runs.length"><td colspan="7" class="empty-state">Henüz sync çalışmadı.</td></tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.schedule { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.schedule p { margin: 0; }
.schedule small { flex-basis: 100%; }
.controls { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
.dt { padding: 0.6rem 0.7rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font: inherit; background: var(--color-surface); color: var(--color-text); }
.summary { display: flex; gap: 1rem; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; align-items: center; min-width: 96px; }
.stat b { font-size: 1.5rem; color: var(--color-primary); }
.runs { width: 100%; border-collapse: collapse; }
.runs th, .runs td { padding: 0.55rem 0.7rem; text-align: center; border-bottom: 1px solid var(--color-border); font-size: 0.88rem; }
.runs thead th { background: var(--color-bg-subtle); font-weight: 700; color: var(--color-text-secondary); }
.runs tbody tr:last-child td { border-bottom: none; }
</style>
