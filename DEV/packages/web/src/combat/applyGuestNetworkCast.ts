import type { CombatEngine, NormalizedSpell, Unit } from '@cata-raid-sim/engine';
import {
  classifySpellCastMode,
  getCastLifecyclePolicy,
  getEffectiveGcdMs,
  getHastedCastTimeMs,
  getSpellByAnyId,
  getUnitHaste,
  isTimedSummonSpellId,
  resolveCooldownSpellIds,
  resolveTimedSummonDef,
  spawnTimedSummons,
} from '@cata-raid-sim/engine';
import { executeAiNormalizedSpell, type AiActiveCast } from './aiCombatExecutor.js';
import { deductAiResource } from './unitResources.js';

function startGuestSpellCooldown(
  engine: CombatEngine,
  casterId: string,
  spellId: string,
  classId: Unit['classId'] | undefined,
  cooldownMs: number
): void {
  if (cooldownMs <= 0) return;
  for (const id of resolveCooldownSpellIds(spellId, classId)) {
    engine.cooldownManager.startSpellCooldownOnly(casterId, id, {
      id,
      cooldownMs,
    } as any);
  }
}

function isGuestSpellOnCooldown(
  engine: CombatEngine,
  casterId: string,
  spellId: string,
  classId: Unit['classId'] | undefined
): boolean {
  return resolveCooldownSpellIds(spellId, classId).some(
    (id) => !engine.cooldownManager.isSpellReady(casterId, id)
  );
}

export type GuestCastInput = {
  playerId: string;
  spellId: string;
  spellName?: string;
  targetId?: string | null;
  x?: number;
  y?: number;
};

/**
 * Host-side apply for a remote human CAST intent.
 * Production never fills engine.spellBook, so engine.castSpell always no-ops —
 * resolve via NormalizedSpell + executeAiNormalizedSpell (same path as AI).
 */
