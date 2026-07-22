<script setup lang="ts">
import { computed } from 'vue';
import { JOKER_ICONS, jokerName } from '@/lib/jokers';

const props = withDefaults(defineProps<{ code: string; size?: number }>(), { size: 15 });

const icon = computed(() => JOKER_ICONS[props.code]);
const label = computed(() => jokerName(props.code));
</script>

<template>
  <span v-if="icon" class="joker-icon" :title="label" :aria-label="label">
    <component :is="icon" :size="size" />
  </span>
</template>

<style scoped>
.joker-icon {
  display: inline-grid;
  place-items: center;
  color: var(--color-primary);
}
</style>
