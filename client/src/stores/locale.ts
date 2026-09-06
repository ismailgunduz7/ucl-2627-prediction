import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';
import { applyLocale, browserLocale, isLocale, type Locale } from '@/i18n';

const STORAGE_KEY = 'ucl:locale';

/**
 * Which language the game is in.
 *
 * Three sources, in order of authority: the account, this browser's last
 * choice, and the browser's own language setting. The account wins because the
 * choice belongs to the person, not the device: switch to English on a phone
 * and the desktop session follows on its next load.
 */
export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<Locale>(browserLocale());
  /** True once a signed-in account has told us what it reads. */
  const fromAccount = ref(false);

  function remember(next: Locale) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A browser with storage switched off simply forgets between visits.
    }
  }

  function set(next: Locale) {
    locale.value = next;
    applyLocale(next);
  }

  /** Runs before the first paint, so nothing flashes in the wrong language. */
  function bootstrap() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    set(isLocale(stored) ? stored : browserLocale());
  }

  /** The account has spoken, on this device or another one. */
  function adoptAccount(language: unknown) {
    if (!isLocale(language)) return;
    fromAccount.value = true;
    if (language === locale.value) return;
    set(language);
    remember(language);
  }

  /** A deliberate switch: this browser remembers it, and so does the account. */
  async function choose(next: Locale) {
    if (next === locale.value) return;
    set(next);
    remember(next);
    if (fromAccount.value) {
      try {
        await api.put('/api/auth/me/language', { language: next });
      } catch {
        // The screen already switched. The account catches up next time.
      }
    }
  }

  /** Signed out: the choice is this browser's again until someone signs in. */
  function forgetAccount() {
    fromAccount.value = false;
  }

  return { locale, fromAccount, bootstrap, adoptAccount, forgetAccount, choose };
});
