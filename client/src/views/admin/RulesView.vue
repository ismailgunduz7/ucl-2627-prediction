<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useToast } from 'primevue/usetoast';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { api, ApiRequestError } from '@/lib/api';

interface RuleRow {
  code: string;
  category: string;
  label: string;
  direction: 'reward' | 'penalty' | 'flat';
  sortOrder: number;
  points: Record<number, number>;
  warning: string | null;
}

const toast = useToast();
const rules = ref<RuleRow[]>([]);
const loading = ref(true);
const saving = ref(false);
const recalculating = ref(false);

const categoryLabel: Record<string, string> = {
  match: 'Maç',
  league: 'Lig',
  knockout: 'Eleme',
};
const directionLabel: Record<string, string> = {
  reward: 'ödül ↑',
  penalty: 'ceza ↓',
  flat: 'sabit',
};

// Client-side re-check so warnings update live as the admin edits (§16).
function directionWarning(r: RuleRow): string | null {
  const v = [1, 2, 3, 4].map((p) => r.points[p] ?? 0);
  if (r.direction === 'flat') {
    return v.every((x) => x === v[0]) ? null : 'Tüm potlarda eşit olmalı';
  }
  for (let i = 1; i < v.length; i++) if (v[i]! < v[i - 1]!) return 'Pot yönü bozuk: Pot 1 → Pot 4 azalmamalı';
  return null;
}

const anyWarning = computed(() => rules.value.some((r) => directionWarning(r) !== null));

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
    const updates = rules.value.flatMap((r) =>
      [1, 2, 3, 4].map((tierId) => ({ ruleCode: r.code, tierId, points: r.points[tierId] ?? 0 })),
    );
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
    toast.add({
      severity: 'success',
      summary: 'Yeniden hesaplandı',
      detail: `${res.matchesScored} bitmiş maç puanlandı`,
      life: 3500,
    });
  } catch (e) {
    toast.add({ severity: 'error', summary: 'Hata', detail: msg(e), life: 4000 });
  } finally {
    recalculating.value = false;
  }
}

function msg(e: unknown) {
  return e instanceof ApiRequestError ? e.message : 'Beklenmeyen hata';
}

onMounted(load);
</script>

<template>
  <div class="stack">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h1 style="margin: 0">Puanlama kuralları</h1>
      <div style="display: flex; gap: 0.5rem">
        <Button
          label="Yeniden hesapla"
          icon="pi pi-refresh"
          severity="secondary"
          :loading="recalculating"
          @click="recalculate"
        />
        <Button label="Kaydet" icon="pi pi-check" :loading="saving" @click="save" />
      </div>
    </div>

    <Message severity="info" :closable="false">
      Değerler tam sayıdır (negatif olabilir). Yön kuralı (§16): ödül değerleri Pot 1 → Pot 4
      artmalı (zayıf pota daha çok), ceza değerleri de artmalı (Pot 1 en negatif → 0'a doğru).
      Bozan satırlar uyarılır ama yine de kaydedilebilir.
    </Message>
    <Message v-if="anyWarning" severity="warn" :closable="false">
      Bazı kurallar pot yönünü bozuyor (aşağıda işaretli).
    </Message>

    <div v-if="loading">Yükleniyor…</div>

    <table v-else class="rules-table">
      <thead>
        <tr>
          <th style="text-align: left">Kural</th>
          <th>Kategori</th>
          <th>Yön</th>
          <th>Pot 1</th>
          <th>Pot 2</th>
          <th>Pot 3</th>
          <th>Pot 4</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rules" :key="r.code" :class="{ warn: directionWarning(r) }">
          <td style="text-align: left">
            <strong>{{ r.label }}</strong>
            <div style="font-size: 0.72rem; color: #889">{{ r.code }}</div>
          </td>
          <td>{{ categoryLabel[r.category] ?? r.category }}</td>
          <td><small>{{ directionLabel[r.direction] }}</small></td>
          <td v-for="p in [1, 2, 3, 4]" :key="p">
            <InputNumber
              v-model="r.points[p]"
              :use-grouping="false"
              show-buttons
              button-layout="horizontal"
              :input-style="{ width: '3.2rem', textAlign: 'center' }"
              decrement-button-class="p-button-secondary"
              increment-button-class="p-button-secondary"
            />
          </td>
          <td>
            <i
              v-if="directionWarning(r)"
              class="pi pi-exclamation-triangle"
              style="color: #d97706"
              :title="directionWarning(r) ?? ''"
            />
            <i v-else class="pi pi-check" style="color: #16a34a" />
          </td>
        </tr>
      </tbody>
    </table>

    <p style="color: #889; font-size: 0.82rem; margin: 0">
      Not: bir kuralın <Tag value="flat" /> yönü tüm potlarda eşit değer ister (örn. atılan gol).
    </p>
  </div>
</template>

<style scoped>
.rules-table {
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}
.rules-table th,
.rules-table td {
  padding: 0.5rem 0.6rem;
  text-align: center;
  border-bottom: 1px solid #eef;
  vertical-align: middle;
}
.rules-table thead th {
  background: #f4f6fb;
  font-size: 0.82rem;
}
.rules-table tr.warn {
  background: #fff7ed;
}
</style>
