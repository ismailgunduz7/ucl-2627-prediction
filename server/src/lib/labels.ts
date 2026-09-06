import { translate, translateOr } from './i18n.ts';

/**
 * The names the API puts on things it derives rather than stores.
 *
 * The database keeps one Turkish label per row from the seed. That was fine
 * while the game spoke one language; now the label is worked out from the key
 * the row already carries, and the stored text only stands in for a row we do
 * not recognise.
 */

const KNOCKOUT_ROUND_KEYS: Record<string, string> = {
  playoff: 'round.playoff',
  r16: 'round.r16',
  qf: 'round.qf',
  sf: 'round.sf',
  final: 'round.final',
};

export interface MatchweekLabelInput {
  id: string;
  label: string;
}

/** "Hafta 3", "Son 16 2. maç", "Final". */
export function matchweekLabel(mw: MatchweekLabelInput): string {
  const league = /^mw-(\d+)$/.exec(mw.id);
  if (league) return translate('matchweek.league_week', { number: Number(league[1]) });

  const knockout = /^([a-z0-9]+)(?:-leg(\d+))?$/.exec(mw.id);
  const key = knockout ? KNOCKOUT_ROUND_KEYS[knockout[1]!] : undefined;
  if (!key) return mw.label;

  const round = translate(key);
  const leg = knockout?.[2] ? Number(knockout[2]) : 0;
  return leg === 0 ? round : `${round} ${translate('leg.nth', { number: leg })}`;
}

/** "Pot 2". */
export function tierLabel(tierId: number): string {
  return translate('tier.name', { number: tierId });
}

/** "Galibiyet". An admin-added rule we have no wording for keeps the stored one. */
export function ruleLabel(code: string, stored: string): string {
  return translateOr(stored, `rule.${code}`);
}
