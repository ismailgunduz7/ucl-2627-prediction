/**
 * How matchweeks are offered in a week picker.
 *
 * A season reads backwards in a menu: the final first, the league phase last,
 * because the week someone wants is nearly always the most recent one. Two-
 * legged rounds are one group with two entries rather than two flat options
 * called "1. maç" and "2. maç", and inside a round the first legs come before
 * the return legs, the order they are played.
 *
 * Matchweek ids are code-owned (`mw-<n>` for league weeks, `<stage>` or
 * `<stage>-leg<n>` for knockout), so the grouping is derived from them. An id
 * we do not recognise falls back to its stored label as its own group, which
 * keeps an unexpected row visible instead of hiding it.
 */

import { translate } from '../lib/i18n.ts';
import { matchweekLabel } from '../lib/labels.ts';

export interface MatchweekMenuEntry {
  /** The round this week belongs to: both legs of a tie share one key. */
  roundKey: string;
  /** Heading the week sits under. */
  group: string;
  /** What the week is called inside that heading. */
  option: string;
  /** Ascending: 0 is the top of the menu. */
  groupOrder: number;
  /** Ascending within the group. */
  optionOrder: number;
}

interface KnockoutRound {
  /** Catalogue key for the round's name. */
  key: string;
  /** Menu order, newest round first. */
  order: number;
}

const KNOCKOUT_ROUNDS: Record<string, KnockoutRound> = {
  final: { key: 'round.final', order: 0 },
  sf: { key: 'round.sf', order: 1 },
  qf: { key: 'round.qf', order: 2 },
  r16: { key: 'round.r16', order: 3 },
  playoff: { key: 'round.playoff', order: 4 },
};

/** The league phase sits under every knockout round. */
const LEAGUE_GROUP_ORDER = 5;
const UNKNOWN_GROUP_ORDER = 6;

const LEG_KEYS: Record<number, string> = { 1: 'leg.first', 2: 'leg.second' };

function legLabel(leg: number): string {
  const key = LEG_KEYS[leg];
  return key ? translate(key) : translate('leg.nth', { number: leg });
}

export interface MatchweekMenuInput {
  id: string;
  act: string;
  sortOrder: number;
  label: string;
}

export function matchweekMenuEntry(mw: MatchweekMenuInput): MatchweekMenuEntry {
  if (mw.act === 'league_phase') {
    return {
      roundKey: mw.id,
      group: translate('matchweek.league_group'),
      option: matchweekLabel(mw),
      groupOrder: LEAGUE_GROUP_ORDER,
      // Newest week at the top of its group, like the rounds above it.
      optionOrder: -mw.sortOrder,
    };
  }

  const match = /^([a-z0-9]+)(?:-leg(\d+))?$/.exec(mw.id);
  const round = match ? KNOCKOUT_ROUNDS[match[1]!] : undefined;
  if (!round) {
    return {
      roundKey: mw.id,
      group: mw.label,
      option: mw.label,
      groupOrder: UNKNOWN_GROUP_ORDER,
      optionOrder: mw.sortOrder,
    };
  }

  const leg = match?.[2] ? Number(match[2]) : 0;
  const roundLabel = translate(round.key);
  return {
    roundKey: match![1]!,
    group: roundLabel,
    // A one-legged round names itself rather than saying "first legs".
    option: leg === 0 ? roundLabel : legLabel(leg),
    groupOrder: round.order,
    optionOrder: leg,
  };
}

/**
 * What a leg is called inside its round's page. A one-legged round has nothing
 * to distinguish, so it gets no heading at all.
 */
export function legHeading(mw: MatchweekMenuInput): string | null {
  const entry = matchweekMenuEntry(mw);
  if (entry.option === entry.group) return null;
  // League weeks sort by a negative order and are not legs of anything.
  return entry.optionOrder > 0 ? legLabel(entry.optionOrder) : null;
}

export interface RoundOption {
  key: string;
  label: string;
}

/**
 * One entry per round for a picker that opens a whole round at a time.
 *
 * A round of several matchweeks is named once: "Son 16" covers both its legs.
 * A round of one names itself, so league weeks stay "Hafta 8", "Hafta 7", and
 * the final stays "Final". The number of weeks in the round is what decides
 * this; the labels alone cannot, since a league week's own name differs from
 * its heading too.
 */
export function roundOptions(matchweeks: MatchweekMenuInput[]): RoundOption[] {
  const entries = matchweeks
    .map((mw) => ({ mw, menu: matchweekMenuEntry(mw) }))
    .sort((a, b) => compareMatchweekMenu(a.menu, b.menu));

  const counts = new Map<string, number>();
  for (const { menu } of entries) counts.set(menu.roundKey, (counts.get(menu.roundKey) ?? 0) + 1);

  const options: RoundOption[] = [];
  const seen = new Set<string>();
  for (const { menu } of entries) {
    if (seen.has(menu.roundKey)) continue;
    seen.add(menu.roundKey);
    options.push({
      key: menu.roundKey,
      label: (counts.get(menu.roundKey) ?? 1) > 1 ? menu.group : menu.option,
    });
  }
  return options;
}

/** Menu order for a whole list: groups first, then entries inside each group. */
export function compareMatchweekMenu(a: MatchweekMenuEntry, b: MatchweekMenuEntry): number {
  return a.groupOrder - b.groupOrder || a.optionOrder - b.optionOrder;
}
