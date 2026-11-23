import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from '../engine/CombatEngine.js';
import {
  getSpellByAnyId,
  getSpellGcdCategory,
  ALL_CLASSES_NORMALIZED,
  RANGE_40YD_PX,
} from '../classes/ClassRegistry.js';
import { GROUND_TARGET_SPELL_DEFS } from '../types.js';
import type { Unit } from '../types.js';
import { createLevel80BaseStats, LEVEL_80_STATS } from '../engine/TierProfile.js';

function makeShaman(overrides: Partial<Unit> = {}): Unit {
  const maxHp = overrides.maxHp ?? LEVEL_80_STATS.dpsHealerBaseHp;
  const maxMp = overrides.maxMp ?? LEVEL_80_STATS.healerBaseMp;
  const role = overrides.role ?? 'HEALER';
  const u: Unit = {
    id: overrides.id ?? 'shaman_1',
    name: overrides.name ?? '测试萨满',
    classId: 'SHAMAN',
    role,
    isPlayer: overrides.isPlayer ?? true,
    isAlive: true,
    alive: true,
    hp: overrides.hp ?? maxHp,
    maxHp,
    mp: overrides.mp ?? Math.round(maxMp * 0.5),
    maxMp,
    energy: 0,
    rage: 0,
    focus: 0,
    runicPower: 0,
    holyPower: 0,
    comboPoints: 0,
    absorb: 0,
    buffs: overrides.buffs ?? [],
    threatTable: [],
    resources: [{ kind: 'MANA', current: overrides.mp ?? Math.round(maxMp * 0.5), max: maxMp }],
    position: overrides.position ?? { x: 200, y: 200 },
    stats: createLevel80BaseStats(role === 'HEALER' ? 'HEALER' : 'DPS', 'SHAMAN'),
    combatStats: { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 },
  };
  if ((overrides as { spec?: string }).spec) {
    (u as { spec?: string }).spec = (overrides as { spec?: string }).spec;
  }
  return u;
}

function makeAlly(id: string, hpRatio = 0.5): Unit {
  const maxHp = LEVEL_80_STATS.dpsHealerBaseHp;
  return {
    id,
    name: id,
    classId: 'WARRIOR',
    role: 'TANK',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: Math.round(maxHp * hpRatio),
    maxHp,
    mp: 0,
    maxMp: 0,
    energy: 0,
    rage: 50,
    focus: 0,
    runicPower: 0,
    holyPower: 0,
    comboPoints: 0,
    absorb: 0,
    buffs: [],
    threatTable: [],
    resources: [],
    position: { x: 210, y: 210 },
    stats: createLevel80BaseStats('TANK', 'WARRIOR'),
  };
}

function makeEnemy(id = 'boss_1'): Unit {
  return {
    id,
    name: '测试首领',
    classId: 'BOSS',
    role: 'ENEMY',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 500000,
    maxHp: 500000,
    mp: 0,
    maxMp: 0,
    energy: 0,
    rage: 0,
    focus: 0,
    runicPower: 0,
    holyPower: 0,
    comboPoints: 0,
    absorb: 0,
    buffs: [],
    threatTable: [],
    resources: [],
    position: { x: 300, y: 200 },
    stats: createLevel80BaseStats('DPS', 'MAGE'),
  };
}

