/**
 * Lifebloom: living friendlies OK; totems never valid targets.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { EffectsManager } from '../engine/EffectsManager.js';
import {
  createSpawnedUnit,
  isTotemGroundEffectId,
  isTotemUnit,
  isValidLifebloomTarget,
} from '../engine/UnitSpawn.js';
import type { Unit } from '../types.js';

function makeAlly(id: string, name = '友方'): Unit {
  return createSpawnedUnit({
    id,
    name,
    unitKind: 'AI',
    role: 'HEALER',
    classId: 'DRUID',
    hp: 80_000,
    maxHp: 100_000,
    position: { x: 200, y: 200 },
  });
}

describe('生命绽放目标：友方有效，图腾无效', () => {
  it('1. isTotemUnit / isValidLifebloomTarget 识别图腾与友方', () => {
    const ally = makeAlly('druid_1', '奶德');
    const totemByName = makeAlly('npc_1', '治疗之潮图腾');
    const totemBySpell = createSpawnedUnit({
      id: 'pet_tide',
      name: '潮汐',
      unitKind: 'PET',
      summonSpellId: 'healing_tide_totem',
      ownerId: 'shaman_1',
      hp: 5000,
    });
    const totemById = makeAlly('htt_12345', '奇怪单位');

    assert.equal(isTotemUnit(ally), false);
    assert.equal(isValidLifebloomTarget(ally), true);

    assert.equal(isTotemUnit(totemByName), true);
    assert.equal(isValidLifebloomTarget(totemByName), false);

    assert.equal(isTotemUnit(totemBySpell), true);
    assert.equal(isValidLifebloomTarget(totemBySpell), false);

    assert.equal(isTotemUnit(totemById), true);
    assert.equal(isValidLifebloomTarget(totemById), false);

    const boss = createSpawnedUnit({
      id: 'boss',
      name: 'Boss',
      unitKind: 'BOSS',
      role: 'ENEMY',
      classId: 'BOSS',
      hp: 1_000_000,
    });
    assert.equal(isValidLifebloomTarget(boss), false);
  });

  it('2. 地面图腾特效 id 不算有效生命绽放目标', () => {
    const engine = new CombatEngine();
    engine.effectsManager = new EffectsManager(engine);
    const ally = makeAlly('tank_1', '主坦');
    engine.addUnit(ally);
    engine.effectsManager.addGroundEffect({
      id: 'htt_live',
      kind: 'TOTEM',
      spellId: 'healing_tide',
      ownerId: ally.id,
      x: 220,
      y: 200,
      radius: 320,
      colorHex: '#0EA5E9',
      remainingMs: 10_000,
    });
    assert.equal(isTotemGroundEffectId(engine, 'htt_live'), true);
    assert.equal(isTotemGroundEffectId(engine, ally.id), false);
    assert.equal(isValidLifebloomTarget(ally, engine), true);
  });

  it('3. AuraManager：对图腾单位施加生命绽放应被拒绝', () => {
    const engine = new CombatEngine();
    const druid = makeAlly('resto_1', '奶德');
    const totem = makeAlly('htt_fake', '治疗之潮图腾');
    engine.addUnit(druid);
    engine.addUnit(totem);

    engine.applyBuff(totem, {
      id: 'lb_bad',
      spellId: 'lifebloom',
      name: '生命绽放 (1层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: druid.id,
      targetUnitId: totem.id,
      stacks: 1,
      maxStacks: 3,
      durationMs: 15_000,
      remainingMs: 15_000,
      school: 'NATURE',
      tickIntervalMs: 2000,
      tickValue: 2400,
    });
    assert.equal(
      totem.buffs.some((b) => b.spellId === 'lifebloom'),
      false,
      '图腾上不应有生命绽放'
    );

    engine.applyBuff(druid, {
      id: 'lb_ok',
      spellId: 'lifebloom',
      name: '生命绽放 (1层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: druid.id,
      targetUnitId: druid.id,
      stacks: 1,
      maxStacks: 3,
      durationMs: 15_000,
      remainingMs: 15_000,
      school: 'NATURE',
      tickIntervalMs: 2000,
      tickValue: 2400,
    });
    assert.ok(druid.buffs.some((b) => b.spellId === 'lifebloom'), '友方应能上生命绽放');
  });
});
