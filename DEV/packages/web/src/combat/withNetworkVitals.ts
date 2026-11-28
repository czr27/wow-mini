/**
 * During local spell resolve under sharded authority, route heal/damage/buff/rez
 * through the effect bus. Local-authority targets keep engine apply; others
 * only emit EFFECT for the target authority (host must not overwrite their seats).
 *
 * Buff stacks: publish ABSOLUTE resulting stacks after local mutate so remotes
 * SET layers (not +1 per stale echo). stackDelta used for multi-peel removes.
 */
import {
  resolveCombatSkillDisplayName,
  SPELL_ID_TO_NAME,
  type CombatEngine,
  type Unit,
} from '@cata-raid-sim/engine';
import {
  getCombatAuthorityContext,
  publishCombatEffectAlreadyApplied,
  publishCombatEffectRelay,
  publishOwnerSnapshotForUnit,
} from './networkCombatAuthority.js';

function unitLooksAlive(u: Unit | undefined | null): boolean {
  return !!(u && (u.isAlive ?? u.alive) && u.hp > 0);
}

export function withNetworkVitals<T>(engine: CombatEngine, fn: () => T): T {
  const { isNetworkHost, isNetworkGuest, activeRoomId, isUnitLocalAuthority, localPlayerId } =
    getCombatAuthorityContext();
  if (!activeRoomId || (!isNetworkHost && !isNetworkGuest)) {
    return fn();
  }

  const origHeal = engine.healUnit.bind(engine);
  const origDamage = engine.dealDamage.bind(engine);
  const origApplyBuff = engine.applyBuff.bind(engine);
  const origRemoveBuff = engine.auraManager.removeBuff.bind(engine.auraManager);
  const origResurrect = engine.resurrectUnit.bind(engine);
  const origApplyTaunt = engine.threatManager.applyTaunt.bind(engine.threatManager);
  const origDrainHp = engine.drainHpTowardFloor.bind(engine);

  engine.healUnit = ((
    source: Unit,
    target: Unit,
    amount: number,
    isCrit?: boolean,
    spellName?: string
  ) => {
    const spellId = guessSpellId(spellName);
    const local = isUnitLocalAuthority(target.id);
    if (local) {
      origHeal(source, target, amount, isCrit, spellName);
    } else {
      if (isUnitLocalAuthority(source.id)) {
        const safeAmt = Math.max(0, Math.round(amount));
        const prevHp = Math.min(target.maxHp, Math.max(0, target.hp));
        const effectiveHeal = Math.max(0, Math.min(target.maxHp, prevHp + safeAmt) - prevHp);
        const overheal = Math.max(0, safeAmt - effectiveHeal);
        if (!source.combatStats) {
          source.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
        }
        source.combatStats.healingDone = (source.combatStats.healingDone || 0) + effectiveHeal;
        source.combatStats.overhealDone = (source.combatStats.overhealDone || 0) + overheal;
        if (!source.combatStats.skillHealing) source.combatStats.skillHealing = {};
        const disp = resolveCombatSkillDisplayName(spellName, '治疗术');
        source.combatStats.skillHealing[disp] = (source.combatStats.skillHealing[disp] || 0) + effectiveHeal;
      }
      // 非本地权威目标的跳字统一以 server 为准，本地不预弹跳字
    }
    const payload = {
      sourceId: source.id,
      targetId: target.id,
      spellId,
      spellName,
      kind: 'HEAL' as const,
      amount,
      isCrit: !!isCrit,
      visualTone: 'HEAL' as const,
    };
    // Foreign: relay without mark so we stack the host-relayed delta ourselves
    if (local) publishCombatEffectAlreadyApplied(payload);
    else publishCombatEffectRelay(payload);
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
    const local = isUnitLocalAuthority(target.id);
    if (local) {
      origDamage(source, target, amount, school, isCrit, spellName);
    } else {
      if (isUnitLocalAuthority(source.id)) {
        const safeAmt = Math.max(0, Math.round(amount));
        const effective = Math.min(Math.max(0, target.hp), safeAmt);
        if (!source.combatStats) {
          source.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
        }
        source.combatStats.damageDealt = (source.combatStats.damageDealt || 0) + effective;
        if (!source.combatStats.skillDamage) source.combatStats.skillDamage = {};
        const disp = resolveCombatSkillDisplayName(spellName, '普通攻击');
        source.combatStats.skillDamage[disp] = (source.combatStats.skillDamage[disp] || 0) + effective;
      }
      // 非本地权威目标的跳字统一以 server 为准，本地不预弹跳字
    }
    const payload = {
      sourceId: source.id,
      targetId: target.id,
      spellId,
      spellName,
      kind: 'DAMAGE' as const,
      amount,
      isCrit: !!isCrit,
      buff: school
        ? { spellId, name: spellName || spellId, school: String(school) }
        : undefined,
    };
    if (local) publishCombatEffectAlreadyApplied(payload);
    else publishCombatEffectRelay(payload);
  }) as CombatEngine['dealDamage'];

  engine.applyBuff = ((target: Unit, partial: any) => {
    const spellId = partial.spellId || 'buff';
    const sourceId = partial.sourceUnitId || localPlayerId || '';
    const before = target.buffs.find(
      (b) => b.spellId === spellId && b.sourceUnitId === sourceId
    );
    const beforeStacks = before?.stacks ?? 0;
    const localTarget = isUnitLocalAuthority(target.id);
    // Same spellId from different casters are separate (keyed by sourceUnitId).
    // Caster computes absolute stacks; trust that number — never let a third seat re-derive.
    const casterOwned = !!(localPlayerId && sourceId === localPlayerId);

    const applyAbsoluteLocal = () => {
      if (spellId === 'lifebloom') {
        const duration = partial.durationMs || 15000;
        const existing = before;
        if (existing) {
          const max = existing.maxStacks || partial.maxStacks || 3;
          if (typeof partial.stacks === 'number') {
            existing.stacks = Math.min(max, Math.max(1, Math.round(partial.stacks)));
          } else if (existing.stacks < max) {
            existing.stacks += 1;
          }
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
            stacks: partial.stacks ?? 1,
            maxStacks: partial.maxStacks || 3,
            tickIntervalMs: partial.tickIntervalMs || 2000,
            tickValue: partial.tickValue || 2400,
          });
          const just = target.buffs.find(
            (b) => b.spellId === 'lifebloom' && b.sourceUnitId === sourceId
          );
          if (just) delete just.stackRemainingMs;
        }
      } else if (typeof partial.stacks === 'number' && before) {
        const max = before.maxStacks || partial.maxStacks || 1;
        before.stacks = Math.min(max, Math.max(0, Math.round(partial.stacks)));
        before.maxStacks = max;
        if (partial.durationMs != null) {
          before.durationMs = partial.durationMs;
          before.remainingMs = partial.remainingMs ?? partial.durationMs;
        }
        if (partial.name) before.name = partial.name;
      } else {
        origApplyBuff(target, partial);
      }
    };

    // Local seat: real apply. Foreign seat: still mirror caster-owned buffs so the
    // next cast can read existing stacks (1→2→3); recipient authority re-applies
    // absolute stacks from relay and owns the real countdown via owner snap.
    if (localTarget || casterOwned) {
      applyAbsoluteLocal();
    }

    const after = target.buffs.find(
      (b) => b.spellId === spellId && b.sourceUnitId === sourceId
    );
    const absoluteStacks =
      (typeof partial.stacks === 'number' ? Math.round(partial.stacks) : undefined) ??
      after?.stacks ??
      Math.min(partial.maxStacks || 99, beforeStacks + 1);
    const maxStacks = after?.maxStacks ?? partial.maxStacks ?? (spellId === 'lifebloom' ? 3 : 1);

    const buffPayload = {
      sourceId,
      targetId: target.id,
      spellId,
      spellName: after?.name || partial.name,
      kind: 'APPLY_BUFF' as const,
      buff: {
        spellId,
        name: after?.name || partial.name || spellId,
        kind: partial.kind,
        tags: partial.tags,
        stacks: absoluteStacks,
        maxStacks,
        durationMs: after?.durationMs ?? partial.durationMs,
        remainingMs: after?.remainingMs ?? partial.remainingMs,
        school: partial.school,
        tickIntervalMs: after?.tickIntervalMs ?? partial.tickIntervalMs,
        tickValue: after?.tickValue ?? partial.tickValue,
        moveSpeedMod: after?.moveSpeedMod ?? partial.moveSpeedMod,
        sharedTimer: spellId === 'lifebloom',
      },
    };
    if (localTarget) publishCombatEffectAlreadyApplied(buffPayload);
    else publishCombatEffectRelay(buffPayload);
  }) as CombatEngine['applyBuff'];

  engine.auraManager.removeBuff = ((target: Unit, spellId: string, sourceId?: string) => {
    const existing = target.buffs.find(
      (b) => b.spellId === spellId && (!sourceId || b.sourceUnitId === sourceId)
    );
    // Must match AuraManager: missing buff → false. Returning true here used to
    // hang `while (removeBuff(...))` (lifebloom unique-target) as an infinite loop.
    if (!existing) return false;
    const beforeStacks = existing.stacks ?? 0;
    const local = isUnitLocalAuthority(target.id);
    // Always peel locally so while(removeBuff) terminates; foreign seats still
    // get a relay for the target authority (idempotent if they apply again).
    const ok = origRemoveBuff(target, spellId, sourceId);
    if (!ok) return false;
    const payload = {
      sourceId: sourceId || localPlayerId || '',
      targetId: target.id,
      spellId,
      kind: 'REMOVE_BUFF' as const,
      removeSpellId: spellId,
      buff:
        beforeStacks > 1
          ? { spellId, name: spellId, stacks: 0, stackDelta: -beforeStacks }
          : undefined,
    };
    if (local) publishCombatEffectAlreadyApplied(payload);
    else publishCombatEffectRelay(payload);
    return true;
  }) as typeof engine.auraManager.removeBuff;

  /**
   * Resurrect flow (no optimistic foreign mutate):
   * caster reports who+when → host relays → target authority applies HP →
   * authority owner-snap → host broadcasts. Foreign: relay without mark.
   */
  engine.resurrectUnit = ((unitId: string, hpFraction = 0.35, mpFraction = 0.35) => {
    const target = engine.getUnit(unitId);
    if (!target) return false;
    if (unitLooksAlive(target)) return false;

    const local = isUnitLocalAuthority(unitId);
    const fullVitals = hpFraction >= 1;
    let ok = false;
    if (local) {
      ok = origResurrect(unitId, hpFraction, mpFraction);
      if (ok && fullVitals) {
        engine.applyCorpseRunFullVitals(unitId);
      }
      if (ok) publishOwnerSnapshotForUnit(engine, unitId);
    } else {
      // Caster FX only — wait for relayed RESURRECT / owner vitals
      engine.effectsManager?.addFloatingText({
        targetId: unitId,
        sourceId: localPlayerId || '',
        text: fullVitals ? '跑尸归来' : '复活',
        category: 'HEAL',
        isCrit: true,
      });
      ok = true;
    }
    if (ok) {
      const payload = {
        sourceId: localPlayerId || '',
        targetId: unitId,
        spellId: fullVitals ? 'corpse_run_rez' : 'resurrect',
        spellName: fullVitals ? '跑尸归来' : '复活',
        kind: 'RESURRECT' as const,
        amount: Math.round(Math.min(1, Math.max(0.01, hpFraction)) * 100),
        visualTone: 'HEAL' as const,
        atMs: Date.now(),
      };
      if (local) publishCombatEffectAlreadyApplied(payload);
      else publishCombatEffectRelay(payload);
    }
    return ok;
  }) as CombatEngine['resurrectUnit'];

  engine.threatManager.applyTaunt = ((targetId: string, sourceId: string) => {
    const local = isUnitLocalAuthority(targetId);
    if (local) {
      origApplyTaunt(targetId, sourceId);
    }
    const payload = {
      sourceId,
      targetId,
      spellId: 'taunt',
      spellName: '嘲讽',
      kind: 'TAUNT' as const,
      atMs: Date.now(),
    };
    if (local) publishCombatEffectAlreadyApplied(payload);
    else publishCombatEffectRelay(payload);
  }) as typeof engine.threatManager.applyTaunt;

  engine.drainHpTowardFloor = ((
    target: Unit,
    amount: number,
    floorHp = 1,
    spellName = '窒息术'
  ) => {
    const local = isUnitLocalAuthority(target.id);
    if (local) {
      const drained = origDrainHp(target, amount, floorHp, spellName);
      if (drained > 0) {
        publishCombatEffectAlreadyApplied({
          sourceId: engine.bossUnit?.id || 'boss',
          targetId: target.id,
          spellId: 'asphyxiate',
          spellName,
          kind: 'DAMAGE',
          amount: drained,
          isCrit: false,
        });
      }
      return drained;
    }
    const drained = Math.min(Math.max(0, Math.round(amount)), Math.max(0, target.hp - floorHp));
    if (drained > 0) {
      publishCombatEffectRelay({
        sourceId: engine.bossUnit?.id || 'boss',
        targetId: target.id,
        spellId: 'asphyxiate',
        spellName,
        kind: 'DAMAGE',
        amount: drained,
        isCrit: false,
      });
    }
    return drained;
  }) as CombatEngine['drainHpTowardFloor'];

  try {
    return fn();
  } finally {
    engine.healUnit = origHeal;
    engine.dealDamage = origDamage;
    engine.applyBuff = origApplyBuff;
    engine.auraManager.removeBuff = origRemoveBuff;
    engine.resurrectUnit = origResurrect;
    engine.threatManager.applyTaunt = origApplyTaunt;
    engine.drainHpTowardFloor = origDrainHp;
  }
}

