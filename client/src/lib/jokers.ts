import { Zap, Shield, Repeat, Users } from '@lucide/vue';
import { translate } from '@/i18n';

export const JOKER_CODES = ['triple_boost', 'clean_sheet_shield', 'weekly_swap', 'bench_boost'] as const;

/*
 * The armchair belongs to the bench itself: it is the button that sends a club
 * there, and the frame it lands in. Bench boost used to borrow it too, so the
 * same mark meant both "put this club on the bench" and "the bench counts this
 * week", which are close enough to be confused and opposite enough to matter.
 * Bench boost is the week all four clubs play, so it is drawn as four of them.
 */
export const JOKER_ICONS: Record<string, unknown> = {
  triple_boost: Zap,
  clean_sheet_shield: Shield,
  weekly_swap: Repeat,
  bench_boost: Users,
};

/**
 * What a joker is called on screen. Outside a component, so it reads the
 * catalogue directly; a code we do not know prints itself rather than nothing.
 */
export function jokerName(code: string | null | undefined): string {
  if (!code) return '';
  const key = `joker.${code}`;
  const name = translate(key);
  return name === key ? code : name;
}
