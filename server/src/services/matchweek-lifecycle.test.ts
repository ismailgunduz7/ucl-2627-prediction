import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineupEditability, type OrderedMatchweek } from './matchweek-lifecycle-service.ts';

// MW1 kicks off 19:00, MW2 kicks off a week later.
const ordered: OrderedMatchweek[] = [
  { id: 'mw-1', firstKickoffAt: new Date('2026-09-15T19:00:00Z') },
  { id: 'mw-2', firstKickoffAt: new Date('2026-09-22T19:00:00Z') },
];

test('MW1 editable well before its lock', () => {
  const e = lineupEditability(ordered, 'mw-1', new Date('2026-09-15T12:00:00Z'));
  assert.equal(e.editable, true);
  assert.equal(e.locked, false);
});

test('MW1 locks at T0 − 5 minutes', () => {
  const justBefore = lineupEditability(ordered, 'mw-1', new Date('2026-09-15T18:54:00Z'));
  assert.equal(justBefore.locked, false);
  const atLock = lineupEditability(ordered, 'mw-1', new Date('2026-09-15T18:55:00Z'));
  assert.equal(atLock.locked, true);
  assert.equal(atLock.editable, false);
});

test('MW2 not editable until MW1 has kicked off (§3.4)', () => {
  const beforeMw1 = lineupEditability(ordered, 'mw-2', new Date('2026-09-15T12:00:00Z'));
  assert.equal(beforeMw1.opened, false);
  assert.equal(beforeMw1.editable, false);
});

test('MW2 opens for editing once MW1 kicks off', () => {
  const afterMw1Kickoff = lineupEditability(ordered, 'mw-2', new Date('2026-09-15T19:30:00Z'));
  assert.equal(afterMw1Kickoff.opened, true);
  assert.equal(afterMw1Kickoff.editable, true);
});

test('a started matchweek is frozen even before the wall-clock lock (§3.4)', () => {
  // Status says started (provider clock ahead of wall clock, as in the mockup).
  const started = [
    { id: 'mw-1', firstKickoffAt: new Date('2026-09-15T19:00:00Z'), status: 'complete' },
    { id: 'mw-2', firstKickoffAt: new Date('2026-09-22T19:00:00Z'), status: 'open' },
  ];
  const wayEarly = new Date('2026-07-01T00:00:00Z');
  const mw1 = lineupEditability(started, 'mw-1', wayEarly);
  assert.equal(mw1.locked, true);
  assert.equal(mw1.editable, false);
  // MW2 opens because MW1 has started (by status), and is itself still editable.
  const mw2 = lineupEditability(started, 'mw-2', wayEarly);
  assert.equal(mw2.opened, true);
  assert.equal(mw2.editable, true);
});
