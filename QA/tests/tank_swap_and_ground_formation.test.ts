import assert from 'node:assert';
import {
  Unit,
  GroundEffect,
  TANK_HEALTHY_THRESHOLD,
  isTankHealthy,
  evaluateTankThreatDecision,
  evaluateGroundFormationPosition,
  TankAI,
  GameState,
  Priority,
} from '../../DEV/packages/engine/dist/index.js';

console.log('--- 运行 [T-14] 坦克顺位与健康线换坦仇恨管理、多治疗阵法防串位与负面阵型避险权衡测试 ---');

// ── 1. 坦克健康线判定 (60% HP Threshold) ───────────────────────────────────
assert.strictEqual(TANK_HEALTHY_THRESHOLD, 0.60, '坦克健康线阈值必须为 60% HP');

const testTankMT: Unit = {
  id: 'tank_mt', name: '莫格莱尼(主坦)', classId: 'DK', role: 'TANK', isPlayer: false, isAlive: true, alive: true,
  hp: 120000, maxHp: 150000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 540, y: 190 },
  stats: { attackPower: 8000, spellPower: 0, critChance: 0.2, haste: 0.1, armor: 24000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};
const testTankOT: Unit = {
  id: 'tank_ot', name: '乌瑟尔(副坦)', classId: 'DK', role: 'TANK', isPlayer: false, isAlive: true, alive: true,
  hp: 135000, maxHp: 150000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 490, y: 190 },
  stats: { attackPower: 8000, spellPower: 0, critChance: 0.2, haste: 0.1, armor: 24000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};

// 80% HP -> Healthy
assert.strictEqual(isTankHealthy(testTankMT), true, '80% HP 坦克应判定为血量健康 (>=60%)');
// 59% HP -> Unhealthy
testTankMT.hp = 88500; // 59%
assert.strictEqual(isTankHealthy(testTankMT), false, '59% HP 坦克应判定为血量不健康 (<60%)');
// Dead -> Unhealthy
testTankMT.hp = 0;
testTankMT.alive = false;
assert.strictEqual(isTankHealthy(testTankMT), false, '阵亡坦克必须判定为血量不健康');
console.log('✓ 1. 坦克 60% HP 健康线与生死状态判定逻辑验证通过');

// ── 2. 双坦协同：顺位仇恨、主动嘲讽与低血暂停拉仇恨机制 ─────────────────────────
// 恢复主坦与副坦健康
testTankMT.hp = 130000;
testTankMT.alive = true;
testTankMT.isAlive = true;

testTankOT.hp = 140000;
testTankOT.alive = true;
testTankOT.isAlive = true;

const allTanks = [testTankMT, testTankOT]; // MT = Rank 0, OT = Rank 1

// 场景 2.1: 主坦健康 (>=60%)，副坦健康 (>=60%)
// 主坦应该积极拉怪稳固仇恨，副坦不得抢拉仇恨（暂停拉仇恨）
const mtDec1 = evaluateTankThreatDecision(testTankMT, allTanks, 'tank_mt', true);
assert.strictEqual(mtDec1.pauseThreat, false, '主坦健康时不得暂停拉仇恨');

const otDec1 = evaluateTankThreatDecision(testTankOT, allTanks, 'tank_mt', false);
assert.strictEqual(otDec1.shouldTaunt, false, '排名靠前的主坦健康时，排名靠后的副坦严禁主动嘲讽抢仇恨');
assert.strictEqual(otDec1.pauseThreat, true, '排名靠前的坦克血量健康时，排名靠后的坦克必须暂停拉仇恨');
console.log('✓ 2.1 主坦健康状态下，副坦暂停拉仇恨且不主动嘲讽验证通过');

// 场景 2.2: 主坦血量受创低于健康线 (<60%)，副坦血量健康 (>=60%)
// "排名靠后的坦克只有在自己血量健康，排名靠前坦克血量都不健康时主动拉仇恨，此时其他坦克要暂停拉仇恨直到自己过健康线"
testTankMT.hp = 60000; // 40% HP (< 60%)
const mtDec2 = evaluateTankThreatDecision(testTankMT, allTanks, 'tank_mt', true);
assert.strictEqual(mtDec2.shouldTaunt, false, '主坦血量不健康时不得主动嘲讽');
assert.strictEqual(mtDec2.pauseThreat, true, '主坦血量不健康时必须暂停拉仇恨，直到自己过健康线');

