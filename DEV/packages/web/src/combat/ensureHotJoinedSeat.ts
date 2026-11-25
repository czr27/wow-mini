/**
 * Host must always end MEMBER_HOT_SWAP with the joiner seated.
 * If inherit missed (ROOM_UPDATE pruned the AI first), remap leftover AI or spawn stub.
 */
import type { ClassId, CombatEngine, LobbyRoom, RoleId, Unit } from '@cata-raid-sim/engine';
import { createLevel80BaseStats, roomManager } from '@cata-raid-sim/engine';

export type HotJoinIdentity = {
  id: string;
  name: string;
  classId: ClassId;
  spec: string;
  role: RoleId;
};

export function ensureHotJoinedSeat(
  engine: CombatEngine,
  replacedAiId: string | undefined,
  player: HotJoinIdentity,
  room?: LobbyRoom | null
): Unit {
  const inherited = replacedAiId
    ? roomManager.inheritCombatUnitFromAi(engine, replacedAiId, player, room)
    : undefined;
  if (inherited) return inherited;

  const existing = engine.getUnit(player.id);
  if (existing) {
    existing.name = player.name;
    existing.classId = player.classId;
    existing.spec = player.spec;
    existing.role = player.role;
    existing.isPlayer = false;
    existing.isHumanControlled = true;
    delete (existing as { unitKind?: string }).unitKind;
    return existing;
  }

  if (replacedAiId) {
    const ai = engine.getUnit(replacedAiId);
    if (ai) {
      const remapped = engine.remapUnitId(replacedAiId, player.id, {
        name: player.name,
        classId: player.classId,
        spec: player.spec,
        role: player.role,
        isPlayer: false,
        isHumanControlled: true,
      });
      if (remapped) {
        delete (remapped as { unitKind?: string }).unitKind;
        return remapped;
      }
    }
  }

  const stub: Unit = {
    id: player.id,
    name: player.name,
    classId: player.classId,
    spec: player.spec,
    role: player.role,
    isPlayer: false,
    isHumanControlled: true,
    isAlive: true,
    alive: true,
    hp: 30_000,
    maxHp: 30_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 220, y: 200 },
    stats: createLevel80BaseStats(
      (player.role as string) === 'ENEMY' ? 'DPS' : player.role,
      player.classId
    ),
  } as Unit;
  engine.addUnit(stub);
  return stub;
}
