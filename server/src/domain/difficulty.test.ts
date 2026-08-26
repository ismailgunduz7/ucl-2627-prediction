import { test } from 'node:test';
import assert from 'node:assert/strict';
import { difficultyFor, harderBand } from './difficulty.ts';

test('a strong club at home against a weaker one has an easy week', () => {
  assert.equal(difficultyFor(1, 3, false), 'kolay');
  assert.equal(difficultyFor(1, 4, false), 'kolay');
  assert.equal(difficultyFor(2, 4, false), 'kolay');
});

test('the same fixture is hard for the weaker visitor', () => {
  assert.equal(difficultyFor(3, 1, true), 'zor');
  assert.equal(difficultyFor(4, 1, true), 'zor');
  assert.equal(difficultyFor(4, 1, false), 'zor');
});

test('evenly matched clubs land in the middle', () => {
  for (const tier of [1, 2, 3, 4]) {
    assert.equal(difficultyFor(tier, tier, false), 'orta', `pot ${tier} at home`);
  }
});

test('going away makes the same fixture harder, never easier', () => {
  for (let own = 1; own <= 4; own++) {
    for (let opp = 1; opp <= 4; opp++) {
      const home = difficultyFor(own, opp, false);
      const away = difficultyFor(own, opp, true);
      const order = ['kolay', 'orta', 'zor'];
      assert.ok(
        order.indexOf(away) >= order.indexOf(home),
        `pot ${own} vs pot ${opp}: away ${away} easier than home ${home}`,
      );
    }
  }
});

test('a club playing twice is judged on its harder fixture', () => {
  assert.equal(harderBand(null, 'kolay'), 'kolay');
  assert.equal(harderBand('kolay', 'zor'), 'zor');
  assert.equal(harderBand('zor', 'kolay'), 'zor');
  assert.equal(harderBand('orta', 'zor'), 'zor');
});
