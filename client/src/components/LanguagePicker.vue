<script setup lang="ts">
import { LOCALES, LOCALE_NAMES, type Locale } from '@/i18n';
import { useLocaleStore } from '@/stores/locale';

/**
 * Two languages, both on screen. A dropdown would hide the choice behind a
 * click for no gain, and the codes are short enough to sit in the header.
 */
withDefaults(defineProps<{ block?: boolean }>(), { block: false });

const locale = useLocaleStore();
</script>

<template>
  <div class="lang-picker" :class="{ block }" role="group" :aria-label="$t('common.language')">
    <button
      v-for="code in LOCALES"
      :key="code"
      type="button"
      class="lang-option"
      :class="{ on: locale.locale === code }"
      :aria-pressed="locale.locale === code"
      :title="LOCALE_NAMES[code]"
      @click="locale.choose(code as Locale)"
    >
      {{ code.toUpperCase() }}
    </button>
  </div>
</template>

<style scoped>
.lang-picker {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-bg-subtle);
}
.lang-picker.block { display: flex; width: 100%; }
.lang-option {
  flex: 1;
  min-width: 34px;
  padding: 0.3rem 0.55rem;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--text-2xs);
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.lang-option:hover { color: var(--color-text); }
.lang-option.on {
  background: var(--color-primary-soft);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(129, 140, 248, 0.4);
}
@media (pointer: coarse) {
  .lang-option { padding: 0.55rem 0.7rem; font-size: var(--text-xs); }
}
</style>
