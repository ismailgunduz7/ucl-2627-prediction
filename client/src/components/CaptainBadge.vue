<script setup lang="ts">
import { computed } from 'vue';
import { JOKER_ICONS, jokerName } from '@/lib/jokers';

// The armband shows a plain C normally. When a joker lifts the captain (triple
// boost), it carries that joker's icon instead so the boost is obvious.
const props = withDefaults(
  defineProps<{ multiplier?: number; jokerCode?: string | null; size?: number }>(),
  { multiplier: 2, jokerCode: null, size: 26 },
);

const boosted = computed(() => props.multiplier > 2 && !!props.jokerCode);
const icon = computed(() => (boosted.value ? JOKER_ICONS[props.jokerCode!] : null));
const label = computed(() =>
  boosted.value ? `Kaptan · ${jokerName(props.jokerCode)}` : 'Kaptan',
);
</script>

<template>
  <span
    class="armband"
    :class="{ boosted }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="label"
    :aria-label="label"
  >
    <component :is="icon" v-if="icon" :size="Math.round(size * 0.55)" />
    <span v-else class="letter">C</span>
  </span>
</template>

<style scoped>
.armband {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-warning), #f59e0b);
  color: #17130a;
  border: 1.5px solid var(--color-warning);
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.35);
  flex-shrink: 0;
}
.armband.boosted {
  background: linear-gradient(135deg, var(--color-primary-strong), var(--color-accent));
  border-color: var(--color-primary);
  color: #fff;
  box-shadow: 0 0 14px rgba(99, 102, 241, 0.45);
}
.letter {
  font-weight: 800;
  font-size: 0.72em;
  line-height: 1;
}
</style>
