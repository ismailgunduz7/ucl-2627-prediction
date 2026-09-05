import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchClubs, normaliseClubName, type ProviderClub } from './club-matching.ts';

test('the legal form is not part of a club identity', () => {
  assert.equal(normaliseClubName('FC Bayern München'), normaliseClubName('Bayern München'));
  assert.equal(normaliseClubName('Arsenal FC'), normaliseClubName('Arsenal'));
  assert.equal(normaliseClubName('FK Shakhtar Donetsk'), normaliseClubName('Shakhtar Donetsk'));
  assert.equal(normaliseClubName('Sabah FK'), normaliseClubName('Sabah'));
});

test('the founding year is not part of it either', () => {
  assert.equal(normaliseClubName('Como 1907'), normaliseClubName('Como'));
});

test('diacritics and slashes fold away', () => {
  assert.equal(normaliseClubName('FK Bodø/Glimt'), 'bodoglimt');
  assert.equal(normaliseClubName('Fenerbahçe SK'), 'fenerbahce');
  assert.equal(normaliseClubName('ŠK Slovan Bratislava'), 'slovanbratislava');
});

test('two clubs sharing a city stay apart', () => {
  assert.notEqual(normaliseClubName('Real Madrid CF'), normaliseClubName('Club Atlético de Madrid'));
});

const THEIRS: ProviderClub[] = [
  { id: 5, name: 'FC Bayern München', shortName: 'Bayern' },
  { id: 86, name: 'Real Madrid CF', shortName: 'Real Madrid' },
  { id: 1899, name: 'PAE AEK', shortName: 'PAE AEK' },
  { id: 546, name: 'Racing Club de Lens', shortName: 'RC Lens' },
];

test('a club matches on the provider short name when the long one differs', () => {
  const res = matchClubs([{ name: 'Lens' }], THEIRS);
  assert.equal(res.unmatched.length, 0);
  assert.equal(res.matched[0]!.providerId, 546);
  assert.equal(res.matched[0]!.viaAlias, false);
});

test('an alias resolves what normalising cannot reach', () => {
  const res = matchClubs([{ name: 'AEK Athens' }], THEIRS, { 'AEK Athens': 'PAE AEK' });
  assert.equal(res.matched[0]!.providerId, 1899);
  assert.equal(res.matched[0]!.viaAlias, true);
});

test('a club nothing answers to is returned, never dropped', () => {
  const res = matchClubs([{ name: 'Bayern München' }, { name: 'Hiçbir Kulüp' }], THEIRS);
  assert.equal(res.matched.length, 1);
  assert.deepEqual(res.unmatched.map((u) => u.club.name), ['Hiçbir Kulüp']);
});

test('an alias pointing at a club the provider no longer lists is reported', () => {
  const res = matchClubs([{ name: 'AEK Athens' }], THEIRS, { 'AEK Athens': 'AEK Atina' });
  assert.equal(res.matched.length, 0);
  assert.deepEqual(res.staleAliases, ['AEK Athens -> AEK Atina']);
});

test('two of ours landing on one provider club is a collision, not a match', () => {
  const res = matchClubs(
    [{ name: 'Bayern München' }, { name: 'Bayern' }],
    THEIRS,
  );
  assert.deepEqual(res.collisions, [
    { providerName: 'FC Bayern München', clubNames: ['Bayern München', 'Bayern'] },
  ]);
});

test('a clean full field reports nothing to fix', () => {
  const res = matchClubs(
    [{ name: 'Bayern München' }, { name: 'Real Madrid' }, { name: 'Lens' }],
    THEIRS,
  );
  assert.equal(res.matched.length, 3);
  assert.equal(res.unmatched.length, 0);
  assert.equal(res.collisions.length, 0);
  assert.equal(res.staleAliases.length, 0);
});
