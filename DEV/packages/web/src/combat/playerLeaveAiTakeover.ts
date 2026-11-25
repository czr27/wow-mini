/**
 * Host-authoritative player leave → AI seat:
 * 1) wipe leaver pets/ground/buffs + gather snaps
 * 2) remap or spawn AI
 * 3) host publishes AI seat mirror for peers
 */
import type {
  ClassId,
  CombatEngine,
  LobbyRoom,
  RoleId,
  Unit,
} from '@cata-raid-sim/engine';
import { createLevel80BaseStats } from '@cata-raid-sim/engine';
import { clearOwnerCombatSpawns } from './clearOwnerCombatSpawns.js';
import {
  buildLocalOwnerSnapshot,
  dropGatherOwnerTraces,
  getCombatAuthorityContext,
  hostForceFlushCombatBatch,
  publishOwnerSnapshot,
} from './networkCombatAuthority.js';

export type ReplaceAiMemberMeta = {
  id: string;
  name: string;
  classId: ClassId;
  spec: string;
  role: RoleId;
};

function stripLeaverAuraTraces(engine: CombatEngine, leaverId: string): void {
  for (const u of engine.getAllUnits()) {
    if (!u.buffs?.length) continue;
    u.buffs = u.buffs.filter((b) => b.sourceUnitId !== leaverId);
  }
}

function ensureAiUnit(
  engine: CombatEngine,
  playerId: string,
  ai: ReplaceAiMemberMeta
): Unit | undefined {
  const patch: Partial<Unit> = {
    name: ai.name,
    classId: ai.classId,
    spec: ai.spec,
    role: ai.role,
    isPlayer: false,
    isHumanControlled: false,
  };
  delete (patch as { unitKind?: string }).unitKind;

  let unit = engine.remapUnitId(playerId, ai.id, patch);
  if (unit) {
    delete (unit as { unitKind?: string }).unitKind;
    unit.isPlayer = false;
    unit.isHumanControlled = false;
    return unit;
  }

  // Seat already gone — still补位 so roster/map keep a body
  const stub: Unit = {
    id: ai.id,
    name: ai.name,
    classId: ai.classId,
    spec: ai.spec,
    role: ai.role,
    isPlayer: false,
    isHumanControlled: false,
    isAlive: true,
    alive: true,
    hp: 30_000,
    maxHp: 30_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 200, y: 200 },
    stats: createLevel80BaseStats((ai.role as string) === 'ENEMY' ? 'DPS' : ai.role, ai.classId),
  } as Unit;
  engine.addUnit(stub);
  return stub;
}

/**
 * Apply MEMBER_REPLACE_AI on a combat client.
 * Host also drops gather traces and publishes the new AI owner slice.
 */
export function applyPlayerLeaveAiTakeover(
  engine: CombatEngine,
  opts: {
    playerId: string;
    aiMemberId: string;
    room: LobbyRoom;
    isHost: boolean;
  }
): Unit | undefined {
  const { playerId, aiMemberId, room, isHost } = opts;
  if (!playerId || !aiMemberId) return undefined;

  if (isHost) {
    dropGatherOwnerTraces(playerId);
  }

  clearOwnerCombatSpawns(engine, playerId, { reportDespawn: isHost });
  stripLeaverAuraTraces(engine, playerId);

  // If a stale unit still sits on the old id after a failed prior remap, drop it
  // only after we attempted remap (remap consumes it).

  const aiMeta = room.members.find((m) => m.id === aiMemberId);
  const meta: ReplaceAiMemberMeta = {
    id: aiMemberId,
    name: aiMeta?.name || `AI-${aiMemberId.slice(-4)}`,
    classId: (aiMeta?.classId || 'MAGE') as ClassId,
    spec: aiMeta?.spec || 'FIRE',
    role: (aiMeta?.role || 'DPS') as RoleId,
  };

  const aiUnit = ensureAiUnit(engine, playerId, meta);

  // Belt: no leftover human id
  if (playerId !== aiMemberId && engine.getUnit(playerId)) {
    engine.removeUnit(playerId);
  }

  if (isHost && aiUnit) {
    // Peers erase leaver seat traces, then take the new AI body from host
    publishOwnerSnapshot({
      ownerId: playerId,
      timeMs: Date.now(),
      units: [],
      groundEffects: [],
      purge: true,
    });
    publishOwnerSnapshot(buildLocalOwnerSnapshot(engine, aiMemberId));
    const roomId = getCombatAuthorityContext().activeRoomId;
    if (roomId) hostForceFlushCombatBatch(roomId);
  }

  return aiUnit;
}

/** Guest/host: drop a seat that no longer exists in the room roster (stale leaver snap). */
export function purgeStaleOwnerIfNotInRoom(
  engine: CombatEngine,
  ownerId: string,
  room: LobbyRoom | null | undefined
): boolean {
  if (!ownerId || !room?.members?.length) return false;
  if (room.members.some((m) => m.id === ownerId)) return false;
  clearOwnerCombatSpawns(engine, ownerId, { reportDespawn: false });
  stripLeaverAuraTraces(engine, ownerId);
  if (engine.getUnit(ownerId)) engine.removeUnit(ownerId);
  return true;
}
