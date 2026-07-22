<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

// Lightweight custom cursor: a dot that tracks the pointer exactly and a ring
// that eases behind it. Pointer devices only; disabled for touch and for users
// who prefer reduced motion. All updates run inside a single rAF loop.
const enabled = ref(false);
const dot = ref<HTMLElement | null>(null);
const ring = ref<HTMLElement | null>(null);

let raf = 0;
let mx = -100, my = -100, rx = -100, ry = -100;

function onMove(e: PointerEvent) {
  mx = e.clientX;
  my = e.clientY;
}
function onDown() { ring.value?.classList.add('is-active'); }
function onUp() { ring.value?.classList.remove('is-active'); }

function loop() {
  rx += (mx - rx) * 0.18;
  ry += (my - ry) * 0.18;
  if (dot.value) dot.value.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
  if (ring.value) ring.value.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
  raf = requestAnimationFrame(loop);
}

onMounted(() => {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduced) return;

  enabled.value = true;
  document.documentElement.classList.add('has-custom-cursor');
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  raf = requestAnimationFrame(loop);
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  document.documentElement.classList.remove('has-custom-cursor');
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerdown', onDown);
  window.removeEventListener('pointerup', onUp);
});
</script>

<template>
  <template v-if="enabled">
    <div ref="ring" class="cursor-ring" aria-hidden="true" />
    <div ref="dot" class="cursor-dot" aria-hidden="true" />
  </template>
</template>