export function applyGuestNetworkCast(
  engine: CombatEngine,
  input: GuestCastInput,
  guestCasts: Record<string, AiActiveCast>
): { startedCast: boolean; resolvedInstant: boolean } {
  const caster = engine.getUnit(input.playerId);
  if (!caster || !(caster.isAlive ?? caster.alive) || caster.hp <= 0) {
    return { startedCast: false, resolvedInstant: false };
  }

  const norm =
    getSpellByAnyId(input.spellId, caster.classId) || getSpellByAnyId(input.spellId);

  if (!norm) {
    if (isTimedSummonSpellId(input.spellId)) {
      const pets = spawnTimedSummons(engine, caster, input.spellId, {
        x: typeof input.x === 'number' ? input.x : undefined,
        y: typeof input.y === 'number' ? input.y : undefined,
      });
      for (const pet of pets) {
        engine.logCombatAction({
          actorId: caster.id,
          spellId: input.spellId,
          spellName: input.spellName,
          kind: 'SUMMON',
          spawnedUnitId: pet.id,
          x: pet.position?.x,
          y: pet.position?.y,
          targetId: input.targetId ?? null,
        });
      }
      return { startedCast: false, resolvedInstant: pets.length > 0 };
    }
    return { startedCast: false, resolvedInstant: false };
  }

  // Gate BEFORE wiping in-flight cast — otherwise a late/retry CAST during GCD
  // cancelled the guest's active read-bar and the spell never landed.
  const gcdCat =
    norm.gcdCategory === 'OFF_GCD' ? 'OFF_GCD' : norm.gcdCategory === 'ROGUE' ? 'ROGUE' : 'NORMAL';
  if (gcdCat !== 'OFF_GCD' && !engine.cooldownManager.isGcdFree(caster.id)) {
    return { startedCast: false, resolvedInstant: false };
  }
  if (isGuestSpellOnCooldown(engine, caster.id, input.spellId, caster.classId)) {
    return { startedCast: false, resolvedInstant: false };
  }

  // Replace any in-flight read-bar for this human (only after gates pass)
  delete guestCasts[caster.id];
  engine.interruptCast(caster.id, 0);

  const target = resolveGuestCastTarget(engine, caster, norm, input.targetId);
  const livingEnemies = engine.enemyUnits.filter((e) => (e.isAlive ?? e.alive) && e.hp > 0);
  const boss = engine.bossUnit || livingEnemies[0];
  if (!target) return { startedCast: false, resolvedInstant: false };

  const castMode = classifySpellCastMode({
    spellId: input.spellId,
    castTimeMs: norm.castTimeMs,
    channelDurationMs: norm.channelDurationMs,
  });
  const lifecycle = getCastLifecyclePolicy(castMode);
  const haste = getUnitHaste(caster, 0);

  if (lifecycle.triggerGcdOnStart && gcdCat !== 'OFF_GCD') {
    engine.cooldownManager.startGcd(caster.id, getEffectiveGcdMs(gcdCat, haste));
  }

  const beginSpellCd = () => {
    startGuestSpellCooldown(engine, caster.id, input.spellId, caster.classId, norm.cooldownMs);
  };

  if (castMode === 'INSTANT') {
    if (lifecycle.deductResourceOnStart) {
      if (!deductAiResource(caster, norm.resourceKind, norm.resourceCostAmount)) {
        return { startedCast: false, resolvedInstant: false };
      }
    }
    if (lifecycle.triggerCooldownOnStart) beginSpellCd();

    executeAiNormalizedSpell(engine, livingEnemies, boss || caster, caster, norm, target, 1, 0, false);
    engine.logCombatAction({
      actorId: caster.id,
      spellId: input.spellId,
      spellName: input.spellName || norm.name,
      kind: 'INSTANT',
      targetId: target.id,
    });
    ensureTimedSummon(engine, caster, input, norm, target.id);
    return { startedCast: false, resolvedInstant: true };
  }

  if (castMode === 'CHANNELED') {
    if (lifecycle.deductResourceOnStart) {
      if (!deductAiResource(caster, norm.resourceKind, norm.resourceCostAmount)) {
        return { startedCast: false, resolvedInstant: false };
      }
    }
    if (lifecycle.triggerCooldownOnStart) beginSpellCd();

    // Channel: resolve ticks/effects on start (matches engine lifecycle); bar is cosmetic sync
    executeAiNormalizedSpell(engine, livingEnemies, boss || caster, caster, norm, target, 1, 0, false);
    const channelMs = getHastedCastTimeMs(
      norm.channelDurationMs > 0 ? norm.channelDurationMs : norm.castTimeMs || 4000,
      haste
    );
    guestCasts[caster.id] = buildGuestActiveCast(input, norm, target, channelMs, true);
    engine.logCombatAction({
      actorId: caster.id,
      spellId: input.spellId,
      spellName: input.spellName || norm.name,
      kind: 'CAST_START',
      targetId: target.id,
    });
    return { startedCast: true, resolvedInstant: true };
  }

  // CASTED: start bar; resolve on completion (tickGuestNetworkCasts)
  const castMs = getHastedCastTimeMs(Math.max(1, norm.castTimeMs), haste);
  guestCasts[caster.id] = buildGuestActiveCast(input, norm, target, castMs, false);
  engine.logCombatAction({
    actorId: caster.id,
    spellId: input.spellId,
    spellName: input.spellName || norm.name,
    kind: 'CAST_START',
    targetId: target.id,
  });
  return { startedCast: true, resolvedInstant: false };
}

/** Advance remote-human cast bars; resolve CASTED spells on completion. */
export function tickGuestNetworkCasts(
  engine: CombatEngine,
  guestCasts: Record<string, AiActiveCast>,
  deltaMs: number
): void {
  const livingEnemies = engine.enemyUnits.filter((e) => (e.isAlive ?? e.alive) && e.hp > 0);
  const boss = engine.bossUnit || livingEnemies[0];

  for (const [unitId, cast] of Object.entries(guestCasts)) {
    const unit = engine.getUnit(unitId);
    // Remote-human cast bars live here. Skip the local host seat (playerCastRef).
    // Do not require isHumanControlled: some snapshots briefly omit the flag and
    // would freeze CASTED spells forever while instants/channels still worked.
    if (!unit || unit.isPlayer) continue;
    if (!(unit.isAlive ?? unit.alive) || unit.hp <= 0) {
      delete guestCasts[unitId];
      continue;
    }

    cast.elapsedMs += deltaMs;
    if (cast.elapsedMs < cast.totalMs) continue;

    delete guestCasts[unitId];
    // Channels already resolved on start — bar only
    if (cast.isChannel) continue;

    const sp = cast.normalizedSpell || getSpellByAnyId(cast.spellId, unit.classId);
    if (!sp) continue;

    const target =
      engine.getUnit(cast.targetId) ||
      (cast.isHarmful ? boss : unit);
    if (!target || (!(target.isAlive ?? target.alive) && !sp.isResurrect)) continue;

    if (!deductAiResource(unit, cast.resourceKind || sp.resourceKind, cast.manaCost || sp.resourceCostAmount)) {
      continue;
    }
    if (sp.cooldownMs > 0) {
      startGuestSpellCooldown(engine, unit.id, cast.spellId, unit.classId, sp.cooldownMs);
    }

    executeAiNormalizedSpell(
      engine,
      livingEnemies,
      boss || unit,
      unit,
      sp,
      target,
      1,
      0,
      false
    );
    engine.logCombatAction({
      actorId: unit.id,
      spellId: cast.spellId,
      spellName: cast.spellName,
      kind: 'CAST_LAND',
      targetId: target.id,
    });
  }
}

