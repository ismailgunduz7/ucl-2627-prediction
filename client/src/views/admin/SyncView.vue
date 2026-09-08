<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import Button from 'primevue/button';
import { RefreshCw } from '@lucide/vue';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import { formatDateTime, formatTime } from '@/lib/format';

interface SyncSummary { provider: string; fixturesSeen: number; matchesCreated: number; matchesUpserted: number; matchesFinished: number; skippedOverride: number; unmapped: number }
interface SyncRun { id: string; provider: string; status: string; trigger: string; finished_at: string; fixtures_seen: number; matches_upserted: number; matches_finished: number }
type SyncDriver = 'timer' | 'cron' | 'off';
interface SchedulerStatus { driver: SyncDriver; enabled: boolean; polling: boolean; provider: string | null; pausedReason: 'mock_provider' | null; nextRunAt: string | null; lastRunAt: string | null; lastStatus: 'success' | 'error' | null; lastError: string | null; consecutiveFailures: number; throttled: boolean }

const { t } = useI18n();
const toast = useToast();
const provider = ref<'mock' | 'football_data'>('mock');
const simulatedNow = ref<string>('');
const running = ref(false);
const lastSummary = ref<SyncSummary | null>(null);
const runs = ref<SyncRun[]>([]);
const scheduler = ref<SchedulerStatus | null>(null);
let statusTimer: ReturnType<typeof setInterval> | null = null;

const providerOptions = computed(() => [
  { label: t('admin.sync.providerMock'), value: 'mock' },
  { label: 'football-data.org', value: 'football_data' },
]);
function providerLabel(name: string) {
  return name === 'mock' ? t('admin.sync.providerMockShort') : 'football-data.org';
}

async function loadRuns() {
  const res = await api.get<{ runs: SyncRun[]; scheduler: SchedulerStatus }>('/api/admin/sync/runs');
  runs.value = res.runs;
  scheduler.value = res.scheduler;
}

const scheduleLine = computed(() => {
  const s = scheduler.value;
  if (!s) return '';
  if (s.driver === 'off') return t('admin.sync.scheduleOff');
  if (s.driver === 'cron') {
    if (s.pausedReason === 'mock_provider') return t('admin.sync.scheduleCronPaused');
    return t('admin.sync.scheduleCron', { time: time(s.lastRunAt) });
  }
  if (s.pausedReason === 'mock_provider') return t('admin.sync.scheduleTimerPaused');
  if (s.polling) return t('admin.sync.schedulePolling');
  if (s.consecutiveFailures > 0) {
    const reason = s.throttled ? t('admin.sync.throttled') : t('admin.sync.lastFailed');
    return t('admin.sync.scheduleRetry', {
      reason,
      attempts: s.consecutiveFailures,
      time: time(s.nextRunAt),
    });
  }
  return t('admin.sync.scheduleNext', { time: time(s.nextRunAt) });
});

