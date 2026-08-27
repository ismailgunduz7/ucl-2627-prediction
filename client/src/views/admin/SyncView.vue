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
  { label: 'Simülasyon', value: 'mock' },
  { label: 'football-data.org', value: 'football_data' },
];
const PROVIDER_LABEL: Record<string, string> = {
  mock: 'simülasyon',
  football_data: 'football-data.org',
};
function providerLabel(name: string) { return PROVIDER_LABEL[name] ?? name; }

async function loadRuns() {
  const res = await api.get<{ runs: SyncRun[]; scheduler: SchedulerStatus }>('/api/admin/sync/runs');
  runs.value = res.runs;
  scheduler.value = res.scheduler;
}

const scheduleLine = computed(() => {
  const s = scheduler.value;
  if (!s) return '';
  if (!s.enabled) return 'Arka planda kimse veri çekmiyor. Skorlar sadece sen buradan çektiğinde güncelleniyor.';
  if (s.pausedReason === 'mock_provider') {
    return 'Simülasyon seçili olduğu için arka plan beklemede: saati sen veriyorsun. Gerçek sağlayıcıya geçtiğinde kendiliğinden başlar.';
  }
  if (s.polling) return 'Şu anda skorlar çekiliyor.';
  if (s.consecutiveFailures > 0) {
    const reason = s.throttled ? 'Sağlayıcı istek sınırına takıldı' : 'Son deneme başarısız oldu';
    return `${reason}. ${s.consecutiveFailures}. denemeden sonra tekrar ${time(s.nextRunAt)} deneyecek.`;
  }
  return `Sıradaki kontrol ${time(s.nextRunAt)}. Maç oynanırken sıklaşır, sakin dönemde seyrelir.`;
});

function time(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-';
}
async function runSync() {
  running.value = true;
  try {
    const body: Record<string, unknown> = { provider: provider.value };
    if (provider.value === 'mock' && simulatedNow.value) body.simulatedNow = new Date(simulatedNow.value).toISOString();
    const res = await api.post<{ summary: SyncSummary }>('/api/admin/sync', body);
    lastSummary.value = res.summary;
    toast.add({ severity: 'success', summary: `${res.summary.matchesFinished} maç bitti`, life: 3500 });
    await loadRuns();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Skorlar çekilemedi', detail: msg(e), life: 5000 });
  } finally {
    running.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
function fmt(iso: string) { return new Date(iso).toLocaleString('tr-TR'); }

/** Start on whichever provider the season is actually configured for (§5.1). */
async function loadConfiguredProvider() {
  try {
    const res = await api.get<{ config: { sync_provider: 'mock' | 'football_data' } }>('/api/admin/config');
    provider.value = res.config.sync_provider;
  } catch {
    /* Leave the default; the select is still usable. */
  }
}

onMounted(() => {
  void loadConfiguredProvider();
  void loadRuns();
  statusTimer = setInterval(() => void loadRuns(), 30_000);
});
onBeforeUnmount(() => { if (statusTimer) clearInterval(statusTimer); });
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Skor çekme" subtitle="Maç sonuçları buradan geliyor. Oyuncuların gördüğü her şey veritabanından okunur, sağlayıcıya sadece bu sayfa ve arka plan işi gider." />

    <section v-if="scheduler" class="surface-card card-pad schedule">
      <Tag
        :severity="!scheduler.enabled || scheduler.pausedReason ? 'secondary' : scheduler.consecutiveFailures ? 'warn' : 'success'"
        :value="!scheduler.enabled ? 'Kapalı' : scheduler.pausedReason ? 'Beklemede' : 'Otomatik'"
      />
      <p>{{ scheduleLine }}</p>
      <small v-if="scheduler.lastError" class="text-muted">{{ scheduler.lastError }}</small>
    </section>

    <Message severity="info" :closable="false">
      Simülasyon, ileri tarihli fikstürleri verdiğin saate göre oynatır. Gerçek 2026/27 verisi
      gelene kadar akışı böyle deneyebilirsin. Skorunu elle girdiğin maçlara dokunmaz.
    </Message>

    <section class="surface-card card-pad">
      <div class="controls">
        <div class="form-field">
          <label>Sağlayıcı</label>
          <Select v-model="provider" :options="providerOptions" option-label="label" option-value="value" style="min-width: 200px" />
        </div>
        <div v-if="provider === 'mock'" class="form-field">
          <label>Simülasyon saati</label>
          <input v-model="simulatedNow" type="datetime-local" class="dt" />
        </div>
        <Button label="Skorları çek" icon="pi pi-sync" :loading="running" @click="runSync" />
      </div>
    </section>

    <div v-if="lastSummary" class="summary">
      <div class="surface-card card-pad stat"><b>{{ lastSummary.fixturesSeen }}</b><small class="text-muted">maç görüldü</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesUpserted }}</b><small class="text-muted">güncellendi</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesFinished }}</b><small class="text-muted">bitti</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.skippedOverride }}</b><small class="text-muted">elle girildiği için atlandı</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.unmapped }}</b><small class="text-muted">eşleşmedi</small></div>
    </div>

    <section class="surface-card" style="overflow: hidden">
      <div class="card-pad section-title" style="margin: 0; border-bottom: 1px solid var(--color-border)">Son çekilenler</div>
      <div style="overflow-x: auto">
        <table class="runs">
          <thead>
            <tr><th>Zaman</th><th>Sağlayıcı</th><th>Kaynak</th><th>Sonuç</th><th>Görülen</th><th>Güncellenen</th><th>Biten</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td>{{ fmt(r.finished_at) }}</td>
              <td>{{ providerLabel(r.provider) }}</td>
              <td>{{ r.trigger === 'scheduled' ? 'otomatik' : 'elle' }}</td>
              <td>
                <Tag
                  :severity="r.status === 'success' ? 'success' : 'danger'"
                  :value="r.status === 'success' ? 'başarılı' : 'hata'"
                />
              </td>
              <td>{{ r.fixtures_seen }}</td>
              <td>{{ r.matches_upserted }}</td>
              <td>{{ r.matches_finished }}</td>
            </tr>
            <tr v-if="!runs.length"><td colspan="7" class="empty-state">Henüz skor çekilmedi.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.schedule { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.schedule p { margin: 0; flex: 1; min-width: 240px; }
.schedule small { flex-basis: 100%; }
.controls { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
.dt {
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-border-control);
  border-radius: var(--radius-sm);
  font: inherit;
  background: var(--color-surface);
  color: var(--color-text);
}
.summary { display: flex; gap: 1rem; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; min-width: 110px; flex: 1; text-align: center; }
.stat b { font-size: var(--text-xl); color: var(--color-primary); }
.stat small { font-size: var(--text-2xs); line-height: 1.25; }
.runs { width: 100%; border-collapse: collapse; min-width: 720px; }
.runs th, .runs td { padding: 0.55rem 0.7rem; text-align: center; border-bottom: 1px solid var(--color-border); font-size: 0.88rem; }
.runs thead th { background: var(--color-bg-subtle); font-weight: 700; color: var(--color-text-secondary); }
.runs tbody tr:last-child td { border-bottom: none; }
</style>
