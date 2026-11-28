import type { NormalizedSpell, SpellResourceCostBundle, Unit } from '@cata-raid-sim/engine';
import { hasSufficientPlayerResources } from '../hooks/usePlayerCastController.js';
import {
  SPELL_MANA_COSTS,
  SPELL_ENERGY_COSTS,
  SPELL_RAGE_COSTS,
  SPELL_RUNIC_COSTS,
} from './spellCosts.js';
import { getDkRunesRequired, hasReadyDkRunes } from './dkResources.js';

/** Build a resource cost bundle: prefer ClassRegistry SSOT, fall back to UI cost tables. */
export function buildSpellCostBundle(
  spellId: string,
  normSpell: NormalizedSpell | undefined | null
): SpellResourceCostBundle {
  const mana =
    normSpell?.resourceKind === 'MANA'
      ? normSpell.resourceCostAmount
      : (SPELL_MANA_COSTS[spellId] ?? 0);
  const energy =
    normSpell?.resourceKind === 'ENERGY'
      ? normSpell.resourceCostAmount
      : (SPELL_ENERGY_COSTS[spellId] ?? 0);
  const rage =
    normSpell?.resourceKind === 'RAGE'
      ? normSpell.resourceCostAmount
      : (SPELL_RAGE_COSTS[spellId] ?? 0);
  const focus = normSpell?.resourceKind === 'FOCUS' ? normSpell.resourceCostAmount : 0;
  const runicPower =
    normSpell?.resourceKind === 'RUNIC_POWER'
      ? normSpell.resourceCostAmount
      : (SPELL_RUNIC_COSTS[spellId] ?? 0);
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
  if (!check.ok) return { ...check, costs };

  if (player.classId === 'DK') {
    const required =
      (normSpell?.runesRequired as Array<'BLOOD' | 'FROST' | 'UNHOLY'> | undefined) ||
      getDkRunesRequired(spellId, player.classId);
    if (required.length > 0 && !hasReadyDkRunes(player, required)) {
      return {
        ok: false,
        errorText: '符文不足',
        floatText: '⚠️ 符文不足！',
        costs,
      };
    }
  }
  return { ...check, costs };
}
