/**
 * Random league-phase draw under the competition's own constraints (§2.2-2.3):
 * every club meets exactly two clubs from each pot, one at home and one away,
 * never a club from its own country, never the same opponent twice, and the
 * 144 matches fold into eight matchdays with every club playing exactly once
 * per matchday. Stands in for UEFA's real fixture list until it is published;
 * a seed makes a draw reproducible.
 *
 * Construction: for each pot pair the pairings are two country-safe bijections
 * (host and return) that never meet twice; a pot against itself is a
 * fixed-point-free, 2-cycle-free permutation. The matchday split is then a
 * 1-factorization of the resulting 8-regular graph, found by most-constrained-
 * first backtracking with random restarts. A graph that refuses to factor gets
 * a fresh opponent draw.
 */

export interface DrawTeam {
  pot: number;
  country: string;
}

export interface DrawFixture {
  round: number; // 1-based matchday
  homeIndex: number; // index into the teams array
  awayIndex: number;
}

export const LEAGUE_ROUNDS = 8;
const POT_SIZE = 9;
const MATCHES_PER_ROUND = 18;

interface Pairing {
  homeIndex: number;
  awayIndex: number;
}

/** Deterministic PRNG so a seeded draw can be replayed exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const PERMUTATION_TRIES = 600;

/**
 * A bijection h: 0..8 → 0..8 with country(a[i]) ≠ country(b[h(i)]) and, when
 * `forbidden` is given, h(i) never landing on a pairing already played.
 */
function drawBijection(
  teams: DrawTeam[],
  a: number[],
  b: number[],
  rnd: () => number,
  forbidden?: (i: number, j: number) => boolean,
): number[] | null {
  const indices = Array.from({ length: POT_SIZE }, (_, i) => i);
  for (let attempt = 0; attempt < PERMUTATION_TRIES; attempt++) {
    const perm = shuffled(indices, rnd);
    let ok = true;
    for (let i = 0; i < POT_SIZE; i++) {
      const j = perm[i]!;
      if (teams[a[i]!]!.country === teams[b[j]!]!.country || (forbidden && forbidden(i, j))) {
        ok = false;
        break;
      }
    }
    if (ok) return perm;
  }
  return null;
}

/** Pairings for a pot against itself: i hosts π(i); no self, no rematch. */
function drawWithinPot(teams: DrawTeam[], pot: number[], rnd: () => number): Pairing[] | null {
  const indices = Array.from({ length: POT_SIZE }, (_, i) => i);
  for (let attempt = 0; attempt < PERMUTATION_TRIES; attempt++) {
    const perm = shuffled(indices, rnd);
    let ok = true;
    for (let i = 0; i < POT_SIZE; i++) {
      const j = perm[i]!;
      // No club hosts itself, no pair meets twice (π(π(i)) = i would be a
      // home-and-home), and never a compatriot.
      if (j === i || perm[j] === i || teams[pot[i]!]!.country === teams[pot[j]!]!.country) {
        ok = false;
        break;
      }
    }
    if (ok) return indices.map((i) => ({ homeIndex: pot[i]!, awayIndex: pot[perm[i]!]! }));
  }
  return null;
}

/** Pairings between two different pots: one host each way, never a rematch. */
function drawAcrossPots(
  teams: DrawTeam[],
  a: number[],
  b: number[],
  rnd: () => number,
): Pairing[] | null {
  const hosts = drawBijection(teams, a, b, rnd);
  if (!hosts) return null;
  const returns = drawBijection(teams, b, a, rnd, (j, i) => hosts[i] === j);
  if (!returns) return null;
  return [
    ...hosts.map((j, i) => ({ homeIndex: a[i]!, awayIndex: b[j]! })),
    ...returns.map((i, j) => ({ homeIndex: b[j]!, awayIndex: a[i]! })),
  ];
}

/** The full 144-pairing set, or null when a pot pair refused its constraints. */
function drawPairings(teams: DrawTeam[], rnd: () => number): Pairing[] | null {
  const pots = new Map<number, number[]>();
  teams.forEach((t, i) => pots.set(t.pot, [...(pots.get(t.pot) ?? []), i]));
  const potKeys = [...pots.keys()].sort((x, y) => x - y);

  const pairings: Pairing[] = [];
  for (let x = 0; x < potKeys.length; x++) {
    const within = drawWithinPot(teams, pots.get(potKeys[x]!)!, rnd);
    if (!within) return null;
    pairings.push(...within);
    for (let y = x + 1; y < potKeys.length; y++) {
      const across = drawAcrossPots(teams, pots.get(potKeys[x]!)!, pots.get(potKeys[y]!)!, rnd);
      if (!across) return null;
      pairings.push(...across);
    }
  }
  return pairings;
}

const SCHEDULE_STEP_BUDGET = 250_000;
const SCHEDULE_TRIES_PER_DRAW = 25;

/**
 * Split the pairings into LEAGUE_ROUNDS matchdays, each club once per day.
 * Most-constrained match first, random day order, hard step budget; null when
 * the budget runs out so the caller can reshuffle or redraw.
 */
