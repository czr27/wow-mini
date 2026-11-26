/**
 * Apply a CombatEffect onto the local CombatEngine once (caller handles idempotency).
 * Visual kinds also logCombatAction so onCombatAction → canvas hit FX / AoE pulses.
 * GROUND_PLACE / summons are receive-and-draw (not skill re-resolve).
 */
import type { AuraTag, CombatEffect, CombatEngine, Unit } from '@cata-raid-sim/engine';
import { withSuppressSummonReport } from './summonReport.js';

function unitAlive(u: Unit | undefined | null): boolean {
  return !!(u && (u.isAlive ?? u.alive) && u.hp > 0);
}

function guessGroundKind(
  spellId: string,
  hint?: CombatEffect['groundKind']
): 'TOTEM' | 'HEAL_ZONE' | 'DAMAGE_ZONE' | 'CONE_WARNING' {
  if (hint) return hint;
  const s = spellId.toLowerCase();
  if (s.includes('cone') || s.includes('barrage') || s.includes('扇')) return 'CONE_WARNING';
  if (s.includes('heal') || s.includes('rain') || s.includes('tide') || s.includes('lightwell')) {
    return s.includes('tide') || s.includes('totem') || s.includes('lightwell') || s.includes('spirit')
      ? 'TOTEM'
      : 'HEAL_ZONE';
  }
  if (s.includes('totem') || s.includes('well') || s.includes('spirit_link') || s.includes('windfury')) {
    return 'TOTEM';
  }
  return 'DAMAGE_ZONE';
}

function guessGroundColor(spellId: string, kind: string): string {
  if (kind === 'HEAL_ZONE' || kind === 'TOTEM') {
    const s = spellId.toLowerCase();
    if (s.includes('spirit') || s.includes('mana') || s.includes('wind')) return '#EAB308';
    return '#10B981';
  }
  if (spellId.toLowerCase().includes('blizzard')) return '#EF4444';
  return '#8B0000';
}

function resolveStackCount(
  current: number,
  maxStacks: number,
  b: { stacks?: number; stackDelta?: number }
): number {
  if (typeof b.stacks === 'number' && Number.isFinite(b.stacks)) {
    return Math.max(0, Math.min(maxStacks, Math.round(b.stacks)));
  }
  if (typeof b.stackDelta === 'number' && Number.isFinite(b.stackDelta)) {
    return Math.max(0, Math.min(maxStacks, current + Math.round(b.stackDelta)));
  }
  return Math.max(0, Math.min(maxStacks, current + 1));
}

function formatStackName(spellId: string, baseName: string | undefined, stacks: number): string {
  if (spellId === 'lifebloom') return `生命绽放 (${stacks}层)`;
  if (spellId === 'bone_shield') return `白骨之盾 (${stacks}层)`;
  const base = (baseName || spellId).replace(/\s*\(\d+层\)\s*$/, '');
  return stacks > 1 ? `${base} (${stacks}层)` : base;
}

/** APPLY_BUFF: absolute `stacks` preferred; else `stackDelta`; else +1. */
export function applyBuffFromEffect(
  engine: CombatEngine,
  target: Unit,
  effect: CombatEffect
): void {
  const b = effect.buff;
  if (!b) return;
  const duration = b.durationMs ?? b.remainingMs ?? 10000;
  const maxStacks = Math.max(1, b.maxStacks ?? (b.spellId === 'lifebloom' ? 3 : 1));
  const existing = target.buffs.find(
    (x) => x.spellId === b.spellId && x.sourceUnitId === effect.sourceId
  );
  const nextStacks = resolveStackCount(existing?.stacks ?? 0, maxStacks, b);
  if (nextStacks <= 0) {
    engine.auraManager.removeBuff(target, b.spellId, effect.sourceId);
    return;
  }
  const shared = b.spellId === 'lifebloom' || !!b.sharedTimer;
  if (existing) {
    existing.stacks = nextStacks;
    existing.maxStacks = maxStacks;
    existing.remainingMs = duration;
    existing.durationMs = duration;
    existing.name = formatStackName(b.spellId, b.name || existing.name, nextStacks);
    if (b.tickIntervalMs != null) existing.tickIntervalMs = b.tickIntervalMs;
    if (b.tickValue != null) existing.tickValue = b.tickValue;
    if (b.moveSpeedMod != null) existing.moveSpeedMod = b.moveSpeedMod;
    if (shared) delete existing.stackRemainingMs;
    return;
  }
  engine.applyBuff(target, {
    id: `${b.spellId}_${effect.effectId}`,
    spellId: b.spellId,
    name: formatStackName(b.spellId, b.name, nextStacks),
    kind: b.kind || 'BUFF',
    tags: (b.tags as AuraTag[]) || (shared ? ['HOT'] : []),
    sourceUnitId: effect.sourceId,
    targetUnitId: target.id,
    stacks: nextStacks,
    maxStacks,
    durationMs: duration,
    remainingMs: duration,
    school: (b.school as any) || (shared ? 'NATURE' : 'PHYSICAL'),
    tickIntervalMs: b.tickIntervalMs,
    tickValue: b.tickValue,
    moveSpeedMod: b.moveSpeedMod,
  });
  if (shared) {
    const just = target.buffs.find(
      (x) => x.spellId === b.spellId && x.sourceUnitId === effect.sourceId
    );
    if (just) {
      just.stacks = nextStacks;
      delete just.stackRemainingMs;
      just.name = formatStackName(b.spellId, b.name, nextStacks);
    }
  }
}

