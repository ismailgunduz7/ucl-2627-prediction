import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _clearAllRateLimits, checkLoginRate, resetLoginRate } from './rate-limit.ts';

beforeEach(() => _clearAllRateLimits());

test('allows attempts up to the limit then blocks (§12)', () => {
  const ip = '1.2.3.4';
  const user = 'alice';
  for (let i = 0; i < 7; i++) {
    assert.equal(checkLoginRate(ip, user).allowed, true, `attempt ${i + 1} should pass`);
  }
  const blocked = checkLoginRate(ip, user);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('successful login resets the counter', () => {
  const ip = '1.2.3.4';
  const user = 'bob';
  for (let i = 0; i < 5; i++) checkLoginRate(ip, user);
  resetLoginRate(ip, user);
  for (let i = 0; i < 7; i++) {
    assert.equal(checkLoginRate(ip, user).allowed, true);
  }
});

test('different (ip, username) pairs are independent — no cross lockout', () => {
  for (let i = 0; i < 7; i++) checkLoginRate('9.9.9.9', 'victim');
  assert.equal(checkLoginRate('9.9.9.9', 'victim').allowed, false);
  // A different IP targeting the same username is unaffected.
  assert.equal(checkLoginRate('8.8.8.8', 'victim').allowed, true);
});
