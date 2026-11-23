import type { Unit } from '@cata-raid-sim/engine';

/**
 * Keep Unit.resources[] mirrored with convenience fields (mp / energy / rage / …)
 * used by HUD frames and cast checks.
 */
export function syncUnitResources(unit: Unit): void {
  if (!unit.resources) unit.resources = [];
  if (unit.maxMp && unit.maxMp > 0) {
    const mRes = unit.resources.find(r => r.kind === 'MANA');
    if (mRes) mRes.current = unit.mp ?? 0;
    else unit.resources.push({ kind: 'MANA', current: unit.mp ?? 0, max: unit.maxMp });
  }
  if (unit.classId === 'ROGUE') {
    const eRes = unit.resources.find(r => r.kind === 'ENERGY');
    if (eRes) eRes.current = unit.energy ?? 0;
    else unit.resources.push({ kind: 'ENERGY', current: unit.energy ?? 100, max: 100 });
  }
  if (unit.classId === 'WARRIOR' || (unit.classId === 'DRUID' && unit.role === 'TANK')) {
    const rRes = unit.resources.find(r => r.kind === 'RAGE');
    if (rRes) rRes.current = unit.rage ?? 0;
    else unit.resources.push({ kind: 'RAGE', current: unit.rage ?? 25, max: 100 });
  }
  if (unit.classId === 'HUNTER') {
    const fRes = unit.resources.find(r => r.kind === 'FOCUS');
    if (fRes) fRes.current = unit.focus ?? 100;
    else unit.resources.push({ kind: 'FOCUS', current: unit.focus ?? 100, max: 100 });
  }
  if (unit.classId === 'DK') {
    const rpRes = unit.resources.find(r => r.kind === 'RUNIC_POWER');
    if (rpRes) rpRes.current = unit.runicPower ?? 0;
    else unit.resources.push({ kind: 'RUNIC_POWER', current: unit.runicPower ?? 0, max: 100 });
  }
  if (unit.classId === 'PALADIN') {
    const hpRes = unit.resources.find(r => r.kind === 'HOLY_POWER');
    if (hpRes) hpRes.current = unit.holyPower ?? 0;
    else unit.resources.push({ kind: 'HOLY_POWER', current: unit.holyPower ?? 0, max: 3 });
  }
}

/**
 * Deduct an AI unit resource by kind. Returns false if insufficient.
 * Rune / combo / none costs are treated as free (return true).
 */
export function deductAiResource(
  unit: Unit,
  kind: string | undefined,
  amount: number
): boolean {
  if (!amount || amount <= 0 || !kind || kind === 'NONE' || kind === 'RUNE' || kind === 'COMBO_POINTS') {
    return true;
  }
  if (kind === 'MANA') {
    if ((unit.mp ?? 0) < amount) return false;
    unit.mp = Math.max(0, (unit.mp ?? 0) - amount);
  } else if (kind === 'ENERGY') {
    if ((unit.energy ?? 100) < amount) return false;
    unit.energy = Math.max(0, (unit.energy ?? 100) - amount);
  } else if (kind === 'RAGE') {
    if ((unit.rage ?? 0) < amount) return false;
    unit.rage = Math.max(0, (unit.rage ?? 0) - amount);
  } else if (kind === 'FOCUS') {
    if ((unit.focus ?? 100) < amount) return false;
    unit.focus = Math.max(0, (unit.focus ?? 100) - amount);
  } else if (kind === 'RUNIC_POWER') {
    if ((unit.runicPower ?? 0) < amount) return false;
    unit.runicPower = Math.max(0, (unit.runicPower ?? 0) - amount);
  } else if (kind === 'HOLY_POWER') {
    if ((unit.holyPower ?? 0) < amount) return false;
    unit.holyPower = Math.max(0, (unit.holyPower ?? 0) - amount);
  }
  syncUnitResources(unit);
  return true;
}
