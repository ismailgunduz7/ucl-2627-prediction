import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOutcome, normalizeTally, outcomeOf, tallyPredictions, type Outcome } from './prediction.ts';

test('a score reads as an outcome from the home side', () => {
  assert.equal(outcomeOf(2, 1), 'home');
  assert.equal(outcomeOf(1, 1), 'draw');
  assert.equal(outcomeOf(0, 3), 'away');
});

test('a match without a score has no outcome yet', () => {
  assert.equal(outcomeOf(null, null), null);
  assert.equal(outcomeOf(2, null), null);
  assert.equal(outcomeOf(null, 0), null);
});

test('only picks that already have a result are counted', () => {
  const picks = new Map<string, Outcome>([
    ['m1', 'home'],
    ['m2', 'draw'],
    ['m3', 'away'],
  ]);
  const results = new Map<string, Outcome | null>([
    ['m1', 'home'], // right
    ['m2', 'away'], // wrong
    ['m3', null], // not played yet
  ]);
  assert.deepEqual(tallyPredictions(picks, results, 3), {
    settled: 2,
    correct: 1,
    points: 3,
    provisional: 0,
  });
});

test('a pick on a match that is not in the week scores nothing', () => {
  const picks = new Map<string, Outcome>([['stray', 'home']]);
  assert.deepEqual(tallyPredictions(picks, new Map(), 3), {
    settled: 0,
    correct: 0,
    points: 0,
    provisional: 0,
  });
});

test('every outcome is worth the same', () => {
  for (const outcome of ['home', 'draw', 'away'] as Outcome[]) {
    const tally = tallyPredictions(
      new Map([['m', outcome]]),
      new Map([['m', outcome]]),
      4,
    );
    assert.deepEqual(tally, { settled: 1, correct: 1, points: 4, provisional: 0 });
  }
});

test('only the three outcomes are accepted', () => {
  assert.ok(isOutcome('home') && isOutcome('draw') && isOutcome('away'));
  assert.ok(!isOutcome('MS1'));
  assert.ok(!isOutcome(''));
});

test('a pick on a live match counts, but counts as provisional (§4.3)', () => {
  const picks = new Map<string, Outcome>([
    ['done', 'home'],
    ['playing', 'draw'],
  ]);
  const results = new Map<string, Outcome | null>([
    ['done', 'home'],
    ['playing', 'draw'],
  ]);
  const tally = tallyPredictions(picks, results, 3, new Set(['playing']));
  assert.deepEqual(tally, { settled: 2, correct: 2, points: 6, provisional: 1 });
});

test('a wrong call on a live match is provisional too, since it can still turn', () => {
  const tally = tallyPredictions(
    new Map<string, Outcome>([['m', 'home']]),
    new Map<string, Outcome | null>([['m', 'away']]),
    3,
    new Set(['m']),
  );
  assert.deepEqual(tally, { settled: 1, correct: 0, points: 0, provisional: 1 });
});

test('a breakdown written before the provisional count reads back as zero', () => {
  assert.deepEqual(normalizeTally({ settled: 4, correct: 2, points: 6 }), {
    settled: 4,
    correct: 2,
    points: 6,
    provisional: 0,
  });
  assert.deepEqual(normalizeTally(null), { settled: 0, correct: 0, points: 0, provisional: 0 });
});
