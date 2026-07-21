<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import { api } from '@/lib/api';

interface RuleRow {
  code: string;
  category: string;
  label: string;
  points: Record<number, number>;
}

const router = useRouter();
const rules = ref<RuleRow[]>([]);
const loading = ref(true);

const categoryLabel: Record<string, string> = { match: 'Maç', league: 'Lig', knockout: 'Eleme' };

onMounted(async () => {
  try {
    const res = await api.get<{ rules: RuleRow[] }>('/api/scoring-rules');
    rules.value = res.rules;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page stack">
    <div style="display: flex; justify-content: space-between; align-items: center">
      <h1 style="margin: 0">Puanlama kuralları</h1>
      <Button label="Geri" icon="pi pi-arrow-left" text @click="router.push('/')" />
    </div>
    <p style="color: #556; margin: 0">
      Puanlar takımın potuna göre değişir: zayıf potlar ödülü daha yüksek, güçlü potlar cezayı daha
      ağır alır. Tüm puanlar tam sayıdır.
    </p>

    <div v-if="loading">Yükleniyor…</div>
    <table v-else class="rules-table">
      <thead>
        <tr>
          <th style="text-align: left">Kural</th>
          <th>Kategori</th>
          <th>Pot 1</th>
          <th>Pot 2</th>
          <th>Pot 3</th>
          <th>Pot 4</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rules" :key="r.code">
          <td style="text-align: left"><strong>{{ r.label }}</strong></td>
          <td>{{ categoryLabel[r.category] ?? r.category }}</td>
          <td v-for="p in [1, 2, 3, 4]" :key="p">{{ r.points[p] ?? 0 }}</td>
        </tr>
      </tbody>
    </table>
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
  padding: 0.55rem 0.7rem;
  text-align: center;
  border-bottom: 1px solid #eef;
}
.rules-table thead th {
  background: #f4f6fb;
  font-size: 0.85rem;
}
</style>
