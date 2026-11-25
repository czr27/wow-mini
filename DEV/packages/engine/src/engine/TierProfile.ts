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
  tankBaseHp: 110000,
  dpsHealerBaseHp: 68000,
  petBaseHp: 35000,
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
  bossHpMult: 6.5,           // 相对 5 人本的粗略血量倍率（展示用；实际 HP 由击杀时间预算算出）
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

/**
 * 目标击杀时长（秒）——英雄难度下按 AI 满编输出标定：
 * - 5 人：非尾王 2 分钟 / 尾王 3 分钟
 * - 20 人：非尾王 3 分钟 / 尾王 5 分钟
 */
export const BOSS_KILL_TIME_SEC = {
  '5man': { normal: 120, final: 180 },
  '20man': { normal: 180, final: 300 },
} as const;

/** 血量预算用单人秒伤基准（与装备面板 baseDps 解耦） */
export const AI_BOSS_BUDGET_SINGLE_DPS = 5000;
/** 坦克相对满额 DPS 的折算；治疗不计入 Boss 血量预算 */
export const AI_BOSS_BUDGET_TANK_FRAC = 0.8;
export const AI_BOSS_BUDGET_HEALER_FRAC = 0;
/** 英雄本相对普通本：Boss 血量倍率 */
export const HEROIC_DIFFICULTY_MULT = 1.5;
/** 英雄本相对普通本：敌方/Boss 输出倍率 */
export const HEROIC_ENEMY_DAMAGE_MULT = 1.2;

/** AI 队伍角色构成（与 DUNGEON_ROLE_QUOTAS 中位一致） */
const AI_RAID_COMPOSITION = {
  '5man': { tanks: 1, healers: 1, dps: 3 },
  '20man': { tanks: 2, healers: 5, dps: 13 },
} as const;

/**
 * 估算满编 AI 队伍对单体首领的预算 DPS。
 * 单人 5000；坦克 ×0.8；输出 ×1；治疗不计。
 * 例：5 人 = 5000×0.8 + 3×5000 = 19000
 */
export function estimateAiRaidDps(tier: '5man' | '20man'): number {
  const { tanks, healers, dps } = AI_RAID_COMPOSITION[tier];
  const raw =
    dps * AI_BOSS_BUDGET_SINGLE_DPS +
    tanks * AI_BOSS_BUDGET_SINGLE_DPS * AI_BOSS_BUDGET_TANK_FRAC +
    healers * AI_BOSS_BUDGET_SINGLE_DPS * AI_BOSS_BUDGET_HEALER_FRAC;
  return Math.max(1, Math.round(raw));
}

function roundBossHp(hp: number): number {
  return Math.max(50_000, Math.round(hp / 50_000) * 50_000);
}

/**
 * 按目标击杀时长 × AI 队伍 DPS 计算首领血量。
 * 默认按英雄本写入（× HEROIC_DIFFICULTY_MULT）；普通本在 spawn 时再除回。
 */
export function computeBossHpForKillTime(
  tier: '5man' | '20man',
  isFinalBoss: boolean,
  difficulty: 'NORMAL' | 'HEROIC' = 'HEROIC',
): number {
  const sec = isFinalBoss
    ? BOSS_KILL_TIME_SEC[tier].final
    : BOSS_KILL_TIME_SEC[tier].normal;
  const base = estimateAiRaidDps(tier) * sec;
  const mult = difficulty === 'HEROIC' ? HEROIC_DIFFICULTY_MULT : 1;
  return roundBossHp(base * mult);
}

/**
 * 生成副本内各位首领血量（英雄本预算）：非尾王约 95%→105% 递进，尾王按终局时长。
 */
export function buildDungeonBossHpList(
  tier: '5man' | '20man',
  bossCount: number,
  difficulty: 'NORMAL' | 'HEROIC' = 'HEROIC',
): number[] {
  const n = Math.max(1, bossCount);
  const normalHp = computeBossHpForKillTime(tier, false, difficulty);
  const finalHp = computeBossHpForKillTime(tier, true, difficulty);
  return Array.from({ length: n }, (_, i) => {
    if (i === n - 1) return finalHp;
    const steps = Math.max(1, n - 1);
    const t = steps === 1 ? 0.5 : i / (steps - 1);
    const mult = 0.95 + t * 0.1;
    return roundBossHp(normalHp * mult);
  });
}

/** 难度对敌方/Boss 输出的倍率：普通 1.0，英雄 1.2，自定义由 coeff 处理 */
export function getDifficultyNumericMult(
  difficulty: 'NORMAL' | 'HEROIC' | 'CUSTOM',
): number {
  if (difficulty === 'HEROIC') return HEROIC_ENEMY_DAMAGE_MULT;
  return 1;
}

/** @deprecated 使用 buildDungeonBossHpList */
export const computeDungeonBossHpTable = buildDungeonBossHpList;
