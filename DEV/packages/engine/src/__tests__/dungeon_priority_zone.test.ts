import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDungeonPriorityZone,
  evaluateGroundFormationPosition,
  RANGED_ATTACK_RANGE,
} from '../ai/TankAI.js';
import type { GroundEffect, Unit } from '../types.js';

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'mage_1',
    name: '法师',
    classId: 'MAGE',
    role: 'DPS',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 36000,
    maxHp: 36000,
    position: { x: 260, y: 200 },
    stats: {
      attackPower: 0,
      spellPower: 1000,
      critChance: 0.2,
      haste: 0,
      armor: 1000,
      dodge: 0,
      parry: 0,
      block: 0,
      spellResist: 0,
    },
    buffs: [],
    ...overrides,
  } as Unit;
}

describe('dungeon_priority_zone', () => {
  it('1. 副本集中指令（如大地践踏）优先于自身战斗距离，引导远程进入集中区', () => {
    const unit = makeUnit({ position: { x: 240, y: 200 } });
    const bossPos = { x: 540, y: 200 };
    const zone = computeDungeonPriorityZone({
      unit,
      bossPos,
      bossCastingSpellName: '大地践踏',
    });
    assert.ok(zone, '应生成集中区');
    assert.equal(zone!.mode, 'STACK');

    const res = evaluateGroundFormationPosition({
      currentPos: { x: 240, y: 200 },
      unit,
      groundEffects: [],
      defaultTarget: { x: 240, y: 200 },
      bossPos,
      dungeonPriorityZone: zone,
    });
    assert.equal(res.tradeOffDecision, 'DUNGEON_STACK');
    const dToBoss = Math.hypot(res.targetPos.x - bossPos.x, res.targetPos.y - bossPos.y);
    assert.ok(dToBoss <= zone!.radiusPx + 1, `远程应进入集中区 (d=${dToBoss})`);
  });

  it('2. 副本分散指令优先于默认输出位，将重合队友拉开安全距离', () => {
    const unit = makeUnit({ id: 'u1', position: { x: 300, y: 200 } });
    const bossPos = { x: 540, y: 200 };
    const zone = computeDungeonPriorityZone({
      unit,
      bossPos,
      bossCastingSpellName: '胸弹分散',
      allies: [
        { id: 'u1', x: 300, y: 200, unit },
        { id: 'u2', x: 305, y: 200 },
      ],
    });
    assert.ok(zone);
    assert.equal(zone!.mode, 'SPREAD');

    const res = evaluateGroundFormationPosition({
      currentPos: { x: 300, y: 200 },
      unit,
      groundEffects: [],
      defaultTarget: { x: 300, y: 200 },
      bossPos,
      dungeonPriorityZone: zone,
    });
    assert.equal(res.tradeOffDecision, 'DUNGEON_SPREAD');
    const dToPeer = Math.hypot(res.targetPos.x - 305, res.targetPos.y - 200);
    assert.ok(dToPeer >= zone!.radiusPx - 1, `应与队友分散 >= ${zone!.radiusPx}px, 实际 ${dToPeer}`);
    const dToBoss = Math.hypot(res.targetPos.x - bossPos.x, res.targetPos.y - bossPos.y);
    assert.ok(dToBoss <= RANGED_ATTACK_RANGE + 100);
  });

  it('3. 必须躲避红圈优先级高于副本集中区：红圈覆盖集中点时绝不踩进红圈', () => {
    const bossPos = { x: 540, y: 200 };
    const unit = makeUnit({ position: { x: 540, y: 200 } });
    const hazard: GroundEffect = {
      id: 'haz_1',
      kind: 'DAMAGE_ZONE',
      spellId: 'fire_pool',
      ownerId: 'boss',
      x: 540,
      y: 200,
      radius: 100,
      colorHex: '#ff0000',
      remainingMs: 5000,
    } as GroundEffect;

    const res = evaluateGroundFormationPosition({
      currentPos: { x: 540, y: 200 },
      unit,
      groundEffects: [hazard],
      defaultTarget: { x: 240, y: 200 },
      bossPos,
      dungeonPriorityZone: {
        mode: 'STACK',
        center: bossPos,
        radiusPx: 85,
        label: '副本集中分摊',
      },
    });
    const dToHazard = Math.hypot(res.targetPos.x - hazard.x, res.targetPos.y - hazard.y);
    assert.ok(dToHazard > hazard.radius, `必须躲出红圈 (d=${dToHazard}, r=${hazard.radius})`);
    assert.equal(res.tradeOffDecision, 'DODGE_HAZARD_LEAVE_ZONE');
  });
});
