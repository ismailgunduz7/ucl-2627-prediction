/**
 * Pure weekly-lineup logic (PLAN.md §3.5). No DB/time dependency.
 *
 * The effective squad is the four permanent clubs (later possibly one replaced
 * by weekly_swap). Exactly one club is benched; the other three score. The
 * captain must be a scoring club (never the bench, except under bench_boost).
 */

export interface SquadClub {
  teamId: string;
  tierId: number;
}

export type LineupError =
  | { code: 'bench_not_in_squad'; message: string }
  | { code: 'captain_not_in_squad'; message: string }
  | { code: 'captain_on_bench'; message: string };

export function validateLineup(
  squad: SquadClub[],
  benchTeamId: string,
  captainTeamId: string,
  benchBoost = false,
): { ok: true } | { ok: false; error: LineupError } {
  const ids = new Set(squad.map((s) => s.teamId));
  if (!ids.has(benchTeamId)) {
    return { ok: false, error: { code: 'bench_not_in_squad', message: 'Bench kulübü kadroda değil' } };
  }
  if (!ids.has(captainTeamId)) {
    return { ok: false, error: { code: 'captain_not_in_squad', message: 'Kaptan kadroda değil' } };
  }
  // A benched club can never hold the captaincy except under bench_boost (§3.5).
  if (!benchBoost && captainTeamId === benchTeamId) {
    return {
      ok: false,
      error: { code: 'captain_on_bench', message: 'Benchteki kulüp kaptan olamaz' },
    };
  }
  return { ok: true };
}

/**
 * Resolve the lineup to use when a user has not set one (§3.5):
 * keep the previous week's bench + captain if both are still valid on the
 * effective four; otherwise deterministic fallback derived from the current pot
 * layout — bench = highest pot number (weakest, e.g. Pot 4), captain = lowest
 * pot (strongest, e.g. Pot 1) among the three that score.
 */
export function defaultLineup(
  squad: SquadClub[],
  previous?: { benchTeamId: string; captainTeamId: string } | null,
): { benchTeamId: string; captainTeamId: string } {
  if (previous && validateLineup(squad, previous.benchTeamId, previous.captainTeamId).ok) {
    return { benchTeamId: previous.benchTeamId, captainTeamId: previous.captainTeamId };
  }
  // Fallback from pot layout. Highest tierId = weakest pot → bench.
  const byWeakest = [...squad].sort((a, b) => b.tierId - a.tierId);
  const benchTeamId = byWeakest[0]!.teamId;
  // Captain = strongest (lowest tierId) among the scoring three.
  const scoring = squad.filter((s) => s.teamId !== benchTeamId).sort((a, b) => a.tierId - b.tierId);
  const captainTeamId = scoring[0]!.teamId;
  return { benchTeamId, captainTeamId };
}

// --- Matchweek score computation ------------------------------------------

export interface MatchweekScoreInput {
  squad: SquadClub[]; // effective four
  benchTeamId: string;
  captainTeamId: string;
  /** Club-layer points for this matchweek, per team id (0 if absent = bye). */
  teamPoints: Map<string, number>;
  benchBoost?: boolean; // §3.6, all four score (Phase 5)
  captainMultiplier?: 2 | 3; // ×3 under triple_boost (Phase 5)
}

export interface ClubLine {
  teamId: string;
  basePoints: number;
  benched: boolean;
  captain: boolean;
  multiplier: number;
  contributed: number;
}

export interface MatchweekScoreResult {
  total: number;
  lines: ClubLine[];
}

/**
 * Compute a participant's matchweek total (§4.1 resolution order steps 3–6).
 * Integer points only; captain multiplier is ×2 or ×3.
 */
export function computeMatchweekScore(input: MatchweekScoreInput): MatchweekScoreResult {
  const benchBoost = input.benchBoost ?? false;
  const captainMultiplier = input.captainMultiplier ?? 2;

  const lines: ClubLine[] = input.squad.map((club) => {
    const basePoints = input.teamPoints.get(club.teamId) ?? 0;
    const benched = club.teamId === input.benchTeamId;
    const scoring = benchBoost || !benched;
    const captain = club.teamId === input.captainTeamId && scoring;
    const multiplier = captain ? captainMultiplier : 1;
    const contributed = scoring ? basePoints * multiplier : 0;
    return { teamId: club.teamId, basePoints, benched, captain, multiplier, contributed };
  });

  const total = lines.reduce((acc, l) => acc + l.contributed, 0);
  return { total, lines };
}
