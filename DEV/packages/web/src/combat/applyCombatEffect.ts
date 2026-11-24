/**
 * Apply a CombatEffect onto the local CombatEngine once (caller handles idempotency).
 */
import type { CombatEffect, CombatEngine, Unit } from '@cata-raid-sim/engine';

function unitAlive(u: Unit | undefined | null): boolean {
  return !!(u && (u.isAlive ?? u.alive) && u.hp > 0);
}

export function applyCombatEffectToEngine(
  engine: CombatEngine,
  effect: CombatEffect
): void {
  const target = engine.getUnit(effect.targetId);
  const source = engine.getUnit(effect.sourceId);

  switch (effect.kind) {
    case 'DAMAGE': {
      if (!target || !unitAlive(target)) return;
      const amt = Math.max(0, Math.round(effect.amount || 0));
      if (amt <= 0) return;
      if (source) {
        engine.dealDamage(
          source,
          target,
          amt,
          (effect.buff?.school as any) || 'PHYSICAL',
          !!effect.isCrit,
          effect.spellName || effect.spellId
        );
      } else {
        target.hp = Math.max(0, target.hp - amt);
        if (target.hp <= 0) {
          target.isAlive = false;
          target.alive = false;
        }
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          sourceId: effect.sourceId,
          text: String(amt),
          category: 'DAMAGE',
          isCrit: !!effect.isCrit,
        });
      }
      return;
    }
    case 'HEAL': {
      if (!target || !unitAlive(target)) return;
      const amt = Math.max(0, Math.round(effect.amount || 0));
      if (amt <= 0) return;
      if (source) {
        engine.healUnit(source, target, amt, !!effect.isCrit, effect.spellName || effect.spellId);
      } else {
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + amt);
        engine.effectsManager?.addFloatingText({
          targetId: target.id,
          sourceId: effect.sourceId,
          text: `+${target.hp - before}`,
          category: 'HEAL',
          isCrit: !!effect.isCrit,
        });
      }
      return;
    }
    case 'APPLY_BUFF': {
      if (!target || !effect.buff) return;
      const b = effect.buff;
      const duration = b.durationMs ?? b.remainingMs ?? 10000;
      const existing = target.buffs.find(
        (x) => x.spellId === b.spellId && x.sourceUnitId === effect.sourceId
      );
      if (b.spellId === 'lifebloom' || b.sharedTimer) {
        if (existing) {
          if ((existing.stacks || 1) < (b.maxStacks || existing.maxStacks || 3)) {
            existing.stacks = (existing.stacks || 1) + 1;
          } else if (b.stacks != null) {
            existing.stacks = Math.min(b.maxStacks || 3, b.stacks);
          }
          existing.remainingMs = duration;
          existing.durationMs = duration;
          delete existing.stackRemainingMs;
          existing.name =
            b.spellId === 'lifebloom'
              ? `生命绽放 (${existing.stacks}层)`
              : b.name || existing.name;
          if (b.tickIntervalMs != null) existing.tickIntervalMs = b.tickIntervalMs;
          if (b.tickValue != null) existing.tickValue = b.tickValue;
        } else {
          engine.applyBuff(target, {
            id: `${b.spellId}_${effect.effectId}`,
            spellId: b.spellId,
            name:
              b.spellId === 'lifebloom'
                ? `生命绽放 (${b.stacks ?? 1}层)`
                : b.name,
            kind: b.kind || 'BUFF',
            tags: b.tags || ['HOT'],
            sourceUnitId: effect.sourceId,
            targetUnitId: target.id,
            stacks: b.stacks ?? 1,
            maxStacks: b.maxStacks ?? 3,
            durationMs: duration,
            remainingMs: duration,
            school: (b.school as any) || 'NATURE',
            tickIntervalMs: b.tickIntervalMs,
            tickValue: b.tickValue,
          });
          const just = target.buffs.find(
            (x) => x.spellId === b.spellId && x.sourceUnitId === effect.sourceId
          );
          if (just) delete just.stackRemainingMs;
        }
        return;
      }
      engine.applyBuff(target, {
        id: `${b.spellId}_${effect.effectId}`,
        spellId: b.spellId,
        name: b.name,
        kind: b.kind || 'BUFF',
        tags: b.tags || [],
        sourceUnitId: effect.sourceId,
        targetUnitId: target.id,
        stacks: b.stacks ?? 1,
        maxStacks: b.maxStacks ?? 1,
        durationMs: duration,
        remainingMs: duration,
        school: (b.school as any) || 'PHYSICAL',
        tickIntervalMs: b.tickIntervalMs,
        tickValue: b.tickValue,
      });
      return;
    }
    case 'REMOVE_BUFF': {
      if (!target) return;
      const spellId = effect.removeSpellId || effect.spellId;
      engine.auraManager.removeBuff(target, spellId, effect.sourceId);
      return;
    }
    case 'RESOURCE': {
      if (!target) return;
      const delta = effect.resourceDelta ?? effect.amount ?? 0;
      const kind = (effect.resourceKind || 'MANA').toUpperCase();
      if (kind === 'MANA' && target.maxMp != null) {
        target.mp = Math.max(0, Math.min(target.maxMp, (target.mp ?? 0) + delta));
      } else if (kind === 'ENERGY') {
        target.energy = Math.max(0, Math.min(100, (target.energy ?? 0) + delta));
      } else if (kind === 'RAGE') {
        target.rage = Math.max(0, Math.min(100, (target.rage ?? 0) + delta));
      } else if (kind === 'FOCUS') {
        target.focus = Math.max(0, Math.min(100, (target.focus ?? 0) + delta));
      } else if (kind === 'RUNIC_POWER') {
        target.runicPower = Math.max(0, Math.min(100, (target.runicPower ?? 0) + delta));
      }
      return;
    }
    case 'RESURRECT': {
      if (!target) return;
      const hpFrac = Math.min(1, Math.max(0.01, (effect.amount ?? 50) / 100));
      engine.resurrectUnit(target.id, hpFrac, hpFrac);
      return;
    }
    case 'INTERRUPT': {
      engine.interruptCast(effect.targetId, 0);
      return;
    }
    case 'CAST_START':
    case 'CAST_LAND':
    case 'AOE_PULSE':
    case 'GROUND_PLACE':
    case 'DISPEL':
    case 'SUMMON_SPAWN':
    case 'SUMMON_DESPAWN':
      // HUD / FX / summon merge handled by callers via effect kind + OWNER_SNAPSHOT
      engine.logCombatAction({
        actorId: effect.sourceId,
        spellId: effect.spellId,
        spellName: effect.spellName,
        kind:
          effect.kind === 'CAST_START'
            ? 'CAST_START'
            : effect.kind === 'CAST_LAND'
              ? 'CAST_LAND'
              : effect.kind === 'SUMMON_SPAWN'
                ? 'SUMMON'
                : effect.kind === 'GROUND_PLACE'
                  ? 'GROUND_PLACE'
                  : effect.kind === 'INTERRUPT'
                    ? 'INTERRUPT'
                    : 'INSTANT',
        targetId: effect.targetId,
        x: effect.x,
        y: effect.y,
        spawnedUnitId: effect.spawnedUnitId,
        radius: effect.radius,
        aoePulse: effect.kind === 'AOE_PULSE',
        visualTone: effect.visualTone,
      });
      return;
    default:
      return;
  }
}