function driverLabel(s: SchedulerStatus) {
  if (s.driver === 'off') return t('admin.sync.driverOff');
  if (s.pausedReason) return t('admin.sync.driverPaused');
  return s.driver === 'cron' ? t('admin.sync.driverCron') : t('admin.sync.driverTimer');
}
function time(iso: string | null) {
  return formatTime(iso);
}
async function runSync() {
  running.value = true;
  try {
    const body: Record<string, unknown> = { provider: provider.value };
    if (provider.value === 'mock' && simulatedNow.value) body.simulatedNow = new Date(simulatedNow.value).toISOString();
    const res = await api.post<{ summary: SyncSummary }>('/api/admin/sync', body);
    lastSummary.value = res.summary;
    toast.add({ severity: 'success', summary: t('admin.sync.finishedCount', { count: res.summary.matchesFinished }), life: 3500 });
    await loadRuns();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.sync.failed'), detail: msg(e), life: 5000 });
  } finally {
    running.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : t('common.unexpectedError'); }
function fmt(iso: string) { return formatDateTime(iso); }

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
    <PageHeader :title="$t('nav.admin.sync')" :subtitle="$t('admin.sync.subtitle')" />

    <section v-if="scheduler" class="surface-card card-pad schedule">
      <Tag
        :severity="scheduler.driver === 'off' || scheduler.pausedReason ? 'secondary' : scheduler.consecutiveFailures ? 'warn' : 'success'"
        :value="driverLabel(scheduler)"
      />
      <p>{{ scheduleLine }}</p>
      <small v-if="scheduler.lastError" class="text-muted">{{ scheduler.lastError }}</small>
    </section>

    <Message severity="info" :closable="false">{{ $t('admin.sync.notice') }}</Message>

    <section class="surface-card card-pad">
      <div class="controls">
        <div class="form-field">
          <label>{{ $t('admin.sync.provider') }}</label>
          <Select class="select-filter" v-model="provider" :options="providerOptions" option-label="label" option-value="value" />
        </div>
        <div v-if="provider === 'mock'" class="form-field">
          <label>{{ $t('admin.sync.simulatedClock') }}</label>
          <input v-model="simulatedNow" type="datetime-local" class="dt" />
        </div>
        <Button :label="$t('admin.sync.run')" :loading="running" @click="runSync">
          <template #icon><RefreshCw :size="16" /></template>
        </Button>
      </div>
    </section>

    <div v-if="lastSummary" class="summary">
      <div class="surface-card card-pad stat"><b>{{ lastSummary.fixturesSeen }}</b><small class="text-muted">{{ $t('admin.sync.seen') }}</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesCreated }}</b><small class="text-muted">{{ $t('admin.sync.created') }}</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesUpserted }}</b><small class="text-muted">{{ $t('admin.sync.updated') }}</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.matchesFinished }}</b><small class="text-muted">{{ $t('admin.sync.finished') }}</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.skippedOverride }}</b><small class="text-muted">{{ $t('admin.sync.skipped') }}</small></div>
      <div class="surface-card card-pad stat"><b>{{ lastSummary.unmapped }}</b><small class="text-muted">{{ $t('admin.sync.unmapped') }}</small></div>
    </div>

    <section class="surface-card runs-card">
      <div class="card-pad section-title runs-head">
        {{ $t('admin.sync.recent') }}
      </div>
      <div class="table-scroll">
        <table class="runs">
          <thead>
            <tr>
              <th>{{ $t('admin.sync.colTime') }}</th>
              <th>{{ $t('admin.sync.provider') }}</th>
              <th>{{ $t('admin.sync.colSource') }}</th>
              <th>{{ $t('admin.sync.colResult') }}</th>
              <th>{{ $t('admin.sync.colSeen') }}</th>
              <th>{{ $t('admin.sync.colUpdated') }}</th>
              <th>{{ $t('admin.sync.colFinished') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td>{{ fmt(r.finished_at) }}</td>
              <td>{{ providerLabel(r.provider) }}</td>
              <td>{{ r.trigger === 'scheduled' ? $t('admin.sync.automatic') : $t('admin.sync.byHand') }}</td>
              <td>
                <Tag
                  :severity="r.status === 'success' ? 'success' : 'danger'"
                  :value="r.status === 'success' ? $t('admin.sync.ok') : $t('admin.sync.error')"
                />
              </td>
              <td>{{ r.fixtures_seen }}</td>
              <td>{{ r.matches_upserted }}</td>
              <td>{{ r.matches_finished }}</td>
            </tr>
            <tr v-if="!runs.length">
              <td colspan="7" class="empty-state">{{ $t('admin.sync.empty') }}</td>
            </tr>
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

/* The heading sits flush on the list under it: no bottom margin, and the
   rule between them belongs to the heading. */
.runs-card { overflow: hidden; }
.runs-head {
  margin: 0;
  border-bottom: 1px solid var(--color-border);
}
</style>
