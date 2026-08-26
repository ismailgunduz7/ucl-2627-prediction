<script setup lang="ts">
/**
 * Ahtapot Paul's mark. Lucide has no octopus, so this is drawn on the same
 * 24×24 grid with the same 2px round stroke as the rest of the icon set.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 18 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 14a8 8 0 0 1 16 0" />
    <path d="M4 14c0 3.2-.9 5-2.4 6" />
    <path d="M9.3 14c-.5 2.8-.3 4.6.6 6" />
    <path d="M14.7 14c.5 2.8.3 4.6-.6 6" />
    <path d="M20 14c0 3.2.9 5 2.4 6" />
    <circle cx="9" cy="10.8" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10.8" r="1" fill="currentColor" stroke="none" />
  </svg>
</template>
