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
import JokerIcon from '@/components/JokerIcon.vue';
import CaptainBadge from '@/components/CaptainBadge.vue';
import FixtureLine from '@/components/FixtureLine.vue';
import OctopusMark from '@/components/OctopusMark.vue';

interface RuleEntry { ruleCode: string; ruleLabel: string; points: number }
interface ClubFixture {
  opponentName: string; home: boolean; status: string;
  teamScore: number | null; opponentScore: number | null;
}
interface ClubBreakdown {
  teamId: string; name: string; shortName: string; basePoints: number;
  benched: boolean; captain: boolean; multiplier: number; contributed: number;
  fixtures: ClubFixture[]; entries: RuleEntry[];
}
interface WeekBreakdown {
  matchweekId: string; label: string; status: string; final: boolean;
  total: number; jokerCode: string | null; clubs: ClubBreakdown[];
  predictions: { settled: number; correct: number; points: number };
}
interface PlayerPoints {
  player: { id: string; displayName: string; totalPoints: number };
  weeks: WeekBreakdown[];
}

const route = useRoute();
const router = useRouter();
const data = ref<PlayerPoints | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const open = ref<string[]>([]);

const weeks = computed(() => data.value?.weeks ?? []);
/** A week counts as played once any club actually scored something in it. */
function isPlayed(w: WeekBreakdown) {
  return w.clubs.some((c) => c.entries.length > 0);
}
const playedWeeks = computed(() => weeks.value.filter(isPlayed));
const bestWeek = computed(() => {
  const done = playedWeeks.value;
  return done.length ? done.reduce((a, b) => (b.total > a.total ? b : a)) : null;
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
    // Open the most recent week that actually has results, not merely the last.
    const last = [...weeks.value].reverse().find(isPlayed);
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
      <PageHeader :title="data.player.displayName" />

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

      <Accordion v-model:value="open" multiple>
        <AccordionPanel v-for="w in weeks" :key="w.matchweekId" :value="w.matchweekId">
          <AccordionHeader>
            <div class="week-head">
              <span class="week-label">{{ w.label }}</span>
              <JokerIcon v-if="w.jokerCode" :code="w.jokerCode" :size="16" />
              <Tag
                v-if="isPlayed(w) && !w.final"
                severity="info"
                value="kesinleşmedi"
                title="Hafta bitmedi, puanlar hâlâ değişebilir"
              />
              <Tag v-else-if="!isPlayed(w)" severity="secondary" value="oynanmadı" />
              <span v-if="isPlayed(w)" class="week-total" :class="w.total >= 0 ? 'text-positive' : 'text-negative'">
                {{ signed(w.total) }}
              </span>
            </div>
          </AccordionHeader>
          <AccordionContent>
            <div class="club-list">
              <div
                v-for="c in w.clubs"
                :key="c.teamId"
                class="club-row"
                :class="{ muted: isPlayed(w) && c.benched && w.jokerCode !== 'bench_boost' }"
              >
                <div class="club-top">
                  <RouterLink :to="`/takim/${c.teamId}`" class="club-id">
                    <span class="crest crest-xs">{{ initials(c.name) }}</span>
                  </RouterLink>

                  <div class="club-mid">
                    <FixtureLine
                      v-for="(f, i) in c.fixtures"
                      :key="i"
                      :team-name="c.name"
                      :opponent-name="f.opponentName"
                      :home="f.home"
                      :team-score="f.teamScore"
                      :opponent-score="f.opponentScore"
                    />
                    <span v-if="!c.fixtures.length" class="text-muted no-fixture">bu hafta maçı yok</span>
                  </div>

                  <template v-if="isPlayed(w)">
                    <CaptainBadge v-if="c.captain" :multiplier="c.multiplier" :joker-code="w.jokerCode" :size="26" />
                    <span v-else-if="c.benched" class="role-chip">Yedek</span>

                    <span class="club-pts">
                      <span v-if="c.captain && c.multiplier > 1" class="text-muted base">
                        {{ c.basePoints }} × {{ c.multiplier }}
                      </span>
                      <strong :class="c.contributed >= 0 ? 'text-positive' : 'text-negative'">{{ signed(c.contributed) }}</strong>
                    </span>
                  </template>
                </div>

                <ul v-if="c.entries.length" class="entries">
                  <li v-for="(e, i) in c.entries" :key="i">
                    <span>{{ e.ruleLabel }}</span>
                    <span :class="e.points >= 0 ? 'text-positive' : 'text-negative'">{{ signed(e.points) }}</span>
                  </li>
                </ul>
              </div>

              <div v-if="w.predictions.correct" class="club-row paul-row">
                <span class="paul-name"><OctopusMark :size="17" /> Ahtapot Paul</span>
                <span class="text-muted">{{ w.predictions.correct }}/{{ w.predictions.settled }} doğru</span>
                <strong class="text-positive">{{ signed(w.predictions.points) }}</strong>
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
.week-total { margin-left: auto; font-weight: 800; font-size: var(--text-lg); }
.club-list { display: flex; flex-direction: column; gap: 0.65rem; }
.club-row { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.7rem 0.85rem; }
.club-row.muted { opacity: 0.6; }
.paul-row { display: flex; align-items: center; gap: 0.75rem; }
.paul-row .paul-name { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; }
.paul-row strong { margin-left: auto; }
.club-top { display: flex; align-items: center; gap: 0.7rem; }
.club-id { display: inline-flex; text-decoration: none; }
.club-mid { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; font-size: 0.88rem; }
.no-fixture { font-size: 0.85rem; }
.club-pts { display: flex; align-items: baseline; gap: 0.45rem; margin-left: auto; font-weight: 800; white-space: nowrap; }
.club-pts .base { font-size: 0.78rem; font-weight: 600; }
.entries { list-style: none; margin: 0.55rem 0 0; padding: 0.55rem 0 0; border-top: 1px dashed var(--color-border); display: flex; flex-direction: column; gap: 0.3rem; max-width: 420px; }
.entries li { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; color: var(--color-text-secondary); }
.entries li > span:last-child { margin-left: auto; font-weight: 700; }
</style>
