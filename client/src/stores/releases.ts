import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { isNewer, shouldAnnounce, unseenReleases } from '@domain/releases.ts';
import { CURRENT_VERSION, RELEASES, type Release } from '@/releases';
import { useAuthStore } from '@/stores/auth';

/**
 * The Yenilikler dialog: whether it is open and what it lists (§18.12).
 *
 * It opens by itself when the account on screen has not seen a release worth
 * announcing, and lists only what they have not seen. Opened from the account
 * menu it lists everything. Closing it either way marks the account up to the
 * newest release, on the server, so no other device asks again.
 */
export const useReleaseStore = defineStore('releases', () => {
  const auth = useAuthStore();
  const open = ref(false);
  const listed = ref<Release[]>([]);

  const lastSeen = computed(() => auth.user?.lastSeenRelease ?? null);
  /** Something new since this account last looked, and worth interrupting for. */
  const pending = computed(() => auth.isAuthenticated && shouldAnnounce(RELEASES, lastSeen.value));

  /** The whole catalogue, at the player's request. */
  function show() {
    listed.value = RELEASES;
    open.value = true;
  }

  /** Only what is new, because the game decided it was worth a word. */
  function announce() {
    listed.value = unseenReleases(RELEASES, lastSeen.value);
    open.value = true;
  }

  /** Closing counts as reading, however the dialog was opened. */
  async function close() {
    open.value = false;
    if (CURRENT_VERSION && isNewer(CURRENT_VERSION, lastSeen.value)) {
      await auth.markReleaseSeen(CURRENT_VERSION);
    }
  }

  return { open, listed, pending, show, announce, close };
});
