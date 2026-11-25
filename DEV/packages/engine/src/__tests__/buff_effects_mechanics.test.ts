/**
 * 团队增益数值 & 无敌/减伤真实结算。
 * 旧测试未覆盖原因见文件末尾。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatEngine,
  getEffectiveUnitStats,
  getIncomingDamageMultiplier,
  unitHasImmunity,
} from '../index.js';
import { makeHealer, makeAlly, makeBoss, registerClassSpells, castAndResolve } from './helpers/combatFixtures.js';

describe('Buff 机械效果：团队增益 / 无敌 / 减伤', () => {
  it('1. 野性印记提高有效法强/攻强（+5%），并提高 maxHp 与 maxMp', () => {
    const engine = new CombatEngine();
    const u = makeHealer('DRUID', { id: 'd1' });
    u.stats = { ...u.stats, spellPower: 10000, attackPower: 8000, armor: 1000, critChance: 0.2, haste: 0.5, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 };
    const maxBefore = u.maxHp;
    const mpBefore = u.maxMp || 0;
    const spBefore = getEffectiveUnitStats(u).spellPower;
    engine.addUnit(u);

    engine.applyBuff(u, {
      id: 'motw_1',
      spellId: 'mark_of_the_wild',
      name: '野性印记',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: u.id,
      targetUnitId: u.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 3600000,
      remainingMs: 3600000,
    });

    const eff = getEffectiveUnitStats(u);
    assert.equal(eff.spellPower, Math.round(spBefore * 1.05));
    assert.equal(eff.attackPower, Math.round(8000 * 1.05));
    assert.ok(u.maxHp > maxBefore, '耐力代理应提高 maxHp');
    assert.equal(u.maxHp, Math.round(maxBefore * 1.05));
    assert.ok(mpBefore > 0, '治疗应有蓝');
    assert.equal(u.maxMp, Math.round(mpBefore * 1.05), '智力代理应提高 maxMp');
  });

  it('2. 奥术光辉：法强↑、暴击+5%、maxMp+10%', () => {
    const engine = new CombatEngine();
    const u = makeHealer('MAGE', { id: 'm1' });
    u.stats = { ...u.stats, spellPower: 10000, attackPower: 0, armor: 0, critChance: 0.2, haste: 0.5, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 };
    const mpBefore = u.maxMp || 0;
    engine.addUnit(u);
    engine.applyBuff(u, {
      id: 'ab',
      spellId: 'arcane_brilliance',
      name: '奥术光辉',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: u.id,
      targetUnitId: u.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 1000,
      remainingMs: 1000,
    });
    const eff = getEffectiveUnitStats(u);
    assert.equal(eff.spellPower, Math.round(10000 * 1.1));
    assert.ok(Math.abs(eff.critChance - 0.25) < 1e-9);
    assert.equal(u.maxMp, Math.round(mpBefore * 1.1));
  });

  it('3. 圣盾 / 寒冰屏障：unitHasImmunity + applyDamage 不掉血', () => {
    const engine = new CombatEngine();
    const pala = makeAlly('pala', 1);
    pala.hp = 50000;
    pala.maxHp = 50000;
    const boss = makeBoss();
    engine.addUnit(pala);
    engine.addUnit(boss);

    engine.applyBuff(pala, {
      id: 'ds',
      spellId: 'divine_shield',
      name: '圣盾术',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: pala.id,
      targetUnitId: pala.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 8000,
      remainingMs: 8000,
    });
    assert.equal(unitHasImmunity(pala, 'PHYSICAL'), true);
    assert.equal(getIncomingDamageMultiplier(pala, 'FIRE'), 0);

    const hp0 = pala.hp;
    engine.applyDamage(boss.id, pala.id, 20000, false, 'boss_swing', 'PHYSICAL');
    assert.equal(pala.hp, hp0, '圣盾期间不应掉血');
  });

  it('4. 树皮术 20% 减伤；冰封之韧 50% 减伤', () => {
    assert.equal(
      getIncomingDamageMultiplier(
        {
          buffs: [{ spellId: 'barkskin' }],
        } as any,
        'PHYSICAL'
      ),
      0.8
    );
    assert.equal(
      getIncomingDamageMultiplier(
        {
          buffs: [{ spellId: 'icebound_fortitude' }],
        } as any,
        'PHYSICAL'
      ),
      0.5
    );

    const engine = new CombatEngine();
    const druid = makeAlly('druid', 1);
    druid.hp = 100000;
    druid.maxHp = 100000;
    druid.absorb = 0;
    const boss = makeBoss();
    engine.addUnit(druid);
    engine.addUnit(boss);

    engine.applyBuff(druid, {
      id: 'bs',
      spellId: 'barkskin',
      name: '树皮术',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: druid.id,
      targetUnitId: druid.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 12000,
      remainingMs: 12000,
    });

    const hp0 = druid.hp;
    engine.applyDamage(boss.id, druid.id, 10000, false, 'boss_cleave', 'PHYSICAL');
    assert.equal(druid.hp, hp0 - 8000, '树皮应只吃 80% 伤害');
  });

  it('5. castSpell 寒冰屏障后免疫伤害', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'MAGE');
    const mage = makeHealer('MAGE', { id: 'mage', mp: 50_000, maxMp: 50_000 });
    mage.hp = 40000;
    mage.maxHp = 40000;
    const boss = makeBoss();
    engine.addUnit(mage);
    engine.addUnit(boss);

    assert.equal(castAndResolve(engine, 'mage', 'mage_ice_block', mage.id), true);
    assert.ok(
      mage.buffs.some(b => (b.spellId || '').includes('ice_block')),
      '应挂上寒冰屏障 buff'
    );
    const hp0 = mage.hp;
    engine.applyDamage(boss.id, mage.id, 25000, true, 'pyroblast', 'FIRE');
    assert.equal(mage.hp, hp0, '冰箱期间火焰伤害免疫');
  });

  it('6. 白骨之盾：施放初始 6 层与 20% 减伤，受击扣 1 层，2 秒内置 CD 保护，扣完移除', () => {
    const engine = new CombatEngine();
    registerClassSpells(engine, 'DK');
    const dk = makeAlly('dk_tank', 1, { classId: 'DK', role: 'TANK' });
    dk.hp = 100_000;
    dk.maxHp = 100_000;
    const boss = makeBoss();
    engine.addUnit(dk);
    engine.addUnit(boss);

    // 施放白骨之盾
    assert.equal(castAndResolve(engine, 'dk_tank', 'dk_bone_shield', 'dk_tank'), true);
    const bsBuff = dk.buffs.find(b => b.spellId === 'bone_shield');
    assert.ok(bsBuff, '应挂上白骨之盾 buff');
    assert.equal(bsBuff?.stacks, 6, '初始层数应为 6 层');
    assert.equal(bsBuff?.durationMs, 300_000, '持续时间应为 5 分钟 (300_000ms)');

    // 第 1 次受击：10000 原始伤害经过 20% 减伤实扣 8000，且消耗 1 层骨盾 (6 -> 5)
    const hp0 = dk.hp;
    engine.applyDamage(boss.id, dk.id, 10000, false, 'boss_hit', 'PHYSICAL');
    assert.equal(dk.hp, hp0 - 8000, '骨盾提供 20% 减伤');
    assert.equal(bsBuff?.stacks, 5, '受击后骨盾消耗 1 层变为 5 层');

    // 500ms 后立刻第 2 次受击（受制于 2s 内置 CD，骨盾不重复扣层，但减伤依然生效）
    engine.tick(500);
    const hp1 = dk.hp;
    engine.applyDamage(boss.id, dk.id, 10000, false, 'boss_hit_fast', 'PHYSICAL');
    assert.equal(dk.hp, hp1 - 8000, '2s 内置 CD 期间 20% 减伤依然生效');
    assert.equal(bsBuff?.stacks, 5, '2s 内置 CD 内再次受击不应重复扣除层数');

    // 推进 2000ms（总计经过 2.5s，已过内置 CD）第 3 次受击：应再次扣 1 层 (5 -> 4)
    engine.tick(2000);
    const hp2 = dk.hp;
    engine.applyDamage(boss.id, dk.id, 10000, false, 'boss_hit_after_icd', 'PHYSICAL');
    assert.equal(dk.hp, hp2 - 8000, '减伤依然生效');
    assert.equal(bsBuff?.stacks, 4, '冷却过后受击应扣除第 2 层变为 4 层');

    // 依次消耗剩余 4 层（4 -> 3 -> 2 -> 1 -> 0 移除）
    for (let remaining = 3; remaining >= 0; remaining--) {
      engine.tick(2000);
      engine.applyDamage(boss.id, dk.id, 10000, false, 'boss_strike', 'PHYSICAL');
      if (remaining > 0) {
        assert.equal(bsBuff?.stacks, remaining);
      }
    }

    // 验证全部层数消耗后 buff 被彻底移除，且再次受击失去 20% 减伤
    assert.equal(dk.buffs.some(b => b.spellId === 'bone_shield'), false, '层数耗尽后白骨之盾应彻底移除');
    const hpLast = dk.hp;
    engine.tick(2000);
    engine.applyDamage(boss.id, dk.id, 10000, false, 'boss_normal_hit', 'PHYSICAL');
    assert.equal(dk.hp, hpLast - 10000, '骨盾移除后承受全额 10000 伤害');
  });

});

/*
 * 为何旧测试没覆盖：
 * 1. 技能 suite 只断言「能施放 / 有 buff / 有数字标签」，从不对比「有 buff 前后伤害或法强」。
 * 2. 无「挂圣盾再挨打」或「挂树皮再 applyDamage」的负例。
 * 3. Calculator 单测缺失；CombatEngine 伤害路径从未断言免疫飘字或 HP 不变。
 * 4. 团队增益测试只验落点人数与 rangePx，不验 getEffectiveUnitStats / maxHp。
 */
