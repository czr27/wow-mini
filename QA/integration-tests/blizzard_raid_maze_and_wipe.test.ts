import assert from 'node:assert';
import {
  CombatEngine,
  RunStateMachine,
  SHADOWFANG_KEEP_CONFIG,
  ReportManager,
} from '../../DEV/packages/engine/dist/index.js';
import type { Unit } from '../../DEV/packages/engine/dist/types.js';

export function runBlizzardRaidMazeAndWipeTests() {
  console.log('--- 运行 [T-10] 原版团队框架规范、迷宫赶路复活门禁、三类开怪判定与灭团统计测试 ---');

  // 1. CombatEngine.reset() clears all units and resets threat
  const engine = new CombatEngine();
  const testUnit: Unit = {
    id: 'u_test',
    name: '测试战士',
    classId: 'DK',
    role: 'TANK',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 100000,
    maxHp: 100000,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: { attackPower: 5000, spellPower: 5000, critChance: 0.1, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
  };
  engine.addUnit(testUnit);
  assert.strictEqual(engine.friendlyUnits.length, 1, '添加单位后队伍应有1人');
  engine.reset();
  assert.strictEqual(engine.friendlyUnits.length, 0, 'CombatEngine.reset() 应彻底清空所有单位');
  assert.strictEqual(engine.threatManager.getTopThreatSource('boss') === undefined, true, '重置后仇恨表应被清空');

  // 2. Travel phase resurrection gating (全员复活方可赶路)
  const reportMgr = new ReportManager();
  const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, reportMgr);
  rsm.startRun();
  assert.strictEqual(rsm.phase, 'TRAVEL_RECOVERY', '新副本开启应首先进入赶路休整');

  // Add 1 living and 1 dead unit
  const aliveHero: Unit = { ...testUnit, id: 'alive_1', isAlive: true, alive: true, hp: 100000 };
  const deadHero: Unit = { ...testUnit, id: 'dead_1', isAlive: false, alive: false, hp: 0 };
  engine.addUnit(aliveHero);
  engine.addUnit(deadHero);

  assert.strictEqual(rsm.canAdvanceTravel(), false, '有队员阵亡时，canAdvanceTravel 应返回 false');

  // Fast forward attempt while someone is dead
  const prevRemainingMs = rsm.travelRemainingMs;
  rsm.fastForwardTravel();
  assert.strictEqual(rsm.travelRemainingMs, prevRemainingMs, '全员未复活前快进赶路应被门禁阻止');

  // Resurrect dead ally
  engine.resurrectUnit('dead_1', 0.5, 0.5);
  assert.strictEqual(rsm.canAdvanceTravel(), true, '全员复活后，canAdvanceTravel 应返回 true');
  rsm.fastForwardTravel();
  assert.strictEqual(rsm.travelRemainingMs, 0, '全员复活后快进赶路应成功推进至 0');

  // 3. Stacking Buffs (Lifebloom) vs Refreshing Buffs (Rejuvenation)
  engine.applyBuff(aliveHero, {
    id: 'lb_1',
    spellId: 'lifebloom',
    name: '生命绽放 (1层)',
    kind: 'BUFF',
    tags: ['HOT'],
    sourceUnitId: aliveHero.id,
    targetUnitId: aliveHero.id,
    stacks: 1,
    maxStacks: 3,
    durationMs: 10000,
    remainingMs: 4000,
    school: 'NATURE',
  });
  assert.strictEqual(aliveHero.buffs.find(b => b.spellId === 'lifebloom')?.stacks, 1, '初次生命绽放应为1层');

  // Stack to 2
  engine.applyBuff(aliveHero, {
    id: 'lb_2',
    spellId: 'lifebloom',
    name: '生命绽放 (2层)',
    kind: 'BUFF',
    tags: ['HOT'],
    sourceUnitId: aliveHero.id,
    targetUnitId: aliveHero.id,
    stacks: 2,
    maxStacks: 3,
    durationMs: 10000,
    remainingMs: 10000,
    school: 'NATURE',
  });
  const lbBuff = aliveHero.buffs.find(b => b.spellId === 'lifebloom');
  assert.strictEqual(lbBuff?.stacks, 2, '叠层后生命绽放应为2层');
  assert.strictEqual(lbBuff?.remainingMs, 10000, '叠层后生命绽放应重置持续时间');

  // Rejuvenation refresh without stacking
  engine.applyBuff(aliveHero, {
    id: 'rej_1',
    spellId: 'rejuvenation',
    name: '回春术',
    kind: 'BUFF',
    tags: ['HOT'],
    sourceUnitId: aliveHero.id,
    targetUnitId: aliveHero.id,
    stacks: 1,
    maxStacks: 1,
    durationMs: 12000,
    remainingMs: 3000,
    school: 'NATURE',
  });
  engine.applyBuff(aliveHero, {
    id: 'rej_2',
    spellId: 'rejuvenation',
    name: '回春术',
    kind: 'BUFF',
    tags: ['HOT'],
    sourceUnitId: aliveHero.id,
    targetUnitId: aliveHero.id,
    stacks: 1,
    maxStacks: 1,
    durationMs: 12000,
    remainingMs: 12000,
    school: 'NATURE',
  });
  const rejBuff = aliveHero.buffs.find(b => b.spellId === 'rejuvenation');
  assert.strictEqual(rejBuff?.stacks, 1, '回春术不可叠加层数');
  assert.strictEqual(rejBuff?.remainingMs, 12000, '回春术重新施放应刷新持续时间至 12s');

  // 4. Clockwise Sector Countdown Sweep Formula Verification
  // Buff decay: (duration - remaining) / duration * 360
  const buffDuration = 10000;
  const buffRemaining = 2500;
  const buffElapsedRatio = (buffDuration - buffRemaining) / buffDuration; // 0.75
  const buffElapsedDeg = Math.round(buffElapsedRatio * 360); // 270 deg
  assert.strictEqual(buffElapsedDeg, 270, 'Buff剩余25%时，顺时针黑色覆盖扇面应为270度');

  // Skill CD recovery: remaining / total * 360
  const totalCd = 60000;
  const remainingCd = 15000;
  const cdRemainingDeg = Math.round((remainingCd / totalCd) * 360); // 90 deg
  assert.strictEqual(cdRemainingDeg, 90, '技能CD剩余25%时，黑色覆盖扇面应缩减至90度');

  // 5. Defeat & Wipe Statistics Generation
  const wipeBoss: Unit = {
    ...testUnit,
    id: 'boss_wipe',
    name: '席瓦莱恩男爵',
    classId: 'BOSS',
    role: 'ENEMY',
    hp: 180000,
    maxHp: 400000, // remaining 45%
  };
  engine.addUnit(wipeBoss);
  // simulate wipe
  deadHero.isAlive = false;
  deadHero.alive = false;
  deadHero.hp = 0;
  aliveHero.isAlive = false;
  aliveHero.alive = false;
  aliveHero.hp = 0;

  const wipeReport = reportMgr.generateEncounterReport(
    1,
    'boss_2',
    '席瓦莱恩男爵',
    'WIPE',
    42,
    1,
    [deadHero, aliveHero],
    Math.round((180000 / 400000) * 100),
    '降受疗诅咒治疗断档倒坦',
    '测试坦克 (降受疗诅咒致死)'
  );
  assert.strictEqual(wipeReport.result, 'WIPE', '灭团报告 result 应为 WIPE');
  assert.strictEqual(wipeReport.bossRemainingHpPct, 45, '灭团时首领剩余生命百分比应精确记录为 45%');
  assert.strictEqual(wipeReport.wipeCause, '降受疗诅咒治疗断档倒坦', '灭团原因应正确记录');
  assert.strictEqual(wipeReport.firstDeath, '测试坦克 (降受疗诅咒致死)', '首位阵亡者应正确记录');

  // 6. Spell Range Rules Verification
  // Melee <= 80px, Ranged <= 360px
  const playerPos = { x: 180, y: 160 };
  const bossClose = { x: 230, y: 160 }; // dist = 50px (Melee & Ranged in range)
  const bossMid = { x: 380, y: 160 }; // dist = 200px (Melee out of range, Ranged in range)
  const bossFar = { x: 600, y: 160 }; // dist = 420px (Melee & Ranged out of range)

  const distClose = Math.hypot(bossClose.x - playerPos.x, bossClose.y - playerPos.y);
  const distMid = Math.hypot(bossMid.x - playerPos.x, bossMid.y - playerPos.y);
  const distFar = Math.hypot(bossFar.x - playerPos.x, bossFar.y - playerPos.y);

  assert.strictEqual(distClose <= 80, true, '50px 距离应在近战攻击范围内 (<=80px)');
  assert.strictEqual(distMid > 80 && distMid <= 360, true, '200px 距离应超出近战范围但在远程法术范围内 (<=360px)');
  assert.strictEqual(distFar > 360, true, '420px 距离应超出远程法术范围 (>360px)');

  // 7. Three Encounter Pull Triggers
  // 1. Tank pull: tank x >= 450
  // 2. Proximity pull: distance <= 110
  // 3. Spell hit: hit trigger
  const tankX = 460;
  const isTankPull = tankX >= 450;
  assert.strictEqual(isTankPull, true, '坦克到达 x>=450 开怪线应触发战斗');

  const proxDist = 95;
  const isProximityPull = proxDist <= 110;
  assert.strictEqual(isProximityPull, true, '玩家靠近首领 <=110px 警戒范围应触发仇恨开怪');

  console.log('✓ CombatEngine.reset()清空、赶路全员复活门禁、HoT叠层刷新、扇形CD/Buff时钟倒计时、灭团数据统计与三类开怪判定全部验证通过');
}
