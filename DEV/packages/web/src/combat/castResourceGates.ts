import type { NormalizedSpell, SpellResourceCostBundle, Unit } from '@cata-raid-sim/engine';
import { hasSufficientPlayerResources } from '../hooks/usePlayerCastController.js';
import {
  SPELL_MANA_COSTS,
  SPELL_ENERGY_COSTS,
  SPELL_RAGE_COSTS,
  SPELL_RUNIC_COSTS,
} from './spellCosts.js';

/** Build a resource cost bundle from UI tables + ClassRegistry fallback. */
export function buildSpellCostBundle(
  spellId: string,
  normSpell: NormalizedSpell | undefined | null
): SpellResourceCostBundle {
  const mana =
    SPELL_MANA_COSTS[spellId] ??
    (normSpell?.resourceKind === 'MANA' ? normSpell.resourceCostAmount : 0);
  const energy =
    SPELL_ENERGY_COSTS[spellId] ??
    (normSpell?.resourceKind === 'ENERGY' ? normSpell.resourceCostAmount : 0);
  const rage =
    SPELL_RAGE_COSTS[spellId] ??
    (normSpell?.resourceKind === 'RAGE' ? normSpell.resourceCostAmount : 0);
  const focus = normSpell?.resourceKind === 'FOCUS' ? normSpell.resourceCostAmount : 0;
  const runicPower =
    SPELL_RUNIC_COSTS[spellId] ??
    (normSpell?.resourceKind === 'RUNIC_POWER' ? normSpell.resourceCostAmount : 0);
  const holyPower = normSpell?.resourceKind === 'HOLY_POWER' ? normSpell.resourceCostAmount : 0;

  return {
    mana: mana || undefined,
    energy: energy || undefined,
    rage: rage || undefined,
    focus: focus || undefined,
    runicPower: runicPower || undefined,
    holyPower: holyPower || undefined,
  };
}

/** Gate cast start on player resources. UI error / float text left to caller. */
export function checkCastSlotResources(
  player: Unit,
  spellId: string,
  normSpell: NormalizedSpell | undefined | null
): { ok: boolean; errorText?: string; floatText?: string; costs: SpellResourceCostBundle } {
  const costs = buildSpellCostBundle(spellId, normSpell);
  const check = hasSufficientPlayerResources(player, costs);
  return { ...check, costs };
}
