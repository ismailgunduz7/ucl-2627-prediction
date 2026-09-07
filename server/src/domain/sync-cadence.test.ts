import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROACHING_WINDOW_MS,
  MAX_BACKOFF_MS,
  MIN_SYNC_INTERVAL_MS,
  SYNC_CADENCE_MS,
  THROTTLE_BACKOFF_BASE_MS,
  backoffDelayMs,
  cadenceForWindow,
  isThrottleFailure,
  nextSyncDelayMs,
} from './sync-cadence.ts';

const NOW = new Date('2026-09-16T18:00:00Z');
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

test('a match in play polls at the live cadence', () => {
  const delay = cadenceForWindow(NOW, { inPlayCount: 2, nextKickoffAt: inMinutes(600) });
  assert.equal(delay, SYNC_CADENCE_MS.live);
});

test('cadence tightens as kickoff approaches', () => {
  const window = (minutes: number) => ({ inPlayCount: 0, nextKickoffAt: inMinutes(minutes) });
  assert.equal(cadenceForWindow(NOW, window(10)), SYNC_CADENCE_MS.imminent);
  assert.equal(cadenceForWindow(NOW, window(90)), SYNC_CADENCE_MS.matchday);
  assert.equal(cadenceForWindow(NOW, window(60 * 8)), SYNC_CADENCE_MS.quiet);
});

test('a day with nothing to play polls twice', () => {
  const window = (minutes: number) => ({ inPlayCount: 0, nextKickoffAt: inMinutes(minutes) });
  assert.equal(cadenceForWindow(NOW, window(60 * 48)), SYNC_CADENCE_MS.dormant);
  // Two days out, twice a day is four polls before kickoff comes into range.
  assert.ok(SYNC_CADENCE_MS.dormant >= 12 * 60 * 60_000);
});

test('a long sleep still wakes in time for the run-up', () => {
  // Kickoff 13 hours out: the quiet band starts in one hour, so that is when
  // the next poll happens rather than half a day later.
  const delay = cadenceForWindow(NOW, { inPlayCount: 0, nextKickoffAt: inMinutes(60 * 13) });
  assert.equal(delay, 60 * 60_000);
  assert.ok(delay < SYNC_CADENCE_MS.dormant);
  assert.equal(APPROACHING_WINDOW_MS, 12 * 60 * 60_000);
});

test('no fixtures left falls back to the idle cadence', () => {
  assert.equal(cadenceForWindow(NOW, { inPlayCount: 0, nextKickoffAt: null }), SYNC_CADENCE_MS.idle);
});

test('backoff doubles per failure and stops at the cap', () => {
  assert.equal(backoffDelayMs(0, false), 0);
  const first = backoffDelayMs(1, false);
  const second = backoffDelayMs(2, false);
  assert.equal(second, first * 2);
  assert.equal(backoffDelayMs(40, false), MAX_BACKOFF_MS);
});

test('a throttled poll waits longer than an ordinary failure', () => {
  assert.ok(backoffDelayMs(1, true) > backoffDelayMs(1, false));
  assert.equal(backoffDelayMs(1, true), THROTTLE_BACKOFF_BASE_MS);
});

test('backoff never polls sooner than the healthy cadence', () => {
  const live = { inPlayCount: 1, nextKickoffAt: null };
  const healthy = nextSyncDelayMs({ now: NOW, window: live, consecutiveFailures: 0, throttled: false });
  const failing = nextSyncDelayMs({ now: NOW, window: live, consecutiveFailures: 3, throttled: true });
  assert.equal(healthy, SYNC_CADENCE_MS.live);
  assert.ok(failing > healthy);
});

test('every delay respects the provider rate-limit floor', () => {
  for (const inPlayCount of [0, 1, 18]) {
    for (const minutes of [-5, 0, 1, 14, 120, 60 * 48]) {
      const delay = nextSyncDelayMs({
        now: NOW,
        window: { inPlayCount, nextKickoffAt: inMinutes(minutes) },
        consecutiveFailures: 0,
        throttled: false,
      });
      assert.ok(delay >= MIN_SYNC_INTERVAL_MS, `delay ${delay} below the floor`);
    }
  }
});

test('throttle detection reads the provider error text', () => {
  assert.ok(isThrottleFailure('football-data rate limit hit (HTTP 429)'));
  assert.ok(isThrottleFailure('Too Many Requests'));
  assert.ok(!isThrottleFailure('football-data request failed: HTTP 503'));
});
