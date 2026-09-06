import { Zap, Shield, Repeat, Armchair } from '@lucide/vue';
import { translate } from '@/i18n';

export const JOKER_CODES = ['triple_boost', 'clean_sheet_shield', 'weekly_swap', 'bench_boost'] as const;

export const JOKER_ICONS: Record<string, unknown> = {
  triple_boost: Zap,
  clean_sheet_shield: Shield,
  weekly_swap: Repeat,
  bench_boost: Armchair,
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
