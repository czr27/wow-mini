/**
 * Combat leave/rejoin must keep engine unit count + roles stable.
 * Regression: MEMBER_REPLACE_AI id drift caused orphan mis-claim → missing AI + wrong class.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoomManager, pickHotJoinAiReplacement } from '../room/RoomManager.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import type { Unit } from '../types.js';

function makeUnit(partial: Partial<Unit> & { id: string; role: Unit['role'] }): Unit {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    classId: partial.classId ?? 'PRIEST',
    spec: partial.spec ?? 'HOLY',
    role: partial.role,
    isPlayer: !!partial.isPlayer,
    isHumanControlled: !!partial.isHumanControlled,
    isAlive: true,
    alive: true,
    hp: partial.hp ?? 20000,
    maxHp: 36000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: partial.position ?? { x: 100, y: 100 },
    stats: {
      attackPower: 1,
      spellPower: 1,
      critChance: 0,
      haste: 0,
      armor: 0,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0,
      mastery: 0,
      versatility: 0,
      speed: 1,
    },
  };
}

describe('hotswap seat id alignment', () => {
  it('leave→AI id remap→rejoin keeps friendly count and other seats', () => {
    const mgr = new RoomManager();
    const room = mgr.createRoom({
      name: '席位对齐',
      dungeonId: 'shadowfang_keep',
      host: { id: 'host_t', name: 'HostT', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    });
    mgr.autoFillAi(room.id);
    const join = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'healer1',
      name: '奶妈',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    assert.ok(join.ok);

    const engine = new CombatEngine();
    for (const m of room.members) {
      engine.addUnit(
        makeUnit({
          id: m.id,
          name: m.name,
          classId: m.classId,
          spec: m.spec,
          role: m.role,
          isPlayer: m.id === 'host_t',
          isHumanControlled: !m.isAi,
        })
      );
    }
    const beforeCount = engine.friendlyUnits.length;
    const tankId = room.members.find((m) => m.role === 'TANK' && m.id === 'host_t')!.id;
    const dpsAiIds = room.members.filter((m) => m.isAi && m.role === 'DPS').map((m) => m.id);

    room.status = 'IN_COMBAT';
    const replaced = mgr.replaceHumanWithAi(room.id, 'healer1');
    assert.ok(replaced.ok && replaced.aiMemberId);

    // Client path: remap engine id player→ai (was the bug when this was skipped)
    const remapped = engine.remapUnitId('healer1', replaced.aiMemberId!, {
      isPlayer: false,
      isHumanControlled: false,
      name: room.members.find((m) => m.id === replaced.aiMemberId)!.name,
      classId: room.members.find((m) => m.id === replaced.aiMemberId)!.classId,
      spec: room.members.find((m) => m.id === replaced.aiMemberId)!.spec,
      role: 'HEALER',
    });
    assert.ok(remapped);
    assert.equal(engine.getUnit('healer1'), undefined);
    assert.ok(engine.getUnit(replaced.aiMemberId!));
    assert.equal(engine.friendlyUnits.length, beforeCount);

    const rejoined = mgr.joinOrHotSwapPlayer(room.id, {
      id: 'healer1',
      name: '奶妈',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    assert.ok(rejoined.ok);
    assert.equal(rejoined.replacedAiId, replaced.aiMemberId);

    const inherited = mgr.inheritCombatUnitFromAi(engine, replaced.aiMemberId!, {
      id: 'healer1',
      name: '奶妈',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    assert.ok(inherited);
    assert.equal(inherited!.id, 'healer1');
    assert.equal(inherited!.role, 'HEALER');
    assert.equal(engine.friendlyUnits.length, beforeCount, '重进后人数不得少 1');
    assert.ok(engine.getUnit(tankId), '坦克席位仍在');
    assert.equal(engine.getUnit(tankId)!.role, 'TANK');
    for (const id of dpsAiIds) {
      assert.ok(engine.getUnit(id), `DPS AI ${id} 不得被误删`);
    }
  });

  it('id drift fallback reclaims player.id AI seat instead of stealing another healer', () => {
    const mgr = new RoomManager();
    const engine = new CombatEngine();
    // Legacy path: room AI id drifted, engine still keyed by healer1
    engine.addUnit(
      makeUnit({
        id: 'healer1',
        name: 'AI奶',
        role: 'HEALER',
        classId: 'PRIEST',
        isHumanControlled: false,
        hp: 11111,
      })
    );
    engine.addUnit(
      makeUnit({
        id: 'ai_other_healer',
        name: '另一奶',
        role: 'HEALER',
        classId: 'SHAMAN',
        spec: 'RESTORATION',
        isHumanControlled: false,
        hp: 22222,
      })
    );
    engine.addUnit(
      makeUnit({
        id: 'tank1',
        name: '坦',
        role: 'TANK',
        classId: 'DK',
        spec: 'BLOOD',
        isHumanControlled: true,
      })
    );

    const inherited = mgr.inheritCombatUnitFromAi(engine, 'ai_missing_room_id', {
      id: 'healer1',
      name: '奶妈回来',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    assert.ok(inherited);
    assert.equal(inherited!.hp, 11111, '应认领自己的旧席而非另一奶');
    assert.ok(engine.getUnit('ai_other_healer'), '另一治疗 AI 不得被偷走');
    assert.equal(engine.friendlyUnits.length, 3);
  });

  it('自定义热加入：治疗优先顶同职责 AI，不先顶坦克', () => {
    const ais = [
      { id: 't', role: 'TANK', classId: 'DK', name: '坦' },
      { id: 'h', role: 'HEALER', classId: 'PRIEST', name: '奶' },
      { id: 'd', role: 'DPS', classId: 'MAGE', name: '法' },
    ] as any[];
    const picked = pickHotJoinAiReplacement(ais, 'PRIEST', 'HEALER');
    assert.equal(picked?.id, 'h');
  });
});
