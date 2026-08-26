/**
 * The REAL 2026–27 league-phase field, as confirmed by UEFA on 26 August 2026
 * ("Champions League: League phase draw pots confirmed", uefa.com). Pots are
 * the official draw pots; countries drive the no-compatriot draw rule (§2.3).
 *
 * The fixture list itself is still random (domain/schedule.ts) until UEFA
 * publishes the real one. `external_id` / `crest_url` stay null until the
 * provider sync maps football-data.org ids onto these rows.
 */
export interface SeedTeam {
  name: string;
  shortName: string;
  country: string; // three-letter association label, as UEFA prints it
}

export const POTS_2627: Record<1 | 2 | 3 | 4, SeedTeam[]> = {
  1: [
    { name: 'Paris Saint-Germain', shortName: 'PSG', country: 'FRA' },
    { name: 'Bayern München', shortName: 'BAY', country: 'GER' },
    { name: 'Real Madrid', shortName: 'RMA', country: 'ESP' },
    { name: 'Liverpool', shortName: 'LIV', country: 'ENG' },
    { name: 'Inter', shortName: 'INT', country: 'ITA' },
    { name: 'Manchester City', shortName: 'MCI', country: 'ENG' },
    { name: 'Arsenal', shortName: 'ARS', country: 'ENG' },
    { name: 'Barcelona', shortName: 'BAR', country: 'ESP' },
    { name: 'Atlético Madrid', shortName: 'ATM', country: 'ESP' },
  ],
  2: [
    { name: 'Borussia Dortmund', shortName: 'BVB', country: 'GER' },
    { name: 'Roma', shortName: 'ROM', country: 'ITA' },
    { name: 'Sporting CP', shortName: 'SCP', country: 'POR' },
    { name: 'Aston Villa', shortName: 'AVL', country: 'ENG' },
    { name: 'Porto', shortName: 'FCP', country: 'POR' },
    { name: 'Manchester United', shortName: 'MUN', country: 'ENG' },
    { name: 'Club Brugge', shortName: 'BRU', country: 'BEL' },
    { name: 'Real Betis', shortName: 'BET', country: 'ESP' },
    { name: 'PSV', shortName: 'PSV', country: 'NED' },
  ],
  3: [
    { name: 'Feyenoord', shortName: 'FEY', country: 'NED' },
    { name: 'Lille', shortName: 'LIL', country: 'FRA' },
    { name: 'Bodø/Glimt', shortName: 'BOD', country: 'NOR' },
    { name: 'Napoli', shortName: 'NAP', country: 'ITA' },
    { name: 'RB Leipzig', shortName: 'RBL', country: 'GER' },
    { name: 'Villarreal', shortName: 'VIL', country: 'ESP' },
    { name: 'Fenerbahçe', shortName: 'FEN', country: 'TUR' },
    { name: 'Shakhtar Donetsk', shortName: 'SHK', country: 'UKR' },
    { name: 'Galatasaray', shortName: 'GAL', country: 'TUR' },
  ],
  4: [
    { name: 'Slavia Praha', shortName: 'SLP', country: 'CZE' },
    { name: 'Slovan Bratislava', shortName: 'SLB', country: 'SVK' },
    { name: 'Stuttgart', shortName: 'STU', country: 'GER' },
    { name: 'AEK Athens', shortName: 'AEK', country: 'GRE' },
    { name: 'LASK', shortName: 'LSK', country: 'AUT' },
    { name: 'Como', shortName: 'COM', country: 'ITA' },
    { name: 'Lens', shortName: 'LEN', country: 'FRA' },
    { name: 'Viking', shortName: 'VIK', country: 'NOR' },
    { name: 'Sabah', shortName: 'SAB', country: 'AZE' },
  ],
};

export const POT_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Pot 1',
  2: 'Pot 2',
  3: 'Pot 3',
  4: 'Pot 4',
};
