/**
 * League-phase table (PLAN.md §2.2). This is the REAL football table (three
 * points for a win, one for a draw), not the fantasy scoring. It decides who
 * finishes 1–8 (straight to the round of 16), 9–24 (play-offs) and 25–36
 * (eliminated), so it must follow the competition's own rules.
 */

export interface StandingMatch {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface StandingTeam {
  teamId: string;
  name: string;
}

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rank: number;
}

const WIN_POINTS = 3;
const DRAW_POINTS = 1;

/**
 * Build the table from finished league-phase matches. Teams with no matches yet
 * still appear (all zeros). Ordering: points, goal difference, goals scored,
 * then name, the same shape UEFA uses before its later tie-breaks.
 */
export function computeStandings(
  teams: StandingTeam[],
  matches: StandingMatch[],
): StandingRow[] {
  const rows = new Map<string, Omit<StandingRow, 'rank' | 'goalDifference'>>();
  for (const t of teams) {
    rows.set(t.teamId, {
      teamId: t.teamId,
      name: t.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }

  const apply = (teamId: string, gf: number, ga: number) => {
    const row = rows.get(teamId);
    if (!row) return; // a club outside the provided set
    row.played += 1;
    row.goalsFor += gf;
    row.goalsAgainst += ga;
    if (gf > ga) {
      row.won += 1;
      row.points += WIN_POINTS;
    } else if (gf === ga) {
      row.drawn += 1;
      row.points += DRAW_POINTS;
    } else {
      row.lost += 1;
    }
  };

  for (const m of matches) {
    apply(m.homeTeamId, m.homeScore, m.awayScore);
    apply(m.awayTeamId, m.awayScore, m.homeScore);
  }

  const sorted = [...rows.values()]
    .map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name, 'tr'),
    );

  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

export type LeagueOutcome = 'top8' | 'playoff' | 'eliminated';

/** Where a finishing position lands a club (§2.4, §2.5). */
export function outcomeForRank(rank: number): LeagueOutcome {
  if (rank <= 8) return 'top8';
  if (rank <= 24) return 'playoff';
  return 'eliminated';
}
