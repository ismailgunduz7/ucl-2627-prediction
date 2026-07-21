import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_CLUBS_PER_WEEK,
  LINEUP_LOCK_OFFSET_SECONDS,
  POT_COUNT,
  SQUAD_SIZE,
  assertDomainInvariants,
  lockInstantFor,
} from './constants.ts';

test('domain invariants hold (§3.9)', () => {
  assert.doesNotThrow(() => assertDomainInvariants());
});

test('active clubs per week is squad size minus one', () => {
  assert.equal(ACTIVE_CLUBS_PER_WEEK, SQUAD_SIZE - 1);
});

test('squad size equals pot count', () => {
  assert.equal(SQUAD_SIZE, POT_COUNT);
});

test('lock instant is 5 minutes before first kickoff', () => {
  const t0 = new Date('2026-09-15T19:00:00.000Z');
  const lock = lockInstantFor(t0);
  assert.equal(lock.toISOString(), '2026-09-15T18:55:00.000Z');
  assert.equal((t0.getTime() - lock.getTime()) / 1000, LINEUP_LOCK_OFFSET_SECONDS);
  assert.ok(lock.getTime() < t0.getTime(), 'lock must be strictly before T0');
});
