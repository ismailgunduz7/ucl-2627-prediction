<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), { message: 'Saha hazırlanıyor…' });

// SVG ids must be unique per instance so two loaders never share a definition.
const uid = `bl${Math.random().toString(36).slice(2, 8)}`;

// Flat football: a pentagon in the middle, five more ringed around it, joined
// by short seams. Coordinates are in a 100x100 viewBox centred on (50,50).
const CENTER_PENTAGON = '50,34 65.22,45.06 59.4,62.94 40.6,62.94 34.78,45.06';
const RING_PENTAGON = '50,5 60.46,12.6 56.47,24.9 43.53,24.9 39.54,12.6';
const SEAM_ANGLES = [0, 72, 144, 216, 288];
const RING_ANGLES = [36, 108, 180, 252, 324];
</script>

<template>
  <div class="ball-loader" role="status" aria-live="polite">
    <div class="ball-stage">
      <!-- Outer element bounces, inner spins: separate elements so the two
           transforms don't overwrite each other. -->
      <div class="ball-bounce">
        <svg class="ball-spin" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <polygon :id="`${uid}-cap`" :points="RING_PENTAGON" />
          </defs>
          <circle cx="50" cy="50" r="47" fill="#eef3ff" />
          <g stroke="#101828" stroke-width="2.4" stroke-linecap="round">
            <line
              v-for="a in SEAM_ANGLES"
              :key="`s${a}`"
              x1="50" y1="34" x2="50" y2="25"
              :transform="`rotate(${a} 50 50)`"
            />
          </g>
          <polygon :points="CENTER_PENTAGON" fill="#101828" />
          <use
            v-for="a in RING_ANGLES"
            :key="`c${a}`"
            :href="`#${uid}-cap`"
            fill="#101828"
            :transform="`rotate(${a} 50 50)`"
          />
          <circle cx="50" cy="50" r="47" fill="none" stroke="#101828" stroke-width="2.5" />
        </svg>
      </div>
      <div class="ball-shadow" />
    </div>
    <p class="ball-text">{{ message }}</p>
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
  width: 56px;
  height: 76px;
}
.ball-bounce {
  position: absolute;
  inset: 0 0 auto 0;
  display: grid;
  place-items: center;
  animation: ball-bounce 0.72s cubic-bezier(0.35, 0, 0.35, 1) infinite alternate;
}
.ball-spin {
  width: 46px;
  height: 46px;
  display: block;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
  animation: ball-spin 1.4s linear infinite;
}
.ball-shadow {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 42px;
  height: 8px;
  margin-left: -21px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  filter: blur(3.5px);
  animation: ball-shadow 0.72s cubic-bezier(0.35, 0, 0.35, 1) infinite alternate;
}
.ball-text {
  margin: 0;
  font-size: 0.92rem;
  color: var(--color-text-muted);
}

@keyframes ball-bounce {
  from { transform: translateY(28px); }
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
  .ball-spin,
  .ball-shadow { animation: none; }
}
</style>
