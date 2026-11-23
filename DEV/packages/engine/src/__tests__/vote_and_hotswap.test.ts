import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasMajorityYes, resolveWipeMajority } from '../net/NetProtocol.js';
import { RoomManager } from '../room/RoomManager.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import type { Unit } from '../types.js';

test('hasMajorityYes requires strict majority; timeout path treated as NO by caller', () => {
  const eligible = ['a', 'b', 'c'];
  assert.equal(hasMajorityYes(eligible, { a: 'YES' }, 'YES'), false);
  assert.equal(hasMajorityYes(eligible, { a: 'YES', b: 'YES' }, 'YES'), true);
  assert.equal(hasMajorityYes(eligible, { a: 'YES', b: 'NO', c: 'NO' }, 'YES'), false);
});

test('resolveWipeMajority picks RETRY or FINISH', () => {
  assert.equal(resolveWipeMajority(['a', 'b', 'c'], { a: 'RETRY', b: 'RETRY' }), 'RETRY');
  assert.equal(resolveWipeMajority(['a', 'b', 'c'], { a: 'FINISH', b: 'FINISH', c: 'RETRY' }), 'FINISH');
  assert.equal(resolveWipeMajority(['a', 'b'], { a: 'RETRY', b: 'FINISH' }), null);
});

test('substituteOutOfCombat inherits HP and buffs from replaced AI', () => {
  const mgr = new RoomManager();
  const room = mgr.createRoom({
    name: 't',
    dungeonId: 'shadowfang_keep',
    host: { id: 'host1', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
  });
  mgr.autoFillAi(room.id);
  const ai = room.members.find((m) => m.isAi && m.role === 'DPS');
  assert.ok(ai);

  const engine = new CombatEngine();
  const aiUnit: Unit = {
    id: ai!.id,
    name: ai!.name,
    classId: ai!.classId,
    spec: ai!.spec,
    role: 'DPS',
    isPlayer: false,
    isAlive: true,
    hp: 12345,
    maxHp: 36000,
    absorb: 500,
    resources: [],
    buffs: [
      {
        id: 'buff1',
        spellId: 'mark',
        name: '野性印记',
        kind: 'BUFF',
        tags: [],
        sourceUnitId: ai!.id,
        targetUnitId: ai!.id,
        stacks: 1,
        maxStacks: 1,
        durationMs: 10000,
        remainingMs: 8000,
      },
    ],
    threatTable: [{ sourceUnitId: 'boss', amount: 99 }],
    position: { x: 111, y: 222 },
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
  engine.addUnit(aiUnit);

  mgr.joinWaitingQueue(room.id, {
    id: 'p_new',
    name: '新人',
    classId: 'MAGE',
    spec: 'FIRE',
    role: 'DPS',
  });

  const result = mgr.substituteOutOfCombat(room.id, engine);
  assert.equal(result.substituted.length, 1);
  const unit = engine.getUnit('p_new');
  assert.ok(unit);
  assert.equal(unit!.hp, 12345);
  assert.equal(unit!.absorb, 500);
  assert.equal(unit!.buffs.length, 1);
  assert.equal(unit!.buffs[0].name, '野性印记');
  assert.equal(unit!.position.x, 111);
  assert.equal(unit!.isPlayer, false);
  assert.equal(unit!.isHumanControlled, true);
  assert.equal(engine.getUnit(ai!.id), undefined);
});
