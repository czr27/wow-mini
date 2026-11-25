/**
 * Hot-join must replace exactly one AI. Id-miss must not steal another same-class seat.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoomManager } from '../room/RoomManager.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import type { Unit } from '../types.js';

function makeUnit(partial: Partial<Unit> & { id: string; role: Unit['role'] }): Unit {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    classId: partial.classId ?? 'MAGE',
    spec: partial.spec ?? 'FIRE',
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
    position: { x: 100, y: 100 },
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

describe('hotjoin no double same-class AI steal', () => {
  it('missing replacedAiId does not consume a second living same-class AI', () => {
    const mgr = new RoomManager();
    const engine = new CombatEngine();
    engine.addUnit(
      makeUnit({
        id: 'ai_mage_1',
        name: '法师A',
        role: 'DPS',
        classId: 'MAGE',
        isHumanControlled: false,
      })
    );
    engine.addUnit(
      makeUnit({
        id: 'ai_mage_2',
        name: '法师B',
        role: 'DPS',
        classId: 'MAGE',
        isHumanControlled: false,
      })
    );
    engine.addUnit(
      makeUnit({
        id: 'host',
        name: '房主',
        role: 'TANK',
        classId: 'DK',
        isHumanControlled: true,
        isPlayer: true,
      })
    );

    // Room already swapped ai_mage_1 → joiner; both mages still in engine (id miss)
    const room = {
      members: [
        {
          id: 'joiner',
          name: '火法客人',
          classId: 'MAGE',
          spec: 'FIRE',
          role: 'DPS',
          isPlayer: true,
          isAi: false,
          isHost: false,
          isReady: true,
          slotIndex: 2,
        },
        {
          id: 'ai_mage_2',
          name: '法师B',
          classId: 'MAGE',
          spec: 'FIRE',
          role: 'DPS',
          isPlayer: false,
          isAi: true,
          isHost: false,
          isReady: true,
          slotIndex: 3,
        },
        {
          id: 'host',
          name: '房主',
          classId: 'DK',
          spec: 'BLOOD',
          role: 'TANK',
          isPlayer: true,
          isAi: false,
          isHost: true,
          isReady: true,
          slotIndex: 0,
        },
      ],
    } as any;

    const inherited = mgr.inheritCombatUnitFromAi(
      engine,
      'ai_mage_1',
      {
        id: 'joiner',
        name: '火法客人',
        classId: 'MAGE',
        spec: 'FIRE',
        role: 'DPS',
      },
      room
    );

    assert.ok(inherited);
    assert.equal(inherited!.id, 'joiner');
    assert.ok(engine.getUnit('ai_mage_2'), '仍在房间里的同职业 AI 不得被顺手顶掉');
    assert.equal(engine.getUnit('ai_mage_1'), undefined);
    assert.equal(engine.friendlyUnits.length, 3);
  });
});
