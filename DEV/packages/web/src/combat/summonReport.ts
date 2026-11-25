/**
 * Summon reporting: ground rings / totems / pets are published as spawn payloads.
 * Remotes DRAW what they receive — they must not re-resolve skills to place visuals.
 *
 * - Local authority addGroundEffect → GROUND_PLACE (alreadyApplied)
 * - Local pet/add spawn → SUMMON_SPAWN + owner snapshot units
 * - Remote apply uses withSuppressSummonReport so echo does not re-broadcast
 */
import type { CombatEngine, GroundEffect, Unit } from '@cata-raid-sim/engine';
import {
  buildLocalOwnerSnapshot,
  getCombatAuthorityContext,
  publishCombatEffectAlreadyApplied,
  publishOwnerSnapshot,
} from './networkCombatAuthority.js';

let suppressReport = 0;
let hookedEngine: CombatEngine | null = null;
let origAddGround: ((effect: any) => GroundEffect) | null = null;

export function withSuppressSummonReport<T>(fn: () => T): T {
  suppressReport += 1;
  try {
    return fn();
  } finally {
    suppressReport -= 1;
  }
}

function networkingReady(): boolean {
  const c = getCombatAuthorityContext();
  return !!(c.activeRoomId && (c.isNetworkHost || c.isNetworkGuest));
}

/** Wire DTO for ground/totem summons — one shape for OWNER_SNAPSHOT + COMBAT_STATE. */
export function serializeGroundEffectWire(g: GroundEffect) {
  return {
    id: g.id,
    kind: g.kind,
    spellId: g.spellId,
    ownerId: g.ownerId,
    x: g.x,
    y: g.y,
    radius: g.radius,
    colorHex: g.colorHex,
    remainingMs: g.remainingMs,
    facingRad: (g as any).facingRad as number | undefined,
    coneAngleRad: (g as any).coneAngleRad as number | undefined,
    tickIntervalMs: g.tickIntervalMs,
    tickValue: g.tickValue,
  };
}

/** Publish a ground / totem / puddle as a summon (GROUND_PLACE). */
export function reportGroundSummon(ge: GroundEffect, spellName?: string): void {
  if (suppressReport > 0 || !networkingReady() || !ge?.id) return;
  publishCombatEffectAlreadyApplied({
    sourceId: ge.ownerId,
    targetId: ge.ownerId,
    spellId: ge.spellId,
    spellName: spellName || ge.spellId,
    kind: 'GROUND_PLACE',
    x: ge.x,
    y: ge.y,
    radius: ge.radius,
    groundEffectId: ge.id,
    groundKind: ge.kind,
    colorHex: ge.colorHex,
    remainingMs: ge.remainingMs,
    tickIntervalMs: ge.tickIntervalMs,
    tickValue: ge.tickValue,
    facingRad: (ge as any).facingRad,
    coneAngleRad: (ge as any).coneAngleRad,
    visualTone:
      ge.kind === 'DAMAGE_ZONE' || ge.kind === 'CONE_WARNING'
        ? 'ENEMY'
        : ge.kind === 'HEAL_ZONE'
          ? 'HEAL'
          : 'FRIENDLY',
  });
}

/** Publish a pet / add / timed summon unit. */
export function reportUnitSummon(opts: {
  engine: CombatEngine;
  owner: Unit;
  pet: Unit;
  spellId: string;
  spellName?: string;
}): void {
  if (suppressReport > 0 || !networkingReady()) return;
  const { engine, owner, pet, spellId, spellName } = opts;
  publishCombatEffectAlreadyApplied({
    sourceId: owner.id,
    targetId: owner.id,
    spellId,
    spellName: spellName || spellId,
    kind: 'SUMMON_SPAWN',
    spawnedUnitId: pet.id,
    x: pet.position?.x,
    y: pet.position?.y,
  });
  // Immediate owner slice so remotes can merge the unit body (not wait ~200ms)
  publishOwnerSnapshot(
    buildLocalOwnerSnapshot(engine, owner.id, {
      groundEffects: (engine.effectsManager?.groundEffects || [])
        .filter((g) => g.ownerId === owner.id)
        .map(serializeGroundEffectWire),
    })
  );
}

export function reportUnitDespawn(opts: {
  ownerId: string;
  unitId: string;
  spellId?: string;
}): void {
  if (suppressReport > 0 || !networkingReady()) return;
  publishCombatEffectAlreadyApplied({
    sourceId: opts.ownerId,
    targetId: opts.ownerId,
    spellId: opts.spellId || 'despawn',
    kind: 'SUMMON_DESPAWN',
    spawnedUnitId: opts.unitId,
  });
}

/**
 * Hook engine.effectsManager.addGroundEffect so boss/AI/player places auto-report.
 * Safe to call multiple times for the same engine.
 */
export function installSummonReporters(engine: CombatEngine): void {
  const em = engine.effectsManager;
  if (!em) return;
  if (hookedEngine === engine && origAddGround) return;

  // Restore previous engine if any
  uninstallSummonReporters();

  origAddGround = em.addGroundEffect.bind(em);
  hookedEngine = engine;
  em.addGroundEffect = ((partial: any) => {
    const ge = origAddGround!(partial);
    reportGroundSummon(ge);
    return ge;
  }) as typeof em.addGroundEffect;
}

export function uninstallSummonReporters(): void {
  if (hookedEngine?.effectsManager && origAddGround) {
    hookedEngine.effectsManager.addGroundEffect = origAddGround;
  }
  hookedEngine = null;
  origAddGround = null;
}
