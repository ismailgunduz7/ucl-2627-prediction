/**
 * Default scoring rule types and the per-pot seed values (PLAN.md §4.2, §16).
 *
 * Direction invariant (§16): reward values ascend Pot 1 -> Pot 4 (weaker pot
 * rewarded more); penalty values also ascend (Pot 1 most negative -> toward 0);
 * flat values are equal across pots. All admin-editable afterwards.
 */
export type RuleDirection = 'reward' | 'penalty' | 'flat';
export type RuleCategory = 'match' | 'league' | 'knockout';

export interface RuleTypeSeed {
  code: string;
  category: RuleCategory;
  label: string; // Turkish display label
  direction: RuleDirection;
  sortOrder: number;
  /** Seed values indexed by pot 1..4. */
  pots: [number, number, number, number];
}

export const RULE_TYPE_SEEDS: RuleTypeSeed[] = [
  { code: 'win', category: 'match', label: 'Galibiyet', direction: 'reward', sortOrder: 10, pots: [3, 4, 5, 6] },
  { code: 'draw', category: 'match', label: 'Beraberlik', direction: 'reward', sortOrder: 20, pots: [1, 1, 2, 2] },
  { code: 'loss', category: 'match', label: 'Mağlubiyet', direction: 'penalty', sortOrder: 30, pots: [-2, -1, 0, 0] },
  { code: 'goals_scored', category: 'match', label: 'Atılan gol (adet)', direction: 'flat', sortOrder: 40, pots: [1, 1, 1, 1] },
  { code: 'goals_conceded', category: 'match', label: 'Yenilen gol (adet)', direction: 'penalty', sortOrder: 50, pots: [-1, -1, 0, 0] },
  { code: 'clean_sheet', category: 'match', label: 'Gol yememe', direction: 'reward', sortOrder: 60, pots: [2, 2, 3, 3] },
  { code: 'league_top8_bonus', category: 'league', label: 'Lig ilk 8 bonusu', direction: 'reward', sortOrder: 70, pots: [6, 8, 10, 12] },
  { code: 'round_advance', category: 'knockout', label: 'Tur atlama', direction: 'reward', sortOrder: 80, pots: [3, 4, 5, 6] },
  { code: 'gold_medal', category: 'knockout', label: 'Şampiyonluk', direction: 'reward', sortOrder: 90, pots: [8, 10, 12, 14] },
  { code: 'silver_medal', category: 'knockout', label: 'Finalist (ikinci)', direction: 'reward', sortOrder: 100, pots: [4, 5, 6, 7] },
];
