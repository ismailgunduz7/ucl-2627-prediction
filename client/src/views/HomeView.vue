<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { Play, Users, Plus, CalendarDays, ChartColumn, Activity, History } from '@lucide/vue';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import TeamCrest from '@/components/TeamCrest.vue';
import CaptainBadge from '@/components/CaptainBadge.vue';
import OctopusMark from '@/components/OctopusMark.vue';
import KickoffList, { type KickoffFixture } from '@/components/KickoffList.vue';
import { JOKER_ICONS } from '@/lib/jokers';
import { roundKeyOf, type MatchweekMenu } from '@/lib/matchweeks';

interface SquadEntry { teamId: string; shortName: string; name: string; crestUrl: string | null; eliminated: boolean }
interface Mw {
  id: string; label: string; status: string; firstKickoffAt: string | null;
  editable: boolean; opened: boolean; menu: MatchweekMenu;
}
interface LbEntry { userId: string; displayName: string; total: number; rank: number }
interface ScoreLine {
  teamId: string; name: string; basePoints: number;
  benched: boolean; captain: boolean; multiplier: number; contributed: number;
}
interface PredictionTally { settled: number; correct: number; points: number }
interface WeekScore {
  total: number; final: boolean; lines: ScoreLine[];
  jokerCode: string | null; jokerDelta: number | null; predictions: PredictionTally;
}
interface RoundFixtures { sections: { matchweekId: string; fixtures: KickoffFixture[] }[] }
interface BriefingClub { teamId: string; name: string; fixtures: unknown[] }
interface WeekPredictions { matches: { matchId: string; pick: string | null }[]; editable: boolean }
/** A week as the squad meets it: the matches with one of theirs in, and who sits it out. */
interface WeekCard { fixtures: KickoffFixture[]; byes: string[] }

type Card = 'squad' | 'live' | 'next' | 'coupon' | 'last' | 'rank';

const { t } = useI18n();
const auth = useAuthStore();
const loading = ref(true);
const squad = ref<SquadEntry[]>([]);
const squadLocked = ref(false);
const leaderboard = ref<LbEntry[]>([]);
// The final is done, so the season has an ending worth replaying (§18.8).
const seasonOver = ref(false);
/** The week being played right now, and how it is going. */
const liveMw = ref<Mw | null>(null);
const liveScore = ref<WeekScore | null>(null);
const liveWeek = ref<WeekCard | null>(null);
/** The week still to be arranged, and what the squad is walking into. */
const nextMw = ref<Mw | null>(null);
const nextWeek = ref<WeekCard | null>(null);
const nextCoupon = ref<WeekPredictions | null>(null);
/** The week just gone, and what it paid. */
const lastMw = ref<Mw | null>(null);
const lastScore = ref<WeekScore | null>(null);

const squadComplete = computed(() => squad.value.length === 4);
const myRank = computed(() => leaderboard.value.find((e) => e.userId === auth.user?.id) ?? null);
const topThree = computed(() => leaderboard.value.slice(0, 3));

/**
 * The cards in the order they matter. The squad leads while it can still be
 * changed and trails once the lock has made it a fact; what is in between runs
 * from what is happening now to what already happened. A card with nothing to
 * say is not drawn at all.
 */
const cards = computed<Card[]>(() =>
  squadLocked.value
    ? ['live', 'next', 'coupon', 'last', 'rank', 'squad']
    : ['squad', 'live', 'next', 'coupon', 'last', 'rank'],
);

