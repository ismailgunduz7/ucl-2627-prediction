import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, outcomeForRank, top8BonusRecipients } from './standings.ts';

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

test('the top-8 bonus goes to the eight who finish top, and to nobody else (§11.22)', () => {
  const table = Array.from({ length: 36 }, (_, i) => ({ rank: i + 1, teamId: `t${i + 1}` }));
  const paid = top8BonusRecipients(table);
  assert.deepEqual(paid, ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
  // The play-off field and the clubs that go out are all outside it.
  assert.ok(!paid.includes('t9'));
  assert.ok(!paid.includes('t24'));
  assert.ok(!paid.includes('t25'));
  assert.ok(!paid.includes('t36'));
});

test('the bonus follows the finishing position, not the row order', () => {
  // A table handed over out of order, as a query without an ORDER BY would.
  const shuffled = [
    { rank: 30, teamId: 'gone' },
    { rank: 3, teamId: 'third' },
    { rank: 12, teamId: 'playoff' },
    { rank: 1, teamId: 'winner' },
  ];
  assert.deepEqual(top8BonusRecipients(shuffled), ['third', 'winner']);
});

test('a season with fewer than eight clubs pays only the ones that exist', () => {
  const small = [
    { rank: 1, teamId: 'a' },
    { rank: 2, teamId: 'b' },
  ];
  assert.deepEqual(top8BonusRecipients(small), ['a', 'b']);
  assert.deepEqual(top8BonusRecipients([]), []);
});
