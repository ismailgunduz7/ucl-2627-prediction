<script setup lang="ts">
import { computed } from 'vue';
import { House, Plane, Star } from '@lucide/vue';

/**
 * One fixture written the way it is played: the home side first, the away side
 * second. `teamName` is the club being looked at and gets a marker so it is
 * obvious which of the two it is.
 */
const props = defineProps<{
  teamName: string;
  opponentName: string;
  home: boolean;
  teamScore?: number | null;
  opponentScore?: number | null;
  status?: string;
}>();

const played = computed(
  () => props.teamScore !== null && props.teamScore !== undefined
    && props.opponentScore !== null && props.opponentScore !== undefined,
);
const left = computed(() => (props.home ? props.teamName : props.opponentName));
const right = computed(() => (props.home ? props.opponentName : props.teamName));
const leftScore = computed(() => (props.home ? props.teamScore : props.opponentScore));
const rightScore = computed(() => (props.home ? props.opponentScore : props.teamScore));
const venueLabel = computed(() => (props.home ? 'Evinde' : 'Deplasmanda'));
</script>

<template>
  <span class="fixture">
    <component
      :is="home ? House : Plane"
      :size="14"
      class="venue"
      :aria-label="venueLabel"
    />
    <span class="side" :class="{ own: home }">
      <Star v-if="home" :size="11" class="own-mark" />{{ left }}
    </span>
    <span class="score">
      <template v-if="played">{{ leftScore }}–{{ rightScore }}</template>
      <template v-else>vs</template>
    </span>
    <span class="side" :class="{ own: !home }">
      {{ right }}<Star v-if="!home" :size="11" class="own-mark" />
    </span>
  </span>
</template>

<style scoped>
.fixture {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.venue {
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.side {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-text-secondary);
}
.side.own {
  color: var(--color-text);
  font-weight: 700;
}
.own-mark {
  color: var(--color-primary);
}
.score {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
</style>
