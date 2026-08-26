<script setup lang="ts">
import { computed } from 'vue';

/**
 * One fixture written the way it is played: home side first, away side second.
 * That ordering is what says where the club played, so the line carries no
 * venue icon, and neither side is emphasised — bold here would read as "won".
 */
const props = defineProps<{
  teamName: string;
  opponentName: string;
  home: boolean;
  teamScore?: number | null;
  opponentScore?: number | null;
}>();

const played = computed(
  () => props.teamScore !== null && props.teamScore !== undefined
    && props.opponentScore !== null && props.opponentScore !== undefined,
);
const left = computed(() => (props.home ? props.teamName : props.opponentName));
const right = computed(() => (props.home ? props.opponentName : props.teamName));
const leftScore = computed(() => (props.home ? props.teamScore : props.opponentScore));
const rightScore = computed(() => (props.home ? props.opponentScore : props.teamScore));
</script>

<template>
  <span class="fixture">
    <span class="side">{{ left }}</span>
    <span class="score">
      <template v-if="played">{{ leftScore }}–{{ rightScore }}</template>
      <template v-else>vs</template>
    </span>
    <span class="side">{{ right }}</span>
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
.score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
</style>
