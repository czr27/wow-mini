import {
  getSpellGcdCategory,
  getEffectiveGcdMs,
  LEVEL_80_MAX_HASTE,
  type ClassId,
} from '@cata-raid-sim/engine';
import { isOffGcdSpell } from '../components/ActionBar.js';

/**
 * Compute player GCD duration for a spell at Lv.80 haste baseline.
 * Returns 0 for OFF_GCD spells.
 */
export function computePlayerGcdMs(
  spellId: string | undefined,
  classId: ClassId | string | undefined,
  haste: number = LEVEL_80_MAX_HASTE
): number {
  if (spellId && isOffGcdSpell(spellId)) return 0;
  const gcdCat = getSpellGcdCategory(spellId || '', classId as ClassId | undefined);
  return getEffectiveGcdMs(gcdCat, haste);
}