export function clearGuestNetworkCast(
  guestCasts: Record<string, AiActiveCast>,
  engine: CombatEngine,
  playerId: string
): boolean {
  const hadBar = !!guestCasts[playerId];
  delete guestCasts[playerId];
  const interrupted = engine.interruptCast(playerId, 0);
  return hadBar || interrupted;
}

function buildGuestActiveCast(
  input: GuestCastInput,
  norm: NormalizedSpell,
  target: Unit,
  totalMs: number,
  isChannel: boolean
): AiActiveCast {
  return {
    targetId: target.id,
    spellId: input.spellId,
    spellName: input.spellName || norm.name,
    amount: Math.round(norm.directHeal || norm.directDamage || 0),
    baseAmt: Math.round(norm.directHeal || norm.directDamage || 0),
    manaCost: norm.resourceCostAmount,
    resourceKind: norm.resourceKind,
    totalMs,
    elapsedMs: 0,
    isHarmful: !!(norm.isDamage || norm.isDot) && !norm.isHeal,
    normalizedSpell: norm,
    isChannel,
  };
}

export function resolveGuestCastTarget(
  engine: CombatEngine,
  caster: Unit,
  norm: NormalizedSpell,
  targetId?: string | null
): Unit | null {
  if (norm.targetType === 'SELF') return caster;

  const wantsFriend =
    norm.isHeal ||
    norm.isHot ||
    norm.isShield ||
    norm.isBuff ||
    norm.isResurrect ||
    norm.isDispel ||
    norm.targetType === 'SINGLE_ALLY' ||
    norm.targetType === 'SMART_ALLY' ||
    norm.targetType === 'AOE_ALLY';

  if (targetId) {
    const explicit = engine.getUnit(targetId);
    if (explicit) {
      const isEnemy =
        !!engine.enemyUnits.find((e) => e.id === explicit.id) ||
        engine.bossUnit?.id === explicit.id;
      // Ignore boss/enemy ids for ally spells (stale guest selection / bossTargetId leak)
      if (wantsFriend && isEnemy) {
        // fall through to ally fallback
      } else if (!wantsFriend && !isEnemy) {
        // Friendly unit selected for harm spell — fall through to boss/enemy
      } else {
        return explicit;
      }
    }
  }

  if (wantsFriend) {
    const allies = engine.friendlyUnits.filter((a) => (a.isAlive ?? a.alive) && a.hp > 0);
    return allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] || caster;
  }

  return engine.bossUnit || engine.enemyUnits.find((e) => (e.isAlive ?? e.alive) && e.hp > 0) || null;
}

function ensureTimedSummon(
  engine: CombatEngine,
  caster: Unit,
  input: GuestCastInput,
  norm: NormalizedSpell,
  targetId: string
): void {
  const summonDef = resolveTimedSummonDef(input.spellId) || resolveTimedSummonDef(norm.id);
  if (!summonDef) return;
  const hasPet = engine
    .getAllUnits()
    .some(
      (u) =>
        u.isPet &&
        u.ownerId === caster.id &&
        u.summonSpellId === summonDef.spellId &&
        u.despawnAtElapsedMs != null
    );
  if (hasPet) return;
  const pets = spawnTimedSummons(engine, caster, summonDef.spellId);
  for (const pet of pets) {
    engine.logCombatAction({
      actorId: caster.id,
      spellId: summonDef.spellId,
      spellName: input.spellName || norm.name,
      kind: 'SUMMON',
      spawnedUnitId: pet.id,
      x: pet.position?.x,
      y: pet.position?.y,
      targetId,
    });
  }
}