const anyLive = computed(() => (liveWeek.value?.fixtures ?? []).some((f) => f.status === 'live'));
/** Where the squad's week stands, in one line: played, in play, still to come. */
const liveSummary = computed(() => {
  const fixtures = liveWeek.value?.fixtures ?? [];
  const tally = (status: string) => fixtures.filter((f) => f.status === status).length;
  const parts: [string, number][] = [
    ['home.matchesPlayed', tally('finished')],
    ['home.matchesLive', tally('live')],
    ['home.matchesUpcoming', tally('scheduled')],
    ['home.matchesPostponed', tally('postponed')],
    ['home.matchesCancelled', tally('cancelled')],
  ];
  return parts.filter(([, n]) => n > 0).map(([key, n]) => t(key, { n }, n)).join(' · ');
});
const showNext = computed(
  () => nextMw.value !== null && nextWeek.value !== null
    && (nextWeek.value.fixtures.length > 0 || nextWeek.value.byes.length > 0),
);
/** The coupon is worth a reminder only while it can still be written. */
const showCoupon = computed(
  () => nextMw.value !== null && nextCoupon.value !== null
    && nextCoupon.value.editable && nextCoupon.value.matches.length > 0,
);
const couponCalled = computed(() => (nextCoupon.value?.matches ?? []).filter((m) => m.pick !== null).length);
/** The clubs that actually paid last week, best first. A bench sits out (§3.5). */
const lastLines = computed(() =>
  [...(lastScore.value?.lines ?? [])].sort((a, b) => b.contributed - a.contributed),
);

function signed(n: number) { return n > 0 ? `+${n}` : `${n}`; }

/**
 * Whether a ball has been kicked this week. By status once the season has
 * moved the week on, and by the clock until it has, since the sync that flips
 * the status can trail the kickoff by a few minutes.
 */
function started(mw: Mw) {
  if (mw.status === 'in_progress' || mw.status === 'complete') return true;
  return mw.firstKickoffAt !== null && Date.now() >= new Date(mw.firstKickoffAt).getTime();
}

