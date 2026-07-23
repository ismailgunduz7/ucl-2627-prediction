<script setup lang="ts">
import { computed } from 'vue';
import trophySvg from '@/assets/trophy.svg?raw';

const props = withDefaults(defineProps<{ size?: number }>(), { size: 17 });

// The artwork carries a mask; give each instance its own id so two copies on
// the page (desktop nav and mobile nav) never share one.
const uid = `trophy${Math.random().toString(36).slice(2, 8)}`;
const svg = computed(() => trophySvg.replaceAll('trophyMask', uid));
</script>

<template>
  <span
    class="trophy-mark"
    :style="{ height: `${props.size}px` }"
    aria-hidden="true"
    v-html="svg"
  />
</template>

<style scoped>
.trophy-mark {
  display: inline-block;
  line-height: 0;
  color: inherit;
}
/* Keep the tall aspect ratio: height drives it, width follows. */
.trophy-mark :deep(svg) {
  height: 100%;
  width: auto;
  display: block;
}
</style>
