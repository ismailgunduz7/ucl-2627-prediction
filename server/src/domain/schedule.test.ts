import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLeagueSchedule } from './schedule.ts';

test('36 teams x 8 rounds: each round has 18 matches, all teams play once', () => {
  const fixtures = generateLeagueSchedule(36, 8);
  assert.equal(fixtures.length, 18 * 8);
  for (let round = 1; round <= 8; round++) {
    const inRound = fixtures.filter((f) => f.round === round);
    assert.equal(inRound.length, 18);
    const played = new Set<number>();
    for (const f of inRound) {
      assert.notEqual(f.homeIndex, f.awayIndex);
      assert.ok(!played.has(f.homeIndex), `team ${f.homeIndex} twice in round ${round}`);
      assert.ok(!played.has(f.awayIndex), `team ${f.awayIndex} twice in round ${round}`);
      played.add(f.homeIndex);
      played.add(f.awayIndex);
    }
    assert.equal(played.size, 36);
  }
});

test('no pair of teams meets twice across the generated rounds', () => {
  const fixtures = generateLeagueSchedule(36, 8);
  const seen = new Set<string>();
  for (const f of fixtures) {
    const key = [f.homeIndex, f.awayIndex].sort((a, b) => a - b).join('-');
    assert.ok(!seen.has(key), `pair ${key} repeats`);
    seen.add(key);
  }
});

test('rejects odd team counts', () => {
  assert.throws(() => generateLeagueSchedule(35, 8));
});
