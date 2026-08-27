import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankOf } from './ranking.ts';

test('a clear order ranks 1, 2, 3', () => {
  const totals = [30, 20, 10];
  assert.deepEqual(totals.map((t) => rankOf(t, totals)), [1, 2, 3]);
});

test('level totals share a rank and the next one skips (§4.8)', () => {
  const totals = [30, 20, 20, 10];
  assert.deepEqual(totals.map((t) => rankOf(t, totals)), [1, 2, 2, 4]);
});

test('a tie at the top still leaves both first', () => {
  const totals = [30, 30, 10];
  assert.deepEqual(totals.map((t) => rankOf(t, totals)), [1, 1, 3]);
});

test('negative totals rank the same way', () => {
  const totals = [5, -2, -2, -9];
  assert.deepEqual(totals.map((t) => rankOf(t, totals)), [1, 2, 2, 4]);
});

test('a single participant is first', () => {
  assert.equal(rankOf(0, [0]), 1);
});
