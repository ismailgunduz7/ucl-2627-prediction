import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, outcomeForRank } from './standings.ts';

const teams = [
  { teamId: 'a', name: 'A Kulüp' },
  { teamId: 'b', name: 'B Kulüp' },
  { teamId: 'c', name: 'C Kulüp' },
];

test('three points for a win, one for a draw', () => {
  const table = computeStandings(teams, [
    { homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 0 }, // a win
    { homeTeamId: 'b', awayTeamId: 'c', homeScore: 1, awayScore: 1 }, // draw
  ]);
  const byId = Object.fromEntries(table.map((r) => [r.teamId, r]));
  assert.equal(byId.a!.points, 3);
  assert.equal(byId.b!.points, 1);
  assert.equal(byId.c!.points, 1);
  assert.equal(byId.a!.won, 1);
  assert.equal(byId.b!.lost, 1);
});

test('goal difference breaks a tie on points', () => {
  const table = computeStandings(teams, [
    { homeTeamId: 'a', awayTeamId: 'c', homeScore: 1, awayScore: 0 }, // a +1
    { homeTeamId: 'b', awayTeamId: 'c', homeScore: 4, awayScore: 0 }, // b +4
  ]);
  assert.equal(table[0]!.teamId, 'b');
  assert.equal(table[1]!.teamId, 'a');
});

test('goals scored breaks a tie on points and goal difference', () => {
  const table = computeStandings(teams, [
    { homeTeamId: 'a', awayTeamId: 'c', homeScore: 1, awayScore: 0 },
    { homeTeamId: 'b', awayTeamId: 'c', homeScore: 3, awayScore: 2 },
  ]);
  // Both +1; b scored more.
  assert.equal(table[0]!.teamId, 'b');
});

test('clubs without a match still appear, with everything at zero', () => {
  const table = computeStandings(teams, [
    { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0 },
  ]);
  assert.equal(table.length, 3);
  const c = table.find((r) => r.teamId === 'c')!;
  assert.equal(c.played, 0);
  assert.equal(c.points, 0);
  assert.equal(c.goalDifference, 0);
  // A goalless club still outranks one that lost: same points, better difference.
  assert.ok(c.rank < table.find((r) => r.teamId === 'b')!.rank);
});

test('ranks map to the right knockout outcome (§2.4)', () => {
  assert.equal(outcomeForRank(1), 'top8');
  assert.equal(outcomeForRank(8), 'top8');
  assert.equal(outcomeForRank(9), 'playoff');
  assert.equal(outcomeForRank(24), 'playoff');
  assert.equal(outcomeForRank(25), 'eliminated');
  assert.equal(outcomeForRank(36), 'eliminated');
});
