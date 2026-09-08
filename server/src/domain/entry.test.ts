import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekCountsForEntry } from './entry.ts';

const order = ['mw-1', 'mw-2', 'mw-3', 'playoff-leg1', 'final'];

test('every week counts for a participant who was there from the start', () => {
  for (const id of order) assert.equal(weekCountsForEntry(order, null, id), true);
});

test('the weeks before the entry week never score', () => {
  assert.equal(weekCountsForEntry(order, 'mw-2', 'mw-1'), false);
  assert.equal(weekCountsForEntry(order, 'playoff-leg1', 'mw-3'), false);
});

test('the entry week itself counts, and so does everything after it', () => {
  assert.equal(weekCountsForEntry(order, 'mw-2', 'mw-2'), true);
  assert.equal(weekCountsForEntry(order, 'mw-2', 'mw-3'), true);
  assert.equal(weekCountsForEntry(order, 'mw-2', 'final'), true);
  assert.equal(weekCountsForEntry(order, 'playoff-leg1', 'final'), true);
});

test('an entry week that is not in the season counts for nothing', () => {
  assert.equal(weekCountsForEntry(order, 'mw-9', 'mw-1'), false);
  assert.equal(weekCountsForEntry(order, 'mw-9', 'final'), false);
});
