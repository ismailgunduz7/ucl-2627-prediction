import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/lib/api';

export interface Team {
  id: string;
  name: string;
  shortName: string;
  crestUrl: string | null;
  country: string | null;
  isActive: boolean;
  eliminated: boolean;
}
export interface Pot {
  tierId: number;
  tierName: string;
  sortOrder: number;
  teams: Team[];
}
export interface SquadEntry {
  teamId: string;
  tierId: number;
  name: string;
  shortName: string;
  crestUrl: string | null;
  eliminated: boolean;
}
export interface TournamentStatus {
  serverTime: string;
  currentAct: string;
  squadSize: number;
  selectionLock: { firstKickoffAt: string | null; lockAt: string | null; locked: boolean };
  mw1Id: string | null;
}

export const useTournamentStore = defineStore('tournament', () => {
  const pots = ref<Pot[]>([]);
  const status = ref<TournamentStatus | null>(null);
  const squad = ref<SquadEntry[]>([]);
  const squadLocked = ref(false);

  async function loadTeams() {
    const res = await api.get<{ pots: Pot[] }>('/api/teams');
    pots.value = res.pots;
  }
  async function loadStatus() {
    status.value = await api.get<TournamentStatus>('/api/tournament/status');
  }
  async function loadSquad() {
    const res = await api.get<{ squad: SquadEntry[]; locked: boolean }>('/api/squad');
    squad.value = res.squad;
    squadLocked.value = res.locked;
  }
  async function saveSquad(teamIds: string[]) {
    const res = await api.put<{ squad: SquadEntry[] }>('/api/squad', { teamIds });
    squad.value = res.squad;
  }

  return { pots, status, squad, squadLocked, loadTeams, loadStatus, loadSquad, saveSquad };
});
