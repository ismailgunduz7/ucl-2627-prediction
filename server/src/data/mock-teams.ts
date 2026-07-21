/**
 * PLACEHOLDER league-phase clubs for the 2026–27 mockup.
 *
 * The real 2026–27 participants are not known yet (qualifying rounds are still
 * being played as of this writing), so this seeds the domain with a plausible
 * 36-club field drawn from the previous season's participants, split into four
 * pots of nine. Pot placement here is illustrative only.
 *
 * Per PLAN.md §2.3, reseed `teams` (and re-pot) once UEFA publishes the official
 * 2026–27 league-phase draw. `external_id` / `crest_url` stay null until the
 * provider sync (Phase 3) maps them.
 */
export interface MockTeam {
  name: string;
  shortName: string;
  country: string; // ISO-ish label
}

export const MOCK_POTS: Record<1 | 2 | 3 | 4, MockTeam[]> = {
  1: [
    { name: 'Paris Saint-Germain', shortName: 'PSG', country: 'FRA' },
    { name: 'Real Madrid', shortName: 'RMA', country: 'ESP' },
    { name: 'Manchester City', shortName: 'MCI', country: 'ENG' },
    { name: 'Bayern München', shortName: 'BAY', country: 'GER' },
    { name: 'Liverpool', shortName: 'LIV', country: 'ENG' },
    { name: 'Inter', shortName: 'INT', country: 'ITA' },
    { name: 'Chelsea', shortName: 'CHE', country: 'ENG' },
    { name: 'Borussia Dortmund', shortName: 'DOR', country: 'GER' },
    { name: 'Barcelona', shortName: 'BAR', country: 'ESP' },
  ],
  2: [
    { name: 'Arsenal', shortName: 'ARS', country: 'ENG' },
    { name: 'Bayer Leverkusen', shortName: 'LEV', country: 'GER' },
    { name: 'Atlético Madrid', shortName: 'ATM', country: 'ESP' },
    { name: 'Benfica', shortName: 'BEN', country: 'POR' },
    { name: 'Atalanta', shortName: 'ATA', country: 'ITA' },
    { name: 'Villarreal', shortName: 'VIL', country: 'ESP' },
    { name: 'Juventus', shortName: 'JUV', country: 'ITA' },
    { name: 'Eintracht Frankfurt', shortName: 'SGE', country: 'GER' },
    { name: 'Club Brugge', shortName: 'BRU', country: 'BEL' },
  ],
  3: [
    { name: 'Tottenham Hotspur', shortName: 'TOT', country: 'ENG' },
    { name: 'PSV Eindhoven', shortName: 'PSV', country: 'NED' },
    { name: 'Ajax', shortName: 'AJA', country: 'NED' },
    { name: 'Napoli', shortName: 'NAP', country: 'ITA' },
    { name: 'Sporting CP', shortName: 'SPO', country: 'POR' },
    { name: 'Olympiacos', shortName: 'OLY', country: 'GRE' },
    { name: 'Slavia Praha', shortName: 'SLA', country: 'CZE' },
    { name: 'Bodø/Glimt', shortName: 'BOD', country: 'NOR' },
    { name: 'Marseille', shortName: 'OM', country: 'FRA' },
  ],
  4: [
    { name: 'FC Copenhagen', shortName: 'COP', country: 'DEN' },
    { name: 'Monaco', shortName: 'MON', country: 'FRA' },
    { name: 'Galatasaray', shortName: 'GAL', country: 'TUR' },
    { name: 'Union Saint-Gilloise', shortName: 'USG', country: 'BEL' },
    { name: 'Qarabağ', shortName: 'QAR', country: 'AZE' },
    { name: 'Athletic Club', shortName: 'ATH', country: 'ESP' },
    { name: 'Newcastle United', shortName: 'NEW', country: 'ENG' },
    { name: 'Pafos', shortName: 'PAF', country: 'CYP' },
    { name: 'Kairat Almaty', shortName: 'KAI', country: 'KAZ' },
  ],
};

export const POT_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Pot 1',
  2: 'Pot 2',
  3: 'Pot 3',
  4: 'Pot 4',
};