const otDec2 = evaluateTankThreatDecision(testTankOT, allTanks, 'tank_mt', false);
assert.strictEqual(otDec2.shouldTaunt, true, '在自己健康且主坦不健康时，排名靠后的副坦必须主动嘲讽接手Boss');
assert.strictEqual(otDec2.pauseThreat, false, '副坦接怪后恢复正常高仇恨循环');
console.log('✓ 2.2 主坦降至健康线下时，主坦暂停拉仇恨，健康副坦主动嘲讽接怪验证通过');

// 场景 2.3: 主坦与副坦均不健康 (<60%)
// 靠后坦克必须自己也健康才能主动拉仇恨，如果不健康同样暂停拉仇恨
testTankOT.hp = 50000; // 33% HP (< 60%)
const otDec3 = evaluateTankThreatDecision(testTankOT, allTanks, 'tank_mt', false);
assert.strictEqual(otDec3.shouldTaunt, false, '副坦自身血量不健康时不得主动拉仇恨');
assert.strictEqual(otDec3.pauseThreat, true, '副坦自身血量不健康时也必须暂停拉仇恨，优先保命');
console.log('✓ 2.3 全体坦克均不健康时，所有坦克暂停高仇恨争夺优先保命验证通过');

// 场景 2.4: 治疗将主坦抬过健康线 (>=60%)
// 主坦重新稳固仇恨，副坦主动让渡并暂停拉仇恨
testTankMT.hp = 110000; // ~73% HP (>= 60%)
testTankOT.hp = 120000; // 80% HP (>= 60%)

const mtDec4 = evaluateTankThreatDecision(testTankMT, allTanks, 'tank_ot', false);
assert.strictEqual(mtDec4.shouldTaunt, true, '主坦过健康线后应主动嘲讽接回首领');
assert.strictEqual(mtDec4.pauseThreat, false, '主坦过健康线后恢复仇恨循环');

const otDec4 = evaluateTankThreatDecision(testTankOT, allTanks, 'tank_ot', true);
assert.strictEqual(otDec4.shouldTaunt, false, '主坦过健康线后，副坦不再主动拉仇恨');
assert.strictEqual(otDec4.pauseThreat, true, '主坦过健康线后，副坦暂停拉仇恨完成顺畅换坦交接');
console.log('✓ 2.4 治疗抬回主坦健康线后，主坦主动接回、副坦暂停拉仇恨交接验证通过');

// ── 3. 三坦梯队 (MT -> OT1 -> OT2) 顺位容灾级联判定 ─────────────────────────
const testTankOT2: Unit = {
  id: 'tank_ot2', name: '萨鲁法尔(三坦)', classId: 'DK', role: 'TANK', isPlayer: false, isAlive: true, alive: true,
  hp: 145000, maxHp: 150000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 460, y: 190 },
  stats: { attackPower: 8000, spellPower: 0, critChance: 0.2, haste: 0.1, armor: 24000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};
const trioTanks = [testTankMT, testTankOT, testTankOT2];

// MT 不健康，OT1 不健康，OT2 健康
testTankMT.hp = 40000;  // 不健康
testTankOT.hp = 50000;  // 不健康
testTankOT2.hp = 135000; // 健康

const ot2Dec = evaluateTankThreatDecision(testTankOT2, trioTanks, 'tank_mt', false);
assert.strictEqual(ot2Dec.shouldTaunt, true, '当前序坦克(MT与OT1)均不健康且自身健康时，OT2必须主动嘲讽接怪');
assert.strictEqual(ot2Dec.pauseThreat, false, 'OT2接怪后正常建立仇恨');

