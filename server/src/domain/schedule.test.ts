import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLeagueDraw, validateLeagueDraw, type DrawTeam } from './schedule.ts';
import { POTS_2627 } from '../data/teams-2627.ts';

// The real 2026-27 field: if the draw works here, it works for the seed.
const TEAMS: DrawTeam[] = ([1, 2, 3, 4] as const).flatMap((pot) =>
  POTS_2627[pot].map((t) => ({ pot, country: t.country })),
);

test('a drawn season satisfies every constraint at once (§2.2-2.3)', () => {
  for (const seed of [1, 2, 3, 42, 2027]) {
    const fixtures = generateLeagueDraw(TEAMS, seed);
    assert.deepEqual(validateLeagueDraw(TEAMS, fixtures), [], `seed ${seed}`);
  }
});

test('the same seed reproduces the same draw', () => {
  assert.deepEqual(generateLeagueDraw(TEAMS, 7), generateLeagueDraw(TEAMS, 7));
});

test('every club plays four at home and four away', () => {
  const fixtures = generateLeagueDraw(TEAMS, 5);
  const home = new Map<number, number>();
  const away = new Map<number, number>();
  for (const f of fixtures) {
    home.set(f.homeIndex, (home.get(f.homeIndex) ?? 0) + 1);
    away.set(f.awayIndex, (away.get(f.awayIndex) ?? 0) + 1);
  }
  for (let t = 0; t < TEAMS.length; t++) {
    assert.equal(home.get(t), 4, `team ${t} home`);
    assert.equal(away.get(t), 4, `team ${t} away`);
  }
});

test('the validator actually catches a broken draw', () => {
  const fixtures = generateLeagueDraw(TEAMS, 9);
  // Swap one match's home side for its own compatriot's slot.
  const tampered = fixtures.map((f, i) => (i === 0 ? { ...f, awayIndex: f.homeIndex } : f));
  assert.notDeepEqual(validateLeagueDraw(TEAMS, tampered), []);
});

test('a malformed field is rejected', () => {
  assert.throws(() => generateLeagueDraw(TEAMS.slice(1)));
  assert.throws(() => generateLeagueDraw([]));
});
