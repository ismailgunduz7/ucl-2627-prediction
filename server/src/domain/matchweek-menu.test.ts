import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMatchweekMenu,
  matchweekMenuEntry,
  type MatchweekMenuInput,
} from './matchweek-menu.ts';

const SEASON: MatchweekMenuInput[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `mw-${i + 1}`,
    act: 'league_phase',
    sortOrder: i + 1,
    label: `Hafta ${i + 1}`,
  })),
  { id: 'playoff-leg1', act: 'knockout', sortOrder: 1, label: 'Play-off 1. maç' },
  { id: 'playoff-leg2', act: 'knockout', sortOrder: 2, label: 'Play-off 2. maç' },
  { id: 'r16-leg1', act: 'knockout', sortOrder: 3, label: 'Son 16 1. maç' },
  { id: 'r16-leg2', act: 'knockout', sortOrder: 4, label: 'Son 16 2. maç' },
  { id: 'qf-leg1', act: 'knockout', sortOrder: 5, label: 'Çeyrek final 1. maç' },
  { id: 'qf-leg2', act: 'knockout', sortOrder: 6, label: 'Çeyrek final 2. maç' },
  { id: 'sf-leg1', act: 'knockout', sortOrder: 7, label: 'Yarı final 1. maç' },
  { id: 'sf-leg2', act: 'knockout', sortOrder: 8, label: 'Yarı final 2. maç' },
  { id: 'final', act: 'knockout', sortOrder: 9, label: 'Final' },
];

function menu(list: MatchweekMenuInput[] = SEASON) {
  return list
    .map((mw) => ({ id: mw.id, ...matchweekMenuEntry(mw) }))
    .sort(compareMatchweekMenu);
}

test('the season reads backwards: final first, league phase last', () => {
  const groups: string[] = [];
  for (const entry of menu()) {
    if (groups[groups.length - 1] !== entry.group) groups.push(entry.group);
  }
  assert.deepEqual(groups, ['Final', 'Yarı final', 'Çeyrek final', 'Son 16', 'Play-off', 'Lig aşaması']);
});

test('a two-legged round is one group with the first leg above the return', () => {
  const r16 = menu().filter((e) => e.group === 'Son 16');
  assert.deepEqual(r16.map((e) => e.option), ['İlk maçlar', 'Rövanş maçları']);
  assert.deepEqual(r16.map((e) => e.id), ['r16-leg1', 'r16-leg2']);
});

test('a one-legged round names itself instead of calling itself a first leg', () => {
  const final = menu().filter((e) => e.group === 'Final');
  assert.deepEqual(final.map((e) => e.option), ['Final']);
});

test('league weeks run from the latest down to the first', () => {
  const league = menu().filter((e) => e.group === 'Lig aşaması');
  assert.deepEqual(
    league.map((e) => e.option),
    ['Hafta 8', 'Hafta 7', 'Hafta 6', 'Hafta 5', 'Hafta 4', 'Hafta 3', 'Hafta 2', 'Hafta 1'],
  );
});

test('no leg ever says "1. maç" in the menu', () => {
  assert.ok(menu().every((e) => !e.option.includes('. maç')));
});

test('an unrecognised id keeps its own label rather than disappearing', () => {
  const entry = matchweekMenuEntry({ id: 'super-cup', act: 'knockout', sortOrder: 12, label: 'Süper Kupa' });
  assert.equal(entry.group, 'Süper Kupa');
  assert.equal(entry.option, 'Süper Kupa');
  const sorted = menu([...SEASON, { id: 'super-cup', act: 'knockout', sortOrder: 12, label: 'Süper Kupa' }]);
  assert.equal(sorted[sorted.length - 1]!.id, 'super-cup');
});
