import { InstanceTierProfile, UnitStats } from '../types.js';

/**
 * 80级满级满急速 (Level 80 BiS / Max-Haste 50%) 统一基准常量
 * - 满级等级：Lv.80
 * - 满急速：50% (haste = 0.50)，使 1.5s 法术公共冷却恰好降至 1.0s 下限 (1500 / 1.5 = 1000ms)
 * - 常规读条缩减公式：castTimeMs / (1 + haste)
 */
export const LEVEL_80_CAP = 80;
export const LEVEL_80_MAX_HASTE = 0.50;
export const LEVEL_80_BOSS_DAMAGE_SCALE = 0.45;

export const LEVEL_80_STATS = {
  level: LEVEL_80_CAP,
  haste: LEVEL_80_MAX_HASTE,
  tankBaseHp: 65000,
  dpsHealerBaseHp: 36000,
  petBaseHp: 22000,
  casterBaseMp: 42000,
  healerBaseMp: 45000,
  tankAttackPower: 5400,
  dpsAttackPower: 6200,
  dpsSpellPower: 3800,
  healerSpellPower: 4000,
  tankCritChance: 0.22,
  dpsCritChance: 0.34,
  healerCritChance: 0.30,
  tankArmor: 28000,
  plateMailArmor: 14000,
  clothLeatherArmor: 8000,
  baseDps: 14500,
  baseHps: 12000,
} as const;

/**
 * 计算受急速影响后的实际施法/引导时间 (ms)
 * 瞬发法术 (0ms) 始终返回 0；读条技能按 baseCastMs / (1 + haste) 缩放
 */
export function getHastedCastTimeMs(baseCastMs: number, haste: number = LEVEL_80_MAX_HASTE): number {
  if (!baseCastMs || baseCastMs <= 0) return 0;
  const safeHaste = Math.max(0, Math.min(2.0, haste || 0));
  return Math.max(500, Math.round(baseCastMs / (1 + safeHaste)));
}

/**
 * 计算按 GCD 分组与急速缩放后的有效公共冷却 (ms)
 * - OFF_GCD: 0ms（打断、嘲讽、瞬发减伤/爆发大招不进且不触发GCD）
 * - ROGUE: 固定 1000ms（盗贼/猫德/猎人集中值/邪DK，不受急速再压缩）
 * - NORMAL: 1500ms / (1 + haste)，下限锁定 1000ms（50%满急速时恰好达到 1000ms 封顶）
 */
export function getEffectiveGcdMs(
  gcdCategory: 'NORMAL' | 'ROGUE' | 'OFF_GCD' = 'NORMAL',
  haste: number = LEVEL_80_MAX_HASTE
): number {
  if (gcdCategory === 'OFF_GCD') return 0;
  if (gcdCategory === 'ROGUE') return 1000;
  const safeHaste = Math.max(0, Math.min(2.0, haste || 0));
  return Math.max(1000, Math.round(1500 / (1 + safeHaste)));
}

/**
 * 生成 80 级满级满急速角色的标准属性面板
 */
export function createLevel80BaseStats(
  role: 'TANK' | 'HEALER' | 'DPS',
  classId?: string,
  hasteOverride?: number
): UnitStats {
  const isTank = role === 'TANK';
  const isHealer = role === 'HEALER';
  const isPlateOrMail = classId === 'DK' || classId === 'WARRIOR' || classId === 'PALADIN' || classId === 'SHAMAN' || classId === 'HUNTER';
  return {
    attackPower: isTank ? LEVEL_80_STATS.tankAttackPower : LEVEL_80_STATS.dpsAttackPower,
    spellPower: isHealer ? LEVEL_80_STATS.healerSpellPower : LEVEL_80_STATS.dpsSpellPower,
    critChance: isTank ? LEVEL_80_STATS.tankCritChance : (isHealer ? LEVEL_80_STATS.healerCritChance : LEVEL_80_STATS.dpsCritChance),
    haste: hasteOverride ?? LEVEL_80_MAX_HASTE,
    armor: isTank ? LEVEL_80_STATS.tankArmor : (isPlateOrMail ? LEVEL_80_STATS.plateMailArmor : LEVEL_80_STATS.clothLeatherArmor),
    spellResist: 0,
    block: isTank && (classId === 'WARRIOR' || classId === 'PALADIN') ? 0.28 : (isTank ? 0.14 : 0),
    parry: isTank ? 0.16 : 0.04,
    dodge: isTank ? 0.18 : (classId === 'ROGUE' || classId === 'DRUID' ? 0.08 : 0.04),
    mastery: 0.22,
    versatility: 0.05,
    speed: 1,
  };
}

export const CATA_5H_346_PROFILE: InstanceTierProfile = {
  tierId: 'cata_5h_346',
  playerHpMult: 1.0,
  playerOutputMult: 1.0,
  bossHpMult: 1.0,
  bossDamageMult: LEVEL_80_BOSS_DAMAGE_SCALE,
  difficultyPressure: 1.0,
  tankBaseHp: LEVEL_80_STATS.tankBaseHp,
  dpsHealerBaseHp: LEVEL_80_STATS.dpsHealerBaseHp,
  baseDps: LEVEL_80_STATS.baseDps,
  baseHps: LEVEL_80_STATS.baseHps,
};

export const CATA_DS_397_PROFILE: InstanceTierProfile = {
  tierId: 'cata_ds_397',
  playerHpMult: 1.15,        // 80级20人团本合剂+耐力Buff约75k血坦 / 41k血DPS
  playerOutputMult: 1.25,    // 80级团本团队增益后输出放大
  bossHpMult: 6.5,           // 20人团本首领血量适配80级满急速输出
  bossDamageMult: 0.58,
  difficultyPressure: 1.2,
  tankBaseHp: 75000,
  dpsHealerBaseHp: 42000,
  baseDps: 18000,
  baseHps: 15000,
};

export function getTierProfile(tier: '5man' | '20man'): InstanceTierProfile {
  return tier === '20man' ? CATA_DS_397_PROFILE : CATA_5H_346_PROFILE;
}
