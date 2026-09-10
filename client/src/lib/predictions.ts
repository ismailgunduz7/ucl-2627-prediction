import { translate } from '@/i18n';

/** A 1X2 call, seen from the home side (§18.9). */
export type Pick = 'home' | 'draw' | 'away';

/** The three calls, in the order a coupon prints them. */
export const PICK_VALUES: Pick[] = ['home', 'draw', 'away'];

/**
 * The mark a coupon puts on a call. Each language has its own: Turkish writes
 * MS1 / MS0 / MS2 after "maç sonucu", while an English coupon writes the 1X2
 * market as 1 / X / 2. Outside a component, so it reads the catalogue directly.
 */
export function pickLabel(value: Pick): string {
  return translate(`paul.pick.${value}`);
}
