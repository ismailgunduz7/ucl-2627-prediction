import { createI18n } from 'vue-i18n';
import tr from './tr';
import en from './en';

export const LOCALES = ['tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'tr';

/** Each language named in itself, which is how a language picker reads best. */
export const LOCALE_NAMES: Record<Locale, string> = { tr: 'Türkçe', en: 'English' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** What the browser is set to, for a visitor who has never chosen. */
export function browserLocale(): Locale {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = tag?.split('-')[0]?.toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { tr, en },
});

/** The language on screen right now. Read by anything outside a component. */
export function activeLocale(): Locale {
  return i18n.global.locale.value as Locale;
}

export function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  document.title = i18n.global.t('common.documentTitle');
}

/** Translate outside a component, where `useI18n()` cannot reach. */
export function translate(key: string, params?: Record<string, unknown>): string {
  return params ? i18n.global.t(key, params) : i18n.global.t(key);
}
