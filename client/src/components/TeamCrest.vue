<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * A club's badge.
 *
 * The real crest when the provider gave us one, the club's own letters when it
 * did not. A missing or broken image is an ordinary state rather than an error,
 * so it falls back instead of leaving a hole, and a crest that fails to load
 * once does not keep retrying.
 */
const props = withDefaults(
  defineProps<{
    name: string;
    crestUrl?: string | null;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    /** What the letters read when there is no crest. Initials of `name` otherwise. */
    fallback?: string | null;
  }>(),
  { crestUrl: null, size: 'md', fallback: null },
);

const broken = ref(false);
watch(() => props.crestUrl, () => (broken.value = false));

const showCrest = computed(() => !!props.crestUrl && !broken.value);
const letters = computed(
  () => props.fallback ?? props.name.split(' ').map((w) => w[0]).slice(0, 3).join('').toUpperCase(),
);
</script>

<template>
  <span class="crest" :class="[`crest-${size}`, { 'crest-badge': showCrest }]">
    <img v-if="showCrest" :src="crestUrl!" :alt="name" loading="lazy" @error="broken = true" />
    <template v-else>{{ letters }}</template>
  </span>
</template>
