/**
 * Asphyxiate fix + iteration B: Springvale cone/adds, Godfrey ghouls, Silverlaine worgen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI } from '../bosses/index.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup(bossId: string, bossName: string) {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss(bossId, {
    id: bossId,
    name: bossName,
    maxHp: 2_000_000,
    hp: 2_000_000,
    position: { x: 500, y: 200 },
  });
  const tank = makeTank('WARRIOR', {
    id: 'tank',
    hp: 65_000,
    maxHp: 65_000,
    position: { x: 200, y: 200 },
  });
  const healer = makeUnit({
    id: 'healer',
    role: 'HEALER',
    classId: 'SHAMAN',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 220, y: 210 },
  });
  // Add boss first so bossUnit getter prefers it (unitKind BOSS / classId BOSS)
  boss.unitKind = 'BOSS';
  boss.classId = 'BOSS';
  engine.addUnit(boss);
  engine.addUnit(tank);
  engine.addUnit(healer);
  return { engine, boss, tank, healer };
}

describe('影牙：窒息术修复 + 迭代 B', () => {
  it('1. 窒息术 6s 引导：昏迷、每秒扣 (maxHp-1)/6、满血无治疗恰剩 1', () => {
    const { engine, boss, tank, healer } = setup('ashbury', '亚什布里男爵');
    const ai = createBossAI('ashbury', 'shadowfang_keep');
    const skill = ai.skills.find(s => s.id === 'asphyxiate')!;
    assert.equal(skill.castTimeMs, 6000);

    tank.hp = tank.maxHp;
    healer.hp = healer.maxHp;
    const tankSlice = Math.round((tank.maxHp - 1) / 6);

    ai.currentCasting = { skill, elapsedMs: 0 };
    ai.asphyxiatePostDelay = 0;

    // First tick applies stun
    ai.tick(50, boss, engine);
    assert.ok(engine.isUnitCrowdControlled(tank), '坦克应昏迷');
    assert.ok(engine.isUnitCrowdControlled(healer), '治疗应昏迷');

    // After first 1s tick: about one sixth gone (not snapped to 1)
    for (let i = 0; i < 10; i++) ai.tick(100, boss, engine);
    assert.ok(tank.hp > 1, '第 1 跳后不应已是 1 血');
    assert.ok(tank.hp <= tank.maxHp - tankSlice + 2, '第 1 跳约扣 1/6');

    // Finish remaining channel
    for (let i = 0; i < 60; i++) ai.tick(100, boss, engine);

    assert.equal(tank.hp, 1, '满血无治疗六跳后恰为 1');
    assert.equal(healer.hp, 1, '治疗同理恰为 1');
    assert.equal(tank.isAlive, true, '坦克不应死亡');
    assert.equal(healer.isAlive, true, '治疗不应死亡');
    assert.equal(engine.isUnitCrowdControlled(tank), false, '结束后应解除昏迷');
    assert.ok(engine.isBossHealingGraceActive(), '应进入安全治疗窗');
  });

  it('1b. 窒息结束后：2s 禁止任何行为 + 共 7s 技能锁（其间仅普攻）', () => {
    const { engine, boss, tank } = setup('ashbury', '亚什布里男爵');
    const ai = createBossAI('ashbury', 'shadowfang_keep');
    const skill = ai.skills.find(s => s.id === 'asphyxiate')!;

    skill.execute(boss, engine);
    assert.equal(ai.asphyxiatePostDelay, 7000, '技能锁定 2s+5s=7s');
    assert.equal(engine.bossHealingGraceRemainingMs, 2000, '前 2s 禁止任何行为');
    assert.equal(ai.isActionLocked(), true);

    // 2s 禁伤窗内普攻无效
    const hp0 = tank.hp;
    engine.dealDamage(boss, tank, 20_000, 'PHYSICAL', false, '首领普通攻击');
    assert.equal(tank.hp, hp0, '2s 安全窗内普攻应被阻断');

    // 推进 1s：仍处于 2s 禁伤窗内
    engine.tick(1000);
    ai.tick(1000, boss, engine);
    assert.equal(engine.bossHealingGraceRemainingMs, 1000, '1s 时仍剩 1s 禁伤窗');
    engine.dealDamage(boss, tank, 20_000, 'PHYSICAL', false, '首领普通攻击');
    assert.equal(tank.hp, hp0, '1s 时普攻仍应被阻断');

    // 再推进 1s（共 2s）：禁伤解除，技能仍锁 5s
    engine.tick(1000);
    ai.tick(1000, boss, engine);
    assert.equal(engine.bossHealingGraceRemainingMs, 0);
    assert.ok(ai.asphyxiatePostDelay > 0, '仍在 5s 仅普攻阶段');
    assert.equal(ai.isActionLocked(), true, '仅普攻阶段仍禁止放技能');

    engine.dealDamage(boss, tank, 5_000, 'PHYSICAL', false, '首领普通攻击');
    assert.ok(tank.hp < hp0, '2s 禁止行为结束后可普攻仇恨目标');

    // 再推进剩余技能锁
    const remain = ai.asphyxiatePostDelay;
    engine.tick(remain);
    ai.tick(remain, boss, engine);
    assert.equal(ai.asphyxiatePostDelay, 0);
    assert.equal(ai.isActionLocked(), false, '7s 后允许其他技能');
  });

  it('2. 席瓦莱恩召唤真实狼人增援单位', () => {
    const { engine, boss } = setup('silverlaine', '席瓦莱恩男爵');
    const ai = createBossAI('silverlaine', 'shadowfang_keep');
    const skill = ai.skills.find(s => s.id === 'summon_worgen')!;
    skill.execute(boss, engine);
    const adds = engine.enemyUnits.filter(e => e.summonSpellId === 'summon_worgen');
    assert.equal(adds.length, 1);
    assert.ok((adds[0].hp || 0) > 1000);
    assert.equal(adds[0].unitKind, 'ADD');
  });

  it('3. 高弗雷召唤食尸鬼；弹幕按引擎时钟结算', () => {
    const { engine, boss, tank } = setup('godfrey', '高弗雷勋爵');
    tank.position = { x: 530, y: 200 }; // in cone danger near boss
    const ai = createBossAI('godfrey', 'shadowfang_keep');
    const summon = ai.skills.find(s => s.id === 'summon_ghouls')!;
    summon.execute(boss, engine);
    const ghouls = engine.enemyUnits.filter(e => e.summonSpellId === 'bloodthirsty_ghoul');
    assert.equal(ghouls.length, 4);

    const barrage = ai.skills.find(s => s.id === 'pistol_barrage')!;
    // Simulate cast complete → execute schedules resolve
    barrage.execute(boss, engine);
    // Advance boss AI / engine time
    for (let i = 0; i < 35; i++) {
      engine.tick(100);
      ai.tick(100, boss, engine);
    }
    assert.ok(tank.hp < 65_000, '弹幕应造成伤害');
  });

  it('4. 斯普林瓦尔开场刷增援', () => {
    const { engine, boss } = setup('springvale', '指挥官斯普林瓦尔');
    const ai = createBossAI('springvale', 'shadowfang_keep');
    ai.tick(100, boss, engine);
    const adds = engine.enemyUnits.filter(
      e => e.summonSpellId === 'wailing_guardsman' || e.summonSpellId === 'tormented_officer'
    );
    assert.ok(adds.length >= 2, '开场应有卫兵+军官');
  });
});
