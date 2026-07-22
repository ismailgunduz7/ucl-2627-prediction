<script setup lang="ts">
// Champions League starball. Inlined (rather than an <img>) so the artwork
// inherits the surrounding text colour.
import ballSvg from '@/assets/ball.svg?raw';
</script>

<template>
  <span class="starball" aria-hidden="true" v-html="ballSvg" />
</template>

<style scoped>
.starball {
  display: inline-block;
  line-height: 0;
}
.starball :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
/* Source paths carry no fill of their own, so currentColor applies cleanly. */
.starball :deep(path) {
  fill: currentColor;
}
</style>
