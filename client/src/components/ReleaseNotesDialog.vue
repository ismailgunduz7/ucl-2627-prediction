<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Image from 'primevue/image';
import { DEFAULT_LOCALE, isLocale } from '@/i18n';
import { formatDateFull } from '@/lib/format';
import type { Note, NoteImage, Release } from '@/releases';
import { useReleaseStore } from '@/stores/releases';

/**
 * What changed, release by release (§18.12). The store decides when this opens
 * and what it lists; this only draws it, and reports every way of closing it,
 * the X and the escape key included, so the account is marked as having read
 * it whichever one the player reaches for.
 */
const { locale } = useI18n();
const releases = useReleaseStore();

const lang = computed(() => (isLocale(locale.value) ? locale.value : DEFAULT_LOCALE));

/** A release's notes in the language on screen, each with its picture if it has one. */
function notesOf(release: Release): { text: string; image: NoteImage | null }[] {
  return release.notes[lang.value].map((note: Note) =>
    typeof note === 'string'
      ? { text: note, image: null }
      : { text: note.text, image: note.image ?? null },
  );
}

function onVisible(visible: boolean) {
  if (!visible) void releases.close();
}
</script>

<template>
  <Dialog
    :visible="releases.open"
    modal
    class="dialog-lg"
    :header="$t('releases.title')"
    @update:visible="onVisible"
  >
    <ol class="release-list">
      <li v-for="r in releases.listed" :key="r.version" class="release">
        <div class="release-head">
          <span class="release-version">{{ r.version }}</span>
          <span class="release-date">{{ formatDateFull(r.date) }}</span>
        </div>
        <ul class="release-notes">
          <li v-for="(note, i) in notesOf(r)" :key="i">
            {{ note.text }}
            <!-- Clicking the picture opens it over the whole screen, zoomable -->
            <Image
              v-if="note.image"
              :src="note.image.src"
              :alt="note.image.alt"
              preview
              class="release-figure"
              image-class="release-shot"
              :pt="{ image: { loading: 'lazy' } }"
            />
          </li>
        </ul>
      </li>
    </ol>
    <template #footer>
      <Button :label="$t('releases.done')" @click="releases.close()" />
    </template>
  </Dialog>
</template>

<style scoped>
.release-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.release + .release {
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}
.release-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin-bottom: 0.45rem;
}
.release-version {
  font-weight: 800;
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
}
.release-date {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.release-notes {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
/* A picture sits under its sentence, no wider than the dialog, framed like a
   card. The frame is PrimeVue's, since it carries the click that opens the
   picture over the whole screen; the picture inside it is reached with :deep,
   because a scoped rule stops at a child component's root. */
.release-figure {
  display: block;
  margin-top: 0.5rem;
  max-width: 100%;
}
.release-figure :deep(.release-shot) {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
</style>