function scheduleRounds(pairings: Pairing[], teamCount: number, rnd: () => number): number[] | null {
  const rounds = new Array<number>(pairings.length).fill(-1);
  const busy: boolean[][] = Array.from({ length: teamCount }, () => new Array(LEAGUE_ROUNDS).fill(false));
  const dayCount = new Array<number>(LEAGUE_ROUNDS).fill(0);
  let steps = 0;

  const feasibleDays = (m: Pairing): number[] => {
    const days: number[] = [];
    for (let d = 0; d < LEAGUE_ROUNDS; d++) {
      if (dayCount[d]! < MATCHES_PER_ROUND && !busy[m.homeIndex]![d] && !busy[m.awayIndex]![d]) {
        days.push(d);
      }
    }
    return days;
  };

  const solve = (): boolean => {
    if (++steps > SCHEDULE_STEP_BUDGET) return false;

    let pick = -1;
    let pickDays: number[] | null = null;
    for (let i = 0; i < pairings.length; i++) {
      if (rounds[i] !== -1) continue;
      const days = feasibleDays(pairings[i]!);
      if (days.length === 0) return false;
      if (!pickDays || days.length < pickDays.length) {
        pick = i;
        pickDays = days;
        if (days.length === 1) break;
      }
    }
    if (pick === -1) return true; // everything assigned

    const m = pairings[pick]!;
    for (const d of shuffled(pickDays!, rnd)) {
      rounds[pick] = d;
      busy[m.homeIndex]![d] = true;
      busy[m.awayIndex]![d] = true;
      dayCount[d]!++;
      if (solve()) return true;
      if (steps > SCHEDULE_STEP_BUDGET) return false;
      rounds[pick] = -1;
      busy[m.homeIndex]![d] = false;
      busy[m.awayIndex]![d] = false;
      dayCount[d]!--;
    }
    return false;
  };

  return solve() ? rounds : null;
}

const DRAW_TRIES = 60;

/**
 * @param teams 36 clubs, nine per pot, each with a country
 * @param seed  optional; the same seed always reproduces the same draw
 */
export function generateLeagueDraw(teams: DrawTeam[], seed?: number): DrawFixture[] {
  const potCounts = new Map<number, number>();
  for (const t of teams) potCounts.set(t.pot, (potCounts.get(t.pot) ?? 0) + 1);
  if (teams.length !== 36 || [...potCounts.values()].some((n) => n !== POT_SIZE)) {
    throw new Error('draw needs 36 teams, nine per pot');
  }

  const rnd = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
  for (let attempt = 0; attempt < DRAW_TRIES; attempt++) {
    const pairings = drawPairings(teams, rnd);
    if (!pairings) continue;
    for (let t = 0; t < SCHEDULE_TRIES_PER_DRAW; t++) {
      const ordered = shuffled(pairings, rnd);
      const rounds = scheduleRounds(ordered, teams.length, rnd);
      if (rounds) {
        return ordered.map((p, i) => ({
          round: rounds[i]! + 1,
          homeIndex: p.homeIndex,
          awayIndex: p.awayIndex,
        }));
      }
    }
  }
  throw new Error('could not produce a valid draw. Check the country distribution');
}

/**
 * Violations in a draw against every rule at once; empty means valid. Meant
 * for tests and for asserting a freshly generated draw before it is seeded.
 */
export function validateLeagueDraw(teams: DrawTeam[], fixtures: DrawFixture[]): string[] {
  const issues: string[] = [];
  if (fixtures.length !== 144) issues.push(`expected 144 matches, got ${fixtures.length}`);

  const perRound = new Map<number, number>();
  const playsOnDay = new Set<string>();
  const met = new Set<string>();
  const potMeetings = new Map<string, number>(); // `${team}:${pot}:${home|away}`

  for (const f of fixtures) {
    const home = teams[f.homeIndex];
    const away = teams[f.awayIndex];
    if (!home || !away) {
      issues.push(`fixture references a missing team (${f.homeIndex} vs ${f.awayIndex})`);
      continue;
    }
    if (f.homeIndex === f.awayIndex) issues.push(`team ${f.homeIndex} plays itself`);
    if (home.country === away.country) {
      issues.push(`same-country pairing ${f.homeIndex} vs ${f.awayIndex} (${home.country})`);
    }
    if (f.round < 1 || f.round > LEAGUE_ROUNDS) issues.push(`round ${f.round} out of range`);
    perRound.set(f.round, (perRound.get(f.round) ?? 0) + 1);

    for (const side of [f.homeIndex, f.awayIndex]) {
      const key = `${side}@${f.round}`;
      if (playsOnDay.has(key)) issues.push(`team ${side} plays twice on matchday ${f.round}`);
      playsOnDay.add(key);
    }

    const pairKey = [f.homeIndex, f.awayIndex].sort((a, b) => a - b).join('-');
    if (met.has(pairKey)) issues.push(`pair ${pairKey} meets twice`);
    met.add(pairKey);

    const homeKey = `${f.homeIndex}:${away.pot}:home`;
    const awayKey = `${f.awayIndex}:${home.pot}:away`;
    potMeetings.set(homeKey, (potMeetings.get(homeKey) ?? 0) + 1);
    potMeetings.set(awayKey, (potMeetings.get(awayKey) ?? 0) + 1);
  }

  for (let r = 1; r <= LEAGUE_ROUNDS; r++) {
    if ((perRound.get(r) ?? 0) !== MATCHES_PER_ROUND) {
      issues.push(`matchday ${r} has ${perRound.get(r) ?? 0} matches, expected ${MATCHES_PER_ROUND}`);
    }
  }
  for (let t = 0; t < teams.length; t++) {
    for (const pot of [1, 2, 3, 4]) {
      if ((potMeetings.get(`${t}:${pot}:home`) ?? 0) !== 1) {
        issues.push(`team ${t} does not host exactly one Pot ${pot} club`);
      }
      if ((potMeetings.get(`${t}:${pot}:away`) ?? 0) !== 1) {
        issues.push(`team ${t} does not visit exactly one Pot ${pot} club`);
      }
    }
  }
  return issues;
}
