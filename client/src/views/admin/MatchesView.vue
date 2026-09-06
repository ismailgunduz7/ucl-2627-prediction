<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
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
    toast.add({ severity: 'error', summary: 'Maçlar yüklenemedi', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}
async function saveResult(m: MatchRow) {
  savingId.value = m.id;
  try {
    await api.put(`/api/admin/matches/${m.id}/result`, { homeScore: m.home_score, awayScore: m.away_score, status: m.status });
    toast.add({ severity: 'success', summary: 'Skor kaydedildi', life: 2000 });
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
    toast.add({ severity: 'success', summary: 'Sonuç sağlayıcıya bırakıldı', life: 2000 });
    await loadMatches();
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Geri alınamadı', detail: msg(e), life: 4000 });
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

const FIELD_LABEL: Record<string, string> = {
  home_score: 'ev skoru',
  away_score: 'deplasman skoru',
  status: 'durum',
};
const VALUE_LABEL: Record<string, string> = {
  scheduled: 'planlandı', live: 'canlı', finished: 'bitti', postponed: 'ertelendi', cancelled: 'iptal',
};
function auditValue(v: unknown) {
  if (v === null || v === undefined) return '-';
  return VALUE_LABEL[String(v)] ?? String(v);
}
function auditWhen(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
    toast.add({ severity: 'error', summary: 'Geçmiş açılamadı', detail: msg(e), life: 4000 });
  } finally {
    auditLoading.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
onMounted(async () => { await loadMatchweeks(); await loadMatches(); });
watch(selectedMw, loadMatches);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Maçlar" subtitle="Bir maçı bitti yaptığın anda puanları işlenir. Elle girdiğin skoru sağlayıcı bir daha ezmez.">
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
            <span class="text-muted">-</span>
            <InputNumber v-model="m.away_score" :min="0" :use-grouping="false" :input-style="{ width: '2.6rem', textAlign: 'center' }" />
          </div>
          <span class="side away">{{ m.away_name }}</span>
        </div>
        <div class="controls">
          <Select v-model="m.status" :options="statusOptions" option-label="label" option-value="value" class="status-select" />
          <span v-if="m.is_manual_override" class="override-mark">
            <Tag severity="warn" value="elle girildi" />
            <Button
              icon="pi pi-undo"
              size="small"
              severity="secondary"
              text
              rounded
              :aria-label="`${m.home_name} - ${m.away_name}: skoru sağlayıcıya geri bırak`"
              title="Skoru sağlayıcıya geri bırak"
              @click="clearOverride(m)"
            />
          </span>
          <Button
            icon="pi pi-history"
            size="small"
            severity="secondary"
            text
            rounded
            :aria-label="`${m.home_name} - ${m.away_name}: elle yapılan değişiklikler`"
            title="Elle yapılan değişiklikler"
            @click="openAudits(m)"
          />
          <Button label="Kaydet" size="small" :loading="savingId === m.id" @click="saveResult(m)" />
        </div>
      </div>
      <p v-if="!matches.length" class="empty-state">Bu hafta için maç yok.</p>
    </div>

    <Dialog
      v-model:visible="auditDialog"
      modal
      :header="auditTarget ? `${auditTarget.home_name} - ${auditTarget.away_name}` : 'Elle yapılan değişiklikler'"
      :style="{ width: '460px' }"
    >
      <BallLoader v-if="auditLoading" />
      <p v-else-if="!audits.length" class="text-muted" style="margin: 0">Bu maça kimse elle dokunmamış.</p>
      <ul v-else class="audit-list">
        <li v-for="a in audits" :key="a.id" class="audit-row">
          <div class="audit-head">
            <b>{{ a.action === 'clear_override' ? 'Sağlayıcıya bırakıldı' : 'Skor elle girildi' }}</b>
            <span class="text-muted">{{ a.adminName ?? 'silinmiş hesap' }} · {{ auditWhen(a.createdAt) }}</span>
          </div>
          <div v-if="Object.keys(a.changedFields).length" class="audit-changes">
            <span v-for="(change, field) in a.changedFields" :key="field" class="audit-chip">
              {{ FIELD_LABEL[field] ?? field }}: {{ auditValue(change.from) }} → <b>{{ auditValue(change.to) }}</b>
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
</style>
