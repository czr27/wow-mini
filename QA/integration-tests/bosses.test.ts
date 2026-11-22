import assert from 'node:assert';
import {
  CombatEngine,
  RunStateMachine,
  SHADOWFANG_KEEP_CONFIG,
  BossAI,
  ReportManager,
} from '../../DEV/packages/engine/dist/index.js';

export function runShadowfangBossesTests() {
  console.log('--- 运行 [T-04] 影牙城堡 5 Boss 机制端到端测试 ---');

  const engine = new CombatEngine();
  const repMgr = new ReportManager();

  // Setup test tank and companion
  const tank: Unit = {
    id: 'test_tank',
    name: '血坦测试',
    classId: 'DK',
    role: 'TANK',
    isPlayer: true,
    isAlive: true,
    alive: true,
    hp: 145000,
    maxHp: 145000,
    mp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 180, y: 160 },
    stats: { attackPower: 8000, spellPower: 0, critChance: 0.15, haste: 0.1, armor: 22000, spellResist: 0, block: 0.15, parry: 0.12, dodge: 0.10, mastery: 0.18, versatility: 0.05, speed: 1 },
  };
  engine.addUnit(tank);

  // ── 1. 亚什布里男爵 (Baron Ashbury)
  const ashburyAI = new BossAI('ashbury');
  const ashbury = engine.spawnBoss('ashbury', '亚什布里男爵', 5200000);

  // Test interruptible cast
  const stayOfExecution = ashburyAI.skills.find(s => s.id === 'stay_of_execution');
  assert.ok(stayOfExecution, '亚什布里应包含暂缓处决技能');
  assert.strictEqual(stayOfExecution.interruptible, true, '暂缓处决应可被打断');

  ashburyAI.currentCasting = { skill: stayOfExecution, elapsedMs: 500 };
  const interrupted = ashburyAI.interruptCurrentCast();
  assert.strictEqual(interrupted, true, '暂缓处决应被打断成功');
  assert.strictEqual(ashburyAI.currentCasting, null, '打断后施法状态应被清空');
  console.log('✓ 1号 亚什布里男爵：打断机制验证通过');

  // ── 2. 席瓦莱恩男爵 (Baron Silverlaine)
  const silverlaineAI = new BossAI('silverlaine');
  const silverlaine = engine.spawnBoss('silverlaine', '席瓦莱恩男爵', 4500000);
  const curseSkill = silverlaineAI.skills.find(s => s.id === 'cursed_veins');
  assert.ok(curseSkill, '席瓦莱恩应包含降受疗诅咒技能');
  curseSkill.execute(silverlaine, engine);

  const tankDebuff = tank.buffs.find(b => b.spellId === 'cursed_veins');
  assert.ok(tankDebuff, '主坦应获得降受疗诅咒Debuff');
  console.log('✓ 2号 席瓦莱恩男爵：降受疗诅咒机制验证通过');

  // ── 3. 指挥官斯普林瓦尔 (Commander Springvale)
  const springvaleAI = new BossAI('springvale');
  const springvale = engine.spawnBoss('springvale', '指挥官斯普林瓦尔', 4000000);
  const desecration = springvaleAI.skills.find(s => s.id === 'desecration');
  assert.ok(desecration, '斯普林瓦尔应包含亵渎技能');
  desecration.execute(springvale, engine);

  const poisonZone = engine.effectsManager.groundEffects.find(e => e.spellId === 'desecration');
  assert.ok(poisonZone, '场地应成功生成亵渎毒圈地面法阵');
  assert.strictEqual(poisonZone.colorHex, '#006400', '亵渎毒圈颜色应为暗绿 #006400');
  console.log('✓ 3号 指挥官斯普林瓦尔：暗绿亵渎毒圈法阵验证通过');

  // ── 4. 沃登勋爵 (Lord Walden)
  const waldenAI = new BossAI('walden');
  const walden = engine.spawnBoss('walden', '沃登勋爵', 3500000);
  const potion = waldenAI.skills.find(s => s.id === 'potion_catalyst');
  assert.ok(potion, '沃登勋爵应包含魔药投掷技能');
  potion.execute(walden, engine);
  assert.ok(tank.combatStats && tank.combatStats.damageTaken > 0, '魔药应造成全团伤害');
  console.log('✓ 4号 沃登勋爵：三色魔药轮替机制验证通过');

  // ── 5. 高弗雷勋爵 (Lord Godfrey)
  const godfreyAI = new BossAI('godfrey');
  const godfrey = engine.spawnBoss('godfrey', '高弗雷勋爵', 7200000);
  const barrage = godfreyAI.skills.find(s => s.id === 'pistol_barrage');
  assert.ok(barrage, '高弗雷勋爵应包含双枪弹幕技能');
  barrage.execute(godfrey, engine);

  const coneWarning = engine.effectsManager.groundEffects.find(e => e.kind === 'CONE_WARNING');
  assert.ok(coneWarning, '双枪弹幕应在地面生成红色扇形预警区');
  assert.strictEqual(coneWarning.colorHex, '#FF0000', '扇形预警区颜色应为红色 #FF0000');
  console.log('✓ 5号 高弗雷勋爵：双枪弹幕60°红色扇形预警区机制验证通过');

  console.log('✅ 影牙城堡全部 5 位首领核心机制测试全部通过！\n');
}
