import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWeeklySwap, computeShieldDelta, remapRole } from './joker.ts';
import type { SquadClub } from './lineup.ts';

const squad: SquadClub[] = [
  { teamId: 'p1', tierId: 1 },
  { teamId: 'p2', tierId: 2 },
  { teamId: 'p3', tierId: 3 },
  { teamId: 'p4', tierId: 4 },
];

test('applyWeeklySwap replaces the club, keeping the pot', () => {
  const out = applyWeeklySwap(squad, { fromTeamId: 'p2', toTeamId: 'x2', toTierId: 2 });
  assert.deepEqual(
    out.map((c) => c.teamId),
    ['p1', 'x2', 'p3', 'p4'],
  );
  assert.equal(out.find((c) => c.teamId === 'x2')!.tierId, 2);
});

test('remapRole moves a role from the swapped-out club to the incoming one', () => {
  const swap = { fromTeamId: 'p2', toTeamId: 'x2', toTierId: 2 };
  assert.equal(remapRole('p2', swap), 'x2'); // captain/bench inherited
  assert.equal(remapRole('p1', swap), 'p1'); // unrelated unchanged
  assert.equal(remapRole('p2', null), 'p2');
});

test('shield: GA=0 → no delta (normal CS already scored)', () => {
  assert.equal(computeShieldDelta([0], 2, -1), 0);
});

test('shield: GA=1 → add CS and suppress the one conceded (§3.6)', () => {
  // Pot 1: cs=2, concededPerGoal=-1 → delta = 2 - (-1) = 3.
  assert.equal(computeShieldDelta([1], 2, -1), 3);
});

test('shield: GA≥2 → breaks, no delta', () => {
  assert.equal(computeShieldDelta([2], 2, -1), 0);
  assert.equal(computeShieldDelta([3], 3, -1), 0);
});

test('shield: two matches in a week apply per match', () => {
  // one GA=1 (delta 3), one GA=0 (delta 0) → 3.
  assert.equal(computeShieldDelta([1, 0], 2, -1), 3);
});
