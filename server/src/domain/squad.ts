import { POT_COUNT, SQUAD_SIZE } from './constants.ts';
import type { MessageParams } from '../lib/i18n.ts';

export interface SelectableTeam {
  id: string;
  tierId: number;
  isActive: boolean;
  eliminatedAt: Date | null;
}

/**
 * Why a squad was refused. It carries a code and the numbers a message needs,
 * never the sentence itself: the words are chosen at the edge, in the language
 * the request asked for.
 */
export interface SquadValidationError {
  code: 'wrong_size' | 'duplicate_team' | 'unknown_team' | 'inactive_team' | 'pot_not_covered';
  params?: MessageParams;
  teamId?: string;
  missingTiers?: number[];
}

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
 * Note: eliminated clubs are allowed on the PERMANENT squad (§2.5). They simply
 * score 0. Elimination only filters the swap and act-transfer pickers (§3.6-3.7).
 */
export function validateSquadSelection(
  teams: SelectableTeam[],
  selectedTeamIds: string[],
): SquadValidationOk | SquadValidationFail {
  if (selectedTeamIds.length !== SQUAD_SIZE) {
    return {
      ok: false,
      error: { code: 'wrong_size', params: { size: SQUAD_SIZE } },
    };
  }

  const unique = new Set(selectedTeamIds);
  if (unique.size !== selectedTeamIds.length) {
    return { ok: false, error: { code: 'duplicate_team' } };
  }

  const byId = new Map(teams.map((t) => [t.id, t]));
  const tierByTeam = new Map<string, number>();
  const coveredTiers = new Set<number>();

  for (const id of selectedTeamIds) {
    const team = byId.get(id);
    if (!team) {
      return { ok: false, error: { code: 'unknown_team', teamId: id } };
    }
    if (!team.isActive) {
      return {
        ok: false,
        error: { code: 'inactive_team', teamId: id },
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
      error: { code: 'pot_not_covered', missingTiers },
    };
  }

  return { ok: true, tierByTeam };
}
