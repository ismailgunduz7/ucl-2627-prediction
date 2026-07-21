import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRuleDirection } from './rules-direction.ts';

test('reward: ascending pot values pass', () => {
  assert.equal(checkRuleDirection('reward', [3, 4, 5, 6]), null);
  assert.equal(checkRuleDirection('reward', [1, 1, 2, 2]), null); // equal steps allowed
});

test('reward: a stronger pot with more points fails', () => {
  assert.ok(checkRuleDirection('reward', [6, 4, 5, 6]) !== null);
});

test('penalty: ascending toward zero passes', () => {
  assert.equal(checkRuleDirection('penalty', [-2, -1, 0, 0]), null);
});

test('penalty: a weaker pot punished harder fails', () => {
  assert.ok(checkRuleDirection('penalty', [-1, -1, -2, 0]) !== null);
});

test('flat: equal passes, unequal fails', () => {
  assert.equal(checkRuleDirection('flat', [1, 1, 1, 1]), null);
  assert.ok(checkRuleDirection('flat', [1, 1, 2, 1]) !== null);
});
