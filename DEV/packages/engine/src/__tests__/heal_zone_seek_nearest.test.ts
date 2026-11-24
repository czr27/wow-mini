/**
 * Healing totems count as seekable heal circles; low-HP AI seeks max stack (tie-break nearer).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isSeekableHealGroundEffect,
  pickNearestGroundEffect,
} from '../engine/AoeRingVisual.js';
import { countHealAurasAt, evaluateGroundFormationPosition } from '../ai/TankAI.js';
import type { GroundEffect, Unit } from '../types.js';

function zone(partial: Partial<GroundEffect> & Pick<GroundEffect, 'id' | 'kind' | 'spellId' | 'x' | 'y'>): GroundEffect {
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
    classId: partial.role === 'DPS' ? 'ROGUE' : 'MAGE',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 4000,
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

describe('治疗光圈 / 图腾可寻 / 就近选择', () => {
  it('1. 治疗之潮/灵魂链接图腾算可寻治疗光圈；法力之潮/风怒不算', () => {
    assert.equal(
      isSeekableHealGroundEffect(zone({ id: 'a', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 0, y: 0 })),
      true
    );
    assert.equal(
      isSeekableHealGroundEffect(zone({ id: 'b', kind: 'TOTEM', spellId: 'healing_tide', x: 0, y: 0 })),
      true
    );
    assert.equal(
      isSeekableHealGroundEffect(zone({ id: 'c', kind: 'TOTEM', spellId: 'spirit_link', x: 0, y: 0 })),
      true
    );
    assert.equal(
      isSeekableHealGroundEffect(zone({ id: 'd', kind: 'TOTEM', spellId: 'mana_tide', x: 0, y: 0 })),
      false
    );
    assert.equal(
      isSeekableHealGroundEffect(zone({ id: 'e', kind: 'TOTEM', spellId: 'windfury_totem', x: 0, y: 0 })),
      false
    );
    assert.equal(
      isSeekableHealGroundEffect(
        zone({ id: 'f', kind: 'TOTEM', spellId: 'healing_tide', x: 0, y: 0, remainingMs: 0 })
      ),
      false
    );
  });

  it('2. pickNearestGroundEffect 选空间最近', () => {
    const near = zone({ id: 'near', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 50, y: 0 });
    const far = zone({ id: 'far', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 300, y: 0 });
    const picked = pickNearestGroundEffect([far, near], { x: 0, y: 0 });
    assert.equal(picked?.id, 'near');
  });

  it('3. 非近战缺血时会走向治疗之潮图腾（非仅 HEAL_ZONE）', () => {
    const unit = ally({
      id: 'mage_1',
      role: 'DPS',
      classId: 'MAGE',
      hp: 3000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
    });
    // radius=80 → centers must be >80 away so unit is outside both circles
    const farRain = zone({ id: 'rain_far', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 400, y: 0 });
    const nearTide = zone({ id: 'tide_near', kind: 'TOTEM', spellId: 'healing_tide', x: 120, y: 0 });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 0, y: 0 },
      unit,
      groundEffects: [farRain, nearTide],
      defaultTarget: { x: 0, y: 0 },
      smartness: 1,
    });
    assert.equal(result.tradeOffDecision, 'SEEK_HEAL_ZONE');
    // 两圈不重叠时叠层同为 1 → 聪明 AI 同叠层取更近（潮图腾）
    assert.equal(result.currentHealZoneId, 'tide_near');
  });

  it('4. 多个互不重叠治疗光圈且叠层相同时取更近', () => {
    const unit = ally({
      id: 'priest_1',
      role: 'HEALER',
      classId: 'PRIEST',
      hp: 2000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
    });
    // radius=80 → 间距须明显 >160，避免边界点被算成叠层 2
    const zones = [
      zone({ id: 'z1', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 600, y: 0 }),
      zone({ id: 'z2', kind: 'TOTEM', spellId: 'spirit_link', x: 150, y: 0 }),
      zone({ id: 'z3', kind: 'HEAL_ZONE', spellId: 'efflorescence', x: 380, y: 0 }),
    ];
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 0, y: 0 },
      unit,
      groundEffects: zones,
      defaultTarget: { x: 0, y: 0 },
      smartness: 1,
    });
    assert.equal(result.tradeOffDecision, 'SEEK_HEAL_ZONE');
    assert.equal(countHealAurasAt(result.targetPos, zones), 1);
    assert.equal(result.currentHealZoneId, 'z2');
  });

  it('5. 不聪明时同叠层更倾向更远的治疗光圈', () => {
    const unit = ally({
      id: 'dumb_mage',
      role: 'DPS',
      classId: 'MAGE',
      hp: 3000,
      maxHp: 10000,
      position: { x: 0, y: 0 },
    });
    const farRain = zone({ id: 'rain_far', kind: 'HEAL_ZONE', spellId: 'healing_rain', x: 400, y: 0 });
    const nearTide = zone({ id: 'tide_near', kind: 'TOTEM', spellId: 'healing_tide', x: 120, y: 0 });
    const result = evaluateGroundFormationPosition({
      currentPos: { x: 0, y: 0 },
      unit,
      groundEffects: [farRain, nearTide],
      defaultTarget: { x: 0, y: 0 },
      smartness: 0,
    });
    assert.equal(result.tradeOffDecision, 'SEEK_HEAL_ZONE');
    assert.equal(result.currentHealZoneId, 'rain_far');
  });
});
