/**
 * 走位可行域求交：躲红圈不回钻、Boss 朝向、仇恨纠偏、多动症上限
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOSS_FRONTAL_CONE_RAD,
  FIDGET_MAX_PX,
  FIDGET_MAX_YD,
  MELEE_ATTACK_RANGE,
  evaluateGroundFormationPosition,
  isInBossFrontalCone,
  isPosInHazard,
  resolveUnitFacingRad,
  yardsToPx,
} from '../index.js';
import type { GroundEffect, Unit } from '../types.js';

function ally(partial: Partial<Unit> & Pick<Unit, 'id' | 'role'>): Unit {
  return {
    name: partial.id,
    classId: partial.classId ?? (partial.role === 'DPS' ? 'ROGUE' : 'WARRIOR'),
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 9000,
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
    ownerId: 'boss',
    radius: 80,
    colorHex: '#7f1d1d',
    remainingMs: 8000,
    tickValue: 12000,
    ...partial,
  };
}

describe('走位优先级求交', () => {
  it('1. Boss 朝向：移动中用移动方向，否则朝打击目标', () => {
    const pos = { x: 100, y: 100 };
    const moving = resolveUnitFacingRad({
      position: pos,
      isMoving: true,
      moveDx: 1,
      moveDy: 0,
      targetPos: { x: 100, y: 200 },
    });
    assert.ok(Math.abs(moving - 0) < 1e-6);

    const idle = resolveUnitFacingRad({
      position: pos,
      isMoving: false,
      moveDx: 0,
      moveDy: 0,
      targetPos: { x: 100, y: 200 },
    });
    assert.ok(Math.abs(idle - Math.PI / 2) < 1e-6);
  });

  it('2. 健康近战踩 Boss 脚下红圈：目标点必须出圈，不得 RETURN_TO_BOSS 回钻', () => {
    const rogue = ally({
      id: 'rogue_dodge',
      role: 'DPS',
      classId: 'ROGUE',
      hp: 9000,
      maxHp: 10000,
    });
    const bossPos = { x: 400, y: 200 };
    const red = zone({
      id: 'puddle',
      kind: 'DAMAGE_ZONE',
      spellId: 'desecration',
      x: 400,
      y: 200,
      radius: 70,
    });
    // 默认近战阵型点仍在红圈内 —— 旧逻辑会回钻
    const defaultInside = { x: 360, y: 200 };
    assert.ok(isPosInHazard(defaultInside, red));

    const result = evaluateGroundFormationPosition({
      currentPos: { x: 400, y: 200 },
      unit: rogue,
      groundEffects: [red],
      defaultTarget: defaultInside,
      bossPos,
      attackTargetPos: bossPos,
      meleeRange: MELEE_ATTACK_RANGE,
    });

    assert.notEqual(result.tradeOffDecision, 'RETURN_TO_BOSS');
    assert.ok(
      result.tradeOffDecision === 'DODGE_HAZARD_LEAVE_ZONE' ||
        result.tradeOffDecision === 'DODGE_HAZARD_SHIFT_IN_ZONE',
      `期望躲圈决策，实际 ${result.tradeOffDecision}`
    );
    assert.ok(!isPosInHazard(result.targetPos, red), '目标点不得仍在红圈内');
    assert.equal(result.allowFidget, false);
  });

  it('3. 正面锥：Boss 朝 +X 时，正前方点在锥内，侧翼不在', () => {
    const boss = { x: 0, y: 0 };
    const front = { x: 50, y: 0 };
    const flank = { x: 0, y: 50 };
    assert.equal(isInBossFrontalCone(front, boss, 0, BOSS_FRONTAL_CONE_RAD), true);
    assert.equal(isInBossFrontalCone(flank, boss, 0, BOSS_FRONTAL_CONE_RAD), false);
  });

  it('4. 非坦持仇：主坦进入近战可及范围；OT 向主坦靠拢', () => {
    const mt = ally({
      id: 'mt',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 100000,
      maxHp: 120000,
    });
    const ot = ally({
      id: 'ot',
      role: 'TANK',
      classId: 'DK',
      hp: 100000,
      maxHp: 120000,
    });
    const bossPos = { x: 400, y: 200 };
    const tankPos = { x: 200, y: 200 };

    const mtResult = evaluateGroundFormationPosition({
      currentPos: { x: 100, y: 200 },
      unit: mt,
      groundEffects: [],
      defaultTarget: { x: 100, y: 200 },
      bossPos,
      attackTargetPos: bossPos,
      aggroIsNonTank: true,
      isPrimaryTank: true,
      meleeRange: MELEE_ATTACK_RANGE,
    });
    assert.equal(mtResult.tradeOffDecision, 'AGGRO_TANK_PULL');
    assert.ok(
      Math.hypot(mtResult.targetPos.x - bossPos.x, mtResult.targetPos.y - bossPos.y) <=
        MELEE_ATTACK_RANGE + 1,
      '主坦应进入攻击可及范围'
    );

    const otResult = evaluateGroundFormationPosition({
      currentPos: { x: 500, y: 300 },
      unit: ot,
      groundEffects: [],
      defaultTarget: { x: 500, y: 300 },
      bossPos,
      tankPos,
      aggroIsNonTank: true,
      isPrimaryTank: false,
    });
    assert.equal(otResult.tradeOffDecision, 'AGGRO_OT_TO_MT');
    const distOtToMt = Math.hypot(
      otResult.targetPos.x - tankPos.x,
      otResult.targetPos.y - tankPos.y
    );
    const distStart = Math.hypot(500 - tankPos.x, 300 - tankPos.y);
    assert.ok(distOtToMt < distStart, 'OT 目标应比起点更靠近主坦');
  });

  it('5. 多动症上限：5 码 = 40px', () => {
    assert.equal(FIDGET_MAX_YD, 5);
    assert.equal(FIDGET_MAX_PX, yardsToPx(5));
    assert.equal(FIDGET_MAX_PX, 40);
  });
});
