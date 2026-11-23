/**
 * Non-tank AI stays within 25yd of primary tank unless higher-priority
 * intents (dodge hazard / seek-or-stay heal zone / aggro pull) apply.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TANK_STACK_RANGE_PX,
  TANK_STACK_RANGE_YD,
  clampPosWithinTankRange,
  evaluateGroundFormationPosition,
  yardsToPx,
} from '../index.js';
import type { GroundEffect, Unit } from '../types.js';

function ally(partial: Partial<Unit> & Pick<Unit, 'id' | 'role'>): Unit {
  return {
    name: partial.id,
    classId: partial.role === 'HEALER' ? 'PRIEST' : 'MAGE',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 8000,
    maxHp: 10000,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 0, y: 0 },
    stats: {
      attackPower: 100,
      spellPower: 100,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
  } as Unit;
}

function zone(
  partial: Partial<GroundEffect> & Pick<GroundEffect, 'id' | 'kind' | 'spellId' | 'x' | 'y'>
): GroundEffect {
  return {
    ownerId: 'healer',
    radius: 80,
    colorHex: '#10b981',
    remainingMs: 8000,
    tickValue: 4000,
    ...partial,
  };
}

describe('离主坦 25 码站位约束', () => {
  it('1. 尺度：25 码 = 200px', () => {
    assert.equal(TANK_STACK_RANGE_YD, 25);
    assert.equal(TANK_STACK_RANGE_PX, 200);
    assert.equal(yardsToPx(25), 200);
  });

  it('2. clampPosWithinTankRange：超距点拉到圆周上', () => {
    const tank = { x: 400, y: 200 };
    const far = { x: 100, y: 200 }; // 300px away
    const clamped = clampPosWithinTankRange(far, tank);
    const dist = Math.hypot(clamped.x - tank.x, clamped.y - tank.y);
    assert.ok(Math.abs(dist - TANK_STACK_RANGE_PX) < 1e-6);
    assert.ok(clamped.x < tank.x);
    assert.equal(clamped.y, 200);
  });

  it('3. 默认站位：远程默认点远离主坦时被拉回 25 码内', () => {
    const mage = ally({ id: 'mage_1', role: 'DPS', classId: 'MAGE', hp: 9000, maxHp: 10000 });
    const tankPos = { x: 445, y: 180 };
    const farDefault = { x: 210, y: 105 }; // ~29yd from tank
    const result = evaluateGroundFormationPosition({
      currentPos: farDefault,
      unit: mage,
      groundEffects: [],
      defaultTarget: farDefault,
      tankPos,
    });
    assert.equal(result.tradeOffDecision, 'DEFAULT_POSITION');
    const dist = Math.hypot(result.targetPos.x - tankPos.x, result.targetPos.y - tankPos.y);
    assert.ok(dist <= TANK_STACK_RANGE_PX + 1e-6, `期望 ≤200px，实际 ${dist}`);
  });

  it('4. 去吃治疗圈：可突破 25 码约束', () => {
    const mage = ally({ id: 'mage_2', role: 'DPS', classId: 'MAGE', hp: 2000, maxHp: 10000 });
    const tankPos = { x: 445, y: 180 };
    const healFar = zone({
      id: 'rain_far',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 100,
      y: 100,
    });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 400, y: 180 },
      unit: mage,
      groundEffects: [healFar],
      defaultTarget: { x: 400, y: 180 },
      tankPos,
    });
    assert.equal(result.tradeOffDecision, 'SEEK_HEAL_ZONE');
    const inHeal =
      Math.hypot(result.targetPos.x - healFar.x, result.targetPos.y - healFar.y) <= healFar.radius;
    assert.ok(inHeal, '应走向远处治疗圈');
    const dist = Math.hypot(result.targetPos.x - tankPos.x, result.targetPos.y - tankPos.y);
    assert.ok(dist > TANK_STACK_RANGE_PX, '寻治疗圈目标应允许超出 25 码');
  });

  it('5. 躲避负面地形：可突破 25 码约束', () => {
    const mage = ally({ id: 'mage_3', role: 'DPS', classId: 'MAGE', hp: 9000, maxHp: 10000 });
    const tankPos = { x: 445, y: 180 };
    const hazard = zone({
      id: 'void',
      kind: 'DAMAGE_ZONE',
      spellId: 'desecration',
      x: 400,
      y: 180,
      radius: 60,
      tickValue: 12000,
      colorHex: '#7f1d1d',
    });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 400, y: 180 },
      unit: mage,
      groundEffects: [hazard],
      defaultTarget: { x: 400, y: 180 },
      tankPos,
    });
    assert.equal(result.tradeOffDecision, 'DODGE_HAZARD_LEAVE_ZONE');
    const withoutTank = evaluateGroundFormationPosition({
      currentPos: { x: 400, y: 180 },
      unit: mage,
      groundEffects: [hazard],
      defaultTarget: { x: 400, y: 180 },
    });
    assert.equal(result.targetPos.x, withoutTank.targetPos.x);
    assert.equal(result.targetPos.y, withoutTank.targetPos.y);
  });

  it('6. 坦克自身不受离坦约束', () => {
    const tank = ally({ id: 'tank_1', role: 'TANK', classId: 'WARRIOR', hp: 100000, maxHp: 120000 });
    const far = { x: 100, y: 100 };
    const result = evaluateGroundFormationPosition({
      currentPos: far,
      unit: tank,
      groundEffects: [],
      defaultTarget: far,
      tankPos: { x: 445, y: 180 },
      isPrimaryTank: true,
    });
    assert.equal(result.targetPos.x, far.x);
    assert.equal(result.targetPos.y, far.y);
  });
});
