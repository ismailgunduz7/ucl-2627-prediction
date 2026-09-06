<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Zap, Shield, Repeat, Armchair } from '@lucide/vue';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';

interface RuleRow { code: string; category: string; label: string; points: Record<number, number> }
interface Pot { tierId: number; tierName: string; teams: { id: string; name: string }[] }
type JokerCounts = Record<string, number>;
interface JokerGrants { league_phase: JokerCounts; knockout: JokerCounts }

const { t } = useI18n();
const rules = ref<RuleRow[]>([]);
const pots = ref<Pot[]>([]);
const predictionPoints = ref(3);
const grants = ref<JokerGrants | null>(null);
const loading = ref(true);

const jokers = [
  { code: 'triple_boost', icon: Zap },
  { code: 'bench_boost', icon: Armchair },
  { code: 'clean_sheet_shield', icon: Shield },
  { code: 'weekly_swap', icon: Repeat },
];

function grantLine(code: string): string | null {
  const g = grants.value;
  if (!g) return null;
  return t('rules.jokerGrant', {
    league: g.league_phase[code] ?? 0,
    knockout: g.knockout[code] ?? 0,
  });
}

onMounted(async () => {
  try {
    const [r, t] = await Promise.all([
      api.get<{ rules: RuleRow[]; predictionPointsPerCorrect: number; jokerGrants: JokerGrants }>(
        '/api/scoring-rules',
      ),
      api.get<{ pots: Pot[] }>('/api/teams'),
    ]);
    rules.value = r.rules;
    pots.value = t.pots;
    predictionPoints.value = r.predictionPointsPerCorrect;
    grants.value = r.jokerGrants;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack rules-page">
    <PageHeader :title="$t('rules.title')" />

    <BallLoader v-if="loading" />

    <template v-else>
      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('rules.squadTitle') }}</div>
        <p>{{ $t('rules.squadBody') }}</p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('rules.locksTitle') }}</div>
        <i18n-t keypath="rules.locksBody" tag="p" scope="global">
          <template #fiveMinutes><b>{{ $t('rules.fiveMinutes') }}</b></template>
        </i18n-t>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('rules.tableTitle') }}</div>
        <p>{{ $t('rules.tableBody') }}</p>
        <div class="table-scroll">
          <table class="rules">
            <thead>
              <tr>
                <th style="text-align: left">{{ $t('rules.ruleColumn') }}</th>
                <th v-for="p in pots" :key="p.tierId">{{ p.tierName }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rules" :key="r.code">
                <td style="text-align: left">
                  <strong>{{ r.label }}</strong>
                  <span class="rule-cat">{{ $t(`rules.category.${r.category}`) }}</span>
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
        <div class="section-title">{{ $t('rules.jokersTitle') }}</div>
        <p>{{ $t('rules.jokersBody') }}</p>
        <div class="joker-grid stagger">
          <div v-for="j in jokers" :key="j.code" class="joker-card">
            <div class="joker-head">
              <component :is="j.icon" :size="18" />
              <b>{{ $t(`joker.${j.code}`) }}</b>
            </div>
            <p class="joker-desc">{{ $t(`rules.jokerDesc.${j.code}`) }}</p>
            <small v-if="grantLine(j.code)" class="joker-grant">{{ grantLine(j.code) }}</small>
          </div>
        </div>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('rules.knockoutTitle') }}</div>
        <p>{{ $t('rules.knockoutBody1') }}</p>
        <i18n-t keypath="rules.knockoutBody2" tag="p" scope="global">
          <template #permanently><b>{{ $t('rules.permanently') }}</b></template>
        </i18n-t>
        <p>{{ $t('rules.knockoutBody3') }}</p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('paul.name') }}</div>
        <p>{{ $t('rules.paulBody', { points: predictionPoints }) }}</p>
      </section>

      <section class="surface-card card-pad">
        <div class="section-title">{{ $t('rules.potsTitle') }}</div>
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
/* One voice, one colour: every paragraph on this page reads the same. */
.rules-page p {
  margin: 0 0 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.55;
}
.rules-page section > p:last-child { margin-bottom: 0; }
.rules-page p b { color: var(--color-text); }

.rules { width: 100%; border-collapse: collapse; min-width: 480px; }
.rules th, .rules td { padding: 0.6rem 0.75rem; text-align: center; border-bottom: 1px solid var(--color-border); }
.rules thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.rules tbody tr:last-child td { border-bottom: none; }
.rule-cat { font-size: 0.75rem; display: block; color: var(--color-text-secondary); }

.joker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.9rem; }
.joker-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.9rem; display: flex; flex-direction: column; gap: 0.45rem; }
.joker-head { display: flex; align-items: center; gap: 0.5rem; color: var(--color-primary); }
.joker-head b { color: var(--color-text); }
.joker-desc { margin: 0; font-size: 0.86rem; }
.joker-grant {
  margin-top: auto; padding-top: 0.35rem;
  font-size: var(--text-2xs); font-weight: 700; color: var(--color-text-secondary);
}

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
