import assert from 'node:assert';
import {
  Unit,
  GroundEffect,
  MELEE_ATTACK_RANGE,
  DPS_HEALTHY_THRESHOLD,
  isMeleeDps,
  isUnitHealthy,
  canHitBoss,
  findMeleeHealZonePosition,
  evaluateGroundFormationPosition,
} from '../../DEV/packages/engine/dist/index.js';

console.log('--- 运行 [T-15] 近战DPS健康血线不远离Boss、不影响输出走治疗地形、恢复健康回打Boss战术走位测试 ---');

// ── 1. 近战DPS判定与攻击范围、健康线基础校验 ─────────────────────────
assert.strictEqual(MELEE_ATTACK_RANGE, 80, '近战攻击范围标准规范必须为 80px');
assert.strictEqual(DPS_HEALTHY_THRESHOLD, 0.60, '近战/DPS 健康血线阈值必须为 60% HP');

const bossPos = { x: 540, y: 190 };
const meleeDefaultPos = { x: 485, y: 190 }; // 距离 Boss 55px (在近战范围 80px 内)

const rogueDps: Unit = {
  id: 'rogue_01', name: '潜行者瓦莉拉', classId: 'ROGUE', role: 'DPS', isPlayer: false, isAlive: true, alive: true,
  hp: 75000, maxHp: 100000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { ...meleeDefaultPos },
  stats: { attackPower: 9000, spellPower: 0, critChance: 0.25, haste: 0.15, armor: 12000, spellResist: 0, block: 0, parry: 0.05, dodge: 0.2, mastery: 0, versatility: 0, speed: 1 },
};

const dkDps: Unit = {
  id: 'dk_dps_01', name: '死骑萨萨里安', classId: 'DK', role: 'DPS', isPlayer: false, isAlive: true, alive: true,
  hp: 80000, maxHp: 100000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { ...meleeDefaultPos },
  stats: { attackPower: 8500, spellPower: 0, critChance: 0.2, haste: 0.1, armor: 18000, spellResist: 0, block: 0, parry: 0.1, dodge: 0.05, mastery: 0, versatility: 0, speed: 1 },
};

const dkTank: Unit = {
  id: 'dk_tank_01', name: '莫格莱尼(主坦)', classId: 'DK', role: 'TANK', isPlayer: false, isAlive: true, alive: true,
  hp: 120000, maxHp: 150000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 480, y: 190 },
  stats: { attackPower: 7000, spellPower: 0, critChance: 0.1, haste: 0.05, armor: 26000, spellResist: 0, block: 0, parry: 0.15, dodge: 0.15, mastery: 0, versatility: 0, speed: 1 },
};

const mageRanged: Unit = {
  id: 'mage_01', name: '吉安娜(火法)', classId: 'MAGE', role: 'DPS', isPlayer: false, isAlive: true, alive: true,
  hp: 60000, maxHp: 80000, absorb: 0, resources: [], buffs: [], threatTable: [], position: { x: 220, y: 190 },
  stats: { attackPower: 0, spellPower: 8000, critChance: 0.3, haste: 0.2, armor: 6000, spellResist: 0, block: 0, parry: 0, dodge: 0.03, mastery: 0, versatility: 0, speed: 1 },
};

// 角色类型与近战攻击判定
assert.strictEqual(isMeleeDps(rogueDps), true, '盗贼DPS应被判定为近战DPS');
assert.strictEqual(isMeleeDps(dkDps), true, 'DK DPS应被判定为近战DPS');
assert.strictEqual(isMeleeDps(dkTank), false, '坦克DK不应判定为近战DPS角色');
assert.strictEqual(isMeleeDps(mageRanged), false, '法师DPS不应判定为近战DPS');

assert.strictEqual(canHitBoss({ x: 485, y: 190 }, bossPos, 80), true, '55px 距离应判定在近战攻击范围内 (<=80px)');
assert.strictEqual(canHitBoss({ x: 460, y: 190 }, bossPos, 80), true, '80px 临界距离应判定在近战攻击范围内 (<=80px)');
assert.strictEqual(canHitBoss({ x: 450, y: 190 }, bossPos, 80), false, '90px 距离应超出近战攻击范围 (>80px)');

console.log('✓ 1. 近战DPS判定、攻击范围 (80px) 与健康血线基础规范验证通过');

// ── 2. 近战DPS血线健康时：不要为了走到治疗地形而远离Boss ─────────────────
// 场上仅存在位于远程后方的治疗雨 (x: 200, y: 200)，距离 Boss 340px，完全打不到Boss
const distantHealZone: GroundEffect = {
  id: 'heal_rain_distant',
  kind: 'HEAL_ZONE',
  spellId: 'shaman_healing_rain',
  ownerId: 'healer_shaman',
  x: 200,
  y: 200,
  radius: 65,
  colorHex: '#10B981',
  remainingMs: 8000,
  tickValue: 4500,
};

