import { Zap, Shield, Repeat, Armchair } from '@lucide/vue';

export const JOKER_NAMES: Record<string, string> = {
  triple_boost: 'Üçlü kaptan',
  clean_sheet_shield: 'Gol yememe kalkanı',
  weekly_swap: 'Haftalık değişim',
  bench_boost: 'Bench boost',
};

export const JOKER_ICONS: Record<string, unknown> = {
  triple_boost: Zap,
  clean_sheet_shield: Shield,
  weekly_swap: Repeat,
  bench_boost: Armchair,
};

export function jokerName(code: string | null | undefined): string {
  return code ? (JOKER_NAMES[code] ?? code) : '';
}
