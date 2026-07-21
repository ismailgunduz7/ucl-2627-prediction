import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSquadSelection, type SelectableTeam } from './squad.ts';

const team = (id: string, tierId: number, over: Partial<SelectableTeam> = {}): SelectableTeam => ({
  id,
  tierId,
  isActive: true,
  eliminatedAt: null,
  ...over,
});

const pool: SelectableTeam[] = [
  team('a1', 1),
  team('a2', 1),
  team('b1', 2),
  team('c1', 3),
  team('d1', 4),
  team('d2', 4, { isActive: false }),
  team('e1', 4, { eliminatedAt: new Date('2026-01-01') }),
];

test('accepts one club per pot', () => {
  const res = validateSquadSelection(pool, ['a1', 'b1', 'c1', 'd1']);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.tierByTeam.get('a1'), 1);
});

test('rejects wrong squad size', () => {
  const res = validateSquadSelection(pool, ['a1', 'b1', 'c1']);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'wrong_size');
});

test('rejects duplicate club', () => {
  const res = validateSquadSelection(pool, ['a1', 'a1', 'b1', 'c1']);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'duplicate_team');
});

test('rejects two clubs from the same pot (pot not covered)', () => {
  const res = validateSquadSelection(pool, ['a1', 'a2', 'b1', 'c1']);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, 'pot_not_covered');
    assert.deepEqual(res.error.missingTiers, [4]);
  }
});

test('rejects unknown club', () => {
  const res = validateSquadSelection(pool, ['a1', 'b1', 'c1', 'zzz']);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'unknown_team');
});

test('rejects inactive club', () => {
  const res = validateSquadSelection(pool, ['a1', 'b1', 'c1', 'd2']);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'inactive_team');
});

test('allows an eliminated club on the permanent squad (§2.5)', () => {
  const res = validateSquadSelection(pool, ['a1', 'b1', 'c1', 'e1']);
  assert.equal(res.ok, true);
});
