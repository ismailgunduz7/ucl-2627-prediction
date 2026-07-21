import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockLiveScore,
  mockScoreFor,
  mockStatusFor,
  normalizeFootballDataStatus,
} from './provider-normalize.ts';

test('football-data status normalization', () => {
  assert.equal(normalizeFootballDataStatus('IN_PLAY'), 'live');
  assert.equal(normalizeFootballDataStatus('PAUSED'), 'live');
  assert.equal(normalizeFootballDataStatus('FINISHED'), 'finished');
  assert.equal(normalizeFootballDataStatus('POSTPONED'), 'postponed');
  assert.equal(normalizeFootballDataStatus('CANCELLED'), 'cancelled');
  assert.equal(normalizeFootballDataStatus('SUSPENDED'), 'cancelled');
  assert.equal(normalizeFootballDataStatus('TIMED'), 'scheduled');
  assert.equal(normalizeFootballDataStatus('WEIRD'), 'scheduled');
});

test('mock status derives from simulated clock vs kickoff', () => {
  const kickoff = new Date('2026-09-15T19:00:00Z');
  assert.equal(mockStatusFor(kickoff, new Date('2026-09-15T18:00:00Z')), 'scheduled');
  assert.equal(mockStatusFor(kickoff, new Date('2026-09-15T19:30:00Z')), 'live');
  assert.equal(mockStatusFor(kickoff, new Date('2026-09-15T21:30:00Z')), 'finished');
});

test('mock score is deterministic per seed and in range', () => {
  const a = mockScoreFor('mock:abc');
  const b = mockScoreFor('mock:abc');
  assert.deepEqual(a, b);
  assert.ok(a.home >= 0 && a.home <= 4 && a.away >= 0 && a.away <= 4);
});

test('mock live score is monotonic toward full-time score', () => {
  const kickoff = new Date('2026-09-15T19:00:00Z');
  const seed = 'mock:xyz';
  const early = mockLiveScore(seed, kickoff, new Date('2026-09-15T19:10:00Z'));
  const late = mockLiveScore(seed, kickoff, new Date('2026-09-15T20:40:00Z'));
  const full = mockScoreFor(seed);
  assert.ok(early.home <= late.home && early.away <= late.away);
  assert.ok(late.home <= full.home && late.away <= full.away);
});
