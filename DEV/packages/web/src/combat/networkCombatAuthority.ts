/**
 * Session-scoped sharded combat authority helpers (host + guests).
 */
import type {
  CombatBatch,
  CombatEffect,
  CombatEngine,
  NetworkUnitSnapshot,
  OwnerSnapshot,
  Unit,
} from '@cata-raid-sim/engine';
import { applyCombatEffectToEngine } from './applyCombatEffect.js';
import {
  AppliedEffectRing,
  CombatEffectIdGen,
  EffectGatherQueue,
  consumeRemoteEffect,
  emitCombatEffect,
} from './combatEffectBus.js';
import { netClient } from '../net/NetClient.js';

export type CombatAuthorityContext = {
  localPlayerId: string | null;
  isNetworkHost: boolean;
  isNetworkGuest: boolean;
  activeRoomId: string | null;
  /** Unit ids this client simulates as authority (self + pets; host also AI/boss/maze). */
  isUnitLocalAuthority: (unitId: string) => boolean;
};

const idGen = new CombatEffectIdGen();
const applied = new AppliedEffectRing();
const gather = new EffectGatherQueue(200);

let ctx: CombatAuthorityContext = {
  localPlayerId: null,
  isNetworkHost: false,
  isNetworkGuest: false,
  activeRoomId: null,
  isUnitLocalAuthority: () => true,
};

export function beginCombatEffectEpoch(epochMs?: number) {
  idGen.beginEpoch(epochMs);
  applied.clear();
  gather.clear();
}

export function configureCombatAuthority(next: Partial<CombatAuthorityContext>) {
  ctx = { ...ctx, ...next };
}

export function getCombatAuthorityContext(): CombatAuthorityContext {
  return ctx;
}

export function resetCombatAuthority() {
  beginCombatEffectEpoch();
  ctx = {
    localPlayerId: null,
    isNetworkHost: false,
    isNetworkGuest: false,
    activeRoomId: null,
    isUnitLocalAuthority: () => true,
  };
}

function networkingActive(): boolean {
  return !!(ctx.activeRoomId && (ctx.isNetworkHost || ctx.isNetworkGuest) && netClient.connected);
}

function enqueueOrSend(effect: CombatEffect) {
  if (!networkingActive() || !ctx.activeRoomId) return;
  if (ctx.isNetworkHost) {
    gather.enqueueEffect(effect);
  } else {
    netClient.sendCombatEffect(ctx.activeRoomId, effect);
  }
}

/**
 * Publish an effect: local-authority targets apply immediately via applyCombatEffectToEngine;
 * always enqueue/send when networked.
 */
export function publishCombatEffect(
  engine: CombatEngine,
  partial: Omit<CombatEffect, 'effectId'> & { effectId?: string }
): CombatEffect | null {
  const ownerId = ctx.localPlayerId || partial.sourceId;
  if (!ownerId) return null;

  const applyLocal = (e: CombatEffect) => applyCombatEffectToEngine(engine, e);

  if (!networkingActive()) {
    const effectId = partial.effectId || idGen.next(ownerId);
    const effect: CombatEffect = { ...partial, effectId, atMs: partial.atMs ?? Date.now() };
    if (ctx.isUnitLocalAuthority(effect.targetId) && applied.mark(effectId)) {
      applyLocal(effect);
    }
    return effect;
  }

  return emitCombatEffect({
    partial,
    ownerId,
    idGen,
    applied,
    isLocalAuthority: ctx.isUnitLocalAuthority,
    applyLocal,
    send: enqueueOrSend,
  });
}

/**
 * Vital already applied via engine.healUnit/dealDamage — only assign effectId, mark, send.
 * Prevents double-apply and recursion through patched vitals.
 */
