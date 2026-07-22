import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMatchweekScore,
  defaultLineup,
  validateLineup,
  type SquadClub,
} from './lineup.ts';

const squad: SquadClub[] = [
  { teamId: 'p1', tierId: 1 },
  { teamId: 'p2', tierId: 2 },
  { teamId: 'p3', tierId: 3 },
  { teamId: 'p4', tierId: 4 },
];

test('validateLineup: valid bench + captain', () => {
  assert.equal(validateLineup(squad, 'p4', 'p1').ok, true);
});

test('validateLineup: captain on bench rejected without bench boost (§3.5)', () => {
  const res = validateLineup(squad, 'p4', 'p4');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'captain_on_bench');
});

test('validateLineup: captain on bench allowed under bench boost', () => {
  assert.equal(validateLineup(squad, 'p4', 'p4', true).ok, true);
});

test('validateLineup: bench must be in squad', () => {
  const res = validateLineup(squad, 'zz', 'p1');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'bench_not_in_squad');
});

test('defaultLineup: keeps previous when still valid', () => {
  const d = defaultLineup(squad, { benchTeamId: 'p3', captainTeamId: 'p2' });
  assert.deepEqual(d, { benchTeamId: 'p3', captainTeamId: 'p2' });
});

test('defaultLineup: fallback benches weakest pot, captains strongest (§3.5)', () => {
  const d = defaultLineup(squad, null);
  assert.equal(d.benchTeamId, 'p4'); // Pot 4 benched
  assert.equal(d.captainTeamId, 'p1'); // Pot 1 captain
});

test('defaultLineup: falls back when previous captain is now the bench', () => {
  const d = defaultLineup(squad, { benchTeamId: 'p1', captainTeamId: 'p1' });
  assert.equal(d.benchTeamId, 'p4');
  assert.equal(d.captainTeamId, 'p1');
});

const points = new Map([
  ['p1', 5],
  ['p2', 3],
  ['p3', 2],
  ['p4', 10],
]);

test('computeMatchweekScore: three score, captain ×2, bench ignored', () => {
  // bench p4 (10 ignored), captain p1 (5×2). Total = 10 + 3 + 2 = 15.
  const res = computeMatchweekScore({ squad, benchTeamId: 'p4', captainTeamId: 'p1', teamPoints: points });
  assert.equal(res.total, 15);
});

test('computeMatchweekScore: captain on negative points multiplies negative (§11.3)', () => {
  const neg = new Map([['p1', -4], ['p2', 1], ['p3', 1], ['p4', 0]]);
  // bench p4, captain p1 (-4×2). Total = -8 + 1 + 1 = -6.
  const res = computeMatchweekScore({ squad, benchTeamId: 'p4', captainTeamId: 'p1', teamPoints: neg });
  assert.equal(res.total, -6);
});

test('computeMatchweekScore: bench boost + triple → all four, captain ×3 (§11.5)', () => {
  // all four score; captain p4 ×3 (10×3=30). Total = 5 + 3 + 2 + 30 = 40.
  const res = computeMatchweekScore({
    squad,
    benchTeamId: 'p1',
    captainTeamId: 'p4',
    teamPoints: points,
    benchBoost: true,
    captainMultiplier: 3,
  });
  assert.equal(res.total, 40);
});

test('computeMatchweekScore: club with no points this week contributes 0 (bye)', () => {
  const partial = new Map([['p1', 4]]); // others absent
  const res = computeMatchweekScore({ squad, benchTeamId: 'p4', captainTeamId: 'p1', teamPoints: partial });
  // captain p1 4×2=8, p2 0, p3 0, bench p4 ignored → 8
  assert.equal(res.total, 8);
});
