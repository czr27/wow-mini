/**
 * Apply host/world unit snapshots without overwriting local-authority vitals.
 * Authority owners keep HP / resources / buffs / position from their own sim;
 * cross-authority changes arrive only as CombatEffect deltas (HEAL/DAMAGE/BUFF…).
 */
import type { CombatEngine, NetworkUnitSnapshot, Unit } from '@cata-raid-sim/engine';
import { getCombatAuthorityContext } from './networkCombatAuthority.js';

/** Local-authority seats (self / pets / owned summons) — never overwritten by any snapshot. */
export function isPreservedUnit(
  id: string,
  ownerId: string | undefined,
  isPet: boolean | undefined,
  isLocalAuthority: (unitId: string) => boolean,
  localPlayerId: string | null
): boolean {
  if (isLocalAuthority(id)) return true;
  if (ownerId && isLocalAuthority(ownerId)) return true;
  if (isPet && localPlayerId && ownerId === localPlayerId) return true;
  if (localPlayerId && id === localPlayerId) return true;
  return false;
}

/**
 * Merge host-authority world units while keeping local-authority seats intact.
 *
 * CRITICAL: must NOT drop other guests / their pets. Host full snaps are filtered to
 * host-authority only — using applyNetworkUnitSnapshots' prune would delete peer seats
 * every ~100ms and freeze/thrash combat.
 */
export function applyWorldSnapshotsPreservingAuthority(
  engine: CombatEngine,
  snapshots: NetworkUnitSnapshot[] | undefined | null
): void {
  if (!snapshots?.length) return;
  const { isUnitLocalAuthority, localPlayerId } = getCombatAuthorityContext();

  const existing = engine.buildNetworkUnitSnapshots();
  const preservedLocal = existing.filter((u) =>
    isPreservedUnit(u.id, u.ownerId, u.isPet, isUnitLocalAuthority, localPlayerId)
  );
  const preservedIds = new Set(preservedLocal.map((u) => u.id));

  const foreignFromSnap = snapshots.filter(
    (s) => !isPreservedUnit(s.id, s.ownerId, s.isPet, isUnitLocalAuthority, localPlayerId)
  );
  const foreignIds = new Set(foreignFromSnap.map((u) => u.id));
  const snapIds = new Set(snapshots.map((s) => s.id));

  // Keep peer humans / their pets that host snap intentionally omits
  const keepPeers = existing.filter((u) => {
    if (preservedIds.has(u.id) || foreignIds.has(u.id)) return false;
    // Host-world AI/boss/enemy vanished from snap → drop (despawn / remap)
    if (!snapIds.has(u.id) && !u.isHumanControlled && !u.isPlayer) {
      if (u.isPet && u.ownerId && u.ownerId !== localPlayerId) return true;
      return false;
    }
    return true;
  });

  const byId = new Map<string, NetworkUnitSnapshot>();
  for (const u of keepPeers) byId.set(u.id, u);
  for (const u of foreignFromSnap) byId.set(u.id, u);
  for (const u of preservedLocal) byId.set(u.id, u);

  engine.applyNetworkUnitSnapshots([...byId.values()]);

  if (localPlayerId) {
    for (const u of engine.friendlyUnits) {
      const isMe = u.id === localPlayerId;
      u.isPlayer = isMe;
      if (isMe) u.isHumanControlled = true;
    }
  }
}

function isLocalOwnedGround(
  ownerId: string,
  isUnitLocalAuthority: (id: string) => boolean,
  localPlayerId: string | null
): boolean {
  if (isUnitLocalAuthority(ownerId)) return true;
  if (localPlayerId && ownerId === localPlayerId) return true;
  return false;
}

/** Peer humans / their pets — host full snap omits these; must not wipe every 100ms. */
function isPeerHumanOwnedGround(
  ownerId: string,
  engine: CombatEngine,
  isUnitLocalAuthority: (id: string) => boolean,
  localPlayerId: string | null
): boolean {
  if (isLocalOwnedGround(ownerId, isUnitLocalAuthority, localPlayerId)) return false;
  const owner = engine.getUnit(ownerId);
  if (!owner) return false;
  if ((owner.isHumanControlled || owner.isPlayer) && owner.id !== localPlayerId) return true;
  if (owner.isPet && owner.ownerId && owner.ownerId !== localPlayerId) {
    const petOwner = engine.getUnit(owner.ownerId);
    if (petOwner && (petOwner.isHumanControlled || petOwner.isPlayer)) return true;
  }
  return false;
}

/**
 * Host full-mirror ground is authoritative for AI/boss/enemy/host FX (appear+despawn).
 * Keep local-authority + peer-human ground; replace the rest from the host list
 * (empty host list clears AI/monster rings that expired).
 */
export function mergeGroundEffectsPreservingAuthority(
  engine: CombatEngine,
  hostWorldGround: Array<{
    id: string;
    kind: string;
    spellId: string;
    ownerId: string;
    x: number;
    y: number;
    radius: number;
    colorHex: string;
    remainingMs: number;
    facingRad?: number;
    coneAngleRad?: number;
    tickIntervalMs?: number;
    tickValue?: number;
  }> | undefined | null,
  setGroundEffects: (fx: any[]) => void
): void {
  const { isUnitLocalAuthority, localPlayerId } = getCombatAuthorityContext();
  const existing = engine.effectsManager?.groundEffects || [];
  const keepMine = existing.filter((g) =>
    isLocalOwnedGround(g.ownerId, isUnitLocalAuthority, localPlayerId)
  );
  const keepPeers = existing.filter((g) =>
    isPeerHumanOwnedGround(g.ownerId, engine, isUnitLocalAuthority, localPlayerId)
  );
  // Host-world slice only (AI / boss / enemy / host) — never re-inject peer humans
  const fromHost = (hostWorldGround || []).filter(
    (g) =>
      !isLocalOwnedGround(g.ownerId, isUnitLocalAuthority, localPlayerId) &&
      !isPeerHumanOwnedGround(g.ownerId, engine, isUnitLocalAuthority, localPlayerId)
  );
  const merged = [
    ...keepMine,
    ...keepPeers,
    ...fromHost.map((g) => ({
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
  ];
  if (engine.effectsManager) {
    engine.effectsManager.groundEffects = merged as any;
  }
  setGroundEffects(merged as any);
}

/** Soft identity sync for preserved unit (name/class) without touching vitals. */
export function syncPreservedIdentityFromSnapshot(
  engine: CombatEngine,
  snapshots: NetworkUnitSnapshot[],
  myId: string | null,
  myChar?: { name?: string; classId?: string; lastSpec?: string } | null
): void {
  if (!myId) return;
  const snap = snapshots.find((s) => s.id === myId);
  const u = engine.getUnit(myId);
  if (!u) return;
  u.isPlayer = true;
  u.isHumanControlled = true;
  if (myChar) {
    u.name = myChar.name || u.name;
    u.classId = (myChar.classId as Unit['classId']) || u.classId;
    u.spec = myChar.lastSpec || u.spec;
  } else if (snap) {
    u.name = snap.name || u.name;
  }
  delete (u as { unitKind?: string }).unitKind;
}