export function publishCombatEffectAlreadyApplied(
  partial: Omit<CombatEffect, 'effectId'> & { effectId?: string }
): CombatEffect | null {
  const ownerId = ctx.localPlayerId || partial.sourceId;
  if (!ownerId) return null;
  const effectId = partial.effectId || idGen.next(ownerId);
  const effect: CombatEffect = { ...partial, effectId, atMs: partial.atMs ?? Date.now() };
  applied.mark(effectId);
  enqueueOrSend(effect);
  return effect;
}

export type HostEffectHudHook = (effect: CombatEffect) => void;
let hostEffectHudHook: HostEffectHudHook | null = null;

export function setHostEffectHudHook(hook: HostEffectHudHook | null) {
  hostEffectHudHook = hook;
}

/** Host: ingest guest COMBAT_EFFECT into gather (+ apply if host authority). */
export function hostReceiveCombatEffect(engine: CombatEngine, effect: CombatEffect) {
  if (!effect?.effectId) return;
  gather.enqueueEffect(effect);
  // Immediate cast-bar HUD for guest casters (don't wait for 200ms batch)
  if (
    (effect.kind === 'CAST_START' ||
      effect.kind === 'CAST_LAND' ||
      effect.kind === 'INTERRUPT') &&
    effect.sourceId !== ctx.localPlayerId
  ) {
    hostEffectHudHook?.(effect);
  }
  if (ctx.isUnitLocalAuthority(effect.targetId)) {
    consumeRemoteEffect(effect, applied, (e) => applyCombatEffectToEngine(engine, e));
  } else {
    // Record so we don't re-apply if echoed in our own batch
    applied.mark(effect.effectId);
  }
}

export function hostReceiveOwnerSnapshot(snap: OwnerSnapshot) {
  gather.enqueueSnapshot(snap);
}

export function publishOwnerSnapshot(snap: OwnerSnapshot) {
  if (!networkingActive() || !ctx.activeRoomId) return;
  if (ctx.isNetworkHost) {
    gather.enqueueSnapshot(snap);
  } else {
    netClient.sendOwnerSnapshot(ctx.activeRoomId, snap);
  }
}

/** Host tick: flush gather → COMBAT_BATCH when due. */
export function hostFlushCombatBatch(
  roomId: string,
  world?: CombatBatch['world']
): CombatBatch | null {
  const flushed = gather.tryFlush(Date.now());
  if (!flushed) return null;
  if (flushed.effects.length === 0 && flushed.snapshots.length === 0 && !world) return null;
  const batch: Omit<CombatBatch, 'seq'> = {
    roomId,
    timeMs: Date.now(),
    effects: flushed.effects,
    snapshots: flushed.snapshots,
    world,
    ackedEffectIds: flushed.ackedEffectIds,
  };
  netClient.sendCombatBatch(batch);
  return batch as CombatBatch;
}

const CAST_HUD_KINDS = new Set([
  'CAST_START',
  'CAST_LAND',
  'INTERRUPT',
  'AOE_PULSE',
  'GROUND_PLACE',
  'SUMMON_SPAWN',
  'SUMMON_DESPAWN',
]);

/** Any client: unpack COMBAT_BATCH — apply effects we own; merge foreign owner snapshots. */
export function applyCombatBatch(
  engine: CombatEngine,
  batch: CombatBatch,
  opts?: {
    onHudEffect?: (e: CombatEffect) => void;
    mergeOwnerSnapshot?: (snap: OwnerSnapshot) => void;
  }
) {
  for (const effect of batch.effects || []) {
    const isCastHud =
      effect.kind === 'CAST_START' ||
      effect.kind === 'CAST_LAND' ||
      effect.kind === 'INTERRUPT';
    // Cast bars key off sourceId (caster), not target — always HUD-notify for remote casters
    if (isCastHud && effect.sourceId !== ctx.localPlayerId) {
      opts?.onHudEffect?.(effect);
    }

    if (ctx.isUnitLocalAuthority(effect.targetId)) {
      consumeRemoteEffect(effect, applied, (e) => applyCombatEffectToEngine(engine, e));
    } else if (CAST_HUD_KINDS.has(effect.kind)) {
      if (applied.mark(effect.effectId)) {
        if (!isCastHud) opts?.onHudEffect?.(effect);
        applyCombatEffectToEngine(engine, effect);
      }
    } else if (applied.mark(effect.effectId)) {
      opts?.onHudEffect?.(effect);
    }
  }
  for (const snap of batch.snapshots || []) {
    if (snap.ownerId === ctx.localPlayerId) continue; // never overwrite self from echo
    opts?.mergeOwnerSnapshot?.(snap);
  }
}

