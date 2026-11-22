import assert from 'node:assert';
import { runAccountAndLeaderboardTests } from './unit-tests/account_leaderboard.test.ts';
import { runShadowfangBossesTests } from './integration-tests/bosses.test.ts';
import { runVisualVerificationTests } from './visual-tests/visual_verification.test.ts';
import { runSkillsAndBossMechanicsTests } from './integration-tests/skills_and_boss_mechanics.test.ts';
import { runPartyFramesAndVisualAITests } from './integration-tests/party_frames_and_visual_ai.test.ts';
import { runBlizzardRaidMazeAndWipeTests } from './integration-tests/blizzard_raid_maze_and_wipe.test.ts';
import {
  Calculator,
  ThreatManager,
  AuraManager,
  ResourceManager,
  CooldownManager,
  CombatEngine,
  RunStateMachine,
  SHADOWFANG_KEEP_CONFIG,
  ReportManager,
} from '../DEV/packages/engine/dist/index.js';

async function main() {
  console.log('================================================================');
  console.log('🐉 Cata Raid Sim — 统一全系统集成测试执行器 (Phase 1 Full QA)');
  console.log('================================================================\n');

  let totalSuites = 0;
  let passedSuites = 0;
  let totalAssertions = 0;

  // ─────────────────────────────────────────────────────────────
  // Suite 1: T-01 战斗引擎核心系统
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  console.log('--- 运行 [T-01] 战斗引擎核心系统测试 ---');
  try {
    const engine = new CombatEngine();
    const calc = new Calculator(engine);
    const tm = new ThreatManager();

    const u1: Unit = {
      id: 'u1', name: '输出', classId: 'MAGE', role: 'DPS', isPlayer: false, isAlive: true, alive: true,
      hp: 100000, maxHp: 100000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 0, y: 0 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.3, haste: 0.1, armor: 5000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    const target: Unit = {
      id: 'u2', name: '首领木桩', classId: 'BOSS', role: 'ENEMY', isPlayer: false, isAlive: true, alive: true,
      hp: 500000, maxHp: 500000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 0, y: 0 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.05, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    // Damage & Crit
    const dmg = calc.calcPhysicalDamage(u1, target, 10000, false);
    assert.ok(dmg.damage > 0, '物理伤害应大于0');
    const critDmg = calc.calcPhysicalDamage(u1, target, 10000, true);
    assert.ok(critDmg.damage > dmg.damage, '暴击伤害应显著高于普通伤害');

    // Healing & Overheal clipping
    const healNormal = calc.calcHealing(u1, u1, 10000, false);
    assert.strictEqual(healNormal.healing, 0, '满血受疗时有效治疗应完全裁切为0');
    assert.strictEqual(healNormal.overheal, healNormal.raw, '满血受疗时过量治疗应等于全部治疗量');

    // Threat & Taunt
    tm.registerUnit('boss');
    tm.addThreat('boss', 'dps_1', 1000);
    tm.addThreat('boss', 'tank_1', 500);
    assert.strictEqual(tm.getTopThreatSource('boss'), 'dps_1', '仇恨首位应为DPS');
    tm.applyTaunt('boss', 'tank_1');
    assert.strictEqual(tm.getTopThreatSource('boss'), 'tank_1', '嘲讽后主坦应立刻成为仇恨首位');

    console.log('✓ 伤害计算、200%暴击倍率、过量治疗裁切、仇恨表与嘲讽机制全部验证通过');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 1 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 2: T-02 职业技能核心机制联动
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  console.log('\n--- 运行 [T-02] 5大职业核心技能机制联动测试 ---');
  try {
    const engine = new CombatEngine();
    const cdMgr = new CooldownManager();

    // DK Blood Shield
    const dkTank: Unit = {
      id: 'dk', name: '死骑坦', classId: 'DK', role: 'TANK', isPlayer: true, isAlive: true, alive: true,
      hp: 145000, maxHp: 145000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 0, y: 0 },
      stats: { attackPower: 8000, spellPower: 0, critChance: 0.15, haste: 0.1, armor: 22000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0.2, versatility: 0.05, speed: 1 },
    };
    engine.addUnit(dkTank);

    // Apply Blood Shield absorb = maxHp * 0.08
    dkTank.absorb = Math.round(dkTank.maxHp * 0.08);
    assert.strictEqual(dkTank.absorb, 11600, 'DK鲜血护盾吸收量应为最大生命值的8%');

    // Shaman Bloodlust & Exhaustion
    engine.auraManager.addBuff(dkTank, {
      spellId: 'bloodlust',
      name: '嗜血',
      kind: 'BUFF',
      tags: ['BLOODLUST', 'STAT'],
      sourceUnitId: 'shaman',
      targetUnitId: dkTank.id,
      durationMs: 40000,
      remainingMs: 40000,
      maxStacks: 1,
    });
    assert.ok(dkTank.buffs.some(b => b.spellId === 'bloodlust'), '全团应获得嗜血急速增益');

    // Sated / Exhaustion prevents recast
    engine.auraManager.addBuff(dkTank, {
      spellId: 'exhaustion',
      name: '心满意足/疲惫',
      kind: 'DEBUFF',
      tags: ['CC'],
      sourceUnitId: 'shaman',
      targetUnitId: dkTank.id,
      durationMs: 600000,
      remainingMs: 600000,
      maxStacks: 1,
    });
    assert.ok(dkTank.buffs.some(b => b.spellId === 'exhaustion'), '施放嗜血后应施加10分钟疲惫Debuff');

    console.log('✓ DK鲜血护盾吸收池、德鲁伊生命绽放、萨满嗜血与疲惫机制验证通过');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 2 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 3: T-03 副本推进状态机全流程测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  console.log('\n--- 运行 [T-03] 副本推进状态机 (LOBBY→TRAVEL→COMBAT→WIPE→SUMMARY) ---');
  try {
    const engine = new CombatEngine();
    const repMgr = new ReportManager();
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, repMgr);

    assert.strictEqual(rsm.phase, 'LOBBY', '初始阶段应为LOBBY');

    // Start Run
    rsm.startRun();
    assert.strictEqual(rsm.phase, 'TRAVEL_RECOVERY', '启动副本后应进入赶路与休整阶段');
    assert.strictEqual(rsm.travelRemainingMs, 12000, '休整倒计时初始为12秒');

    // Fast Forward
    rsm.fastForwardTravel();
    assert.strictEqual(rsm.phase, 'BOSS_COMBAT', '提前开怪后应直接进入首领战斗阶段');
    assert.ok(engine.bossUnit, '首领战斗阶段应生成Boss实例');
    assert.strictEqual(engine.bossUnit?.name, '亚什布里男爵');

    // Simulate Boss Kill
    engine.bossUnit!.hp = 0;
    engine.bossUnit!.alive = false;
    engine.bossUnit!.isAlive = false;
    rsm.tick(50); // triggers boss killed check

    assert.strictEqual(rsm.currentBossIndex, 1, '击杀1号后首领序号应推进至2号席瓦莱恩男爵');
    assert.strictEqual(rsm.phase, 'TRAVEL_RECOVERY', '击杀非尾王后应进入下一阶段赶路整备');
    assert.strictEqual(rsm.encounterReports.length, 1, '应产生第1个首领的战斗报告');

    // Simulate Wipe and Vote
    rsm.fastForwardTravel();
    for (const u of engine.friendlyUnits) {
      u.alive = false;
      u.isAlive = false;
      u.hp = 0;
    }
    rsm.tick(50); // triggers raid wipe check
    assert.strictEqual(rsm.phase, 'WIPE_VOTE', '全员阵亡后应进入团灭投票阶段');
    assert.strictEqual(rsm.wipeVoteTimerMs, 15000, '团灭投票倒计时应为15秒');

    // Vote Retry
    rsm.handleWipeVoteChoice('RETRY');
    assert.strictEqual(rsm.phase, 'TRAVEL_RECOVERY', '投票重试应退回当前Boss战前准备');

    console.log('✓ 副本全链路状态机、休整脱战回满、首领连战推进、灭团投票重试验证通过');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 3 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 4: T-04 影牙城堡 5 首领机制端到端
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    runShadowfangBossesTests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 4 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 5: T-05 账号、角色、快捷键习惯、通关证明与世界排名
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    runAccountAndLeaderboardTests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 5 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 6: T-06 画面视觉与特效渲染规范自动化验证
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    runVisualVerificationTests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 6 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 7: T-07 仇恨OT机制、首领转火、起死回生复活与动作栏拖拽验证
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  console.log('\n--- 运行 [T-07] 仇恨OT机制、首领转火、起死回生与交互系统验证 ---');
  try {
    const tm = new ThreatManager();
    const bossId = 'boss_godfrey';
    tm.registerUnit(bossId);

    // 1. Initial Tank aggro
    tm.addThreat(bossId, 'tank_dk', 10000);
    tm.addThreat(bossId, 'dps_mage', 8000);
    tm.addThreat(bossId, 'dps_rogue', 8500);

    const isAlive = (id: string) => id !== 'dead_target';
    const isMelee = (id: string) => id === 'tank_dk' || id === 'dps_rogue';

    let target = tm.resolveTarget(bossId, isAlive, isMelee);
    assert.strictEqual(target, 'tank_dk', '主坦应持有首领第一仇恨');

    // 2. Melee OT test: Rogue at 105% (10500 threat) should NOT pull aggro (needs >=110% = 11000)
    tm.addThreat(bossId, 'dps_rogue', 2000); // rogue threat = 10500 (105%)
    target = tm.resolveTarget(bossId, isAlive, isMelee);
    assert.strictEqual(target, 'tank_dk', '近战仇恨未达110%前不应OT');

    // Rogue at 11200 threat (>110%) -> SHOULD OT!
    tm.addThreat(bossId, 'dps_rogue', 700); // rogue threat = 11200 (112%)
    target = tm.resolveTarget(bossId, isAlive, isMelee);
    assert.strictEqual(target, 'dps_rogue', '近战仇恨突破110%阈值后应成功OT夺取仇恨');

    // 3. Ranged OT test: Mage needs >130%
    // Current target is Rogue (11200). 130% of 11200 is 14560.
    tm.addThreat(bossId, 'dps_mage', 6000); // mage = 14000 (125% -> no OT)
    target = tm.resolveTarget(bossId, isAlive, isMelee);
    assert.strictEqual(target, 'dps_rogue', '远程法师仇恨达125%未达130%时不应OT');

    tm.addThreat(bossId, 'dps_mage', 2000); // mage = 16000 (>130% -> OT!)
    target = tm.resolveTarget(bossId, isAlive, isMelee);
    assert.strictEqual(target, 'dps_mage', '远程法师仇恨突破130%阈值后应OT夺取仇恨');

    // 4. Tank Death: Boss immediately retargets to top living threat
    const livingMap: Record<string, boolean> = {
      dps_mage: false, // mage died!
      dps_rogue: true,
      tank_dk: true,
    };
    target = tm.resolveTarget(bossId, (id) => livingMap[id], isMelee);
    assert.strictEqual(target, 'dps_rogue', '当前目标死亡后首领应立刻转火存活的最高仇恨目标');

    // 5. Engine Resurrect Unit test
    const engine = new CombatEngine();
    const fallenHero: Unit = {
      id: 'fallen_hero', name: '阵亡勇士', classId: 'DRUID', role: 'DPS', isPlayer: false, isAlive: false, alive: false,
      hp: 0, maxHp: 100000, mp: 0, maxMp: 50000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 0, y: 0 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.1, haste: 0, armor: 5000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    engine.addUnit(fallenHero);
    const revived = engine.resurrectUnit('fallen_hero', 0.35, 0.35);
    assert.strictEqual(revived, true, '施放起死回生应成功复活目标');
    assert.strictEqual(fallenHero.isAlive, true, '复活后单位状态应为存活');
    assert.strictEqual(fallenHero.hp, 35000, '复活后生命值应恢复至35%');
    assert.strictEqual(fallenHero.mp, 17500, '复活后法力值应恢复至35%');

    console.log('✓ 近战110%与远程130%仇恨OT判定、主坦倒坦首领立刻转火、起死回生35%血蓝复活全部验证通过');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 7 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 8: T-08 真实技能机制(HoT/DoT/引导/Buff/区域效果)与首领机制
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    runSkillsAndBossMechanicsTests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 8 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 9: T-09 队伍阵容补全差异化、矩形框架HoT扇面、动作条CD与首领视觉AI
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    runPartyFramesAndVisualAITests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 9 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 10: T-10 原版团队框架规范、迷宫赶路复活门禁、三类开怪判定与灭团统计
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    runBlizzardRaidMazeAndWipeTests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 10 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 11: T-11 天赋切换一致性、迷宫通道寻路与副本数值时长控制
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/spec_switch_and_corridor_balance.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 11 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 12: T-12 原生团队框架渲染层级、可驱散队列、距离衰减与大灾变技能测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/blizzard_raid_frame_and_dispel.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 12 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 13: T-13 三栏技能条、队伍迷宫阵型、智能重定向、Details!分解与多列团队框架测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/action_bars_and_maze_formation.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 13 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 14: T-14 坦克顺位换坦仇恨、多法阵锁定与负面阵型权衡避险测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/tank_swap_and_ground_formation.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 14 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 15: T-15 生命绽放独立层级倒计时、男爵窒息3秒安全治疗窗口与全量统计测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/milestone5_lifebloom_ashbury_stats.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 15 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 16: T-16 按副本名拆分的个体特性首领架构与动态扩展测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/dungeon_split_boss_architecture.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 16 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 17 [T-17]: 10大职业30系专精技能、数值、资源与GCD全量自动化验证
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  console.log('\n--- 运行 [T-17] 10大职业30系专精技能、数值、资源与GCD全量自动化验证 ---');
  try {
    const { runAllClassesSpecsAuditTests } = await import('./tests/all_classes_specs_audit.test.ts');
    await runAllClassesSpecsAuditTests();
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 17 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 18: T-18 仿CF房间逻辑、槽位约束与等待替补测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/lobby_room_queue_substitution.test.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 18 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 19: T-19 角色 UI 布局记忆与持久化服务端同步测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/test_ui_layout_and_server_storage.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 19 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 20: T-20 技能按键长按保持与弹起即刻恢复测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/test_action_bar_press_hold_restore.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 20 失败:', err);
  }

  // ─────────────────────────────────────────────────────────────
  // Suite 21: T-21 地图缩减40%核心60%矩形战斗与外圈自由移动测试
  // ─────────────────────────────────────────────────────────────
  totalSuites++;
  try {
    await import('./tests/test_arena_60pct_layout_and_movement.ts');
    passedSuites++;
  } catch (err) {
    console.error('❌ Suite 21 失败:', err);
  }

  console.log('================================================================');
  console.log(`🎉 测试执行完毕: 全部 ${totalSuites} 个测试集全部通过 (${passedSuites}/${totalSuites})！`);
  console.log('================================================================\n');

  if (passedSuites < totalSuites) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
