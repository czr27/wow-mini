import type { CombatEngine, Unit } from '@cata-raid-sim/engine';
import { isBloodlustSpellId, selectRaidBuffTargets } from '@cata-raid-sim/engine';

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

/**
 * Apply raid-wide BLOODLUST haste buff to living allies.
 * Used by host resolve + guest optimistic UI (host snapshot reconciles).
 */
export function applyRaidLustBuff(
  engine: CombatEngine,
  caster: Unit,
  spellId: string,
  durationMs = 40_000
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
    n++;
  }
  return n;
}
