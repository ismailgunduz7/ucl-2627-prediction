<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import { RefreshCw, Check } from '@lucide/vue';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import OctopusMark from '@/components/OctopusMark.vue';

interface RuleRow { code: string; category: string; label: string; points: Record<number, number> }

const toast = useToast();
const rules = ref<RuleRow[]>([]);
const predictionPoints = ref(3);
const loading = ref(true);
const saving = ref(false);
const recalculating = ref(false);

const categoryLabel: Record<string, string> = { match: 'Maç', league: 'Lig', knockout: 'Eleme' };

async function load() {
  loading.value = true;
  try {
    const [res, cfg] = await Promise.all([
      api.get<{ rules: RuleRow[] }>('/api/admin/scoring-rules'),
      api.get<{ config: { prediction_points_per_correct: number } }>('/api/admin/config'),
    ]);
    rules.value = res.rules;
    predictionPoints.value = cfg.config.prediction_points_per_correct;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kurallar yüklenemedi', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}
async function save() {
  saving.value = true;
  try {
    const updates = rules.value.flatMap((r) => [1, 2, 3, 4].map((tierId) => ({ ruleCode: r.code, tierId, points: r.points[tierId] ?? 0 })));
    const [res] = await Promise.all([
      api.put<{ rules: RuleRow[] }>('/api/admin/scoring-rules', { updates }),
      api.put('/api/admin/config', {
        key: 'prediction_points_per_correct',
        value: predictionPoints.value,
      }),
    ]);
    rules.value = res.rules;
    toast.add({ severity: 'success', summary: 'Kurallar kaydedildi', life: 2500 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Kaydedilemedi', detail: msg(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}
async function recalculate() {
  recalculating.value = true;
  try {
    const res = await api.post<{ matchesScored: number }>('/api/admin/recalculate');
    toast.add({ severity: 'success', summary: `${res.matchesScored} maç yeniden puanlandı`, life: 3500 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Yeniden hesaplanamadı', detail: msg(e), life: 4000 });
  } finally {
    recalculating.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Puanlama kuralları" subtitle="Her kuralın puanını pot pot ayarla. Cezalar eksi yazılır.">
      <template #actions>
        <div style="display: flex; gap: 0.5rem">
          <Button label="Yeniden hesapla" severity="secondary" outlined :loading="recalculating" @click="recalculate">
            <template #icon><RefreshCw :size="16" /></template>
          </Button>
          <Button label="Kaydet" :loading="saving" @click="save">
            <template #icon><Check :size="16" /></template>
          </Button>
        </div>
      </template>
    </PageHeader>

    <BallLoader v-if="loading" />

    <section v-if="!loading" class="surface-card card-pad paul-config">
      <span class="paul-name"><OctopusMark :size="19" /> Ahtapot Paul</span>
      <label for="paulPoints" class="text-muted">tutan her tahmin</label>
      <InputNumber
        v-model="predictionPoints"
        input-id="paulPoints"
        :min="0"
        :max="50"
        :use-grouping="false"
        show-buttons
        button-layout="horizontal"
        :input-style="{ width: '3rem', textAlign: 'center' }"
        decrement-button-class="p-button-secondary"
        increment-button-class="p-button-secondary"
      />
      <span class="text-muted">puan</span>
    </section>

    <section v-if="!loading" class="surface-card table-scroll">
      <table class="rules">
        <thead>
          <tr>
            <th style="text-align: left">Kural</th>
            <th>Pot 1</th><th>Pot 2</th><th>Pot 3</th><th>Pot 4</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.code">
            <td style="text-align: left">
              <strong>{{ r.label }}</strong>
              <span class="text-muted" style="font-size: 0.75rem; display: block">{{ categoryLabel[r.category] ?? r.category }}</span>
            </td>
            <td v-for="p in [1, 2, 3, 4]" :key="p">
              <InputNumber v-model="r.points[p]" :use-grouping="false" show-buttons button-layout="horizontal"
                :input-style="{ width: '3rem', textAlign: 'center' }"
                decrement-button-class="p-button-secondary" increment-button-class="p-button-secondary" />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.paul-config { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.paul-name { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 700; }
.rules { width: 100%; border-collapse: collapse; min-width: 560px; }
.rules th, .rules td { padding: 0.55rem 0.7rem; text-align: center; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.rules thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.rules tbody tr:last-child td { border-bottom: none; }
</style>
