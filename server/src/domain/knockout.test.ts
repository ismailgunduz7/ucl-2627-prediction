import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFor, pairSeeds, resolveTie } from './knockout.ts';

const legs = [
  { homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 1 },
  { homeTeamId: 'b', awayTeamId: 'a', homeScore: 1, awayScore: 0 },
];

test('aggregate sums both legs from a club perspective', () => {
  assert.deepEqual(aggregateFor(legs, 'a'), { scored: 2, conceded: 2 });
  assert.deepEqual(aggregateFor(legs, 'b'), { scored: 2, conceded: 2 });
});

test('higher aggregate advances', () => {
  const decided = [
    { homeTeamId: 'a', awayTeamId: 'b', homeScore: 3, awayScore: 1 },
    { homeTeamId: 'b', awayTeamId: 'a', homeScore: 1, awayScore: 0 },
  ];
  const r = resolveTie(decided, 'a', 'b', 'tie-1');
  assert.equal(r.winnerTeamId, 'a');
  assert.equal(r.loserTeamId, 'b');
  assert.equal(r.onPenalties, false);
});

test('away goals do not decide a level tie (§2.4)', () => {
  // 2-2 on aggregate; b scored more away but that must not matter.
  const r = resolveTie(legs, 'a', 'b', 'tie-away');
  assert.equal(r.onPenalties, true);
});

test('a shootout is deterministic for the same tie', () => {
  const first = resolveTie(legs, 'a', 'b', 'tie-42');
  const second = resolveTie(legs, 'a', 'b', 'tie-42');
  assert.equal(first.winnerTeamId, second.winnerTeamId);
});

test('seeds pair best against worst', () => {
  assert.deepEqual(pairSeeds([9, 10, 11, 12, 13, 14, 15, 16]), [
    [9, 16],
    [10, 15],
    [11, 14],
    [12, 13],
  ]);
});
