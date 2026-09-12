<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import FixtureLine from '@/components/FixtureLine.vue';
import { formatLongDateTime } from '@/lib/format';

/**
 * A handful of fixtures under the moment they kick off, the way a player plans
 * an evening: two matches at the same hour share one heading rather than
 * repeating the date on every line, and the reader's own clubs are the ones
 * that stand out. A match still without a date closes the list under a heading
 * that says so.
 */
export interface KickoffSide {
  name: string;
  score: number | null;
  /** In the reader's squad this week. */
  mine: boolean;
}
export interface KickoffFixture {
  matchId: string;
  kickoffAt: string | null;
  status: string;
  home: KickoffSide;
  away: KickoffSide;
}

const props = defineProps<{ fixtures: KickoffFixture[] }>();
const { t } = useI18n();

const groups = computed(() => {
  const sorted = [...props.fixtures].sort((a, b) => {
    if (a.kickoffAt === b.kickoffAt) return 0;
    if (a.kickoffAt === null) return 1;
    if (b.kickoffAt === null) return -1;
    return a.kickoffAt.localeCompare(b.kickoffAt);
  });
  const byTime = new Map<string, KickoffFixture[]>();
  for (const f of sorted) {
    const key = f.kickoffAt ?? 'tbd';
    byTime.set(key, [...(byTime.get(key) ?? []), f]);
  }
  return [...byTime].map(([key, fixtures]) => ({
    key,
    label: key === 'tbd' ? t('fixtures.dateUnknown') : formatLongDateTime(key),
    fixtures,
  }));
});
</script>

<template>
  <ul class="kickoffs">
    <li v-for="g in groups" :key="g.key">
      <span class="kickoff-when">{{ g.label }}</span>
      <ul class="kickoff-rows">
        <li v-for="f in g.fixtures" :key="f.matchId" class="kickoff-row">
          <FixtureLine
            :team-name="f.home.name"
            :opponent-name="f.away.name"
            :home="true"
            :team-score="f.home.score"
            :opponent-score="f.away.score"
            :team-mine="f.home.mine"
            :opponent-mine="f.away.mine"
          />
          <span v-if="f.status === 'live'" class="live-chip">
            <span class="dot" aria-hidden="true" />{{ $t('common.live') }}
          </span>
          <span v-else-if="f.status === 'postponed' || f.status === 'cancelled'" class="role-chip">
            {{ $t(`matchStatus.${f.status}`) }}
          </span>
        </li>
      </ul>
    </li>
  </ul>
</template>

<style scoped>
.kickoffs,
.kickoff-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.kickoffs {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
/* The hour is a heading over its matches: small, quiet, and lined up. */
.kickoff-when {
  display: block;
  margin-bottom: 0.25rem;
  font-size: var(--text-2xs);
  font-weight: 700;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.kickoff-rows {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.kickoff-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: var(--text-sm);
}
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
</style>
