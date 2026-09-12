import { newestVersion } from '@domain/releases.ts';
import type { Locale } from '@/i18n';

import calculatorView from '@/assets/releases/v1.2.0/calculatorView.png';

/**
 * What changed, release by release, newest first (§18.12).
 *
 * This is the version of the game: the newest entry here, and nothing else is
 * bumped. A player who signs in after a release with `announce` on is shown
 * the entries they have not seen, once per account; a release of nothing but
 * fixes is listed when they open the dialog themselves and never interrupts.
 *
 * The notes are interface copy. They speak to the player, in both languages,
 * each written rather than translated, and say what changed for them, never
 * what changed in the code.
 *
 * A note is a sentence, or a sentence with a picture under it. The picture is
 * a file under `client/src/assets/releases/<version>/`, imported at the top of
 * this file so that a missing one fails the build rather than the page, with
 * an alt text in the note's own language:
 *
 *   { text: 'Ana sayfa yenilendi.', image: { src: homeShot, alt: 'Ana sayfadaki yeni kartlar' } }
 *
 * The dialog is 460 pixels wide, so a screenshot cropped to the part that
 * changed reads better than a whole screen.
 */
export interface NoteImage {
  /** An imported asset, never a path typed by hand. */
  src: string;
  /** What the picture shows, for a reader who cannot see it. */
  alt: string;
}

/** One line of what changed, with or without a picture under it. */
export type Note = string | { text: string; image?: NoteImage };

export interface Release {
  /** `major.minor.patch`, with or without the `v` a git tag would carry. */
  version: string;
  /** The day it shipped, as a calendar day. */
  date: string;
  /** Worth opening the dialog for on its own. */
  announce: boolean;
  notes: Record<Locale, Note[]>;
}

export const RELEASES: Release[] = [
  {
    version: 'v1.2.0',
    date: '2026-09-12',
    announce: true,
    notes: {
      tr: [
        {
          text: 'Bu pencere yeni. Her önemli güncellemede neyin değiştiğini burada görürsün. Hesap menüsündeki Yenilikler ile istediğin zaman açabilirsin.'
        },
        {
          text: 'Fikstür sayfasında hesaplama görünümü var. Skorları değiştirip bir kulübün kaç puan alacağını, kaptanlık ve kalkanla birlikte, yazdıkça görüyorsun.',
          image: {
            src: calculatorView,
            alt: 'Fikstür sayfasındaki hesaplama görünümü',
          },
        },
        {
          text: 'Ana sayfa yenilendi. Bu haftanın gidişatı, sıradaki haftanın maçları, kuponun durumu ve geçen haftanın dökümü artık ilk ekranda.'
        },
        {
          text: 'Hafta sayfasında her kulübün maçı, rakibinin potu ve maçın zorluğu kulübün kendi kartında. Yedek ve jokerler sahanın hemen altında.'
        },
        {
          text: 'Kurallar sayfası maç zorluğunun nasıl hesaplandığını anlatıyor.'
        },
      ],
      en: [
        {
          text: 'This window is new. Every important update says what changed here. Open it any time from the account menu, under What\'s new.'
        },
        {
          text: 'The fixtures page has a calculator view. Change the scores and see what a club would earn, captaincy and shield included, as you type.',
          image: {
            src: calculatorView,
            alt: 'The fixtures page has a calculator view',
          },
        },
        {
          text: 'The home page is new. How this week is going, next week\'s matches, the state of your coupon and last week\'s breakdown are on the first screen.'
        },
        {
          text: 'On the week page every club\'s match, its opponent\'s pot and how hard the match looks sit on the club\'s own card. The bench and the jokers are right under the pitch.'
        },
        {
          text: 'The rules page explains how a match\'s difficulty is worked out.'
        },
      ],
    },
  },
];

/** The version of the game: the newest release listed, whatever order the list is in. */
export const CURRENT_VERSION: string | null = newestVersion(RELEASES);
