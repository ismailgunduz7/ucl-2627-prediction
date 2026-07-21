import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatchDraft, sumLinesForTeam, type TierRules } from './scoring.ts';

// §16 seed values.
const rules: TierRules = new Map([
  [1, new Map([['win', 3], ['draw', 1], ['loss', -2], ['goals_scored', 1], ['goals_conceded', -1], ['clean_sheet', 2]])],
  [4, new Map([['win', 6], ['draw', 2], ['loss', 0], ['goals_scored', 1], ['goals_conceded', 0], ['clean_sheet', 3]])],
]);

const match = (homeScore: number, awayScore: number) => ({
  homeTeamId: 'H',
  awayTeamId: 'A',
  homeTierId: 1, // strong pot
  awayTierId: 4, // weak pot
  homeScore,
  awayScore,
});

test('home win 2-0: win + goals + clean sheet; away loss + conceded', () => {
  const lines = scoreMatchDraft(match(2, 0), rules);
  // Home (Pot 1): win 3 + goals 2*1 + clean_sheet 2 = 7
  assert.equal(sumLinesForTeam(lines, 'H'), 7);
  // Away (Pot 4): loss 0 + conceded 2*0 = 0
  assert.equal(sumLinesForTeam(lines, 'A'), 0);
});

test('draw 1-1: both draw + one goal each, one conceded each', () => {
  const lines = scoreMatchDraft(match(1, 1), rules);
  // Home Pot1: draw 1 + goals 1 + conceded -1 = 1
  assert.equal(sumLinesForTeam(lines, 'H'), 1);
  // Away Pot4: draw 2 + goals 1 + conceded 0 = 3
  assert.equal(sumLinesForTeam(lines, 'A'), 3);
});

test('away win 0-3: weak pot rewarded more for the upset', () => {
  const lines = scoreMatchDraft(match(0, 3), rules);
  // Home Pot1: loss -2 + conceded 3*-1 = -5 (no goals scored line)
  assert.equal(sumLinesForTeam(lines, 'H'), -5);
  // Away Pot4: win 6 + goals 3 + clean_sheet 3 = 12
  assert.equal(sumLinesForTeam(lines, 'A'), 12);
});

test('outcome line always present even at 0 points', () => {
  const lines = scoreMatchDraft(match(0, 0), rules);
  const homeOutcome = lines.find((l) => l.teamId === 'H' && l.ruleCode === 'draw');
  assert.ok(homeOutcome, 'draw line recorded');
});

test('no goals_scored line when a team scores zero', () => {
  const lines = scoreMatchDraft(match(0, 1), rules);
  assert.ok(!lines.some((l) => l.teamId === 'H' && l.ruleCode === 'goals_scored'));
});
