import { POT_COUNT, SQUAD_SIZE } from './constants.ts';

export interface SelectableTeam {
  id: string;
  tierId: number;
  isActive: boolean;
  eliminatedAt: Date | null;
}

export type SquadValidationError =
  | { code: 'wrong_size'; message: string }
  | { code: 'duplicate_team'; message: string }
  | { code: 'unknown_team'; message: string; teamId: string }
  | { code: 'inactive_team'; message: string; teamId: string }
  | { code: 'pot_not_covered'; message: string; missingTiers: number[] };

export interface SquadValidationOk {
  ok: true;
  /** team id -> tier id, resolved server-side from the teams table (never client input). */
  tierByTeam: Map<string, number>;
}
export interface SquadValidationFail {
  ok: false;
  error: SquadValidationError;
}

/**
 * Validates a permanent squad pick (§3.2): exactly SQUAD_SIZE clubs, no
 * duplicates, all active, and exactly one club per pot covering every pot.
 *
 * Note: eliminated clubs are allowed on the PERMANENT squad (§2.5); they simply
 * score 0. Elimination only filters the swap/act-transfer pickers (§3.6–3.7).
 */
export function validateSquadSelection(
  teams: SelectableTeam[],
  selectedTeamIds: string[],
): SquadValidationOk | SquadValidationFail {
  if (selectedTeamIds.length !== SQUAD_SIZE) {
    return {
      ok: false,
      error: { code: 'wrong_size', message: `Kadro tam olarak ${SQUAD_SIZE} kulüpten oluşmalı` },
    };
  }

  const unique = new Set(selectedTeamIds);
  if (unique.size !== selectedTeamIds.length) {
    return { ok: false, error: { code: 'duplicate_team', message: 'Aynı kulüp iki kez seçilemez' } };
  }

  const byId = new Map(teams.map((t) => [t.id, t]));
  const tierByTeam = new Map<string, number>();
  const coveredTiers = new Set<number>();

  for (const id of selectedTeamIds) {
    const team = byId.get(id);
    if (!team) {
      return { ok: false, error: { code: 'unknown_team', message: 'Geçersiz kulüp', teamId: id } };
    }
    if (!team.isActive) {
      return {
        ok: false,
        error: { code: 'inactive_team', message: 'Bu kulüp seçilemez', teamId: id },
      };
    }
    tierByTeam.set(id, team.tierId);
    coveredTiers.add(team.tierId);
  }

  if (coveredTiers.size !== POT_COUNT) {
    const allTiers = Array.from({ length: POT_COUNT }, (_, i) => i + 1);
    const missingTiers = allTiers.filter((t) => !coveredTiers.has(t));
    return {
      ok: false,
      error: {
        code: 'pot_not_covered',
        message: 'Her pottan tam olarak bir kulüp seçilmeli',
        missingTiers,
      },
    };
  }

  return { ok: true, tierByTeam };
}
