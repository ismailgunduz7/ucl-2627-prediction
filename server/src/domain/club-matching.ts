/**
 * Matching our 36 clubs onto a provider's own club list (§5.1).
 *
 * Nobody spells a club the same way twice. The provider writes "FC Bayern
 * München" where we write "Bayern München", "Como 1907" where we write "Como",
 * "Racing Club de Lens" where we write "Lens". Dropping the legal-form tokens
 * and the founding year settles almost all of it, and the provider's own short
 * name catches most of the rest.
 *
 * What is left gets named explicitly in an alias table rather than guessed at
 * by a cleverer normaliser, because the cost of a wrong guess is a club whose
 * scores silently never arrive all season. Nothing here drops a club quietly:
 * whatever fails to match comes back for the caller to refuse to proceed on.
 */

/** Legal forms and initialisms that carry no identity of their own. */
const NOISE = new Set([
  'fc', 'cf', 'sc', 'ac', 'as', 'afc', 'kv', 'sk', 'fk', 'bv', 'ss', 'ssc',
  'osc', 'rc', 'cd', 'ud', 'sv', 'bk', 'ik', 'ck', 'vfb', 'club', 'clube',
  'de', 'del', 'kulubu', 'calcio',
]);

/**
 * A club name reduced to the part that identifies it: no diacritics, no
 * punctuation, no legal form, no founding year.
 */
export function normaliseClubName(raw: string): string {
  const folded = raw
    .replace(/ø/gi, 'o')
    .replace(/ł/gi, 'l')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(?:18|19|20)\d{2}\b/g, ' ');

  return folded
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !NOISE.has(token))
    .join('');
}

export interface ProviderClub {
  id: number;
  name: string;
  shortName?: string | null;
}

export interface ClubMatch<T> {
  club: T;
  providerId: number;
  providerName: string;
  /** True when an alias resolved it rather than the normalised name. */
  viaAlias: boolean;
}

export interface ClubMatchResult<T> {
  matched: ClubMatch<T>[];
  /** Ours that nothing answered to, with the key that was looked for. */
  unmatched: { club: T; key: string }[];
  /** Two of ours landing on one provider club, which would corrupt both. */
  collisions: { providerName: string; clubNames: string[] }[];
  /** Aliases naming a provider club that is not in the list any more. */
  staleAliases: string[];
}

/**
 * Resolve each of our clubs to one provider club.
 *
 * `aliases` maps our club name to the provider's exact name, for the few that
 * normalising cannot reach. A provider rename then shows up as a stale alias
 * instead of quietly mapping the wrong club.
 */
export function matchClubs<T extends { name: string }>(
  ours: T[],
  theirs: ProviderClub[],
  aliases: Readonly<Record<string, string>> = {},
): ClubMatchResult<T> {
  const byKey = new Map<string, ProviderClub>();
  for (const club of theirs) {
    for (const candidate of [club.name, club.shortName ?? '']) {
      const key = normaliseClubName(candidate);
      if (key && !byKey.has(key)) byKey.set(key, club);
    }
  }

  const matched: ClubMatch<T>[] = [];
  const unmatched: { club: T; key: string }[] = [];
  const staleAliases: string[] = [];
  const claimedBy = new Map<number, string[]>();

  for (const club of ours) {
    const alias = aliases[club.name];
    const key = normaliseClubName(alias ?? club.name);
    const hit = byKey.get(key);

    if (!hit) {
      if (alias) staleAliases.push(`${club.name} -> ${alias}`);
      unmatched.push({ club, key });
      continue;
    }
    matched.push({
      club,
      providerId: hit.id,
      providerName: hit.name,
      viaAlias: alias !== undefined,
    });
    claimedBy.set(hit.id, [...(claimedBy.get(hit.id) ?? []), club.name]);
  }

  const collisions = matched
    .filter((m, i) => matched.findIndex((o) => o.providerId === m.providerId) === i)
    .map((m) => ({ providerName: m.providerName, clubNames: claimedBy.get(m.providerId) ?? [] }))
    .filter((c) => c.clubNames.length > 1);

  return { matched, unmatched, collisions, staleAliases };
}
