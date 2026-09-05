import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupKnockoutFixtures, type DrawFixture } from './knockout-draw.ts';

function fx(externalId: string, home: string, away: string, day: number, stage = 'r16'): DrawFixture {
  return {
    externalId,
    homeTeamId: home,
    awayTeamId: away,
    kickoffAt: new Date(`2027-02-${String(day).padStart(2, '0')}T20:00:00Z`),
    stage,
  };
}

test('two fixtures between one pair in one round are a single tie', () => {
  const ties = groupKnockoutFixtures([fx('a', 'ars', 'bay', 10), fx('b', 'bay', 'ars', 17)]);
  assert.equal(ties.length, 1);
  assert.equal(ties[0]!.legs.length, 2);
  assert.deepEqual(ties[0]!.legs.map((l) => l.fixture.externalId), ['a', 'b']);
  assert.deepEqual(ties[0]!.legs.map((l) => l.leg), [1, 2]);
});

test('legs are numbered by kickoff, whatever order they arrive in', () => {
  const ties = groupKnockoutFixtures([fx('return', 'bay', 'ars', 17), fx('first', 'ars', 'bay', 10)]);
  assert.deepEqual(ties[0]!.legs.map((l) => l.fixture.externalId), ['first', 'return']);
});

test('the club hosting the deciding leg is the tie home side', () => {
  const ties = groupKnockoutFixtures([fx('a', 'ars', 'bay', 10), fx('b', 'bay', 'ars', 17)]);
  assert.equal(ties[0]!.teamA, 'bay');
  assert.equal(ties[0]!.teamB, 'ars');
});

test('a single fixture is a one-legged tie, which is how the final arrives', () => {
  const ties = groupKnockoutFixtures([fx('f', 'ars', 'rma', 28, 'final')]);
  assert.equal(ties.length, 1);
  assert.equal(ties[0]!.legs.length, 1);
  assert.equal(ties[0]!.teamA, 'ars');
  assert.equal(ties[0]!.stage, 'final');
});

test('the same pair meeting again in a later round is a separate tie', () => {
  const ties = groupKnockoutFixtures([
    fx('r16a', 'ars', 'bay', 10, 'r16'),
    fx('r16b', 'bay', 'ars', 17, 'r16'),
    fx('qfa', 'ars', 'bay', 24, 'qf'),
    fx('qfb', 'bay', 'ars', 28, 'qf'),
  ]);
  assert.equal(ties.length, 2);
  assert.deepEqual(ties.map((t) => t.stage), ['r16', 'qf']);
});

test('ties come back earliest first, so slot numbers stay put', () => {
  const ties = groupKnockoutFixtures([
    fx('late1', 'c', 'd', 12), fx('late2', 'd', 'c', 19),
    fx('early1', 'a', 'b', 10), fx('early2', 'b', 'a', 17),
  ]);
  assert.deepEqual(ties.map((t) => t.legs[0]!.fixture.externalId), ['early1', 'late1']);
});

test('an empty fixture list yields no ties', () => {
  assert.deepEqual(groupKnockoutFixtures([]), []);
});
