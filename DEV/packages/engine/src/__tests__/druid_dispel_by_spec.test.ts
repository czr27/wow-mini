/**
 * 德鲁伊驱散按专精：
 * - 平衡 / 野德：清除腐蚀（诅咒+中毒）
 * - 恢复：自然之愈（魔法+诅咒+中毒）
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import {
  getSpellByAnyId,
  getSpellsForClassSpec,
} from '../classes/ClassRegistry.js';
import { getPlayerDispelCapabilities } from '../../../web/src/components/RaidFrames.js';

describe('德鲁伊驱散按专精补齐', () => {
  it('平衡 / 野德有清除腐蚀；恢复有自然之愈', () => {
    const bal = getSpellsForClassSpec('DRUID', 'BALANCE');
    const fer = getSpellsForClassSpec('DRUID', 'FERAL');
    const resto = getSpellsForClassSpec('DRUID', 'RESTORATION');

    assert.ok(
      bal.some((s) => s.shortId === 'remove_corruption' || s.id.includes('remove_corruption')),
      '平衡应有清除腐蚀'
    );
    assert.ok(
      fer.some((s) => s.shortId === 'remove_corruption' || s.id.includes('remove_corruption')),
      '野德应有清除腐蚀'
    );
    assert.ok(
      resto.some((s) => s.shortId === 'natures_cure' || s.id.includes('natures_cure')),
      '恢复应有自然之愈'
    );

    const rc = getSpellByAnyId('remove_corruption', 'DRUID');
    const nc = getSpellByAnyId('natures_cure', 'DRUID');
    assert.ok(rc?.isDispel, '清除腐蚀 isDispel');
    assert.ok(nc?.isDispel, '自然之愈 isDispel');
    assert.equal(rc?.cooldownMs, 8_000);
    assert.equal(nc?.cooldownMs, 8_000);
  });

  it('驱散类型矩阵与专精一致', () => {
    assert.deepEqual(getPlayerDispelCapabilities('DRUID', 'BALANCE'), ['CURSE', 'POISON']);
    assert.deepEqual(getPlayerDispelCapabilities('DRUID', 'FERAL'), ['CURSE', 'POISON']);
    assert.deepEqual(getPlayerDispelCapabilities('DRUID', 'RESTORATION'), [
      'MAGIC',
      'CURSE',
      'POISON',
    ]);
    assert.deepEqual(getPlayerDispelCapabilities('DRUID', 'RESTO_HEAL'), [
      'MAGIC',
      'CURSE',
      'POISON',
    ]);
    assert.deepEqual(getPlayerDispelCapabilities('DRUID', 'RESTO'), [
      'MAGIC',
      'CURSE',
      'POISON',
    ]);
  });

  it('CombatEngine 中自然之愈能驱散魔法/诅咒/中毒，但不能驱散疾病；清除腐蚀仅能驱散诅咒/中毒', () => {
    const engine = new CombatEngine({ dungeonTier: '5man' });

    const druidResto = {
      id: 'druid_healer',
      name: '奶德',
      classId: 'DRUID',
      spec: 'RESTO_HEAL',
      role: 'HEALER',
      hp: 100000,
      maxHp: 100000,
      mp: 100000,
      maxMp: 100000,
      resources: [{ kind: 'MANA', current: 100000, max: 100000 }],
      isPlayer: true,
      isAlive: true,
      buffs: [],
    };
    const ally = {
      id: 'ally_target',
      name: '受害者队友',
      classId: 'WARRIOR',
      role: 'TANK',
      hp: 120000,
      maxHp: 120000,
      resources: [{ kind: 'RAGE', current: 0, max: 100 }],
      isAlive: true,
      buffs: [],
    };

    engine.addUnit(druidResto);
    engine.addUnit(ally);

    // 1. 测试魔法减益 (Magic)
    ally.buffs = [
      {
        id: 'debuff_magic_1',
        spellId: 'asphyxiate',
        name: '窒息',
        kind: 'DEBUFF',
        dispelType: 'MAGIC',
        tags: ['STAT'],
        sourceUnitId: 'boss',
        targetUnitId: ally.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
      },
    ];

    engine.castSpell('druid_healer', 'druid_natures_cure', 'ally_target');
    assert.equal(ally.buffs.length, 0, '恢复德自然之愈应成功驱散魔法减益 (asphyxiate)');

    engine.tick(8500);

    // 2. 测试中毒减益 (Poison)
    ally.buffs = [
      {
        id: 'debuff_poison_1',
        spellId: 'toxic_catalyst',
        name: '剧毒催化',
        kind: 'DEBUFF',
        dispelType: 'POISON',
        tags: ['DOT'],
        sourceUnitId: 'boss',
        targetUnitId: ally.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
      },
    ];
    engine.castSpell('druid_healer', 'druid_natures_cure', 'ally_target');
    assert.equal(ally.buffs.length, 0, '恢复德自然之愈应成功驱散中毒减益 (toxic_catalyst)');

    engine.tick(8500);

    // 3. 测试诅咒减益 (Curse)
    ally.buffs = [
      {
        id: 'debuff_curse_1',
        spellId: 'cursed_veins',
        name: '诅咒之脉',
        kind: 'DEBUFF',
        dispelType: 'CURSE',
        tags: ['STAT'],
        sourceUnitId: 'boss',
        targetUnitId: ally.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
      },
    ];
    engine.castSpell('druid_healer', 'druid_natures_cure', 'ally_target');
    assert.equal(ally.buffs.length, 0, '恢复德自然之愈应成功驱散诅咒减益 (cursed_veins)');

    engine.tick(8500);

    // 4. 测试疾病减益 (Disease - 德鲁伊不可驱散)
    ally.buffs = [
      {
        id: 'debuff_disease_1',
        spellId: 'necrotic_plague',
        name: '死疽疾病',
        kind: 'DEBUFF',
        dispelType: 'DISEASE',
        tags: ['DOT'],
        sourceUnitId: 'boss',
        targetUnitId: ally.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
      },
    ];
    engine.castSpell('druid_healer', 'druid_natures_cure', 'ally_target');
    assert.equal(ally.buffs.length, 1, '德鲁伊不可驱散疾病减益');

    engine.tick(8500);

    // 5. 非恢复德鲁伊（平衡德）使用清除腐蚀测试
    const druidBalance = {
      id: 'druid_boomkin',
      name: '鸟德',
      classId: 'DRUID',
      spec: 'BALANCE_DPS',
      role: 'DPS',
      hp: 100000,
      maxHp: 100000,
      mp: 100000,
      maxMp: 100000,
      resources: [{ kind: 'MANA', current: 100000, max: 100000 }],
      isAlive: true,
      buffs: [],
    };
    engine.addUnit(druidBalance);

    // 鸟德无法驱散魔法
    ally.buffs = [
      {
        id: 'debuff_magic_2',
        spellId: 'asphyxiate',
        name: '窒息',
        kind: 'DEBUFF',
        dispelType: 'MAGIC',
        tags: ['STAT'],
        sourceUnitId: 'boss',
        targetUnitId: ally.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
      },
    ];
    engine.castSpell('druid_boomkin', 'druid_remove_corruption', 'ally_target');
    assert.equal(ally.buffs.length, 1, '非恢复德清除腐蚀无法驱散魔法');

    engine.tick(8500);

    // 鸟德可以驱散诅咒
    ally.buffs = [
      {
        id: 'debuff_curse_2',
        spellId: 'cursed_veins',
        name: '诅咒之脉',
        kind: 'DEBUFF',
        dispelType: 'CURSE',
        tags: ['STAT'],
        sourceUnitId: 'boss',
        targetUnitId: ally.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
      },
    ];
    engine.castSpell('druid_boomkin', 'druid_remove_corruption', 'ally_target');
    assert.equal(ally.buffs.length, 0, '非恢复德清除腐蚀可以驱散诅咒');
  });
});
