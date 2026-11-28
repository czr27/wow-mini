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
import { isPreservedUnit } from './applyWorldSnapshotPreserveAuth.js';
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

/** Owners cleared by leave/AI takeover — ignore late OWNER_SNAPSHOTs until next combat epoch. */
const purgedOwnerIds = new Set<string>();

export function beginCombatEffectEpoch(epochMs?: number) {
  idGen.beginEpoch(epochMs);
  applied.clear();
  gather.clear();
  purgedOwnerIds.clear();
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
  netClient.sendCombatEffect(ctx.activeRoomId, effect);
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

/**
 * Relay a vital/event for a foreign-authority target: send only, do not mark.
 * Author applies the delta when host batch (or peer live relay) echoes back.
 */
export function publishCombatEffectRelay(
  partial: Omit<CombatEffect, 'effectId'> & { effectId?: string }
): CombatEffect | null {
  const ownerId = ctx.localPlayerId || partial.sourceId;
  if (!ownerId) return null;
  const effectId = partial.effectId || idGen.next(ownerId);
  const effect: CombatEffect = { ...partial, effectId, atMs: partial.atMs ?? Date.now() };
  enqueueOrSend(effect);
  return effect;
}

/** After local-authority RESURRECT, push seat vitals so remotes do not wait for full world mirror. */
export function publishOwnerSnapshotForUnit(engine: CombatEngine, unitId: string): void {
  const ownerId = ctx.localPlayerId;
  if (!ownerId || !networkingActive()) return;
  if (!ctx.isUnitLocalAuthority(unitId)) return;
  publishOwnerSnapshot(buildLocalOwnerSnapshot(engine, ownerId));
}

export type HostEffectHudHook = (effect: CombatEffect) => void;
let hostEffectHudHook: HostEffectHudHook | null = null;

export function setHostEffectHudHook(hook: HostEffectHudHook | null) {
  hostEffectHudHook = hook;
}

const VITAL_DELTA_KINDS = new Set([
  'DAMAGE',
  'HEAL',
  'RESURRECT',
  'APPLY_BUFF',
  'REMOVE_BUFF',
  'RESOURCE',
  'KNOCKBACK',
]);

const CAST_HUD_KINDS = new Set([
  'CAST_START',
  'CAST_LAND',
  'INTERRUPT',
  'AOE_PULSE',
  'GROUND_PLACE',
  'SUMMON_SPAWN',
  'SUMMON_DESPAWN',
]);

/**
 * Shared ingest for one COMBAT_EFFECT (host live receive OR batch unpack).
 *
 * - Local-authority targets: apply (only authority “算”).
 * - Host + foreign vitals: do NOT apply — only gather/forward; splice others’ HP via OWNER_SNAPSHOT.
 * - Guests + foreign vitals: stack relayed deltas for display.
 * - HUD / ground / summon kinds: apply everywhere for FX.
 */
export function ingestCombatEffect(
  engine: CombatEngine,
  effect: CombatEffect,
  opts?: {
    onHudEffect?: (e: CombatEffect) => void;
    /** When true, also enqueue into host gather (guest→host live path). */
    enqueueGather?: boolean;
  }
): void {
  if (!effect?.effectId) return;
  if (opts?.enqueueGather) gather.enqueueEffect(effect);

  const isLocalSource = !!(effect.sourceId && ctx.isUnitLocalAuthority(effect.sourceId));
  const isLocalTarget = ctx.isUnitLocalAuthority(effect.targetId);

  // 0) 自己（及自己宝宝）发出给自己的效果当场已结算，广播包中一律忽略（含服务端新生成的 effectId）
  if (isLocalSource && isLocalTarget) {
    applied.mark(effect.effectId);
    return;
  }

  const isCastHud =
    effect.kind === 'CAST_START' ||
    effect.kind === 'CAST_LAND' ||
    effect.kind === 'INTERRUPT';
  if (isCastHud && !isLocalSource) {
    opts?.onHudEffect?.(effect);
  }

  const isVital = VITAL_DELTA_KINDS.has(effect.kind);
  const isHudVisual = CAST_HUD_KINDS.has(effect.kind);

  // 1) 自己和自己宝宝（本地权威）发生的特效已在本地直接消费，忽略 server 回包
  if (isHudVisual && isLocalSource) {
    applied.mark(effect.effectId);
    return;
  }

  // 2) 非本地权威目标（Boss/小怪/AI/其他玩家）的 DAMAGE/HEAL 跳字以 server COMBAT_STATE 为准，
  //    不在客户端重复结算或重复弹字；KNOCKBACK 也仅由目标所属权威端消费并上报新坐标。
  if (!isLocalTarget && (effect.kind === 'DAMAGE' || effect.kind === 'HEAL' || effect.kind === 'KNOCKBACK')) {
    applied.mark(effect.effectId);
    return;
  }

  // Server owns Boss/AI; all players (host & guest) apply local-authority vitals & remote FX/buffs

  if (isLocalTarget || isVital || isHudVisual) {
    const appliedNow = consumeRemoteEffect(effect, applied, (e) => {
      applyCombatEffectToEngine(engine, e);
      // Authority seat: after rez or knockback, push owner vitals/position immediately
      if ((e.kind === 'RESURRECT' || e.kind === 'KNOCKBACK') && ctx.isUnitLocalAuthority(e.targetId)) {
        publishOwnerSnapshotForUnit(engine, e.targetId);
      }
    });
    if (appliedNow && isHudVisual && !isCastHud && !isLocalTarget) {
      opts?.onHudEffect?.(effect);
    }
  } else if (applied.mark(effect.effectId)) {
    opts?.onHudEffect?.(effect);
  }
}

/** Host: gather guest EFFECT for batch fan-out; apply only host-authority seats. */
export function hostReceiveCombatEffect(engine: CombatEngine, effect: CombatEffect) {
  ingestCombatEffect(engine, effect, {
    enqueueGather: true,
    onHudEffect: (e) => hostEffectHudHook?.(e),
  });
}

export function hostReceiveOwnerSnapshot(snap: OwnerSnapshot) {
  if (!snap?.ownerId) return;
  // Late packets from a leaver must not revive their seat after AI takeover
  if (purgedOwnerIds.has(snap.ownerId) && !snap.purge) return;
  gather.enqueueSnapshot(snap);
}

/** Player left: drop their queued OWNER_SNAPSHOT / effects so AI takeover is clean. */
export function dropGatherOwnerTraces(ownerId: string) {
  if (!ownerId) return;
  gather.dropSnapshot(ownerId);
  gather.dropEffectsForOwner(ownerId);
  purgedOwnerIds.add(ownerId);
}

export function publishOwnerSnapshot(snap: OwnerSnapshot) {
  if (!networkingActive() || !ctx.activeRoomId) return;
  netClient.sendOwnerSnapshot(ctx.activeRoomId, snap);
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

/** Immediate fan-out (player leave purge + new AI seat). */
export function hostForceFlushCombatBatch(roomId: string): CombatBatch | null {
  if (!networkingActive() || !ctx.isNetworkHost) return null;
  const flushed = gather.forceFlush();
  if (!flushed) return null;
  if (flushed.effects.length === 0 && flushed.snapshots.length === 0) return null;
  const batch: Omit<CombatBatch, 'seq'> = {
    roomId,
    timeMs: Date.now(),
    effects: flushed.effects,
    snapshots: flushed.snapshots,
    ackedEffectIds: flushed.ackedEffectIds,
  };
  netClient.sendCombatBatch(batch);
  return batch as CombatBatch;
}

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
    ingestCombatEffect(engine, effect, { onHudEffect: opts?.onHudEffect });
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
  // Seat-local only (self + owned pets/summons). AI/boss/enemy belong in COMBAT_STATE
  // full mirror — stuffing them into OWNER_SNAPSHOT made merge prune peer humans.
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

function mergeSkillCounterMax(
  a?: Record<string, number>,
  b?: Record<string, number>
): Record<string, number> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, number> = { ...(a || {}) };
  if (b) {
    for (const [k, v] of Object.entries(b)) {
      out[k] = Math.max(out[k] || 0, v || 0);
    }
  }
  return out;
}

function mergeCombatStatsMonotonic(
  existing?: NetworkUnitSnapshot['combatStats'],
  incoming?: NetworkUnitSnapshot['combatStats']
): NetworkUnitSnapshot['combatStats'] {
  if (!existing) return incoming ? { ...incoming } : undefined;
  if (!incoming) return { ...existing };
  return {
    damageDealt: Math.max(existing.damageDealt || 0, incoming.damageDealt || 0),
    healingDone: Math.max(existing.healingDone || 0, incoming.healingDone || 0),
    overhealDone: Math.max(existing.overhealDone || 0, incoming.overhealDone || 0),
    damageTaken: Math.max(existing.damageTaken || 0, incoming.damageTaken || 0),
    interruptCount: Math.max(existing.interruptCount || 0, incoming.interruptCount || 0),
    skillDamage: mergeSkillCounterMax(existing.skillDamage, incoming.skillDamage),
    skillHealing: mergeSkillCounterMax(existing.skillHealing, incoming.skillHealing),
    skillDamageTaken: mergeSkillCounterMax(existing.skillDamageTaken, incoming.skillDamageTaken),
  };
}

export function mergeOwnerSnapshotUnits(engine: CombatEngine, snap: OwnerSnapshot) {
  const { isUnitLocalAuthority, localPlayerId } = ctx;

  // Explicit purge (player leave): erase owner seat + owned pets/ground even if units=[]
  if (snap.purge) {
    dropGatherOwnerTraces(snap.ownerId);
    const owned = engine
      .getAllUnits()
      .filter((u) => u.id === snap.ownerId || u.ownerId === snap.ownerId);
    for (const u of owned) engine.removeUnit(u.id);
    if (engine.effectsManager?.groundEffects) {
      engine.effectsManager.groundEffects = engine.effectsManager.groundEffects.filter(
        (g) => g.ownerId !== snap.ownerId
      );
    }
    return;
  }

  if (snap.units?.length) {
    const existing = engine.buildNetworkUnitSnapshots();
    // Self / pets / owned summons: always keep live local sim — never snapshot overwrite
    const preservedLocal = existing.filter((u) =>
      isPreservedUnit(u.id, u.ownerId, u.isPet, isUnitLocalAuthority, localPlayerId)
    );
    const preservedIds = new Set(preservedLocal.map((u) => u.id));

    const existingById = new Map(existing.map((u) => [u.id, u]));
    // Strip any local-authority seats from foreign owner payload (hp/buffs/pos/alive)
    const fromSnap = snap.units
      .filter((s) => !isPreservedUnit(s.id, s.ownerId, s.isPet, isUnitLocalAuthority, localPlayerId))
      .map((s) => {
        const prev = existingById.get(s.id);
        const mergedStats = mergeCombatStatsMonotonic(prev?.combatStats, s.combatStats);
        // Snap owner is always a human authority seat — never let flags drop to "AI"
        return s.id === snap.ownerId
          ? { ...s, isHumanControlled: true, isPlayer: s.id === localPlayerId, combatStats: mergedStats }
          : { ...s, combatStats: mergedStats };
      });
    const snapIds = new Set(fromSnap.map((u) => u.id));
    const rawSnapIds = new Set(snap.units.map((u) => u.id));

    const others = existing.filter((u) => {
      if (preservedIds.has(u.id)) return false;
      if (snapIds.has(u.id)) return false;

      // Snap owner seat omitted from payload → keep existing (do NOT treat as despawn).
      // This was wiping guests off the host roster/map while their EFFECTS still synced.
      if (u.id === snap.ownerId && !rawSnapIds.has(u.id)) return true;

      const isHumanSeat = !!(u.isHumanControlled || u.isPlayer);
      // Peer humans are never owned by this snap — always keep when not replaced
      if (isHumanSeat && !rawSnapIds.has(u.id)) return true;

      // Owner pets/summons omitted from snap → despawn
      if (
        u.id === snap.ownerId ||
        u.ownerId === snap.ownerId ||
        (u.isPet && u.ownerId === snap.ownerId)
      ) {
        return false;
      }
      if (rawSnapIds.has(u.id)) return false;
      return true;
    });

    const byId = new Map<string, NetworkUnitSnapshot>();
    for (const u of others) byId.set(u.id, u);
    for (const u of fromSnap) byId.set(u.id, u);
    // Preserved last so applyNetworkUnitSnapshots never sees foreign vitals for our seats
    for (const u of preservedLocal) byId.set(u.id, u);
    engine.applyNetworkUnitSnapshots([...byId.values()]);

    if (localPlayerId) {
      for (const u of engine.friendlyUnits) {
        const isMe = u.id === localPlayerId;
        u.isPlayer = isMe;
        if (isMe) u.isHumanControlled = true;
        // Keep other humans marked so ROOM_UPDATE / AI prune cannot eat them
        if (!isMe && u.id === snap.ownerId) u.isHumanControlled = true;
      }
    }
  }

  // Replace that owner's ground/totem FX — never touch local-authority FX
  if (snap.groundEffects && engine.effectsManager) {
    const kept = (engine.effectsManager.groundEffects || []).filter(
      (g) =>
        isUnitLocalAuthority(g.ownerId) ||
        (localPlayerId && g.ownerId === localPlayerId) ||
        g.ownerId !== snap.ownerId
    );
    const foreignGround = snap.groundEffects.filter(
      (g) =>
        !isUnitLocalAuthority(g.ownerId) &&
        !(localPlayerId && g.ownerId === localPlayerId)
    );
    engine.effectsManager.groundEffects = [
      ...kept,
      ...foreignGround.map((g) => ({
        id: g.id,
        kind: g.kind,
        spellId: g.spellId,
        ownerId: g.ownerId,
        x: g.x,
        y: g.y,
        radius: g.radius,
        colorHex: g.colorHex,
        remainingMs: g.remainingMs,
        tickIntervalMs: g.tickIntervalMs ?? 1000,
        tickElapsedMs: 0,
        tickValue: g.tickValue ?? 0,
        facingRad: g.facingRad,
        coneAngleRad: g.coneAngleRad,
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
    // Guest humans and anything they own (pets/totem units)
    if (u.isHumanControlled && u.id !== hostPlayerId) return false;
    if (u.isPlayer && u.id !== hostPlayerId) return false;
    // Pets/summons: only foreign if owner is another human — AI/boss pets stay host-world
    if (u.ownerId && u.ownerId !== hostPlayerId) {
      const owner = engine.getUnit(u.ownerId);
      if (owner && (owner.isHumanControlled || owner.isPlayer) && owner.id !== hostPlayerId) {
        return false;
      }
    }
    return true; // AI, boss, enemies, AI/boss summons, host pets
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

/**
 * V2 服务端唯一世界权威下：战斗内 Host 与 Guest 100% 平权，
 * 双方均仅对自己角色及自己召唤物/图腾拥有权威。
 */
export const makeServerAuthoritativePlayerPredicate = makeGuestAuthorityPredicate;

export function listOwnedPetIds(engine: CombatEngine, ownerId: string): string[] {
  return engine
    .getAllUnits()
    .filter((u) => u.isPet && u.ownerId === ownerId)
    .map((u) => u.id);
}
