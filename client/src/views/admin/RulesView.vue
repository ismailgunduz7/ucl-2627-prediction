<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import LoadingState from '@/components/LoadingState.vue';

interface RuleRow { code: string; category: string; label: string; points: Record<number, number> }

const toast = useToast();
const rules = ref<RuleRow[]>([]);
const loading = ref(true);
const saving = ref(false);
const recalculating = ref(false);

const categoryLabel: Record<string, string> = { match: 'Maç', league: 'Lig', knockout: 'Eleme' };

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ rules: RuleRow[] }>('/api/admin/scoring-rules');
    rules.value = res.rules;
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    loading.value = false;
  }
}
async function save() {
  saving.value = true;
  try {
    const updates = rules.value.flatMap((r) => [1, 2, 3, 4].map((tierId) => ({ ruleCode: r.code, tierId, points: r.points[tierId] ?? 0 })));
    const res = await api.put<{ rules: RuleRow[] }>('/api/admin/scoring-rules', { updates });
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
    toast.add({ severity: 'success', summary: 'Yeniden hesaplandı', detail: `${res.matchesScored} maç puanlandı`, life: 3500 });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    recalculating.value = false;
  }
}
function msg(e: unknown) { return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata'; }
onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Puanlama kuralları" subtitle="Her kural için pot bazında puanı belirle. Değerler tam sayı, negatif olabilir.">
      <template #actions>
        <div style="display: flex; gap: 0.5rem">
          <Button label="Yeniden hesapla" icon="pi pi-refresh" severity="secondary" outlined :loading="recalculating" @click="recalculate" />
          <Button label="Kaydet" icon="pi pi-check" :loading="saving" @click="save" />
        </div>
      </template>
    </PageHeader>

    <LoadingState v-if="loading" />

    <section v-else class="surface-card" style="overflow-x: auto">
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
.rules { width: 100%; border-collapse: collapse; min-width: 560px; }
.rules th, .rules td { padding: 0.55rem 0.7rem; text-align: center; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.rules thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.rules tbody tr:last-child td { border-bottom: none; }
</style>