export function buildLocalOwnerSnapshot(
  engine: CombatEngine,
  ownerId: string,
  extras?: Partial<OwnerSnapshot>
): OwnerSnapshot {
  const all = engine.buildNetworkUnitSnapshots();
  const units = all.filter(
    (u) => u.id === ownerId || u.ownerId === ownerId || (u.isPet && u.ownerId === ownerId)
  );
  return {
    ownerId,
    timeMs: Date.now(),
    units,
    ...extras,
  };
}

export function mergeOwnerSnapshotUnits(engine: CombatEngine, snap: OwnerSnapshot) {
  if (snap.units?.length) {
    // Merge only units belonging to that owner (and their pets)
    const existing = engine.buildNetworkUnitSnapshots();
    const keep = existing.filter(
      (u) =>
        u.id !== snap.ownerId && u.ownerId !== snap.ownerId && !(u.isPet && u.ownerId === snap.ownerId)
    );
    const me = ctx.localPlayerId;
    const keptMine = me ? existing.filter((u) => u.id === me || u.ownerId === me) : [];
    const others = keep.filter((u) => u.id !== me && u.ownerId !== me);
    const merged: NetworkUnitSnapshot[] = [...others, ...keptMine, ...snap.units];
    const byId = new Map<string, NetworkUnitSnapshot>();
    for (const u of merged) byId.set(u.id, u);
    engine.applyNetworkUnitSnapshots([...byId.values()]);
  }
  // Replace that owner's ground/totem FX from snapshot
  if (snap.groundEffects && engine.effectsManager) {
    const kept = (engine.effectsManager.groundEffects || []).filter(
      (g) => g.ownerId !== snap.ownerId
    );
    engine.effectsManager.groundEffects = [
      ...kept,
      ...snap.groundEffects.map((g) => ({
        id: g.id,
        kind: g.kind,
        spellId: g.spellId,
        ownerId: g.ownerId,
        x: g.x,
        y: g.y,
        radius: g.radius,
        colorHex: g.colorHex,
        remainingMs: g.remainingMs,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      })),
    ] as any;
  }
}

/** Host authority helper: true for non-human-controlled units + local host player + host pets. */
export function makeHostAuthorityPredicate(
  engine: CombatEngine,
  hostPlayerId: string
): (unitId: string) => boolean {
  return (unitId: string) => {
    if (unitId === hostPlayerId) return true;
    const u = engine.getUnit(unitId);
    if (!u) {
      // Unknown id (boss stub etc.) — host owns world
      return true;
    }
    if (u.ownerId === hostPlayerId) return true;
    if (u.isHumanControlled && u.id !== hostPlayerId) return false;
    if (u.isPlayer && u.id !== hostPlayerId) return false;
    return true; // AI, boss, enemies, host pets
  };
}

export function makeGuestAuthorityPredicate(
  engine: CombatEngine,
  guestPlayerId: string
): (unitId: string) => boolean {
  return (unitId: string) => {
    if (unitId === guestPlayerId) return true;
    const u = engine.getUnit(unitId);
    if (!u) return false;
    return u.ownerId === guestPlayerId;
  };
}

export function listOwnedPetIds(engine: CombatEngine, ownerId: string): string[] {
  return engine
    .getAllUnits()
    .filter((u) => u.isPet && u.ownerId === ownerId)
    .map((u) => u.id);
}
