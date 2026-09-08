<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import { Undo2, History } from '@lucide/vue';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import { groupMatchweeks, matchweekTitle, type MatchweekMenu } from '@/lib/matchweeks';
import { formatShortDateTime } from '@/lib/format';

interface MatchRow {
  id: string; matchweek_id: string; status: string;
  home_name: string; home_short: string; away_name: string; away_short: string;
  home_score: number | null; away_score: number | null; is_manual_override: boolean;
}
interface MwOption { id: string; label: string; menu: MatchweekMenu }

const { t } = useI18n();
const toast = useToast();
const matchweeks = ref<MwOption[]>([]);
const weekGroups = computed(() => groupMatchweeks(matchweeks.value));
const selectedMw = ref<string | null>(null);
const matches = ref<MatchRow[]>([]);
const loading = ref(false);
const savingId = ref<string | null>(null);

const STATUSES = ['scheduled', 'live', 'finished', 'postponed', 'cancelled'] as const;
const statusOptions = computed(() =>
  STATUSES.map((value) => ({ value, label: t(`matchStatus.${value}`) })),
);

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
    toast.add({ severity: 'error', summary: t('admin.matches.loadFailed'), detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}
async function saveResult(m: MatchRow) {
  savingId.value = m.id;
  try {
    await api.put(`/api/admin/matches/${m.id}/result`, { homeScore: m.home_score, awayScore: m.away_score, status: m.status });
    toast.add({ severity: 'success', summary: t('admin.matches.scoreSaved'), life: 2000 });
    await loadMatches();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.saveFailed'), detail: msg(e), life: 4000 });
  } finally {
    savingId.value = null;
  }
}
async function clearOverride(m: MatchRow) {
  try {
    await api.post(`/api/admin/matches/${m.id}/clear-override`);
    toast.add({ severity: 'success', summary: t('admin.matches.overrideCleared'), life: 2000 });
    await loadMatches();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.matches.clearFailed'), detail: msg(e), life: 4000 });
  }
}

// Who touched this match by hand, when, and what they changed (§5.3).
interface Audit {
  id: string;
  action: string;
  changedFields: Record<string, { from: unknown; to: unknown }>;
  adminName: string | null;
  createdAt: string;
}
const auditDialog = ref(false);
const auditTarget = ref<MatchRow | null>(null);
const audits = ref<Audit[]>([]);
const auditLoading = ref(false);

function fieldLabel(field: string) {
  const key = `admin.matches.field.${field}`;
  const label = t(key);
  return label === key ? field : label;
}
function auditValue(v: unknown) {
  if (v === null || v === undefined) return '-';
  const key = `matchStatus.${String(v)}`;
  const label = t(key);
  return label === key ? String(v) : label.toLocaleLowerCase();
}
function auditWhen(iso: string) {
  return formatShortDateTime(iso);
}

async function openAudits(m: MatchRow) {
  auditTarget.value = m;
  audits.value = [];
  auditDialog.value = true;
  auditLoading.value = true;
  try {
    const res = await api.get<{ audits: Audit[] }>(`/api/admin/matches/${m.id}/audits`);
    audits.value = res.audits;
  } catch (e) {
    auditDialog.value = false;
    toast.add({ severity: 'error', summary: t('admin.matches.auditFailed'), detail: msg(e), life: 4000 });
  } finally {
    auditLoading.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : t('common.unexpectedError'); }
onMounted(async () => { await loadMatchweeks(); await loadMatches(); });
watch(selectedMw, loadMatches);
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('nav.admin.matches')" :subtitle="$t('admin.matches.subtitle')">
      <template #actions>
        <Select
          v-model="selectedMw"
          :options="weekGroups"
          option-group-label="label"
          option-group-children="items"
          option-label="label"
          option-value="value"
          :placeholder="$t('admin.matches.week')"
        class="select-filter"
        >
          <template #value="{ value }">{{ matchweekTitle(matchweeks, value) || $t('admin.matches.week') }}</template>
        </Select>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <div v-else class="page-stack match-list">
      <div v-for="m in matches" :key="m.id" class="surface-card match-row">
        <div class="teams">
          <span class="side home">{{ m.home_name }}</span>
          <div class="score">
            <InputNumber class="num-input" v-model="m.home_score" :min="0" :use-grouping="false" />
            <span class="text-muted">-</span>
            <InputNumber class="num-input" v-model="m.away_score" :min="0" :use-grouping="false" />
          </div>
          <span class="side away">{{ m.away_name }}</span>
        </div>
        <div class="controls">
          <Select v-model="m.status" :options="statusOptions" option-label="label" option-value="value" class="status-select" />
          <span v-if="m.is_manual_override" class="override-mark">
            <Tag severity="warn" :value="$t('admin.matches.manual')" />
            <Button
              size="small"
              severity="secondary"
              text
              rounded
              :aria-label="$t('admin.matches.clearAria', { match: `${m.home_name} - ${m.away_name}` })"
              :title="$t('admin.matches.clear')"
              @click="clearOverride(m)"
            >
              <template #icon><Undo2 :size="16" /></template>
            </Button>
          </span>
          <Button
            size="small"
            severity="secondary"
            text
            rounded
            :aria-label="$t('admin.matches.auditAria', { match: `${m.home_name} - ${m.away_name}` })"
            :title="$t('admin.matches.auditTitle')"
            @click="openAudits(m)"
          >
            <template #icon><History :size="16" /></template>
          </Button>
          <Button :label="$t('common.save')" size="small" :loading="savingId === m.id" @click="saveResult(m)" />
        </div>
      </div>
      <p v-if="!matches.length" class="empty-state">{{ $t('admin.matches.empty') }}</p>
    </div>

    <Dialog
      v-model:visible="auditDialog"
      modal
      :header="
        auditTarget
          ? `${auditTarget.home_name} - ${auditTarget.away_name}`
          : $t('admin.matches.auditTitle')
      "
      class="dialog-lg"
    >
      <BallLoader v-if="auditLoading" />
      <p v-else-if="!audits.length" class="text-muted flush">{{ $t('admin.matches.auditEmpty') }}</p>
      <ul v-else class="audit-list">
        <li v-for="a in audits" :key="a.id" class="audit-row">
          <div class="audit-head">
            <b>{{ a.action === 'clear_override' ? $t('admin.matches.auditCleared') : $t('admin.matches.auditManual') }}</b>
            <span class="text-muted">
              {{ a.adminName ?? $t('admin.matches.deletedAccount') }} · {{ auditWhen(a.createdAt) }}
            </span>
          </div>
          <div v-if="Object.keys(a.changedFields).length" class="audit-changes">
            <span v-for="(change, field) in a.changedFields" :key="field" class="audit-chip">
              {{ fieldLabel(String(field)) }}: {{ auditValue(change.from) }} → <b>{{ auditValue(change.to) }}</b>
            </span>
          </div>
        </li>
      </ul>
    </Dialog>
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
.override-mark { display: inline-flex; align-items: center; gap: 0.15rem; }
.audit-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
.audit-row { border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-2); padding: 0.6rem 0.75rem; }
.audit-head { display: flex; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; font-size: 0.88rem; }
.audit-changes { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.45rem; }
.audit-chip {
  font-size: var(--text-2xs); padding: 0.15rem 0.5rem; border-radius: var(--radius-pill);
  background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary);
}

@media (max-width: 700px) {
  .match-row { padding: 0.75rem 0.85rem; gap: 0.75rem; }
  .teams { width: 100%; gap: 0.5rem; }
  .side { min-width: 0; flex: 1; font-size: 0.86rem; }
  .controls { width: 100%; justify-content: space-between; }
  .status-select { min-width: 0; flex: 1; }
}

.match-list { gap: 0.75rem; }
</style>
