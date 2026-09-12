import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  isNewer,
  isVersion,
  newestVersion,
  shouldAnnounce,
  unseenReleases,
} from './releases.ts';

const catalogue = [
  { version: '1.0.0', announce: true },
  { version: '1.1.0', announce: true },
  { version: '1.1.1', announce: false },
  { version: '1.10.0', announce: false },
];

test('a version is three numbers, with or without a leading v, and nothing else', () => {
  assert.ok(isVersion('1.0.0'));
  assert.ok(isVersion('12.34.56'));
  assert.ok(isVersion('v1.0.0'));
  assert.ok(!isVersion('1.0'));
  assert.ok(!isVersion('1.0.0-beta'));
  assert.ok(!isVersion('V1.0.0'));
  assert.ok(!isVersion(100));
  assert.ok(!isVersion(null));
});

test('versions compare as numbers, not as text, and the v does not count', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('1.9.0', '1.10.0') < 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('v1.3.0', '1.2.9') > 0);
});

test('anything is newer than a mark of nothing', () => {
  assert.ok(isNewer('1.0.0', null));
  assert.ok(isNewer('1.1.0', '1.0.0'));
  assert.ok(!isNewer('1.0.0', '1.0.0'));
  assert.ok(!isNewer('1.0.0', '1.1.0'));
  assert.ok(!isNewer('v1.2.0', '1.2.0'));
});

test('unseen releases come back newest first, whatever order they were listed in', () => {
  assert.deepEqual(
    unseenReleases(catalogue, '1.0.0').map((r) => r.version),
    ['1.10.0', '1.1.1', '1.1.0'],
  );
  assert.deepEqual(unseenReleases(catalogue, null).length, 4);
  assert.deepEqual(unseenReleases(catalogue, '1.10.0'), []);
});

test('the dialog opens only when something unseen asked to be announced', () => {
  // Everything is unseen, and two of them are worth it.
  assert.ok(shouldAnnounce(catalogue, null));
  // Only the announced 1.1.0 and the two fix-only ones are left.
  assert.ok(shouldAnnounce(catalogue, '1.0.0'));
  // Only fix-only releases remain unseen: listed on request, never announced.
  assert.ok(!shouldAnnounce(catalogue, '1.1.0'));
  assert.ok(!shouldAnnounce(catalogue, '1.10.0'));
  assert.ok(!shouldAnnounce([], null));
});

test('the newest version is found by version order, not list order', () => {
  assert.equal(newestVersion(catalogue), '1.10.0');
  assert.equal(newestVersion([]), null);
});
