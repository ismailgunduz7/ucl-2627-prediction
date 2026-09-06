import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LOCALE, LOCALES, MESSAGES, type Locale } from '../i18n/messages.ts';

export { DEFAULT_LOCALE, LOCALES, type Locale };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The language a request wants.
 *
 * The client sends its active locale as `Accept-Language`, so a signed-out
 * screen is answered in the language on the screen rather than the language on
 * the account. Anything we do not speak falls back to Turkish.
 */
export function resolveLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase();
    if (!tag) continue;
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export type MessageParams = Record<string, string | number>;

/** Renders one message, filling `{name}` placeholders from `params`. */
export function t(locale: Locale, key: string, params?: MessageParams): string {
  const template = MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * The locale of the request in flight.
 *
 * Threading a language argument through every service down to every label
 * would touch code that has no business knowing about languages, so the
 * request parks its locale here and the label helpers read it back. Outside a
 * request (seeds, the sync job, tests) there is nothing parked and the default
 * applies.
 */
const localeStore = new AsyncLocalStorage<Locale>();

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return localeStore.run(locale, fn);
}

export function currentLocale(): Locale {
  return localeStore.getStore() ?? DEFAULT_LOCALE;
}

/** `t()` in the language of the request in flight. */
export function translate(key: string, params?: MessageParams): string {
  return t(currentLocale(), key, params);
}

/** Same, but a key we do not carry falls back to a value we were handed. */
export function translateOr(fallback: string, key: string, params?: MessageParams): string {
  const locale = currentLocale();
  if (MESSAGES[locale][key] === undefined && MESSAGES[DEFAULT_LOCALE][key] === undefined) {
    return fallback;
  }
  return t(locale, key, params);
}
