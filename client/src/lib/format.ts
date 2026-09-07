import { activeLocale, i18n } from '@/i18n';

/**
 * Dates and times in the language on screen.
 *
 * `Intl` does the work; all this adds is that nothing has to remember to pass
 * the locale, and that a missing date always reads as a dash rather than
 * "Invalid Date".
 */

const EMPTY = '-';

export function formatDate(iso: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return new Intl.DateTimeFormat(activeLocale(), options).format(date);
}

/** "Salı, 14 Nisan" / "Tuesday, 14 April". */
export function formatDayLong(iso: string | null | undefined): string {
  return formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "21:00". */
export function formatTime(iso: string | null | undefined): string {
  return formatDate(iso, { hour: '2-digit', minute: '2-digit' });
}

/** "14 Nis 21:00". */
export function formatShortDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Full date and time, the way the reader's locale writes it. */
export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { dateStyle: 'short', timeStyle: 'medium' });
}

/** "14.04.2026" / "14/04/2026". */
export function formatDateOnly(iso: string | null | undefined): string {
  return formatDate(iso, { dateStyle: 'short' });
}

/** Lower-cased the way the language does it, not the way ASCII does. */
export function lower(text: string): string {
  return text.toLocaleLowerCase(activeLocale());
}

/** English needs st/nd/rd/th; Turkish just puts a dot after the number. */
const EN_ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

/** "3." in Turkish, "3rd" in English. */
export function ordinal(n: number): string {
  const locale = activeLocale();
  if (locale === 'tr') return `${n}.`;
  const rule = new Intl.PluralRules(locale, { type: 'ordinal' }).select(n);
  return `${n}${EN_ORDINAL_SUFFIX[rule] ?? 'th'}`;
}

/**
 * A club's association, written out.
 *
 * `teams.country` holds UEFA's three-letter labels because the no-compatriot
 * draw rule compares them, but "GER" is not a word in either language.
 * `Intl.DisplayNames` cannot do this: ENG, and the other home nations, are
 * associations rather than ISO countries. A code nobody has named yet falls
 * back to itself, which is wrong on screen but never blank.
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return EMPTY;
  const key = `country.${code}`;
  return i18n.global.te(key) ? i18n.global.t(key) : code;
}
