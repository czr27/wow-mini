import type { Buff, CombatEngine, Unit } from '@cata-raid-sim/engine';
import { isBloodlustSpellId, selectRaidBuffTargets } from '@cata-raid-sim/engine';

/** Cataclysm: lust 40s, then Exhaustion / Temporal Displacement 10min (shared). */
export const LUST_DURATION_MS = 40_000;
export const EXHAUSTION_DURATION_MS = 600_000;
export const EXHAUSTION_SPELL_ID = 'exhaustion';

/** Resolve lust aura id / display for bloodlust · heroism · time warp. */
export function resolveLustAura(spellId: string): {
  auraId: string;
  name: string;
  school: 'PHYSICAL' | 'ARCANE' | 'NATURE';
} | null {
  if (!isBloodlustSpellId(spellId)) return null;
  const id = (spellId || '').toLowerCase();
  if (id.includes('time_warp')) {
    return { auraId: 'time_warp', name: '时间扭曲 (+30%急速)', school: 'ARCANE' };
  }
  if (id.includes('bloodlust')) {
    return { auraId: 'bloodlust', name: '嗜血 (+30%急速)', school: 'NATURE' };
  }
  // shaman_heroism / heroism → show as 嗜血 with bloodlust icon key
  return { auraId: 'bloodlust', name: '嗜血 (+30%急速)', school: 'NATURE' };
}

export function unitHasExhaustion(u: Unit | null | undefined): boolean {
  if (!u) return false;
  return (u.buffs || []).some(
    (b) =>
      (b.remainingMs ?? 0) > 0 &&
      (b.spellId === EXHAUSTION_SPELL_ID ||
        b.spellId === 'temporal_displacement' ||
        (b.tags || []).includes('EXHAUSTION'))
  );
}

function makeExhaustionBuff(casterId: string, targetId: string): Buff {
  return {
    id: `exhaustion_${targetId}`,
    spellId: EXHAUSTION_SPELL_ID,
    name: '疲惫',
    kind: 'DEBUFF',
    tags: ['EXHAUSTION'],
    sourceUnitId: casterId,
    targetUnitId: targetId,
    stacks: 1,
    maxStacks: 1,
    durationMs: EXHAUSTION_DURATION_MS,
    remainingMs: EXHAUSTION_DURATION_MS,
    school: 'PHYSICAL',
  };
}

/**
 * Apply raid-wide BLOODLUST haste buff to living allies who are not Exhausted.
 * Each recipient also gets Exhaustion (10min) — blocks further lust / time warp.
 * Returns how many allies received the haste buff.
 */
export function applyRaidLustBuff(
  engine: CombatEngine,
  caster: Unit,
  spellId: string,
  durationMs = LUST_DURATION_MS
): number {
  const lust = resolveLustAura(spellId);
  if (!lust) return 0;
  const allies = selectRaidBuffTargets({
    spellId,
    allies: engine.friendlyUnits,
    caster,
    isRaidBuff: true,
  });
  let n = 0;
  for (const u of allies) {
    if (!(u.isAlive ?? u.alive) || u.hp <= 0) continue;
    if (unitHasExhaustion(u)) continue;
    engine.applyBuff(u, {
      id: `lust_${lust.auraId}_${u.id}`,
      spellId: lust.auraId,
      name: lust.name,
      kind: 'BUFF',
      tags: ['BLOODLUST', 'STAT'],
      sourceUnitId: caster.id,
      targetUnitId: u.id,
      stacks: 1,
      maxStacks: 1,
      durationMs,
      remainingMs: durationMs,
      school: lust.school,
    });
    engine.applyBuff(u, makeExhaustionBuff(caster.id, u.id));
    n++;
  }
  return n;
}
