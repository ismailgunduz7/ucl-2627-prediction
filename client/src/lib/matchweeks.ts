/**
 * Week pickers all read the same way: the final at the top, the league phase at
 * the bottom, and a two-legged round as one heading with "İlk maçlar" above
 * "Rövanş maçları". The grouping itself is decided by the server (§10.1); this
 * only turns it into the shape PrimeVue's Select wants.
 */

export interface MatchweekMenu {
  roundKey: string;
  group: string;
  option: string;
  groupOrder: number;
  optionOrder: number;
}

export interface MatchweekLike {
  id: string;
  label: string;
  menu?: MatchweekMenu;
}

export interface MatchweekGroup {
  label: string;
  items: { label: string; value: string }[];
}

/** Falls back to the flat label for a week the server did not file. */
function menuOf(mw: MatchweekLike, index: number): MatchweekMenu {
  return (
    mw.menu ?? { roundKey: mw.id, group: mw.label, option: mw.label, groupOrder: 99, optionOrder: index }
  );
}

export interface RoundOption {
  /** Round key the fixtures endpoint is addressed by. */
  value: string;
  label: string;
}

/** The round a matchweek belongs to, for defaulting a picker. */
export function roundKeyOf(matchweeks: MatchweekLike[], matchweekId: string | null): string | null {
  const index = matchweeks.findIndex((m) => m.id === matchweekId);
  return index === -1 ? null : menuOf(matchweeks[index]!, index).roundKey;
}

export function groupMatchweeks(matchweeks: MatchweekLike[]): MatchweekGroup[] {
  const entries = matchweeks
    .map((mw, i) => ({ mw, menu: menuOf(mw, i) }))
    .sort((a, b) => a.menu.groupOrder - b.menu.groupOrder || a.menu.optionOrder - b.menu.optionOrder);

  const groups: MatchweekGroup[] = [];
  for (const { mw, menu } of entries) {
    let group = groups[groups.length - 1];
    if (!group || group.label !== menu.group) {
      group = { label: menu.group, items: [] };
      groups.push(group);
    }
    group.items.push({ label: menu.option, value: mw.id });
  }
  return groups;
}

/** What the trigger should read for the selected week, headings included. */
export function matchweekTitle(matchweeks: MatchweekLike[], id: string | null): string {
  const mw = matchweeks.find((m) => m.id === id);
  if (!mw) return '';
  const menu = mw.menu;
  if (!menu || menu.option === menu.group) return menu?.option ?? mw.label;
  return `${menu.group} · ${menu.option}`;
}