rogueDps.hp = 85000; // 85% HP (健康血线)
const healthyDistantResult = evaluateGroundFormationPosition({
  currentPos: { ...meleeDefaultPos },
  unit: rogueDps,
  groundEffects: [distantHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  healthyDistantResult.tradeOffDecision,
  'DEFAULT_POSITION',
  '近战DPS血线健康时，远离Boss的治疗阵严禁跑过去，必须留在Boss近战位 (DEFAULT_POSITION)'
);
assert.strictEqual(
  healthyDistantResult.targetPos.x,
  meleeDefaultPos.x,
  '目标点必须保持在默认近战攻击位X坐标'
);
assert.strictEqual(
  healthyDistantResult.targetPos.y,
  meleeDefaultPos.y,
  '目标点必须保持在默认近战攻击位Y坐标'
);
assert.strictEqual(healthyDistantResult.currentHealZoneId, null);
console.log('✓ 2. 近战DPS血线健康时，不为了走到远离首领的治疗地形而离开Boss验证通过');

// ── 3. 近战DPS血线健康时：走到治疗地形不影响打Boss可以走 ────────────────
// 场上存在覆盖首领脚下的近战治疗阵 (例如奶德百花齐放铺在 Boss 侧翼，x: 500, y: 190，半径 35px)
const meleeHealZone: GroundEffect = {
  id: 'efflo_melee',
  kind: 'HEAL_ZONE',
  spellId: 'druid_efflorescence',
  ownerId: 'healer_druid',
  x: 500,
  y: 190,
  radius: 35,
  colorHex: '#10B981',
  remainingMs: 9000,
  tickValue: 4800,
};

// 角色站在 (460, 190)（在近战攻击范围 80px 内，但尚未在治疗阵半径 35px 内，dist = 40px > 35px）
const healthyMeleeApproachResult = evaluateGroundFormationPosition({
  currentPos: { x: 460, y: 190 },
  unit: rogueDps,
  groundEffects: [distantHealZone, meleeHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  healthyMeleeApproachResult.tradeOffDecision,
  'SEEK_HEAL_ZONE',
  '走到治疗地形不影响打Boss时，允许近战DPS走入近战位治疗阵 (SEEK_HEAL_ZONE)'
);
assert.strictEqual(
  healthyMeleeApproachResult.currentHealZoneId,
  'efflo_melee',
  '锁定的治疗法阵必须为近战位治疗阵'
);
// 验证目标位置既在治疗阵内，又在Boss近战攻击范围内 (<=80px)
const distToBossFromTarget = Math.hypot(
  healthyMeleeApproachResult.targetPos.x - bossPos.x,
  healthyMeleeApproachResult.targetPos.y - bossPos.y
);
const distToHealFromTarget = Math.hypot(
  healthyMeleeApproachResult.targetPos.x - meleeHealZone.x,
  healthyMeleeApproachResult.targetPos.y - meleeHealZone.y
);
assert.ok(distToBossFromTarget <= 80, '目标位置必须在Boss近战攻击范围内 (<=80px)');
assert.ok(distToHealFromTarget <= meleeHealZone.radius, '目标位置必须在该治疗法阵半径内');
console.log('✓ 3. 走到治疗地形不影响打Boss时，允许近战DPS走入近战治疗阵验证通过');

// ── 4. 近战DPS在不影响打Boss的治疗阵中继续站位（边打边受疗） ─────────────
const inMeleeHealPos = { x: 495, y: 190 };
const healthyStandingInMeleeZoneResult = evaluateGroundFormationPosition({
  currentPos: inMeleeHealPos,
  unit: rogueDps,
  groundEffects: [meleeHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  healthyStandingInMeleeZoneResult.tradeOffDecision,
  'STAY_IN_CURRENT_HEAL_ZONE',
  '身处不影响打Boss的治疗阵且血线健康，继续保持边打Boss边受疗站位'
);
assert.strictEqual(healthyStandingInMeleeZoneResult.targetPos.x, inMeleeHealPos.x);
console.log('✓ 4. 近战DPS身处近战治疗阵且能打Boss时，保持站位稳定输出验证通过');

// ── 5. 残血 (<60%) 近战DPS前往治疗阵保命 ───────────────────────────────
rogueDps.hp = 30000; // 30% HP (< 60%，濒危血线)
const lowHpSeekResult = evaluateGroundFormationPosition({
  currentPos: { ...meleeDefaultPos },
  unit: rogueDps,
  groundEffects: [distantHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  lowHpSeekResult.tradeOffDecision,
  'SEEK_HEAL_ZONE',
  '血线低于健康线时，近战DPS优先前往安全治疗阵保命 (SEEK_HEAL_ZONE)'
);
assert.strictEqual(
  lowHpSeekResult.currentHealZoneId,
  'heal_rain_distant',
  '目标为场上唯一的安全治疗阵'
);
console.log('✓ 5. 残血近战DPS前往远处治疗阵保命受疗逻辑验证通过');

// ── 6. 恢复到健康血线且这时候打不到Boss：必须回去打Boss ──────────────────
// 盗贼现在站在远程治疗阵 (x: 210, y: 200)，距离 Boss 330px (打不到Boss)
const standingInDistantZone = { x: 210, y: 200 };

// 场景 6.1: 血线恢复到了健康线 (75% HP >= 60%)，打不到Boss -> 回去打Boss
rogueDps.hp = 75000; // 75% HP (已恢复健康)
const recoverToHealthyResult = evaluateGroundFormationPosition({
  currentPos: standingInDistantZone,
  unit: rogueDps,
  groundEffects: [distantHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  recoverToHealthyResult.tradeOffDecision,
  'RETURN_TO_BOSS',
  '恢复到健康血线且此时打不到Boss，必须离开治疗阵回去打Boss (RETURN_TO_BOSS)'
);
assert.strictEqual(
  recoverToHealthyResult.targetPos.x,
  meleeDefaultPos.x,
  '目标X坐标必须返回首领默认近战攻击位'
);
assert.strictEqual(
  recoverToHealthyResult.targetPos.y,
  meleeDefaultPos.y,
  '目标Y坐标必须返回首领默认近战攻击位'
);
assert.strictEqual(
  recoverToHealthyResult.currentHealZoneId,
  null,
  '脱离治疗阵，法阵ID重置为 null'
);
console.log('✓ 6.1 近战DPS恢复健康血线后若打不到Boss，立即返回攻击Boss验证通过');

// 场景 6.2: 死骑DPS (DK DPS) 恢复健康血线且打不到Boss，同样必须回去打Boss
dkDps.hp = 65000; // 65% HP >= 60%
const dkRecoverResult = evaluateGroundFormationPosition({
  currentPos: standingInDistantZone,
  unit: dkDps,
  groundEffects: [distantHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  dkRecoverResult.tradeOffDecision,
  'RETURN_TO_BOSS',
  '死骑近战DPS恢复健康且打不到Boss时，同样必须回去打Boss'
);
assert.strictEqual(dkRecoverResult.targetPos.x, meleeDefaultPos.x);
console.log('✓ 6.2 死骑近战DPS恢复健康血线后打不到Boss立即返回Boss位验证通过');

// 场景 6.3: 在远处治疗阵中血量尚未恢复健康 (45% < 60%)，继续受疗，不提前脱离
rogueDps.hp = 45000; // 45% HP (< 60%)
const stillUnhealthyInZoneResult = evaluateGroundFormationPosition({
  currentPos: standingInDistantZone,
  unit: rogueDps,
  groundEffects: [distantHealZone],
  defaultTarget: meleeDefaultPos,
  bossPos,
});

assert.strictEqual(
  stillUnhealthyInZoneResult.tradeOffDecision,
  'STAY_IN_CURRENT_HEAL_ZONE',
  '血线未达健康线时，即便打不到Boss也必须在治疗阵中继续受疗保命'
);
console.log('✓ 6.3 血线未达健康线时在治疗阵中继续安心受疗验证通过');

// ── 7. 坦克与远程职业回归测试（确保零破坏） ─────────────────────────────
// 坦克健康在治疗阵内：保持锁阵，不受近战打Boss脱离规则影响
dkTank.hp = 130000; // 86% HP
const tankResult = evaluateGroundFormationPosition({
  currentPos: standingInDistantZone,
  unit: dkTank,
  groundEffects: [distantHealZone],
  defaultTarget: { x: 480, y: 190 },
  bossPos,
});
assert.strictEqual(
  tankResult.tradeOffDecision,
  'STAY_IN_CURRENT_HEAL_ZONE',
  '坦克职业遵循坦克多阵法锁定与换坦规则，不触发近战DPS打Boss脱离'
);

// 远程法师健康在治疗阵内：法师射程 360px，在 210px 处完全能打到 Boss
mageRanged.hp = 70000; // 87.5% HP
const mageResult = evaluateGroundFormationPosition({
  currentPos: standingInDistantZone,
  unit: mageRanged,
  groundEffects: [distantHealZone],
  defaultTarget: { x: 220, y: 190 },
  bossPos,
});
assert.strictEqual(
  mageResult.tradeOffDecision,
  'STAY_IN_CURRENT_HEAL_ZONE',
  '远程DPS身处治疗阵内且无威胁，保持阵内受疗输出'
);
console.log('✓ 7. 坦克与远程法系职业原有行为无破坏回归验证通过');

console.log('✅ [T-15] 近战DPS健康血线不远离Boss、不影响输出走治疗地形、恢复健康回打Boss全部测试通过！\n');