// 一旦 OT1 被治疗过健康线，OT2 必须停止争夺
testTankOT.hp = 100000; // OT1 恢复健康
const ot2DecAfterHeal = evaluateTankThreatDecision(testTankOT2, trioTanks, 'tank_ot', false);
assert.strictEqual(ot2DecAfterHeal.shouldTaunt, false, '前序有任意坦克恢复健康，后续坦克立即停止主动拉仇恨');
assert.strictEqual(ot2DecAfterHeal.pauseThreat, true, '前序有更靠前坦克健康时，靠后坦克必须暂停拉仇恨');
console.log('✓ 3. 多坦克梯队(3T)顺位容灾与链式换坦逻辑验证通过');

// ── 4. TankAI 技能决策层联动（暂停高仇恨技能与嘲讽过滤）──────────────────────
const tankAI = new TankAI();
const dummyBoss: Unit = {
  id: 'boss_test', name: '测试首领', classId: 'BOSS', role: 'ENEMY', isPlayer: false, isAlive: true, alive: true,
  hp: 5000000, maxHp: 5000000, absorb: 0, resources: [], buffs: [], threatTable: [{ sourceUnitId: 'tank_mt', amount: 10000 }], position: { x: 500, y: 200 },
  stats: { attackPower: 10000, spellPower: 10000, critChance: 0.1, haste: 0, armor: 15000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};

const mockGameState: GameState = {
  phase: 'BOSS_COMBAT',
  elapsedMs: 5000,
  units: [testTankMT, testTankOT, dummyBoss],
  bossId: dummyBoss.id,
  bossChannelSpellId: null,
  bossChannelRemainingMs: 0,
};

// 副坦在主坦健康时执行 decide
testTankMT.hp = 140000; // 主坦健康
testTankOT.hp = 140000; // 副坦健康
const otActionsWhileMtHealthy = tankAI.decide(testTankOT, mockGameState);

// 验证：副坦不得包含 dk_dark_command，且不得打出 dk_rune_strike (高仇恨泄能)
assert.strictEqual(
  otActionsWhileMtHealthy.some(a => a.action.spellId === 'dk_dark_command'),
  false,
  '主坦健康时，副坦决策队列中绝不得出现嘲讽法术'
);
assert.strictEqual(
  otActionsWhileMtHealthy.some(a => a.action.spellId === 'dk_rune_strike'),
  false,
  '主坦健康时，副坦应暂停打出高仇恨泄能符文打击(dk_rune_strike)'
);
assert.ok(
  otActionsWhileMtHealthy.some(a => a.action.spellId === 'dk_souls_strike'),
  '副坦仍应施放自愈护盾技能(dk_souls_strike)自保'
);
console.log('✓ 4. TankAI 技能队列在暂停拉仇恨期间自动抑制嘲讽与高仇恨技能验证通过');

// ── 5. 多地面治疗阵法判定：已在其中一个法阵内严禁移动至其他治疗阵 ─────────────
const healZoneA: GroundEffect = {
  id: 'heal_zone_a',
  kind: 'HEAL_ZONE',
  spellId: 'healing_rain',
  ownerId: 'healer_shaman',
  x: 220,
  y: 200,
  radius: 60,
  colorHex: '#10B981',
  remainingMs: 8000,
  tickValue: 4500,
};

const healZoneB: GroundEffect = {
  id: 'heal_zone_b',
  kind: 'HEAL_ZONE',
  spellId: 'efflorescence',
  ownerId: 'healer_druid',
  x: 380,
  y: 200,
  radius: 60,
  colorHex: '#10B981',
  remainingMs: 8000,
  tickValue: 4800,
};

// 角色初始位置位于 healZoneA 内部 (距离中心 20px <= 60px 半径)
const standingInZoneAPos = { x: 230, y: 205 };
const injuredAlly: Unit = {
  id: 'ally_injured', name: '伤员', classId: 'DK', role: 'TANK', isPlayer: false, isAlive: true, alive: true,
  hp: 40000, maxHp: 100000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { ...standingInZoneAPos },
  stats: { attackPower: 5000, spellPower: 0, critChance: 0.1, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
};

const multiHealZonesResult = evaluateGroundFormationPosition({
  currentPos: standingInZoneAPos,
  unit: injuredAlly,
  groundEffects: [healZoneA, healZoneB],
  defaultTarget: { x: 490, y: 190 },
});

assert.strictEqual(
  multiHealZonesResult.tradeOffDecision,
  'STAY_IN_CURRENT_HEAL_ZONE',
  '存在多个治疗阵法且已在其中一个时，决策必须为 STAY_IN_CURRENT_HEAL_ZONE'
);
assert.strictEqual(
  multiHealZonesResult.targetPos.x,
  standingInZoneAPos.x,
  '已在治疗阵A中时，目标坐标必须留在原地，严禁移动至治疗阵B'
);
assert.strictEqual(
  multiHealZonesResult.targetPos.y,
  standingInZoneAPos.y,
  '已在治疗阵A中时，Y坐标必须留在原地'
);
console.log('✓ 5. 存在多个治疗阵法时，已身处其中一个则锁定站位不跑向其他法阵验证通过');

// ── 6. 负面阵型避险权衡机制 (Hazard Trade-Off Evaluation) ───────────────────

// 场景 6.1: 治疗阵法与负面阵型部分重叠 -> 权衡判定微调至治疗圈内的安全子区域
const partialHazard: GroundEffect = {
  id: 'damage_zone_partial',
  kind: 'DAMAGE_ZONE',
  spellId: 'desecration',
  ownerId: 'boss_test',
  x: 180, // 偏左，部分覆盖 healZoneA (x: 220)
  y: 200,
  radius: 40,
  colorHex: '#EF4444',
  remainingMs: 6000,
  tickValue: 7000, // 伤害高于治疗
};

// 角色站在 (195, 200)，同时位于 healZoneA (dist=25<=60) 和 partialHazard (dist=15<=40) 中
const tradeOffResultPartial = evaluateGroundFormationPosition({
  currentPos: { x: 195, y: 200 },
  unit: injuredAlly,
  groundEffects: [healZoneA, healZoneB, partialHazard],
});

assert.strictEqual(
  tradeOffResultPartial.tradeOffDecision,
  'DODGE_HAZARD_SHIFT_IN_ZONE',
  '负面阵型部分重叠时，权衡结果必须为 DODGE_HAZARD_SHIFT_IN_ZONE（在治疗圈内微调）'
);
// 验证微调后的目标点：必须在 healZoneA 内，且在 partialHazard 外
const distToHeal = Math.hypot(tradeOffResultPartial.targetPos.x - healZoneA.x, tradeOffResultPartial.targetPos.y - healZoneA.y);
const distToHazard = Math.hypot(tradeOffResultPartial.targetPos.x - partialHazard.x, tradeOffResultPartial.targetPos.y - partialHazard.y);
assert.ok(distToHeal <= healZoneA.radius, '微调目标点必须仍处于当前治疗法阵内');
assert.ok(distToHazard > partialHazard.radius, '微调目标点必须成功避开负面阵型危险半径');
console.log('✓ 6.1 负面阵型部分重叠时，权衡微调至治疗圈内安全子区域规避验证通过');

// 场景 6.2: 治疗阵法被负面阵型完全覆盖（或致命锥形弹幕）-> 权衡判定撤离至阵外安全区
const fullHazard: GroundEffect = {
  id: 'damage_zone_full',
  kind: 'DAMAGE_ZONE',
  spellId: 'void_zone',
  ownerId: 'boss_test',
  x: 220, // 完全覆盖 healZoneA
  y: 200,
  radius: 90,
  colorHex: '#EF4444',
  remainingMs: 7000,
  tickValue: 8000,
};

const tradeOffResultFull = evaluateGroundFormationPosition({
  currentPos: { x: 220, y: 200 },
  unit: injuredAlly,
  groundEffects: [healZoneA, healZoneB, fullHazard],
});

assert.strictEqual(
  tradeOffResultFull.tradeOffDecision,
  'DODGE_HAZARD_LEAVE_ZONE',
  '治疗法阵完全受害时，权衡结果必须为撤离法阵 (DODGE_HAZARD_LEAVE_ZONE)'
);
// 此时应转移至完全安全的另一个治疗法阵 healZoneB (x: 380, y: 200)
assert.strictEqual(
  tradeOffResultFull.targetPos.x,
  healZoneB.x,
  '完全受害时应优先转移至场上另一个完全安全的治疗法阵B'
);
console.log('✓ 6.2 治疗阵完全受害时，权衡判定撤出当前法阵并转移至安全替代阵法验证通过');

// 场景 6.3: 负面阵型即将结束且伤害轻微 -> 权衡判定继续站位 (STAY_DESPITE_HAZARD)
const expiringHazard: GroundEffect = {
  id: 'damage_zone_expiring',
  kind: 'DAMAGE_ZONE',
  spellId: 'light_poison',
  ownerId: 'boss_test',
  x: 220,
  y: 200,
  radius: 50,
  colorHex: '#EF4444',
  remainingMs: 200, // 即将结束 (<=300ms)
  tickValue: 3000,  // 伤害低于治疗 (4500)
};

const healthyTankHolding: Unit = {
  ...injuredAlly,
  hp: 95000, // 95% HP
};

const tradeOffResultExpiring = evaluateGroundFormationPosition({
  currentPos: { x: 220, y: 200 },
  unit: healthyTankHolding,
  groundEffects: [healZoneA, expiringHazard],
});

assert.strictEqual(
  tradeOffResultExpiring.tradeOffDecision,
  'STAY_DESPITE_HAZARD',
  '负面阵型即将消失且伤害低于治疗时，权衡决策应为继续稳固站位 (STAY_DESPITE_HAZARD)'
);
assert.strictEqual(tradeOffResultExpiring.targetPos.x, 220, '继续站位时目标X坐标保持原位');
console.log('✓ 6.3 负面阵型极弱或即将结束时，权衡判定继续站位验证通过');

// 场景 6.4: 致命扇形弹幕预警 (CONE_WARNING) -> 极高危险度无论何种状态必须立即躲避
const coneLethalHazard: GroundEffect = {
  id: 'cone_hazard',
  kind: 'CONE_WARNING',
  spellId: 'pistol_barrage',
  ownerId: 'boss_test',
  x: 520,
  y: 190,
  radius: 350,
  colorHex: '#EF4444',
  remainingMs: 3000,
  tickValue: 20000,
  ...({ facingRad: Math.PI, coneAngleRad: Math.PI / 3 } as any),
};

const tradeOffResultCone = evaluateGroundFormationPosition({
  currentPos: { x: 220, y: 190 }, // 正好在 Boss 朝左的 60° 扇形正中
  unit: healthyTankHolding,
  groundEffects: [healZoneA, coneLethalHazard],
});

assert.ok(
  tradeOffResultCone.tradeOffDecision === 'DODGE_HAZARD_LEAVE_ZONE' ||
  tradeOffResultCone.tradeOffDecision === 'DODGE_HAZARD_SHIFT_IN_ZONE',
  '首领致命高危锥形弹幕预警时，权衡必须判定紧急规避离开危险区'
);
// 验证使用官方的 isPosInHazard 判定目标点必须绝对脱离危险区域
const isStillInCone = (eff: GroundEffect, p: { x: number; y: number }) => {
  const dx = p.x - eff.x;
  const dy = p.y - eff.y;
  const dist = Math.hypot(dx, dy);
  if (dist > eff.radius) return false;
  const angle = Math.atan2(dy, dx);
  let diff = Math.abs(angle - Math.PI);
  while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
  return diff <= (Math.PI / 6);
};
assert.strictEqual(
  isStillInCone(coneLethalHazard, tradeOffResultCone.targetPos),
  false,
  '规避后的目标点必须成功脱离锥形预警危险区'
);
console.log('✓ 6.4 致命扇形预警时，最高危险度权衡必须立即规避验证通过');

console.log('✅ [T-14] 坦克顺位换坦仇恨、多法阵锁定与负面阵型权衡避险全部测试通过！\n');
