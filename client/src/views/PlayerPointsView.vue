<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import { api, ApiRequestError } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';

interface RuleEntry { ruleCode: string; ruleLabel: string; points: number; matchLabel: string | null }
interface ClubBreakdown {
  teamId: string; name: string; shortName: string; basePoints: number;
  benched: boolean; captain: boolean; multiplier: number; contributed: number; entries: RuleEntry[];
}
interface WeekBreakdown {
  matchweekId: string; label: string; status: string; final: boolean;
  total: number; jokerCode: string | null; clubs: ClubBreakdown[];
}
interface PlayerPoints {
  player: { id: string; displayName: string; totalPoints: number };
  weeks: WeekBreakdown[];
}

const JOKER_NAMES: Record<string, string> = {
  weekly_swap: 'Haftalık değişim', triple_boost: 'Üçlü kaptan',
  clean_sheet_shield: 'Gol yememe kalkanı', bench_boost: 'Bench boost',
};

const route = useRoute();
const router = useRouter();
const data = ref<PlayerPoints | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const open = ref<string[]>([]);

// Weeks that actually produced something are the interesting ones.
const playedWeeks = computed(() => data.value?.weeks.filter((w) => w.status !== 'upcoming') ?? []);
const bestWeek = computed(() => {
  const played = playedWeeks.value.filter((w) => w.final);
  if (!played.length) return null;
  return played.reduce((a, b) => (b.total > a.total ? b : a));
});

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase();
}
function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n}`;
}

async function load(id: string) {
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.get<PlayerPoints>(`/api/players/${id}/points`);
    // Open the most recent week that has been played.
    const last = [...(data.value?.weeks ?? [])].reverse().find((w) => w.status !== 'upcoming');
    open.value = last ? [last.matchweekId] : [];
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : 'Yüklenemedi';
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(route.params.id as string));
watch(() => route.params.id, (id) => id && load(id as string));
</script>

<template>
  <div class="page-stack">
    <Button label="Geri" icon="pi pi-arrow-left" text style="align-self: flex-start" @click="router.back()" />

    <BallLoader v-if="loading" />
    <Message v-else-if="error" severity="error" :closable="false">{{ error }}</Message>

    <template v-else-if="data">
      <PageHeader :title="data.player.displayName" subtitle="Sezon boyunca hangi puan nereden geldi." />

      <div class="stat-row">
        <div class="surface-card card-pad stat">
          <span class="stat-num">{{ data.player.totalPoints }}</span><small class="text-muted">toplam puan</small>
        </div>
        <div class="surface-card card-pad stat">
          <span class="stat-num">{{ playedWeeks.length }}</span><small class="text-muted">oynanan hafta</small>
        </div>
        <div v-if="bestWeek" class="surface-card card-pad stat">
          <span class="stat-num">{{ bestWeek.total }}</span><small class="text-muted">en iyi hafta · {{ bestWeek.label }}</small>
        </div>
      </div>

      <Message v-if="!playedWeeks.length" severity="secondary" :closable="false">
        Henüz oynanmış bir hafta yok.
      </Message>

      <Accordion v-else v-model:value="open" multiple>
        <AccordionPanel v-for="w in playedWeeks" :key="w.matchweekId" :value="w.matchweekId">
          <AccordionHeader>
            <div class="week-head">
              <span class="week-label">{{ w.label }}</span>
              <Tag v-if="w.jokerCode" severity="warn" :value="JOKER_NAMES[w.jokerCode] ?? w.jokerCode" />
              <Tag v-if="!w.final" severity="info" value="anlık" />
              <span class="week-total" :class="w.total >= 0 ? 'text-positive' : 'text-negative'">{{ signed(w.total) }}</span>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div class="club-list">
              <div
                v-for="c in w.clubs"
                :key="c.teamId"
                class="club-row"
                :class="{ muted: c.benched && w.jokerCode !== 'bench_boost' }"
              >
                <div class="club-top">
                  <RouterLink :to="`/takim/${c.teamId}`" class="club-id">
                    <span class="crest crest-xs">{{ initials(c.name) }}</span>
                    <span>{{ c.name }}</span>
                  </RouterLink>
                  <div class="tag-row">
                    <Tag v-if="c.captain" severity="warn" :value="`Kaptan ×${c.multiplier}`" />
                    <Tag v-else-if="c.benched" severity="secondary" value="Yedek" />
                  </div>
                  <span class="club-pts" :class="c.contributed >= 0 ? 'text-positive' : 'text-negative'">
                    {{ signed(c.contributed) }}
                  </span>
                </div>

                <ul v-if="c.entries.length" class="entries">
                  <li v-for="(e, i) in c.entries" :key="i">
                    <span>{{ e.ruleLabel }}</span>
                    <span v-if="e.matchLabel" class="text-muted match-label">{{ e.matchLabel }}</span>
                    <span :class="e.points >= 0 ? 'text-positive' : 'text-negative'">{{ signed(e.points) }}</span>
                  </li>
                  <li v-if="c.captain && c.multiplier > 1" class="mult">
                    <span>Kaptan çarpanı</span>
                    <span class="text-muted match-label">{{ c.basePoints }} × {{ c.multiplier }}</span>
                    <span class="text-positive">{{ signed(c.contributed - c.basePoints) }}</span>
                  </li>
                </ul>
                <p v-else class="text-muted no-entry">bu hafta puan getirmedi</p>
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </template>
  </div>
</template>

<style scoped>
.stat-row { display: flex; gap: 1rem; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; align-items: center; min-width: 130px; }
.stat-num { font-size: 1.9rem; font-weight: 800; color: var(--color-primary); line-height: 1.1; }
.week-head { display: flex; align-items: center; gap: 0.6rem; width: 100%; }
.week-label { font-weight: 700; }
.week-total { margin-left: auto; font-weight: 800; font-size: 1.05rem; }
.club-list { display: flex; flex-direction: column; gap: 0.65rem; }
.club-row { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.7rem 0.85rem; }
.club-row.muted { opacity: 0.6; }
.club-top { display: flex; align-items: center; gap: 0.65rem; }
.club-id { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; color: var(--color-text); text-decoration: none; }
.club-id:hover { color: var(--color-primary); text-decoration: none; }
.crest-xs { width: 26px; height: 26px; font-size: 0.58rem; }
.club-pts { margin-left: auto; font-weight: 800; }
.entries { list-style: none; margin: 0.55rem 0 0; padding: 0.55rem 0 0; border-top: 1px dashed var(--color-border); display: flex; flex-direction: column; gap: 0.3rem; }
.entries li { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; }
.entries li > span:last-child { margin-left: auto; font-weight: 700; }
.match-label { font-size: 0.76rem; }
.entries li.mult { border-top: 1px dashed var(--color-border); padding-top: 0.35rem; }
.no-entry { margin: 0.5rem 0 0; font-size: 0.82rem; }
</style>
