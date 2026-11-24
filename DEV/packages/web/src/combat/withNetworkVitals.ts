/**
 * During local spell resolve under sharded authority, route heal/damage/buff
 * through the effect bus. Local-authority targets keep engine apply; others
 * only emit EFFECT for the target authority.
 */
import type { CombatEngine, Unit } from '@cata-raid-sim/engine';
import {
  getCombatAuthorityContext,
  publishCombatEffectAlreadyApplied,
} from './networkCombatAuthority.js';

export function withNetworkVitals<T>(engine: CombatEngine, fn: () => T): T {
  const { isNetworkHost, isNetworkGuest, activeRoomId, isUnitLocalAuthority, localPlayerId } =
    getCombatAuthorityContext();
  if (!activeRoomId || (!isNetworkHost && !isNetworkGuest)) {
    return fn();
  }

  const origHeal = engine.healUnit.bind(engine);
  const origDamage = engine.dealDamage.bind(engine);
  const origApplyBuff = engine.applyBuff.bind(engine);

  engine.healUnit = ((
    source: Unit,
    target: Unit,
    amount: number,
    isCrit?: boolean,
    spellName?: string
  ) => {
    const spellId = guessSpellId(spellName);
    if (isUnitLocalAuthority(target.id)) {
      origHeal(source, target, amount, isCrit, spellName);
    } else {
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        sourceId: source.id,
        text: `+${Math.round(amount)}`,
        category: 'HEAL',
        isCrit: !!isCrit,
      });
    }
    publishCombatEffectAlreadyApplied({
      sourceId: source.id,
      targetId: target.id,
      spellId,
      spellName,
      kind: 'HEAL',
      amount,
      isCrit: !!isCrit,
      visualTone: 'HEAL',
    });
  }) as CombatEngine['healUnit'];

  engine.dealDamage = ((
    source: Unit,
    target: Unit,
    amount: number,
    school?: any,
    isCrit?: boolean,
    spellName?: string
  ) => {
    const spellId = guessSpellId(spellName);
    if (isUnitLocalAuthority(target.id)) {
      origDamage(source, target, amount, school, isCrit, spellName);
    } else {
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        sourceId: source.id,
        text: String(Math.round(amount)),
        category: 'DAMAGE',
        isCrit: !!isCrit,
      });
    }
    publishCombatEffectAlreadyApplied({
      sourceId: source.id,
      targetId: target.id,
      spellId,
      spellName,
      kind: 'DAMAGE',
      amount,
      isCrit: !!isCrit,
      buff: school
        ? { spellId, name: spellName || spellId, school: String(school) }
        : undefined,
    });
  }) as CombatEngine['dealDamage'];

  engine.applyBuff = ((target: Unit, partial: any) => {
    const spellId = partial.spellId || 'buff';
    const sourceId = partial.sourceUnitId || localPlayerId || '';
    if (isUnitLocalAuthority(target.id)) {
      if (spellId === 'lifebloom') {
        const existing = target.buffs.find(
          (b) => b.spellId === 'lifebloom' && b.sourceUnitId === sourceId
        );
        const duration = partial.durationMs || 15000;
        if (existing) {
          if (existing.stacks < (existing.maxStacks || 3)) existing.stacks += 1;
          existing.remainingMs = duration;
          existing.durationMs = duration;
          delete existing.stackRemainingMs;
          existing.name = `生命绽放 (${existing.stacks}层)`;
          if (partial.tickIntervalMs != null) existing.tickIntervalMs = partial.tickIntervalMs;
          if (partial.tickValue != null) existing.tickValue = partial.tickValue;
        } else {
          origApplyBuff(target, {
            ...partial,
            durationMs: duration,
            remainingMs: duration,
            maxStacks: partial.maxStacks || 3,
            tickIntervalMs: partial.tickIntervalMs || 2000,
            tickValue: partial.tickValue || 2400,
          });
          const just = target.buffs.find(
            (b) => b.spellId === 'lifebloom' && b.sourceUnitId === sourceId
          );
          if (just) delete just.stackRemainingMs;
        }
      } else {
        origApplyBuff(target, partial);
      }
    }
    publishCombatEffectAlreadyApplied({
      sourceId,
      targetId: target.id,
      spellId,
      spellName: partial.name,
      kind: 'APPLY_BUFF',
      buff: {
        spellId,
        name: partial.name || spellId,
        kind: partial.kind,
        tags: partial.tags,
        stacks: partial.stacks,
        maxStacks: partial.maxStacks,
        durationMs: partial.durationMs,
        remainingMs: partial.remainingMs,
        school: partial.school,
        tickIntervalMs: partial.tickIntervalMs,
        tickValue: partial.tickValue,
        sharedTimer: spellId === 'lifebloom',
      },
    });
  }) as CombatEngine['applyBuff'];

  try {
    return fn();
  } finally {
    engine.healUnit = origHeal;
    engine.dealDamage = origDamage;
    engine.applyBuff = origApplyBuff;
  }
}

function guessSpellId(spellName?: string): string {
  if (!spellName) return 'unknown';
  return (
    spellName
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 48) || 'unknown'
  );
}
