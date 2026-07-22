<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import LoadingState from '@/components/LoadingState.vue';

interface RuleRow { code: string; category: string; label: string; points: Record<number, number> }
interface Pot { tierId: number; tierName: string; teams: { id: string; name: string }[] }

const rules = ref<RuleRow[]>([]);
const pots = ref<Pot[]>([]);
const loading = ref(true);

const categoryLabel: Record<string, string> = { match: 'Maç', league: 'Lig', knockout: 'Eleme' };

onMounted(async () => {
  try {
    const [r, t] = await Promise.all([
      api.get<{ rules: RuleRow[] }>('/api/scoring-rules'),
      api.get<{ pots: Pot[] }>('/api/teams'),
    ]);
    rules.value = r.rules;
    pots.value = t.pots;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader title="Nasıl puan kazanılır" subtitle="Kulüplerin sahadaki sonuçları senin puanına dönüşür." />

    <LoadingState v-if="loading" />

    <template v-else>
      <section class="surface-card card-pad">
        <p style="margin: 0 0 0.75rem">
          Aynı sonuç, zayıf pottaki bir kulüp için daha değerlidir; güçlü bir kulübün kötü sonucu ise
          daha çok cezalandırılır. Kaptanın puanı iki katına çıkar (üçlü kaptan jokeriyle üçe).
        </p>
        <div style="overflow-x: auto">
          <table class="rules">
            <thead>
              <tr>
                <th style="text-align: left">Kural</th>
                <th v-for="p in pots" :key="p.tierId">{{ p.tierName }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rules" :key="r.code">
                <td style="text-align: left">
                  <strong>{{ r.label }}</strong>
                  <span class="text-muted" style="font-size: 0.75rem; display: block">{{ categoryLabel[r.category] ?? r.category }}</span>
                </td>
                <td v-for="p in pots" :key="p.tierId" :class="(r.points[p.tierId] ?? 0) < 0 ? 'text-negative' : ''">
                  {{ r.points[p.tierId] ?? 0 }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">Potlar ve kulüpler</div>
        <div class="pot-grid">
          <div v-for="p in pots" :key="p.tierId" class="pot-box">
            <div class="pot-box-head">{{ p.tierName }}</div>
            <div class="chip-wrap">
              <RouterLink v-for="t in p.teams" :key="t.id" :to="`/takim/${t.id}`" class="team-chip">{{ t.name }}</RouterLink>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rules { width: 100%; border-collapse: collapse; min-width: 480px; }
.rules th, .rules td { padding: 0.6rem 0.75rem; text-align: center; border-bottom: 1px solid var(--color-border); }
.rules thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.rules tbody tr:last-child td { border-bottom: none; }
.pot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; }
.pot-box { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem; }
.pot-box-head { font-weight: 700; margin-bottom: 0.6rem; }
.chip-wrap { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.team-chip {
  display: inline-block; padding: 0.3rem 0.65rem; border-radius: 999px;
  background: var(--color-surface); border: 1px solid var(--color-border);
  font-size: 0.8rem; color: var(--color-text); text-decoration: none;
}
.team-chip:hover { border-color: var(--color-primary); color: var(--color-primary); text-decoration: none; }
</style>
