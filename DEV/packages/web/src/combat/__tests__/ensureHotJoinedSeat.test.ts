import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import { ensureHotJoinedSeat } from '../ensureHotJoinedSeat.js';

function ai(id: string): Unit {
  return {
    id,
    name: id,
    classId: 'MAGE',
    role: 'DPS',
    isAlive: true,
    alive: true,
    isPlayer: false,
    isHumanControlled: false,
    hp: 15_000,
    maxHp: 20_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('DPS', 'MAGE'),
  } as Unit;
}

describe('ensureHotJoinedSeat', () => {
  it('spawns joiner when replaced AI was already pruned', () => {
    const engine = new CombatEngine();
    engine.addUnit(ai('other_ai'));
    const room = {
      members: [
        {
          id: 'joiner',
          name: '客人',
          classId: 'MAGE',
          spec: 'FIRE',
          role: 'DPS',
          isPlayer: true,
          isAi: false,
          isHost: false,
          isReady: true,
          slotIndex: 1,
        },
        {
          id: 'other_ai',
          name: 'AI',
          classId: 'WARLOCK',
          spec: 'AFFLICTION',
          role: 'DPS',
          isPlayer: false,
          isAi: true,
          isHost: false,
          isReady: true,
          slotIndex: 2,
        },
      ],
    } as any;

    const u = ensureHotJoinedSeat(
      engine,
      'ai_already_gone',
      { id: 'joiner', name: '客人', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
      room
    );
    assert.equal(u.id, 'joiner');
    assert.equal(u.isHumanControlled, true);
    assert.ok(engine.getUnit('joiner'));
    assert.ok(engine.getUnit('other_ai'), '其他 AI 保留');
  });
});
