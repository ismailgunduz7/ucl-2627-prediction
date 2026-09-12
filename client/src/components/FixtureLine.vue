<script setup lang="ts">
import { computed } from 'vue';

/**
 * One fixture written the way it is played: home side first, away side second.
 * That ordering is what tells you where the club played, so the line needs no
 * venue icon. Neither side is emphasised either, because bold would read as
 * "this one won". The one exception is a list built around the reader's own
 * clubs, like the cards on the home page: there the side that is theirs is
 * marked, the same way the fixtures page marks it, so the eye finds it first.
 */
const props = defineProps<{
  teamName: string;
  opponentName: string;
  home: boolean;
  teamScore?: number | null;
  opponentScore?: number | null;
  /** The reader's own club, when the list is about their clubs. */
  teamMine?: boolean;
  opponentMine?: boolean;
}>();

const played = computed(
  () => props.teamScore !== null && props.teamScore !== undefined
    && props.opponentScore !== null && props.opponentScore !== undefined,
);
const left = computed(() => (props.home ? props.teamName : props.opponentName));
const right = computed(() => (props.home ? props.opponentName : props.teamName));
const leftScore = computed(() => (props.home ? props.teamScore : props.opponentScore));
const rightScore = computed(() => (props.home ? props.opponentScore : props.teamScore));
const leftMine = computed(() => (props.home ? props.teamMine : props.opponentMine) ?? false);
const rightMine = computed(() => (props.home ? props.opponentMine : props.teamMine) ?? false);
</script>

<template>
  <span class="fixture">
    <span class="side" :class="{ own: leftMine }">{{ left }}</span>
    <span class="score">
      <template v-if="played">{{ leftScore }}-{{ rightScore }}</template>
      <template v-else>vs</template>
    </span>
    <span class="side" :class="{ own: rightMine }">{{ right }}</span>
  </span>
</template>

<style scoped>
.fixture {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.side {
  color: var(--color-text-secondary);
}
/* Brighter and heavier, never a colour: a colour would read as a result. */
.side.own {
  color: var(--color-text);
  font-weight: 700;
}
.score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
</style>
