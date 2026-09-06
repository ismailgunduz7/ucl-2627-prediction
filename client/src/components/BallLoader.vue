<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import StarBall from '@/components/StarBall.vue';

const { t } = useI18n();
const props = defineProps<{ message?: string }>();

const MESSAGE_COUNT = 10;

// Picked once per mount so the line doesn't shuffle on every re-render, but
// still follows the language if it changes while the page is loading.
const pick = Math.floor(Math.random() * MESSAGE_COUNT);
const text = computed(() => props.message ?? t(`loading.${pick}`));
</script>

<template>
  <div class="ball-loader" role="status" aria-live="polite">
    <div class="ball-stage">
      <!-- Outer element bounces, inner spins: separate elements so the two
           transforms don't overwrite each other. -->
      <div class="ball-bounce">
        <StarBall class="ball-mark" />
      </div>
      <div class="ball-shadow" />
    </div>
    <p class="ball-text">{{ text }}</p>
  </div>
</template>

<style scoped>
.ball-loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.1rem;
  padding: 3.25rem 1rem;
}
.ball-stage {
  position: relative;
  width: 62px;
  height: 80px;
}
.ball-bounce {
  position: absolute;
  inset: 0 0 auto 0;
  display: grid;
  place-items: center;
  animation: ball-bounce 0.72s cubic-bezier(0.35, 0, 0.35, 1) infinite alternate;
}
.ball-mark {
  display: block;
  width: 48px;
  height: 48px;
  color: #eef3ff;
  filter: drop-shadow(0 3px 7px rgba(0, 0, 0, 0.55));
  animation: ball-spin 2.4s linear infinite;
}
.ball-shadow {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 44px;
  height: 8px;
  margin-left: -22px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  filter: blur(4px);
  animation: ball-shadow 0.72s cubic-bezier(0.35, 0, 0.35, 1) infinite alternate;
}
.ball-text {
  margin: 0;
  font-size: 0.92rem;
  color: var(--color-text-muted);
}

@keyframes ball-bounce {
  from { transform: translateY(30px); }
  to { transform: translateY(0); }
}
@keyframes ball-spin {
  to { transform: rotate(360deg); }
}
@keyframes ball-shadow {
  from { transform: scaleX(1); opacity: 0.5; }
  to { transform: scaleX(0.55); opacity: 0.18; }
}

@media (prefers-reduced-motion: reduce) {
  .ball-bounce,
  .ball-mark,
  .ball-shadow { animation: none; }
}
</style>