onMounted(async () => {
  try {
    const [status, sq, lb] = await Promise.all([
      api.get<{ matchweeks: Mw[]; seasonComplete: boolean }>('/api/tournament/status'),
      api.get<{ squad: SquadEntry[]; locked: boolean }>('/api/squad'),
      api.get<{ leaderboard: LbEntry[] }>('/api/leaderboard'),
    ]);
    squad.value = sq.squad;
    squadLocked.value = sq.locked;
    leaderboard.value = lb.leaderboard;
    seasonOver.value = status.seasonComplete;

    const weeks = status.matchweeks;
    // Three weeks matter, and at the ends of a season any of them can be
    // missing: the one being played, the one still to arrange, the one just
    // gone. The latest week under way rather than the earliest, because a
    // postponed match can hold an old week open while the season plays on.
    liveMw.value = [...weeks].reverse().find((m) => m.status !== 'complete' && started(m)) ?? null;
    // Opened under the M+1 rule and not kicked off. Locked for its last five
    // minutes, but still the week to be looking at.
    nextMw.value = weeks.find((m) => m.status !== 'complete' && m.opened && !started(m)) ?? null;
    const played = weeks.filter((m) => m.status === 'complete');
    lastMw.value = played[played.length - 1] ?? null;

    // A round's fixtures are read once even when two of the weeks share it,
    // which is what the two legs of a knockout tie do.
    const rounds = new Map<string, Promise<RoundFixtures>>();
    const roundOf = (mw: Mw) => {
      const key = roundKeyOf(weeks, mw.id) ?? mw.id;
      const held = rounds.get(key);
      if (held) return held;
      const fresh = api.get<RoundFixtures>(`/api/rounds/${key}/fixtures`);
      rounds.set(key, fresh);
      return fresh;
    };
    const weekCardOf = async (mw: Mw): Promise<WeekCard> => {
      const [round, br] = await Promise.all([
        roundOf(mw),
        api.get<{ briefing: BriefingClub[] }>(`/api/matchweeks/${mw.id}/briefing`),
      ]);
      const section = round.sections.find((s) => s.matchweekId === mw.id);
      return {
        fixtures: (section?.fixtures ?? []).filter((f) => f.home.mine || f.away.mine),
        byes: br.briefing.filter((c) => c.fixtures.length === 0).map((c) => c.name),
      };
    };
    const scoreOf = (mw: Mw) =>
      api.get<{ score: WeekScore | null }>(`/api/matchweeks/${mw.id}/score`).then((r) => r.score);

    await Promise.all([
      liveMw.value && scoreOf(liveMw.value).then((s) => (liveScore.value = s)),
      liveMw.value && weekCardOf(liveMw.value).then((w) => (liveWeek.value = w)),
      nextMw.value && weekCardOf(nextMw.value).then((w) => (nextWeek.value = w)),
      nextMw.value
        && api
          .get<WeekPredictions>(`/api/matchweeks/${nextMw.value.id}/predictions`)
          .then((p) => (nextCoupon.value = p)),
      lastMw.value && scoreOf(lastMw.value).then((s) => (lastScore.value = s)),
    ]);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('home.greeting', { name: auth.user?.displayName })" />

    <BallLoader v-if="loading" />

    <RouterLink v-if="!loading && seasonOver" to="/sezon" class="surface-card card-pad replay-banner">
      <span class="replay-title">{{ $t('home.replayTitle') }}</span>
      <span class="text-muted">{{ $t('home.replaySubtitle') }}</span>
      <Button :label="$t('home.replayAction')" size="small">
        <template #icon><Play :size="15" /></template>
      </Button>
    </RouterLink>

    <div v-if="!loading" class="dash-grid stagger">
      <template v-for="card in cards" :key="card">
        <!-- Squad: first while it can still change, last once it is settled -->
        <section v-if="card === 'squad'" class="surface-card card-pad">
          <div class="card-top">
            <h2 class="section-title flush">{{ $t('home.squadTitle') }}</h2>
            <Tag
              :severity="squadComplete ? 'success' : 'warn'"
              :value="squadComplete ? $t('home.squadReady') : $t('home.squadIncomplete')"
            />
          </div>
          <template v-if="squadComplete">
            <div class="crest-wall">
              <div class="crest-row">
                <RouterLink v-for="s in squad" :key="s.teamId" :to="`/takim/${s.teamId}`" class="crest-mini">
                  <TeamCrest
                    :name="s.name"
                    :crest-url="s.crestUrl"
                    :fallback="s.shortName"
                    size="md"
                    :class="{ elim: s.eliminated }"
                  />
                  <small>{{ s.name }}</small>
                </RouterLink>
              </div>
            </div>
            <RouterLink to="/kadro">
              <Button :label="squadLocked ? $t('home.squadView') : $t('home.squadEdit')" outlined size="small">
                <template #icon><Users :size="15" /></template>
              </Button>
            </RouterLink>
          </template>
          <template v-else>
            <p class="text-muted empty-note">{{ $t('home.squadEmpty') }}</p>
            <RouterLink to="/kadro">
              <Button :label="$t('home.squadBuild')"><template #icon><Plus :size="16" /></template></Button>
            </RouterLink>
          </template>
        </section>

        <!-- This week, from the first kickoff to the last whistle -->
        <section v-else-if="card === 'live' && liveMw && liveScore && liveWeek" class="surface-card card-pad">
          <div class="card-top">
            <h2 class="section-title flush">{{ $t('home.liveTitle') }}</h2>
            <span class="card-tags">
              <span v-if="anyLive" class="live-chip"><span class="dot" aria-hidden="true" />{{ $t('common.live') }}</span>
              <Tag :value="liveMw.label" severity="info" />
            </span>
          </div>
          <div class="week-score">
            <span class="big-num" :class="{ negative: liveScore.total < 0 }">{{ liveScore.total }}</span>
            <span class="text-muted">{{ $t('home.livePoints') }}</span>
          </div>
          <p v-if="liveSummary" class="text-muted status-line">{{ liveSummary }}</p>
          <KickoffList v-if="liveWeek.fixtures.length" :fixtures="liveWeek.fixtures" class="card-list" />
          <p v-for="b in liveWeek.byes" :key="b" class="text-muted bye-note">{{ b }} · {{ $t('week.noFixture') }}</p>
          <RouterLink :to="`/hafta/${liveMw.id}`">
            <Button :label="$t('home.liveAction')" size="small">
              <template #icon><Activity :size="15" /></template>
            </Button>
          </RouterLink>
        </section>

        <!-- Next week: who the squad meets, and when -->
        <section v-else-if="card === 'next' && nextMw && nextWeek && showNext" class="surface-card card-pad">
          <div class="card-top">
            <h2 class="section-title flush">{{ $t('home.nextWeekTitle') }}</h2>
            <Tag :value="nextMw.label" severity="info" />
          </div>
          <KickoffList v-if="nextWeek.fixtures.length" :fixtures="nextWeek.fixtures" class="card-list" />
          <p v-for="b in nextWeek.byes" :key="b" class="text-muted bye-note">{{ b }} · {{ $t('week.noFixture') }}</p>
          <RouterLink :to="`/hafta/${nextMw.id}`">
            <Button :label="$t('home.nextWeekAction')" size="small">
              <template #icon><CalendarDays :size="15" /></template>
            </Button>
          </RouterLink>
        </section>

        <!-- The coupon still waiting to be filled in -->
        <section v-else-if="card === 'coupon' && nextMw && nextCoupon && showCoupon" class="surface-card card-pad">
          <div class="card-top">
            <h2 class="section-title flush"><OctopusMark :size="18" /> {{ $t('paul.name') }}</h2>
            <Tag
              :value="`${couponCalled}/${nextCoupon.matches.length}`"
              :severity="couponCalled ? 'success' : 'warn'"
            />
          </div>
          <p class="text-muted coupon-note">
            {{ couponCalled ? $t('home.couponSome') : $t('home.couponNone') }}
          </p>
          <RouterLink :to="`/hafta/${nextMw.id}`">
            <Button
              :label="couponCalled ? $t('home.couponReview') : $t('home.couponFill')"
              :outlined="couponCalled > 0"
              size="small"
            >
              <template #icon><Play :size="15" /></template>
            </Button>
          </RouterLink>
        </section>

        <!-- Last week: what the pitch, the joker and the coupon each paid -->
        <section v-else-if="card === 'last' && lastMw && lastScore" class="surface-card card-pad">
          <div class="card-top">
            <h2 class="section-title flush">{{ $t('home.lastWeekTitle') }}</h2>
            <Tag :value="lastMw.label" severity="secondary" />
          </div>
          <div class="week-score">
            <span class="big-num" :class="{ negative: lastScore.total < 0 }">{{ Math.abs(lastScore.total) }}</span>
            <span class="text-muted">{{ lastScore.total < 0 ? $t('home.pointsLost') : $t('home.pointsBanked') }}</span>
          </div>
          <ul class="recap">
            <li v-for="l in lastLines" :key="l.teamId" class="recap-row">
              <span class="recap-name">
                {{ l.name }}
                <CaptainBadge v-if="l.captain" :multiplier="l.multiplier" :size="15" />
                <span v-else-if="l.benched" class="role-chip">{{ $t('week.bench') }}</span>
              </span>
              <span class="recap-pts" :class="l.contributed >= 0 ? 'text-positive' : 'text-negative'">
                {{ signed(l.contributed) }}
              </span>
            </li>
            <li v-if="lastScore.jokerCode" class="recap-row extra">
              <span class="recap-name">
                <component :is="JOKER_ICONS[lastScore.jokerCode]" :size="14" aria-hidden="true" />
                {{ $t(`joker.${lastScore.jokerCode}`) }}
              </span>
              <span
                v-if="lastScore.jokerDelta !== null"
                class="recap-pts"
                :class="lastScore.jokerDelta >= 0 ? 'text-positive' : 'text-negative'"
              >{{ signed(lastScore.jokerDelta) }}</span>
              <span v-else class="recap-pts text-muted">{{ $t('home.jokerPlayed') }}</span>
            </li>
            <li v-if="lastScore.predictions.settled" class="recap-row extra">
              <span class="recap-name">
                <OctopusMark :size="14" />
                {{ $t('paul.correctOf', lastScore.predictions) }}
              </span>
              <span class="recap-pts text-positive">{{ signed(lastScore.predictions.points) }}</span>
            </li>
          </ul>
          <RouterLink :to="`/hafta/${lastMw.id}`">
            <Button :label="$t('home.lastWeekAction')" outlined size="small">
              <template #icon><History :size="15" /></template>
            </Button>
          </RouterLink>
        </section>

        <!-- Standings -->
        <section v-else-if="card === 'rank'" class="surface-card card-pad">
          <div class="card-top">
            <h2 class="section-title flush">{{ $t('home.rankTitle') }}</h2>
            <Tag v-if="myRank" :value="`${myRank.rank}.`" severity="info" />
          </div>
          <ol v-if="topThree.length" class="mini-lb">
            <li v-for="e in topThree" :key="e.userId" :class="{ me: e.userId === auth.user?.id }">
              <span class="lb-rank">{{ e.rank }}</span>
              <RouterLink :to="`/oyuncu/${e.userId}`" class="lb-name">{{ e.displayName }}</RouterLink>
              <span class="lb-pts">{{ e.total }}</span>
            </li>
          </ol>
          <p v-else class="text-muted flush">{{ $t('home.rankEmpty') }}</p>
          <RouterLink to="/puan-durumu">
            <Button :label="$t('home.rankAll')" text size="small">
              <template #icon><ChartColumn :size="15" /></template>
            </Button>
          </RouterLink>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.replay-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  text-decoration: none;
  color: var(--color-text);
  border-color: var(--color-warning);
  transition: box-shadow 0.16s ease, transform 0.16s ease;
}
.replay-banner:hover { box-shadow: 0 0 18px rgba(251, 191, 36, 0.25); transform: translateY(-2px); text-decoration: none; }
.replay-banner .replay-title { font-weight: 800; }
.replay-banner .text-muted { flex: 1; font-size: var(--text-sm); }
/* Three across at most: a card holds a fixture list, and a fixture is two
   club names on one line, which four narrow columns would keep breaking. */
.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 1.25rem;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.card-tags { display: inline-flex; align-items: center; gap: 0.5rem; }

/* Four clubs read as one row or as two by two, never three and a stray. The
   wall measures itself rather than the window, because how wide a card is
   depends on how many share the grid. */
.crest-wall {
  container-type: inline-size;
  margin-bottom: 1.1rem;
}
.crest-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
@container (max-width: 329px) {
  .crest-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.crest-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  text-align: center;
  text-decoration: none;
  color: var(--color-text);
}
.crest-mini small {
  max-width: 100%;
  font-size: var(--text-2xs);
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.crest.elim {
  filter: grayscale(1);
  opacity: 0.6;
}
.crest-mini:hover .crest {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.week-score {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.big-num {
  font-size: var(--text-3xl);
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1;
}
.big-num.negative { color: var(--color-danger); }
.status-line { margin: 0 0 0.9rem; font-size: var(--text-sm); }
.card-list { margin-bottom: 0.9rem; }
.live-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.12rem 0.55rem;
  border-radius: var(--radius-pill);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: var(--text-2xs);
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.live-chip .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse-soft 1.4s ease-in-out infinite;
}
.bye-note { margin: 0 0 0.6rem; font-size: var(--text-xs); }
.coupon-note { margin: 0.4rem 0 0.9rem; font-size: var(--text-sm); }

/* Last week, line by line: what each club, the joker and the coupon paid. A
   total on its own says how the week went but never why. */
.recap { list-style: none; margin: 0.6rem 0 0.9rem; padding: 0; display: flex; flex-direction: column; }
.recap-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.6rem;
  padding: 0.4rem 0; border-bottom: 1px solid var(--color-border); font-size: var(--text-sm);
}
.recap-row:last-child { border-bottom: none; }
/* The joker and the coupon are not clubs, so they read a shade quieter. */
.recap-row.extra .recap-name { color: var(--color-text-muted); }
.recap-name { display: inline-flex; align-items: center; gap: 0.4rem; min-width: 0; }
.recap-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recap-pts { flex-shrink: 0; font-weight: 800; font-variant-numeric: tabular-nums; }

.mini-lb {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.mini-lb li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
}
.mini-lb li.me {
  background: var(--color-primary-soft);
}
.lb-rank {
  font-weight: 800;
  color: var(--color-primary);
  width: 1.2rem;
}
.lb-name {
  flex: 1;
  color: var(--color-text);
  text-decoration: none;
}
.lb-name:hover { color: var(--color-primary); }
.lb-pts {
  font-weight: 700;
}

@media (max-width: 600px) {
  .dash-grid { grid-template-columns: minmax(0, 1fr); gap: 0.9rem; }
  .replay-banner .text-muted { flex: 1 1 100%; }
}

.empty-note { margin: 0 0 1rem; }
</style>
