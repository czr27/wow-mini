import assert from 'node:assert';
import type { Unit, GroundEffect } from '../../DEV/packages/engine/dist/index.js';
import {
  CombatEngine,
  BossAI,
} from '../../DEV/packages/engine/dist/index.js';

export function runSkillsAndBossMechanicsTests() {
  console.log('--- 运行 [T-08] 真实技能机制 (HoT/DoT/引导/Buff/区域效果) 与 首领机制验证 ---');

  const engine = new CombatEngine();

  // 1. Rejuvenation HoT Periodic Ticking Test
  const woundedHero: Unit = {
    id: 'wounded_hero',
    name: '负伤德鲁伊',
    classId: 'DRUID',
    role: 'HEALER',
    isPlayer: true,
    isAlive: true,
    alive: true,
    hp: 40000,
    maxHp: 100000,
    mp: 50000,
    maxMp: 50000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 150, y: 150 },
    stats: {
      attackPower: 0,
      spellPower: 8000,
      critChance: 0,
      haste: 0,
      armor: 5000,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0,
      mastery: 0,
      versatility: 0,
      speed: 1,
    },
  };
  engine.addUnit(woundedHero);

  // Apply Rejuvenation: 12s duration, 3s tick interval, 4500 tick value
  engine.applyBuff(woundedHero, {
    id: 'rejuv_test',
    spellId: 'rejuvenation',
    name: '回春术',
    kind: 'BUFF',
    tags: ['HOT'],
    sourceUnitId: woundedHero.id,
    targetUnitId: woundedHero.id,
    stacks: 1,
    maxStacks: 1,
    durationMs: 12000,
    remainingMs: 12000,
    school: 'NATURE',
    tickIntervalMs: 3000,
    tickValue: 4500,
  });

  const rejuvBuff = woundedHero.buffs.find(b => b.spellId === 'rejuvenation');
  assert.ok(rejuvBuff, '目标应获得回春术HoT Buff');

  // Advance time by 2000ms: no tick yet (2000 < 3000)
  engine.tick(2000);
  assert.strictEqual(woundedHero.hp, 40000, '2000ms时未达到3000ms周期，不应产生治疗');

  // Advance time by 1000ms: reaches 3000ms, 1st tick fires!
  // Note: 4500 baseHeal + (8000 SP * 0.8 = 6400) = 10,900 total heal per tick (or 21,800 on critical)!
  engine.tick(1000);
  assert.ok(
    woundedHero.hp === 50900 || woundedHero.hp === 61800,
    `达到3000ms时回春术应产生首跳治疗 (10900平跳或21800暴击跳)，实际: ${woundedHero.hp}`
  );

  // Advance by another 3000ms: 2nd tick fires!
  const prevHp = woundedHero.hp;
  engine.tick(3000);
  assert.ok(
    woundedHero.hp === prevHp + 10900 || woundedHero.hp === prevHp + 21800,
    `6000ms时回春术应产生第二跳治疗 (+10900平跳或+21800暴击跳)，实际: ${woundedHero.hp}`
  );
  console.log('✓ 回春术 HoT 周期性每3秒跳数与法术强度加成机制验证通过');

  // 2. Range-based Ground Effect: Distance & Area Check Test
  const effectsMgr = engine.effectsManager;

  const testZone: GroundEffect = {
    id: 'heal_ring_1',
    kind: 'HEAL_ZONE',
    spellId: 'swiftmend',
    ownerId: woundedHero.id,
    x: 200,
    y: 200,
    radius: 50,
    colorHex: '#6FCF97',
    remainingMs: 8000,
    tickIntervalMs: 1000,
    tickElapsedMs: 0,
    tickValue: 3000,
  };
  effectsMgr.addGroundEffect(testZone);

  // Position inside circle (dist = 14.1px <= 50px)
  const posInside = { x: 210, y: 210 };
  assert.strictEqual(effectsMgr.isPositionInEffect(posInside, testZone), true, '圆内坐标应判定在法阵内');

  // Position outside circle (dist = 100px > 50px)
  const posOutside = { x: 300, y: 200 };
  assert.strictEqual(effectsMgr.isPositionInEffect(posOutside, testZone), false, '圆外坐标应判定在法阵外');

  // Unit standing inside receives tick heal, unit outside does not
  const unitInside: Unit = {
    id: 'u_in',
    name: '阵内盟友',
    classId: 'ROGUE',
    role: 'DPS',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 50000,
    maxHp: 100000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 210, y: 210 },
    stats: { attackPower: 5000, spellPower: 0, critChance: 0, haste: 0, armor: 5000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
  };
  const unitOutside: Unit = {
    id: 'u_out',
    name: '阵外盟友',
    classId: 'MAGE',
    role: 'DPS',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 50000,
    maxHp: 100000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 350, y: 350 },
    stats: { attackPower: 0, spellPower: 5000, critChance: 0, haste: 0, armor: 5000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
  };
  engine.addUnit(unitInside);
  engine.addUnit(unitOutside);

  // Tick 1000ms for ground effect
  effectsMgr.tick(engine['units'], 1000);
  assert.strictEqual(unitInside.hp, 53000, '阵内单位应受到治疗法阵周期治疗 (+3000)');
  assert.strictEqual(unitOutside.hp, 50000, '阵外单位不应受到治疗法阵治疗');
  console.log('✓ 基于距离半径的真实地面法阵生效机制验证通过');

  // 3. Godfrey Pistol Barrage Cone Hazard Geometry Test
  const coneHazard: GroundEffect = {
    id: 'cone_1',
    kind: 'CONE_WARNING',
    spellId: 'pistol_barrage',
    ownerId: 'boss_godfrey',
    x: 500,
    y: 200,
    radius: 350,
    colorHex: '#FF0000',
    remainingMs: 3000,
  };
  effectsMgr.addGroundEffect(coneHazard);

  // Left side target (angle ~ Math.PI) is inside cone
  const targetInCone = { x: 300, y: 200 };
  assert.strictEqual(effectsMgr.isPositionInHazard(targetInCone), true, '扇形弹幕正面路径上的单位应判定处于危险区');

  // Behind boss target (x = 600 > 500) is outside cone
  const targetBehindBoss = { x: 600, y: 200 };
  assert.strictEqual(effectsMgr.isPositionInHazard(targetBehindBoss), false, '首领背后的单位不应被扇形弹幕击中');
  console.log('✓ 高弗雷勋爵 60° 扇形几何预警判定机制验证通过');

  // 4. Baron Ashbury Asphyxiate 1-HP Drain Test
  const ashburyAI = new BossAI('ashbury');
  const ashbury = engine.spawnBoss('ashbury', '亚什布里男爵', 5200000);
  const asphyxiate = ashburyAI.skills.find(s => s.id === 'asphyxiate');
  assert.ok(asphyxiate, '亚什布里必须拥有窒息术技能');

  // Execute asphyxiate on the raid
  asphyxiate.execute(ashbury, engine);
  assert.strictEqual(woundedHero.hp, 1, '窒息术应强制将全团生命值抽干至恰好 1 点');
  assert.strictEqual(unitInside.hp, 1, '窒息术对全员抽至1点');
  assert.strictEqual(ashburyAI.asphyxiatePostDelay, 6000, '窒息术后技能锁定 1s+5s=6s');
  assert.strictEqual(engine.bossHealingGraceRemainingMs, 1000, '窒息术后引擎应激活1秒治疗保护窗口');

  // Verify damage lockout during 1s grace window: Boss damage must be blocked
  engine.dealDamage(ashbury, woundedHero, 30000, 'PHYSICAL', false, '首领普通攻击');
  assert.strictEqual(woundedHero.hp, 1, '1秒安全治疗窗口期内首领普攻伤害应被阻断，英雄免于暴毙');

  // Verify healing can still be applied normally during grace window
  engine.healUnit(woundedHero, woundedHero, 20000, false, '治疗之触');
  assert.strictEqual(woundedHero.hp, 20001, '治疗窗口期内团队治疗应正常生效');

  // Tick 1000ms: Grace expires (skill lock continues for melee-only phase)
  engine.tick(1000);
  assert.strictEqual(engine.bossHealingGraceRemainingMs, 0, '1秒后治疗窗口期应正常归零解除');

  console.log('✓ 亚什布里男爵 窒息术 (抽至1血) 与 1秒安全治疗 + 5秒仅普攻机制验证通过');

  console.log('✅ 真实技能机制与首领技能机制验证全部通过！\n');
}