/** REMOVE_BUFF: full strip, or peel via stackDelta / set absolute stacks. */
export function removeBuffFromEffect(
  engine: CombatEngine,
  target: Unit,
  effect: CombatEffect
): void {
  const spellId = effect.removeSpellId || effect.spellId;
  const b = effect.buff;
  const existing = target.buffs.find(
    (x) => x.spellId === spellId && (!effect.sourceId || x.sourceUnitId === effect.sourceId)
  );
  if (!existing) {
    engine.auraManager.removeBuff(target, spellId, effect.sourceId);
    return;
  }
  // No stack hint → remove entire aura
  if (b?.stacks == null && b?.stackDelta == null) {
    engine.auraManager.removeBuff(target, spellId, effect.sourceId);
    return;
  }
  const maxStacks = existing.maxStacks || b?.maxStacks || existing.stacks || 1;
  const finalStacks = resolveStackCount(existing.stacks || 1, maxStacks, {
    stacks: b?.stacks,
    stackDelta: b?.stackDelta,
  });
  if (finalStacks <= 0) {
    engine.auraManager.removeBuff(target, spellId, effect.sourceId);
    return;
  }
  existing.stacks = finalStacks;
  existing.name = formatStackName(spellId, existing.name, finalStacks);
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
      if (
        effect.spellId === 'asphyxiate' ||
        effect.spellId === '窒息术' ||
        effect.spellName === '窒息术'
      ) {
        engine.drainHpTowardFloor(target, amt, 1, effect.spellName || '窒息术');
        return;
      }
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
      applyBuffFromEffect(engine, target, effect);
      return;
    }
    case 'REMOVE_BUFF': {
      if (!target) return;
      removeBuffFromEffect(engine, target, effect);
      return;
    }
    case 'TAUNT': {
      if (!target || !unitAlive(target) || !source) return;
      engine.threatManager.applyTaunt(target.id, source.id);
      engine.effectsManager?.addFloatingText({
        targetId: target.id,
        sourceId: source.id,
        text: `🛡️ ${effect.spellName || '嘲讽'}！`,
        category: 'CRIT',
        isCrit: true,
      });
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
      // 跑尸归来 amount=100 → 权威座位满状态（血蓝/资源）
      if ((effect.amount ?? 0) >= 100 || effect.spellId === 'corpse_run_rez') {
        engine.applyCorpseRunFullVitals(target.id);
      }
      return;
    }
    case 'INTERRUPT': {
      engine.interruptCast(effect.targetId, 0);
      engine.logCombatAction({
        actorId: effect.sourceId,
        spellId: effect.spellId,
        spellName: effect.spellName,
        kind: 'INTERRUPT',
        targetId: effect.targetId,
      });
      return;
    }
    case 'GROUND_PLACE': {
      const x = effect.x;
      const y = effect.y;
      const radius = effect.radius ?? 60;
      const id = effect.groundEffectId || `ground_${effect.effectId}`;
      if (
        engine.effectsManager &&
        typeof x === 'number' &&
        typeof y === 'number' &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        const exists = (engine.effectsManager.groundEffects || []).some((g) => g.id === id);
        if (!exists) {
          const groundKind = guessGroundKind(effect.spellId, effect.groundKind);
          // Suppress re-broadcast: we are drawing a received summon, not authoring one
          withSuppressSummonReport(() => {
            engine.effectsManager!.addGroundEffect({
              id,
              kind: groundKind,
              spellId: effect.spellId,
              ownerId: effect.sourceId,
              x,
              y,
              radius,
              colorHex: effect.colorHex || guessGroundColor(effect.spellId, groundKind),
              remainingMs: effect.remainingMs ?? 10_000,
              tickIntervalMs: effect.tickIntervalMs ?? 1000,
              tickElapsedMs: 0,
              tickValue: effect.tickValue ?? 0,
              facingRad: effect.facingRad,
              coneAngleRad: effect.coneAngleRad,
            } as any);
          });
        }
      }
      engine.logCombatAction({
        actorId: effect.sourceId,
        spellId: effect.spellId,
        spellName: effect.spellName,
        kind: 'GROUND_PLACE',
        targetId: effect.targetId,
        x: effect.x,
        y: effect.y,
        groundEffectId: id,
        radius: effect.radius,
        visualTone: effect.visualTone,
      });
      return;
    }
    case 'CAST_START':
    case 'CAST_LAND':
    case 'AOE_PULSE':
    case 'DISPEL':
    case 'SUMMON_SPAWN':
    case 'SUMMON_DESPAWN':
      // HUD / FX — canvas listens via engine.onCombatAction → cata_combat_actions
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
                : effect.kind === 'DISPEL'
                  ? 'DISPEL'
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
