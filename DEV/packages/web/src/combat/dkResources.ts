import type { CombatEngine, NormalizedSpell, RuneSlot, Unit } from '@cata-raid-sim/engine';
import { getSpellByAnyId } from '@cata-raid-sim/engine';
import { syncUnitResources } from './unitResources.js';

/** Cata base rune recharge (haste shortens via ResourceManager.tickRunes). */
export const DK_RUNE_BASE_CD_MS = 10_000;
/** RP gained per rune spent (Cata-like simplification used by engine.castSpell). */
export const DK_RP_PER_RUNE = 10;
/** Horn of Winter: no rune cost, +10 RP. */
export const DK_HORN_RP_GAIN = 10;

export function createDefaultDkRunes(): RuneSlot[] {
  const types: Array<RuneSlot['runeType']> = [
    'BLOOD',
    'BLOOD',
    'FROST',
    'FROST',
    'UNHOLY',
    'UNHOLY',
  ];
  return types.map((runeType, index) => ({
    index,
    runeType,
    cooldownMs: 0,
    totalCdMs: DK_RUNE_BASE_CD_MS,
  }));
}

export function ensureDkRunes(unit: Unit): void {
  if (unit.classId !== 'DK') return;
  if (!unit.runes || unit.runes.length !== 6) {
    unit.runes = createDefaultDkRunes();
    return;
  }
  for (let i = 0; i < unit.runes.length; i++) {
    const r = unit.runes[i];
    r.index = i;
    if (!r.totalCdMs || r.totalCdMs <= 0) r.totalCdMs = DK_RUNE_BASE_CD_MS;
    if (r.cooldownMs == null || r.cooldownMs < 0) r.cooldownMs = 0;
  }
}

export function getDkRunesRequired(
  spellId: string,
  classId?: Unit['classId']
): Array<'BLOOD' | 'FROST' | 'UNHOLY'> {
  const norm =
    getSpellByAnyId(spellId, classId === 'BOSS' || classId === 'NPC' ? undefined : classId) ||
    getSpellByAnyId(spellId);
  return (norm?.runesRequired || []).slice() as Array<'BLOOD' | 'FROST' | 'UNHOLY'>;
}

export function hasReadyDkRunes(
  unit: Unit,
  required: Array<'BLOOD' | 'FROST' | 'UNHOLY'>
): boolean {
  if (!required.length) return true;
  ensureDkRunes(unit);
  const ready = (unit.runes || []).filter((r) => r.cooldownMs <= 0);
  const pool = ready.map((r) => r.runeType);
  for (const need of required) {
    const idx = pool.indexOf(need);
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return true;
}

/**
 * Spend runes (if any) and grant RP. Also grants Horn of Winter RP.
 * Returns false if runes insufficient.
 */
export function spendDkResourcesForSpell(
  engine: CombatEngine,
  unit: Unit,
  spellId: string,
  norm?: NormalizedSpell | null
): boolean {
  if (unit.classId !== 'DK') return true;
  ensureDkRunes(unit);
  const sp =
    norm ||
    getSpellByAnyId(spellId, unit.classId) ||
    getSpellByAnyId(spellId);
  const required = (sp?.runesRequired || []) as Array<'BLOOD' | 'FROST' | 'UNHOLY'>;
  if (required.length > 0) {
    if (!engine.resourceManager.consumeRunes(unit.id, required)) return false;
    engine.resourceManager.restore(unit.id, 'RUNIC_POWER', required.length * DK_RP_PER_RUNE);
  }
  const short = (sp?.shortId || spellId || '').toLowerCase();
  if (short.includes('horn_of_winter')) {
    engine.resourceManager.restore(unit.id, 'RUNIC_POWER', DK_HORN_RP_GAIN);
  }
  syncUnitResources(unit);
  return true;
}

/** UI mapping for PlayerUnitFrame (type + cdMs). */
export function dkRunesForHud(unit: Unit | null | undefined): Array<{ type: string; cdMs: number }> | undefined {
  if (!unit || unit.classId !== 'DK') return undefined;
  ensureDkRunes(unit);
  return (unit.runes || []).map((r) => ({
    type: r.runeType,
    cdMs: Math.max(0, Math.round(r.cooldownMs || 0)),
  }));
}

/**
 * Full DK cast resource deduct for AI / guest host path:
 * runes (+RP gen) / Horn RP, then RUNIC_POWER cost if any.
 */
export function deductDkSpellResources(
  engine: CombatEngine,
  unit: Unit,
  spellId: string,
  norm?: NormalizedSpell | null,
  rpCostOverride?: number
): boolean {
  if (unit.classId !== 'DK') return true;
  const sp =
    norm ||
    getSpellByAnyId(spellId, unit.classId) ||
    getSpellByAnyId(spellId);
  const required = (sp?.runesRequired || []) as Array<'BLOOD' | 'FROST' | 'UNHOLY'>;
  if (required.length > 0 && !hasReadyDkRunes(unit, required)) return false;

  const rpCost =
    sp?.resourceKind === 'RUNIC_POWER'
      ? (rpCostOverride ?? sp.resourceCostAmount)
      : 0;
  if (rpCost > 0 && (unit.runicPower ?? 0) < rpCost) return false;

  if (!spendDkResourcesForSpell(engine, unit, spellId, sp)) return false;
  if (rpCost > 0) {
    unit.runicPower = Math.max(0, (unit.runicPower ?? 0) - rpCost);
    syncUnitResources(unit);
  }
  return true;
}
