/**
 * AI 治疗光环站位：避开红圈 → 危险叠层最多 → 健康则不影响输出地多蹭光环
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countHealAurasAt,
  evaluateGroundFormationPosition,
  findBestHealAuraStandPosition,
  MELEE_ATTACK_RANGE,
  RANGED_ATTACK_RANGE,
} from '../ai/TankAI.js';
import type { GroundEffect, Unit } from '../types.js';

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

function ally(partial: Partial<Unit> & Pick<Unit, 'id' | 'role'>): Unit {
  return {
    name: partial.id,
    classId: partial.classId ?? (partial.role === 'DPS' ? 'MAGE' : 'PRIEST'),
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

describe('治疗光环叠层站位优先级', () => {
  it('1. countHealAurasAt 正确统计叠层', () => {
    const a = zone({ id: 'a', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 0, y: 0, radius: 100 });
    const b = zone({ id: 'b', kind: 'TOTEM', spellId: 'healing_tide', x: 60, y: 0, radius: 100 });
    assert.equal(countHealAurasAt({ x: 30, y: 0 }, [a, b]), 2);
    assert.equal(countHealAurasAt({ x: 200, y: 0 }, [a, b]), 0);
  });

  it('2. 危险血线：优先叠层最多，而非最近单体光环', () => {
    const mage = ally({ id: 'mage_low', role: 'DPS', classId: 'MAGE', hp: 2000, maxHp: 10000 });
    // 近处单层光环
    const nearSingle = zone({
      id: 'near',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 120,
      y: 0,
      radius: 60,
    });
    // 稍远两层重叠
    const farA = zone({
      id: 'far_a',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 280,
      y: 0,
      radius: 80,
    });
    const farB = zone({
      id: 'far_b',
      kind: 'TOTEM',
      spellId: 'spirit_link',
      x: 320,
      y: 0,
      radius: 80,
    });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 0, y: 0 },
      unit: mage,
      groundEffects: [nearSingle, farA, farB],
      defaultTarget: { x: 0, y: 0 },
    });
    assert.equal(result.tradeOffDecision, 'SEEK_HEAL_ZONE');
    const stacks = countHealAurasAt(result.targetPos, [nearSingle, farA, farB]);
    assert.ok(stacks >= 2, `危险血线应去叠层≥2，实际 ${stacks}`);
  });

  it('3. 健康近战：不会为蹭光环走出近战射程', () => {
    const rogue = ally({
      id: 'rogue_1',
      role: 'DPS',
      classId: 'ROGUE',
      hp: 9000,
      maxHp: 10000,
    });
    const bossPos = { x: 400, y: 200 };
    // 光环中心远离 Boss，近战够不到
    const farHeal = zone({
      id: 'far_heal',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 100,
      y: 200,
      radius: 70,
    });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 380, y: 200 },
      unit: rogue,
      groundEffects: [farHeal],
      defaultTarget: { x: 360, y: 200 },
      bossPos,
      meleeRange: MELEE_ATTACK_RANGE,
    });
    assert.notEqual(result.tradeOffDecision, 'SEEK_HEAL_ZONE');
    assert.ok(
      Math.hypot(result.targetPos.x - bossPos.x, result.targetPos.y - bossPos.y) <=
        MELEE_ATTACK_RANGE + 1,
      '健康近战目标点须在近战射程内'
    );
  });

  it('4. 健康远程：可在 40 码内蹭更多光环，但不会踩红圈', () => {
    const mage = ally({ id: 'mage_ok', role: 'DPS', classId: 'MAGE', hp: 9000, maxHp: 10000 });
    const bossPos = { x: 400, y: 200 };
    const healA = zone({
      id: 'ha',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 300,
      y: 200,
      radius: 70,
    });
    const healB = zone({
      id: 'hb',
      kind: 'TOTEM',
      spellId: 'healing_tide',
      x: 340,
      y: 200,
      radius: 70,
    });
    const red = zone({
      id: 'red',
      kind: 'DAMAGE_ZONE',
      spellId: 'void',
      x: 320,
      y: 200,
      radius: 40,
      tickValue: 12000,
      colorHex: '#7f1d1d',
    });
    const best = findBestHealAuraStandPosition({
      healZones: [healA, healB],
      hazards: [red],
      currentPos: { x: 250, y: 200 },
      defaultTarget: { x: 250, y: 200 },
      requireAttackRange: { bossPos, range: RANGED_ATTACK_RANGE },
    });
    assert.ok(best, '应找到安全叠层点');
    assert.ok(best!.stackCount >= 1);
    assert.ok(
      Math.hypot(best!.pos.x - red.x, best!.pos.y - red.y) > red.radius,
      '不得站在红色地形内'
    );
    assert.ok(
      Math.hypot(best!.pos.x - bossPos.x, best!.pos.y - bossPos.y) <= RANGED_ATTACK_RANGE,
      '须保持远程输出射程'
    );
  });

  it('5. 身在红圈时优先躲开（即使旁边有治疗光环中心也在红圈内）', () => {
    const mage = ally({ id: 'mage_haz', role: 'DPS', classId: 'MAGE', hp: 5000, maxHp: 10000 });
    const red = zone({
      id: 'red',
      kind: 'DAMAGE_ZONE',
      spellId: 'void',
      x: 200,
      y: 200,
      radius: 80,
      tickValue: 15000,
      colorHex: '#7f1d1d',
    });
    const healInsideRed = zone({
      id: 'heal_bad',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 200,
      y: 200,
      radius: 50,
    });
    const healSafe = zone({
      id: 'heal_safe',
      kind: 'HEAL_ZONE',
      spellId: 'healing_rain',
      x: 400,
      y: 200,
      radius: 70,
    });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 200, y: 200 },
      unit: mage,
      groundEffects: [red, healInsideRed, healSafe],
      defaultTarget: { x: 200, y: 200 },
    });
    assert.equal(result.tradeOffDecision, 'DODGE_HAZARD_LEAVE_ZONE');
    assert.ok(
      Math.hypot(result.targetPos.x - red.x, result.targetPos.y - red.y) > red.radius,
      '躲开后不得仍在红圈内'
    );
  });
});
