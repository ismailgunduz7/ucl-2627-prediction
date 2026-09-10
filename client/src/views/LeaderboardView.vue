<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Message from 'primevue/message';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader.vue';
import BallLoader from '@/components/BallLoader.vue';
import TeamCrest from '@/components/TeamCrest.vue';

interface SquadClub { teamId: string; tierId: number; name: string; shortName: string }
interface Entry {
  userId: string;
  displayName: string;
  finalPoints: number;
  provisionalPoints: number;
  total: number;
  rank: number;
  squad: SquadClub[];
}

interface TeamEntry {
  teamId: string;
  name: string;
  shortName: string;
  crestUrl: string | null;
  tierId: number;
  eliminated: boolean;
  provisionalPoints: number;
  total: number;
  rank: number;
}

const rows = ref<Entry[]>([]);
const teams = ref<TeamEntry[]>([]);
const meId = ref<string | null>(null);
const loading = ref(true);

const POTS = [1, 2, 3, 4];
function clubOf(e: Entry, pot: number) {
  return e.squad.find((c) => c.tierId === pot) ?? null;
}
function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}

onMounted(async () => {
  try {
    const [players, clubs] = await Promise.all([
      api.get<{ leaderboard: Entry[]; meId: string }>('/api/leaderboard'),
      api.get<{ teams: TeamEntry[] }>('/api/team-leaderboard'),
    ]);
    rows.value = players.leaderboard;
    meId.value = players.meId ?? null;
    teams.value = clubs.teams;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page-stack">
    <PageHeader :title="$t('leaderboard.title')" />

    <BallLoader v-if="loading" />
    <template v-else>
      <Tabs value="players">
        <TabList>
          <Tab value="players">{{ $t('leaderboard.tabPlayers') }}</Tab>
          <Tab value="clubs">{{ $t('leaderboard.tabClubs') }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="players">
            <Message v-if="!rows.length" severity="secondary" :closable="false">
              {{ $t('leaderboard.empty') }}
            </Message>
            <div v-else class="surface-card table-scroll">
              <table class="lb freeze-2">
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="text-start">{{ $t('leaderboard.player') }}</th>
                    <th v-for="pot in POTS" :key="pot" class="pot-col">{{ $t('common.pot', { number: pot }) }}</th>
                    <th>{{ $t('leaderboard.points') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in rows" :key="e.userId" :class="{ me: e.userId === meId }">
                    <td class="rank">{{ e.rank }}</td>
                    <td class="text-start">
                      <RouterLink :to="`/oyuncu/${e.userId}`" class="player-link">{{ e.displayName }}</RouterLink>
                      <span v-if="e.userId === meId" class="you"> · {{ $t('common.you') }}</span>
                    </td>
                    <td v-for="pot in POTS" :key="pot" class="pot-col">
                      <RouterLink
                        v-if="clubOf(e, pot)"
                        :to="`/takim/${clubOf(e, pot)!.teamId}`"
                        class="club-link"
                        :title="clubOf(e, pot)!.name"
                      >{{ clubOf(e, pot)!.shortName }}</RouterLink>
                      <span v-else class="text-muted">{{ $t('common.none') }}</span>
                    </td>
                    <td class="total-cell">
                      <strong>{{ e.total }}</strong>
                      <span
                        v-if="e.provisionalPoints !== 0"
                        class="live-part"
                        :title="$t('leaderboard.liveHint')"
                      >
                        <span class="dot" aria-hidden="true" />{{ signed(e.provisionalPoints) }} {{ $t('common.live') }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TabPanel>

          <TabPanel value="clubs">
            <Message v-if="!teams.length" severity="secondary" :closable="false">
              {{ $t('leaderboard.clubsEmpty') }}
            </Message>
            <div v-else class="surface-card table-scroll">
              <table class="lb clubs freeze-2">
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="text-start">{{ $t('standings.club') }}</th>
                    <th>{{ $t('leaderboard.pot') }}</th>
                    <th>{{ $t('leaderboard.collected') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in teams" :key="c.teamId" :class="{ out: c.eliminated }">
                    <td class="rank" :class="{ first: c.rank === 1 }">{{ c.rank }}</td>
                    <td class="text-start">
                      <div class="club-cell">
                        <RouterLink :to="`/takim/${c.teamId}`" class="club-title">
                          <TeamCrest :name="c.name" :crest-url="c.crestUrl" :fallback="c.shortName" size="xs" />
                          <span class="club-name">{{ c.name }}</span>
                        </RouterLink>
                        <span v-if="c.eliminated" class="out-chip">{{ $t('common.eliminated') }}</span>
                      </div>
                    </td>
                    <td><span class="pot-pill">{{ c.tierId }}</span></td>
                    <td class="total-cell">
                      <strong :class="{ 'text-negative': c.total < 0 }">{{ c.total }}</strong>
                      <span
                        v-if="c.provisionalPoints !== 0"
                        class="live-part"
                        :title="$t('leaderboard.liveHint')"
                      >
                        <span class="dot" aria-hidden="true" />{{ signed(c.provisionalPoints) }} {{ $t('common.live') }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>
  </div>
</template>

<style scoped>
.lb { width: 100%; border-collapse: collapse; }
.lb th, .lb td { padding: 0.7rem 0.85rem; text-align: center; border-bottom: 1px solid var(--color-border); }
.lb thead th { background: var(--color-bg-subtle); font-size: 0.82rem; font-weight: 700; color: var(--color-text-secondary); }
.lb tbody tr:last-child td { border-bottom: none; }
.lb tr.me { background: var(--color-primary-soft); }
.rank { font-weight: 800; color: var(--color-primary); }
.you { color: var(--color-primary); font-size: 0.8rem; font-weight: 600; }
.player-link { color: var(--color-text); font-weight: 600; }
.player-link:hover { color: var(--color-primary); }
.pot-col { font-variant-numeric: normal; }
.club-link { color: var(--color-text-secondary); font-weight: 600; font-size: 0.85rem; }
.club-link:hover { color: var(--color-primary); }

/* The column naming a row reads from the left. The helper class that says so
   is unscoped, so the centring rule above out-specifies it; said again here it
   wins, and the columns of numbers stay centred either way. */
.lb th.text-start, .lb td.text-start { text-align: left; }

/* The clubs tab: a badge and a full name in the pinned column, so a row is
   recognisable before any of the numbers arrive. */
.clubs { min-width: 420px; }
.club-cell { display: flex; align-items: center; gap: 0.5rem; }
.club-title {
  display: inline-flex; align-items: center; gap: 0.55rem;
  color: var(--color-text); font-weight: 600;
}
.club-title:hover { color: var(--color-primary); }
.club-name { white-space: nowrap; }
/* The pot is a label, not a quantity, so it does not read as another number in
   a row of them. */
.pot-pill {
  display: inline-block; min-width: 1.75rem; padding: 0.1rem 0.4rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-2); border: 1px solid var(--color-border);
  font-size: var(--text-2xs); font-weight: 700; color: var(--color-text-secondary);
}
/* The season's top scorer, in the same gold the podium gives first place. */
.clubs .rank.first { color: var(--color-warning); }
/* Knocked out and still on the table: the season it played is still counted. */
.clubs tr.out { color: var(--color-text-muted); }
.clubs tr.out .club-title { color: var(--color-text-muted); }
.clubs tr.out .pot-pill { opacity: 0.55; }
/* The badge lives in TeamCrest, so dimming it has to reach into the child. */
.clubs tr.out :deep(.crest) { opacity: 0.55; }
.out-chip {
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-pill); background: var(--color-danger-soft);
  color: var(--color-danger); font-size: var(--text-2xs); font-weight: 700;
  white-space: nowrap;
}
.total-cell strong { font-size: var(--text-md); }
/* The slice of the total that is still moving in live matches. */
.live-part {
  display: block;
  margin-top: 0.15rem;
  font-size: var(--text-2xs);
  font-weight: 700;
  color: var(--color-danger);
}
.live-part .dot {
  display: inline-block;
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
  margin-right: 0.3rem;
  vertical-align: middle;
  animation: pulse-soft 1.4s ease-in-out infinite;
}

@media (max-width: 600px) {
  .lb { min-width: 520px; }
  .lb.clubs { min-width: 400px; }
  .lb th, .lb td { padding: 0.55rem 0.45rem; font-size: 0.84rem; }
}
</style>