/** Publish a multi-stack peel without removing the whole aura (e.g. bone shield charges). */
export function publishBuffStackDelta(opts: {
  sourceId: string;
  targetId: string;
  spellId: string;
  spellName?: string;
  stackDelta: number;
  stacksAfter?: number;
  maxStacks?: number;
}): void {
  if (opts.stackDelta >= 0 && opts.stacksAfter == null) return;
  if (opts.stacksAfter != null && opts.stacksAfter > 0) {
    publishCombatEffectAlreadyApplied({
      sourceId: opts.sourceId,
      targetId: opts.targetId,
      spellId: opts.spellId,
      spellName: opts.spellName,
      kind: 'APPLY_BUFF',
      buff: {
        spellId: opts.spellId,
        name: opts.spellName || opts.spellId,
        stacks: opts.stacksAfter,
        maxStacks: opts.maxStacks,
        stackDelta: opts.stackDelta,
      },
    });
  } else {
    publishCombatEffectAlreadyApplied({
      sourceId: opts.sourceId,
      targetId: opts.targetId,
      spellId: opts.spellId,
      spellName: opts.spellName,
      kind: 'REMOVE_BUFF',
      removeSpellId: opts.spellId,
      buff: {
        spellId: opts.spellId,
        name: opts.spellName || opts.spellId,
        stacks: 0,
        stackDelta: opts.stackDelta,
        maxStacks: opts.maxStacks,
      },
    });
  }
}

const SPELL_NAME_TO_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [id, name] of Object.entries(SPELL_ID_TO_NAME)) {
    if (name && !map[name]) map[name] = id;
  }
  return map;
})();

function guessSpellId(spellName?: string): string {
  if (!spellName) return 'unknown';
  const trimmed = spellName.trim();
  const byName = SPELL_NAME_TO_ID[trimmed];
  if (byName) return byName;
  return (
    trimmed
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 48) || 'unknown'
  );
}
