import type { Locale } from './index';

/**
 * The words PrimeVue puts on its own furniture.
 *
 * Its components carry a few strings of their own (an empty table, the buttons
 * on a confirm dialog) that never pass through our catalogue, so they get their
 * own small one and are swapped whenever the language changes.
 */
const PRIMEVUE_MESSAGES: Record<Locale, Record<string, string>> = {
  tr: {
    accept: 'Tamam',
    reject: 'İptal',
    choose: 'Seç',
    upload: 'Yükle',
    cancel: 'Vazgeç',
    clear: 'Temizle',
    apply: 'Uygula',
    emptyMessage: 'Kayıt yok',
    emptyFilterMessage: 'Sonuç yok',
    emptySelectionMessage: 'Seçili kayıt yok',
    emptySearchMessage: 'Sonuç yok',
    searchMessage: 'Aramak için yaz',
    noFilter: 'Filtre yok',
  },
  en: {
    accept: 'OK',
    reject: 'Cancel',
    choose: 'Choose',
    upload: 'Upload',
    cancel: 'Cancel',
    clear: 'Clear',
    apply: 'Apply',
    emptyMessage: 'Nothing here',
    emptyFilterMessage: 'No matches',
    emptySelectionMessage: 'Nothing selected',
    emptySearchMessage: 'No matches',
    searchMessage: 'Type to search',
    noFilter: 'No filter',
  },
};

export function primeVueLocale(locale: Locale): Record<string, string> {
  return PRIMEVUE_MESSAGES[locale];
}