describe('萨满核心技能钩子与 80 级数值/GCD', () => {
  it('1. 关键技能在 ClassRegistry 中存在且数值/GCD 合理', () => {
    const required = [
      'shaman_ascendance',
      'shaman_ancestral_guidance',
      'shaman_healing_tide_totem',
      'shaman_earth_shield',
      'shaman_unleash_life',
      'shaman_chain_lightning',
      'shaman_lightning_bolt',
    ];
    for (const id of required) {
      const sp = getSpellByAnyId(id);
      assert.ok(sp, `缺少技能 ${id}`);
    }

    assert.equal(getSpellGcdCategory('ascendance', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('ancestral_guidance', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('healing_tide', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('earth_shield', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('unleash_life', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('chain_lightning', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('wind_shear', 'SHAMAN'), 'OFF_GCD');
    assert.equal(getSpellGcdCategory('bloodlust', 'SHAMAN'), 'NORMAL');
    assert.equal(getSpellGcdCategory('thunderstorm', 'SHAMAN'), 'NORMAL');

    const cl = getSpellByAnyId('chain_lightning', 'SHAMAN')!;
    assert.equal(cl.directDamage, 8600);
    assert.equal(cl.cooldownMs, 3000);
    assert.equal(cl.castTimeMs, 2000);

    const ht = getSpellByAnyId('healing_tide', 'SHAMAN')!;
    assert.ok(ht.isHeal);
    assert.equal(ht.cooldownMs, 180_000);
    assert.ok((ht.hotTotalHeal || 0) >= 5200 * 5);

    const es = getSpellByAnyId('earth_shield', 'SHAMAN')!;
    assert.ok(es.isBuff);
    assert.equal(es.auraId, 'earth_shield');

    const ul = getSpellByAnyId('unleash_life', 'SHAMAN')!;
    assert.equal(ul.directHeal, 8500);
    assert.equal(ul.cooldownMs, 15_000);
  });

  it('2. 大地之流：闪电链/闪电箭命中回蓝', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman({ mp: 10000, maxMp: 45000 });
    const boss = makeEnemy();
    engine.addUnit(shaman);
    engine.addUnit(boss);

    const before = shaman.mp ?? 0;
    engine.applyDamage(shaman.id, boss.id, 8600, false, 'chain_lightning', 'NATURE');
    assert.ok((shaman.mp ?? 0) > before, '闪电链命中后应回蓝');
    const afterCl = shaman.mp ?? 0;

    engine.applyDamage(shaman.id, boss.id, 8500, false, 'lightning_bolt', 'NATURE');
    assert.ok((shaman.mp ?? 0) > afterCl, '闪电箭命中后应回蓝');

    // 中文 spellId 同样生效
    const beforeCn = shaman.mp ?? 0;
    engine.applyDamage(shaman.id, boss.id, 8600, false, '闪电链', 'NATURE');
    assert.ok((shaman.mp ?? 0) > beforeCn, '中文闪电链 ID 也应触发大地之流');
  });

  it('3. 大地之盾：受击消耗层数治疗 + 受到施法者治疗 +20%', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman();
    // 低血量以确保 +20% 治疗不会被过量治疗裁切掩盖
    const tank = makeAlly('tank_1', 0.35);
    const boss = makeEnemy();
    engine.addUnit(shaman);
    engine.addUnit(tank);
    engine.addUnit(boss);

    engine.applyBuff(tank, {
      id: 'es_1',
      spellId: 'earth_shield',
      name: '大地之盾 (9层)',
      kind: 'BUFF',
      tags: ['SHIELD'],
      sourceUnitId: shaman.id,
      targetUnitId: tank.id,
      stacks: 9,
      maxStacks: 9,
      durationMs: 600_000,
      remainingMs: 600_000,
      school: 'NATURE',
    });

    const hpBefore = tank.hp;
    engine.applyDamage(boss.id, tank.id, 5000, false, 'boss_melee', 'PHYSICAL');
    assert.ok(tank.hp > hpBefore - 5000, '大地之盾受击应触发额外治疗');
    assert.equal(tank.buffs.find(b => b.spellId === 'earth_shield')?.stacks, 8);

    const healBefore = tank.hp;
    engine.applyHeal(shaman.id, tank.id, 10000, false, 0, 'healing_wave', false);
    assert.ok(tank.hp - healBefore >= 11900, '大地之盾目标应获得 +20% 治疗');
  });

  it('4. 生命释放：下一次直接治疗 +30%', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman();
    const ally = makeAlly('ally_1', 0.4);
    engine.addUnit(shaman);
    engine.addUnit(ally);

    engine.applyBuff(shaman, {
      id: 'ul_1',
      spellId: 'unleash_life',
      name: '生命释放',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: shaman.id,
      targetUnitId: shaman.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 10_000,
      remainingMs: 10_000,
      school: 'NATURE',
    });

    // HoT / 周期跳字不应消耗生命释放
    engine.applyHeal(shaman.id, ally.id, 5000, false, 0, 'riptide', false, true);
    assert.equal(shaman.buffs.some(b => b.spellId === 'unleash_life'), true, 'HoT 跳字不应消耗生命释放');

    const before = ally.hp;
    engine.applyHeal(shaman.id, ally.id, 10000, false, 0, 'healing_surge', false);
    assert.ok(ally.hp - before >= 12900, '生命释放应使下一次直接治疗 +30%');
    assert.equal(shaman.buffs.some(b => b.spellId === 'unleash_life'), false, '生命释放 buff 应被消耗');
  });

  it('4b. 生命释放：治疗之潮图腾跳字不消耗', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman();
    const ally = makeAlly('ally_tide', 0.4);
    engine.addUnit(shaman);
    engine.addUnit(ally);
    engine.applyBuff(shaman, {
      id: 'ul_tide',
      spellId: 'unleash_life',
      name: '生命释放',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: shaman.id,
      targetUnitId: shaman.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 10_000,
      remainingMs: 10_000,
      school: 'NATURE',
    });
    engine.healUnit(shaman, ally, 5200, false, '治疗之潮图腾', true);
    assert.equal(shaman.buffs.some(b => b.spellId === 'unleash_life'), true, '潮图腾跳字不应消耗生命释放');
  });

  it('5. 升腾：伤害 +35% 与治疗复制', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman({ spec: 'RESTORATION' } as Partial<Unit>);
    const allyA = makeAlly('a1', 0.3);
    const allyB = makeAlly('a2', 0.4);
    const allyFar = makeAlly('far', 0.2);
    allyFar.position = { x: 200 + RANGE_40YD_PX + 40, y: 200 };
    const boss = makeEnemy();
    engine.addUnit(shaman);
    engine.addUnit(allyA);
    engine.addUnit(allyB);
    engine.addUnit(allyFar);
    engine.addUnit(boss);

    engine.applyBuff(shaman, {
      id: 'asc_1',
      spellId: 'ascendance',
      name: '升腾',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: shaman.id,
      targetUnitId: shaman.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 15_000,
      remainingMs: 15_000,
      school: 'NATURE',
    });

    const bossHp = boss.hp;
    engine.applyDamage(shaman.id, boss.id, 10000, false, 'lava_burst', 'FIRE');
    assert.equal(bossHp - boss.hp, 13500, '升腾应使伤害 +35%');

    const aBefore = allyA.hp;
    const bBefore = allyB.hp;
    const farBefore = allyFar.hp;
    engine.applyHeal(shaman.id, shaman.id, 10000, false, 0, 'healing_wave', false);
    assert.ok(allyA.hp > aBefore || allyB.hp > bBefore, '升腾应复制治疗给附近受伤友方');
    assert.equal(allyFar.hp, farBefore, '升腾复制不应命中 40 码外友方');
  });

  it('5b. 升腾：元素专精有伤害增幅但无治疗复制', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman({ role: 'DPS', spec: 'ELEMENTAL' } as Partial<Unit>);
    const ally = makeAlly('hurt_ele', 0.3);
    const boss = makeEnemy();
    engine.addUnit(shaman);
    engine.addUnit(ally);
    engine.addUnit(boss);
    engine.applyBuff(shaman, {
      id: 'asc_ele',
      spellId: 'ascendance',
      name: '升腾',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: shaman.id,
      targetUnitId: shaman.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 15_000,
      remainingMs: 15_000,
      school: 'NATURE',
    });
    const bossHp = boss.hp;
    engine.applyDamage(shaman.id, boss.id, 10000, false, 'lava_burst', 'FIRE');
    assert.equal(bossHp - boss.hp, 13500, '元素升腾仍应伤害 +35%');
    const before = ally.hp;
    engine.applyHeal(shaman.id, shaman.id, 10000, false, 0, 'healing_surge', false);
    assert.equal(ally.hp, before, '非恢复专精升腾不应治疗复制');
  });

  it('6. 先祖指引：伤害 40% / 治疗 60% 转化为群体治疗', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman({ role: 'DPS' });
    const ally = makeAlly('hurt', 0.3);
    const boss = makeEnemy();
    engine.addUnit(shaman);
    engine.addUnit(ally);
    engine.addUnit(boss);

    engine.applyBuff(shaman, {
      id: 'ag_1',
      spellId: 'ancestral_guidance',
      name: '先祖指引',
      kind: 'BUFF',
      tags: ['STAT'],
      sourceUnitId: shaman.id,
      targetUnitId: shaman.id,
      stacks: 1,
      maxStacks: 1,
      durationMs: 10_000,
      remainingMs: 10_000,
      school: 'NATURE',
    });

    const beforeDmg = ally.hp;
    engine.applyDamage(shaman.id, boss.id, 10000, false, 'lightning_bolt', 'NATURE');
    assert.ok(ally.hp > beforeDmg, '先祖指引伤害转化治疗应生效');

    const beforeHeal = ally.hp;
    engine.applyHeal(shaman.id, shaman.id, 10000, false, 0, 'healing_surge', false);
    assert.ok(ally.hp - beforeHeal >= 5000, '先祖指引治疗转化应约为 60%');

    // HoT 跳字不应再触发 60% 转化
    const beforeHot = ally.hp;
    engine.applyHeal(shaman.id, shaman.id, 10000, false, 0, 'riptide', false, true);
    assert.equal(ally.hp, beforeHot, '先祖指引不应被 HoT 跳字触发');
  });

  it('7. 治疗之潮图腾：地面跳字治疗最多 5 名伤员', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman();
    const allies = [0.2, 0.3, 0.4, 0.5, 0.6, 0.9].map((r, i) => makeAlly(`ally_${i}`, r));
    engine.addUnit(shaman);
    for (const a of allies) engine.addUnit(a);

    engine.effectsManager.addGroundEffect({
      id: 'htt_test',
      kind: 'TOTEM',
      spellId: 'healing_tide',
      ownerId: shaman.id,
      x: 200,
      y: 200,
      radius: RANGE_40YD_PX, // 40 码
      colorHex: '#0EA5E9',
      remainingMs: 10_000,
      tickIntervalMs: 2_000,
      tickElapsedMs: 2_000,
      tickValue: 5200,
    });

    const before = allies.map(a => a.hp);
    engine.effectsManager.tick(50);
    const healedCount = allies.filter((a, i) => a.hp > before[i]).length;
    assert.ok(healedCount <= 5, '治疗之潮最多治疗 5 人');
    assert.ok(healedCount >= 1, '治疗之潮应至少治疗伤员');
    assert.ok(allies[0].hp > before[0], '血量最低者应优先被治疗之潮治疗');
  });

  it('8. 全职业技能非空壳：每个技能至少有一种真实效果标签', () => {
    for (const cls of Object.values(ALL_CLASSES_NORMALIZED)) {
      for (const sp of cls.allSpells) {
        const hasEffect =
          sp.isDamage ||
          sp.isHeal ||
          sp.isBuff ||
          sp.isShield ||
          sp.isInterrupt ||
          sp.isTaunt ||
          sp.isDispel ||
          sp.isResurrect ||
          sp.isResourceRestore ||
          sp.isDefensive ||
          Boolean(sp.groundKind);
        assert.ok(hasEffect, `${cls.id} 技能 ${sp.id} 不能是空壳`);
        assert.ok(
          sp.gcdCategory === 'NORMAL' || sp.gcdCategory === 'ROGUE' || sp.gcdCategory === 'OFF_GCD',
          `${sp.id} gcdCategory 非法: ${sp.gcdCategory}`
        );
      }
    }
  });

  it('9. castSpell 结算：治疗之潮图腾与大地之盾可真实生效', () => {
    const engine = new CombatEngine();
    const shaman = makeShaman({ mp: 45000, maxMp: 45000 });
    const ally = makeAlly('ally_es', 0.4);
    engine.addUnit(shaman);
    engine.addUnit(ally);

    const es = getSpellByAnyId('earth_shield', 'SHAMAN')!;
    const ht = getSpellByAnyId('healing_tide', 'SHAMAN')!;
    engine.registerSpell({
      id: es.id,
      name: es.name,
      classId: 'SHAMAN',
      castTimeMs: 0,
      cooldownMs: es.cooldownMs,
      school: es.school,
      targetType: 'SINGLE_ALLY',
      resourceCost: 'MANA',
      resourceCostAmount: es.resourceCostAmount,
      gcdCategory: es.gcdCategory,
      gcdType: 'normal',
      effects: [
        {
          type: 'BUFF',
          auraId: 'earth_shield',
          baseValue: 6800,
          durationMs: 600_000,
          maxStacks: 9,
        },
      ],
    } as any);
    engine.registerSpell({
      id: ht.id,
      name: ht.name,
      classId: 'SHAMAN',
      castTimeMs: 0,
      cooldownMs: ht.cooldownMs,
      school: ht.school,
      targetType: 'GROUND',
      resourceCost: 'MANA',
      resourceCostAmount: ht.resourceCostAmount,
      gcdCategory: ht.gcdCategory,
      gcdType: 'normal',
      effects: [
        {
          type: 'GROUND_EFFECT',
          groundKind: 'TOTEM',
          groundColorHex: '#38BDF8',
          groundRadius: 40,
          durationMs: 10_000,
          tickIntervalMs: 2_000,
          baseValue: 5200,
        },
      ],
    } as any);

    assert.equal(engine.castSpell(shaman.id, es.id, ally.id), true);
    assert.ok(ally.buffs.some(b => b.spellId === 'earth_shield'), '大地之盾应施加到友方');
    assert.equal(ally.buffs.find(b => b.spellId === 'earth_shield')?.stacks, 9);

    // 大地之盾进了 GCD，推进时间后再放下治疗之潮
    engine.tick(1100);
    assert.equal(engine.castSpell(shaman.id, ht.id, shaman.id), true);
    const ground = engine.effectsManager.groundEffects.find(
      (g: any) => g.spellId === 'healing_tide' || g.spellId === ht.id
    );
    assert.ok(ground, '治疗之潮图腾应生成地面效果');
    assert.equal(ground.kind, 'TOTEM');
    assert.equal(ground.tickValue, 5200);
    assert.equal(ground.radius, RANGE_40YD_PX, 'castSpell 治疗之潮半径应为 40 码');
    assert.equal(GROUND_TARGET_SPELL_DEFS.healing_tide.radius, RANGE_40YD_PX, 'GROUND_TARGET_SPELL_DEFS 应为 40 码');
  });
});
