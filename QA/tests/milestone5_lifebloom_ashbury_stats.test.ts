import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CombatEngine, SPELL_ID_TO_NAME } from '../../DEV/packages/engine/src/engine/CombatEngine.js';
import { BossAI } from '../../DEV/packages/engine/src/ai/BossAI.js';
import type { Unit } from '../../DEV/packages/engine/src/types.js';

describe('Milestone 5 — Lifebloom Independent Timers, Baron Ashbury Grace & Full Stats', () => {

  it('1. 影牙1号男爵窒息术后3秒治疗窗口：期间首领与环境严禁造成任何伤害', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('ashbury', '亚什布里男爵', 500000);
    const tank: Unit = {
      id: 'tank_1',
      name: '莫格莱尼',
      classId: 'DK',
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 85000,
      maxHp: 85000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 220 },
      stats: { attackPower: 1000, spellPower: 1000, critChance: 0.1, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    engine.addUnit(tank);

    const bossAi = new BossAI('ashbury');
    const asphyxiate = (bossAi as any).skills.find((s: any) => s.id === 'asphyxiate');
    assert.ok(asphyxiate, '必须包含窒息术技能');

    // 释放窒息术，全员降至1血
    asphyxiate.execute(boss, engine);
    assert.strictEqual(tank.hp, 1, '窒息术应将全员生命抽至1点');
    assert.strictEqual(engine.isBossHealingGraceActive(), true, '窒息术后安全治疗窗口必须激活');
    assert.strictEqual(bossAi.isActionLocked(), true, 'BossAI应处于行动锁定状态');

    // 在治疗窗口期内尝试对坦克普攻与环境伤害，验证被严格阻断
    engine.dealDamage(boss, tank, 25000, 'PHYSICAL', false, '首领普通攻击');
    assert.strictEqual(tank.hp, 1, '3秒安全治疗窗口期内，首领普攻伤害必须被完全阻断');

    engine.applyDamage(boss.id, tank.id, 8000, false, 'ambient_shadow', 'SHADOW');
    assert.strictEqual(tank.hp, 1, '3秒安全治疗窗口期内，环境暗影伤害必须被完全阻断');

    // 推进时间 3100ms（治疗窗口结束）
    engine.tick(3100);
    assert.strictEqual(engine.isBossHealingGraceActive(), false, '3秒后治疗窗口应已解除');

    // 窗口结束后，首领恢复正常造成伤害
    engine.dealDamage(boss, tank, 15000, 'PHYSICAL', false, '首领普通攻击');
    assert.ok(tank.hp < 1 || tank.hp === 0, '治疗窗口结束后首领可正常命中');
  });

  it('2. 生命绽放三层独立倒计时机制：最少层倒计时先走，到期-1层，叠满3层再施放重置最少层时长', () => {
    const engine = new CombatEngine();
    const healer: Unit = {
      id: 'druid_healer',
      name: '玛法里奥',
      classId: 'DRUID',
      role: 'HEALER',
      isPlayer: true,
      isAlive: true,
      alive: true,
      hp: 50000,
      maxHp: 75000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 180, y: 220 },
      stats: { attackPower: 1000, spellPower: 5000, critChance: 0.1, haste: 0, armor: 8000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    const tank: Unit = {
      id: 'tank_target',
      name: '莫格莱尼',
      classId: 'DK',
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 50000,
      maxHp: 85000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 220 },
      stats: { attackPower: 1000, spellPower: 1000, critChance: 0.1, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    engine.addUnit(healer);
    engine.addUnit(tank);

    // 施放第1层生命绽放 (10000ms)
    engine.auraManager.addBuff(tank, {
      spellId: 'lifebloom',
      name: '生命绽放 (1层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: healer.id,
      targetUnitId: tank.id,
      durationMs: 10000,
      maxStacks: 3,
      school: 'NATURE',
      tickIntervalMs: 1000,
      tickValue: 1200,
    });
    let lb = tank.buffs.find(b => b.spellId === 'lifebloom')!;
    assert.strictEqual(lb.stacks, 1);
    assert.strictEqual(lb.stackRemainingMs?.length, 1);
    assert.strictEqual(lb.remainingMs, 10000);

    // 推进 2000ms，第1层还剩 8000ms
    engine.tick(2000);
    lb = tank.buffs.find(b => b.spellId === 'lifebloom')!;
    assert.strictEqual(lb.stackRemainingMs?.[0], 8000);

    // 施放第2层生命绽放：第1层剩 8000ms，第2层是 10000ms
    engine.auraManager.addBuff(tank, {
      spellId: 'lifebloom',
      name: '生命绽放 (2层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: healer.id,
      targetUnitId: tank.id,
      durationMs: 10000,
      maxStacks: 3,
      school: 'NATURE',
      tickIntervalMs: 1000,
      tickValue: 1200,
    });
    lb = tank.buffs.find(b => b.spellId === 'lifebloom')!;
    assert.strictEqual(lb.stacks, 2);
    assert.strictEqual(lb.stackRemainingMs?.length, 2);
    // 框架显示的倒计时必须是最少那层 (8000ms)
    assert.strictEqual(lb.remainingMs, 8000);

    // 推进 2000ms，第1层剩 6000ms，第2层剩 8000ms
    engine.tick(2000);

    // 施放第3层生命绽放：第1层剩 6000ms，第2层剩 8000ms，第3层是 10000ms
    engine.auraManager.addBuff(tank, {
      spellId: 'lifebloom',
      name: '生命绽放 (3层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: healer.id,
      targetUnitId: tank.id,
      durationMs: 10000,
      maxStacks: 3,
      school: 'NATURE',
      tickIntervalMs: 1000,
      tickValue: 1200,
    });
    lb = tank.buffs.find(b => b.spellId === 'lifebloom')!;
    assert.strictEqual(lb.stacks, 3);
    assert.strictEqual(lb.remainingMs, 6000, '3层时框架阴影显示的倒计时必须是最少那层的时长(6000ms)');

    // 已经叠满三层后，再次施放生命绽放：必须重置最少倒计时那一层的时长为10000ms！
    engine.auraManager.addBuff(tank, {
      spellId: 'lifebloom',
      name: '生命绽放 (3层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: healer.id,
      targetUnitId: tank.id,
      durationMs: 10000,
      maxStacks: 3,
      school: 'NATURE',
      tickIntervalMs: 1000,
      tickValue: 1200,
    });
    lb = tank.buffs.find(b => b.spellId === 'lifebloom')!;
    assert.strictEqual(lb.stacks, 3);
    // 原来最少的 6000ms 被重置为 10000ms，现在的最少层变成了原来第2层的 8000ms！
    assert.strictEqual(lb.remainingMs, 8000, '满3层重置最少层后，新的最少层生效');

    // 推进 8500ms：最少那层到期归零，触发绽放，层数减1变为2层！
    engine.tick(8500);
    lb = tank.buffs.find(b => b.spellId === 'lifebloom')!;
    assert.ok(lb, '尚未全部流逝');
    assert.strictEqual(lb.stacks, 2, '最少层倒计时到期后，叠层自动-1');
  });

  it('3. 战斗统计(Details!)全成分细化与玩家全量统计覆盖', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('boss_dummy', '训练假人', 1000000);
    const player: Unit = {
      id: 'player_druid',
      name: '玩家治疗德',
      classId: 'DRUID',
      role: 'HEALER',
      isPlayer: true,
      isAlive: true,
      alive: true,
      hp: 50000,
      maxHp: 75000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 180, y: 220 },
      stats: { attackPower: 1000, spellPower: 5000, critChance: 0.1, haste: 0, armor: 8000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    engine.addUnit(player);

    // 1. 直伤法术测试：自动归类到具体技能名
    engine.applyDamage(player.id, boss.id, 15000, false, 'wrath', 'NATURE');
    assert.strictEqual(player.combatStats?.damageDealt, 15000);
    assert.strictEqual(player.combatStats?.skillDamage?.['愤怒'], 15000, '必须映射出中文法术名');

    // 2. 周期性 DoT (月火术) 跳字直接记录到 combatStats
    engine.applyDamage(player.id, boss.id, 4800, false, 'moonfire', 'ARCANE');
    assert.strictEqual(player.combatStats?.skillDamage?.['月火术'], 4800);

    // 3. 周期性 HoT (回春术) 跳字直接记录到 skillHealing
    engine.applyHeal(player.id, player.id, 8000, false, 0, 'rejuvenation');
    assert.strictEqual(player.combatStats?.healingDone, 8000);
    assert.strictEqual(player.combatStats?.skillHealing?.['回春术'], 8000);

    // 4. 地面法阵效果 (百花齐放)
    engine.applyHeal(player.id, player.id, 12000, false, 0, 'efflorescence');
    assert.strictEqual(player.combatStats?.skillHealing?.['百花齐放'], 12000);

    // 验证统计没有任何 fallback '普通攻击' 或 '治疗术' 污染
    assert.strictEqual(player.combatStats?.skillDamage?.['普通攻击'], undefined);
    assert.strictEqual(player.combatStats?.skillHealing?.['治疗术'], undefined);
  });

});
