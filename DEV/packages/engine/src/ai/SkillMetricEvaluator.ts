// ============================================================
// Cata Raid Sim — AI Skill Metric Evaluator & Personality System
// Computes dynamic metrics (DPS, HPS, DPS/Cost, HPS/Cost, DPS/CD, HPS/CD, isAOE)
// Classifies skills into Major/Minor cycles, Throughput vs Cost Efficiency,
// and evaluates AI & Boss decisions with seeded individuality and jitter.
// ============================================================

import type { Unit } from '../types.js';

export type SkillCycle = 'MAJOR' | 'MINOR' | 'SUSTAINED';
export type SkillRoleCategory = 'DAMAGE' | 'HEAL' | 'DEFENSIVE' | 'UTILITY' | 'INTERRUPT';

export interface SkillEvaluationInput {
  id: string;
  name: string;
  roleType: SkillRoleCategory;
  castTimeMs: number;
  cooldownMs: number;
  resourceCost: number;
  resourceType?: 'MANA' | 'ENERGY' | 'RUNIC_POWER' | 'NONE';
  rawDamage?: number;
  rawHeal?: number;
  isAOE?: boolean;
  maxAoeTargets?: number;
  description?: string;
  priorityBonus?: number;
}

export interface SkillMetrics {
  id: string;
  name: string;
  roleType: SkillRoleCategory;
  castTimeMs: number;
  cooldownMs: number;
  resourceCost: number;
  resourceType: 'MANA' | 'ENERGY' | 'RUNIC_POWER' | 'NONE';

  // Core metrics required by user:
  dps: number;             // DPS (Damage Per Second)
  hps: number;             // HPS (Healing Per Second)
  dpsPerCost: number;      // DPS / 消耗 (Damage Per Resource Cost)
  hpsPerCost: number;      // HPS / 消耗 (Healing Per Resource Cost)
  dpsPerCd: number;        // DPS / CD (Burst Density per Cooldown Second)
  hpsPerCd: number;        // HPS / CD (Emergency Density per Cooldown Second)
  isAOE: boolean;          // 是否适合群体
  maxAoeTargets: number;

  // Categorization & Strategy:
  cycle: SkillCycle;       // 大周期 (爆发/救急) vs 小周期 vs 常规循环
  rawThroughput: number;   // 原始单次输出量 (伤害或治疗)
  costEfficiency: number;  // 输出性价比
}

export interface AIPersonality {
  seed: number;
  name: string;
  id: string;

  // 1. 蓝量 / 能量健康线浮动 (Health line jitter)
  // 比如常规30%蓝线，每个AI根据随机种子在20%~40%之间抖动；盗贼能量储备在22~42浮动
  resourceHealthyThreshold: number;
  energyReserveThreshold: number;

  // 2. 输出量 vs 性价比平衡值浮动 (Throughput vs Cost Efficiency balance jitter)
  // 0.32 ~ 0.68：低值代表偏好低耗可持续性价比，高值代表偏好纯输出爆发
  throughputVsEfficiencyBias: number;

  // 3. 周期爆发/救急倾向 (Aggressiveness in popping major/minor cycles)
  // 0.85 ~ 1.15
  cycleAggression: number;

  // 4. 群体偏好目标数门槛 (AOE threshold count jitter: 2 或 3)
  aoeThresholdCount: number;

  // 5. 步调偏移抖动 (0 ~ 29 ticks，避免所有机器人同步卡点动作)
  tickOffset: number;
}

/**
 * 根据 AI 的名称与唯一标识作为伪随机数种子，生成专属且稳定的个性化性格画像与抖动参数
 */
export function createAIPersonality(name: string, id: string = ''): AIPersonality {
  let hash = 0;
  const str = `${name}#${id}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const pos = Math.abs(hash);

  // 蓝量健康线: 0.22 ~ 0.38 (中位数 ~0.30)
  const resourceHealthyThreshold = Number((0.22 + ((pos % 17) / 100)).toFixed(2));

  // 能量储备线: 22 ~ 42 能量
  const energyReserveThreshold = 22 + (pos % 21);

  // 性价比 vs 输出量平衡值: 0.32 ~ 0.68 (中位数 0.50)
  const throughputVsEfficiencyBias = Number((0.32 + ((pos % 37) / 100)).toFixed(2));

  // 周期爆发激进倾向: 0.85 ~ 1.15
  const cycleAggression = Number((0.85 + ((pos % 31) / 100)).toFixed(2));

  // 群体偏好目标数门槛: 2 或 3 个受伤队友/敌方目标
  const aoeThresholdCount = 2 + (pos % 2);

  // 步调防撞车偏移: 0 ~ 29 ticks
  const tickOffset = pos % 30;

  return {
    seed: pos,
    name,
    id,
    resourceHealthyThreshold,
    energyReserveThreshold,
    throughputVsEfficiencyBias,
    cycleAggression,
    aoeThresholdCount,
    tickOffset,
  };
}

/**
 * 为单个技能精确计算 DPS, HPS, DPS/消耗, HPS/消耗, DPS/CD, HPS/CD, isAOE 及大小周期分类
 */
export function computeSkillMetrics(params: SkillEvaluationInput): SkillMetrics {
  const castSec = params.castTimeMs > 0 ? params.castTimeMs / 1000 : 1.25; // 瞬发技能按 1.25s 基础 GCD 计
  const cdSec = params.cooldownMs > 0 ? params.cooldownMs / 1000 : castSec;
  const dmg = params.rawDamage || 0;
  const heal = params.rawHeal || 0;
  const cost = params.resourceCost || 0;

  // 1. DPS 与 HPS
  const dps = dmg > 0 ? Math.round(dmg / castSec) : 0;
  const hps = heal > 0 ? Math.round(heal / castSec) : 0;

  // 2. DPS / 消耗 与 HPS / 消耗 (性价比)
  const dpsPerCost = cost > 0 ? Number((dmg / cost).toFixed(2)) : (dmg > 0 ? 999 : 0);
  const hpsPerCost = cost > 0 ? Number((heal / cost).toFixed(2)) : (heal > 0 ? 999 : 0);

  // 3. DPS / CD 与 HPS / CD (爆发/救急冷却密度)
  const dpsPerCd = dmg > 0 ? Math.round(dmg / cdSec) : 0;
  const hpsPerCd = heal > 0 ? Math.round(heal / cdSec) : 0;

  const isAOE = Boolean(params.isAOE);
  const maxAoeTargets = params.maxAoeTargets || (isAOE ? 5 : 1);

  // 4. 大小周期分类 (根据输出成本与冷却时间):
  // 大周期 (MAJOR): CD >= 45s (长CD爆发、大招救急、全团大抬血，如宁静、激活、冲动、首领全屏机制)
  // 小周期 (MINOR): 6s <= CD < 45s (核心战术小技能，如迅捷治愈、野性成长、熔岩爆裂、激流、打断反制)
  // 常规循环 (SUSTAINED): CD < 6s (常规读条或填充循环，如滋养、治疗波、火球术、影袭)
  let cycle: SkillCycle = 'SUSTAINED';
  if (params.cooldownMs >= 45000) {
    cycle = 'MAJOR';
  } else if (params.cooldownMs >= 6000) {
    cycle = 'MINOR';
  }

  const rawThroughput = dmg > 0 ? dmg : heal;
  const costEfficiency = cost > 0 ? Number((rawThroughput / cost).toFixed(2)) : 999;

  return {
    id: params.id,
    name: params.name,
    roleType: params.roleType,
    castTimeMs: params.castTimeMs,
    cooldownMs: params.cooldownMs,
    resourceCost: cost,
    resourceType: params.resourceType || 'MANA',
    dps,
    hps,
    dpsPerCost,
    hpsPerCost,
    dpsPerCd,
    hpsPerCd,
    isAOE,
    maxAoeTargets,
    cycle,
    rawThroughput,
    costEfficiency,
  };
}

export interface SkillScoreContext {
  caster: Unit;
  personality: AIPersonality;
  target?: Unit;
  allies: Unit[];
  enemies: Unit[];
  tickCount: number;
  isEmergency?: boolean;
}

/**
 * 智能决策打分函数：
 * 综合技能的 DPS/HPS、性价比、大小周期、群体适合度，以及 AI 个体抖动，得出当前最适合释放的技能评分
 */
export function scoreSkillCandidate(skill: SkillMetrics, ctx: SkillScoreContext): number {
  const { caster, personality, allies, enemies, tickCount } = ctx;

  // 1. 检查资源状态 (当前资源与该 AI 个性化健康线的对比)
  let isLowResource = false;
  if (skill.resourceType === 'MANA') {
    const curMp = caster.mp ?? 0;
    const maxMp = caster.maxMp || 100000;
    const mpRatio = maxMp > 0 ? curMp / maxMp : 1;
    // 当蓝量低于该 AI 专属的健康线时，进入节能模式
    isLowResource = mpRatio < personality.resourceHealthyThreshold;
    if (curMp < skill.resourceCost) return -1; // 资源不足直接不可用
  } else if (skill.resourceType === 'ENERGY') {
    const curEnergy = caster.energy ?? 100;
    isLowResource = curEnergy < personality.energyReserveThreshold;
    if (curEnergy < skill.resourceCost) return -1;
  }

  // 2. 权重分配 (输出性价比 vs 纯输出量)
  // 当救急状态下 (isEmergency)：纯输出量 (DPS、HPS) 占据主导，严禁贪恋省蓝性价比！
  // 当消耗不足时：输出性价比 (DPS/消耗、HPS/消耗) 权重极大提升，优先低耗技能
  // 当消耗充足时：纯输出量 (DPS、HPS、DPS/CD、HPS/CD) 占据主导
  let throughputWeight: number;
  let efficiencyWeight: number;

  if (ctx.isEmergency) {
    // 救急救命状态：队友濒临死亡，吞吐量必须彻底压倒性价比，防猝死！
    throughputWeight = 0.90 + personality.throughputVsEfficiencyBias * 0.08;
    efficiencyWeight = 1 - throughputWeight;
  } else if (isLowResource) {
    // 节能优先：70%~90% 偏向高性价比，抑制高耗爆发
    efficiencyWeight = 0.70 + (1 - personality.throughputVsEfficiencyBias) * 0.20;
    throughputWeight = 1 - efficiencyWeight;
  } else {
    // 充沛输出：60%~80% 偏向纯输出量与冷却爆发
    throughputWeight = 0.60 + personality.throughputVsEfficiencyBias * 0.25;
    efficiencyWeight = 1 - throughputWeight;
  }

  // 3. 群体适合度判定 (isAOE)
  let aoeMultiplier = 1.0;
  if (skill.isAOE) {
    if (skill.roleType === 'HEAL') {
      const injuredCount = allies.filter(a => (a.alive ?? a.isAlive) && a.hp < a.maxHp * 0.85).length;
      if (injuredCount >= personality.aoeThresholdCount) {
        aoeMultiplier = Math.min(skill.maxAoeTargets, injuredCount) * 0.95;
      } else {
        // 单体受伤时施放群体技能收益减半
        aoeMultiplier = 0.45;
      }
    } else {
      const enemyCount = enemies.filter(e => (e.alive ?? e.isAlive) && e.hp > 0).length;
      if (enemyCount >= 2) {
        aoeMultiplier = Math.min(skill.maxAoeTargets, enemyCount) * 0.90;
      } else {
        // 单个首领时群体技能效率轻微折损
        aoeMultiplier = 0.65;
      }
    }
  }

  // 4. 大小周期与爆发/救急判定
  let cycleMultiplier = 1.0;
  if (skill.cycle === 'MAJOR') {
    if (skill.roleType === 'HEAL') {
      // 大周期救急 (如宁静、法力之潮、激活)：需要团队大面积低血线或极端紧急
      const criticalCount = allies.filter(a => (a.alive ?? a.isAlive) && a.hp < a.maxHp * 0.45).length;
      if (criticalCount >= 2 || ctx.isEmergency) {
        cycleMultiplier = 2.6 * personality.cycleAggression;
      } else {
        cycleMultiplier = 0.15; // 平时留存大招，不随意挥霍
      }
    } else {
      // 大周期爆发 (如冲动、燃烧、首领全屏大招)：进入爆发期或首领狂暴
      const bossTarget = enemies[0];
      const bossHpPct = bossTarget && bossTarget.maxHp > 0 ? bossTarget.hp / bossTarget.maxHp : 1;
      if (bossHpPct < 0.35 || ctx.isEmergency) {
        cycleMultiplier = 2.2 * personality.cycleAggression;
      } else {
        cycleMultiplier = 1.2 * personality.cycleAggression;
      }
    }
  } else if (skill.cycle === 'MINOR') {
    // 小周期技能：具备较高的冷却利用价值，适度优先出手
    cycleMultiplier = 1.35 * personality.cycleAggression;
  } else {
    // 常规填充技能
    cycleMultiplier = 1.0;
  }

  // 5. 核心量化打分
  const tpRate = skill.roleType === 'HEAL' ? skill.hps : skill.dps;
  const cdRate = skill.roleType === 'HEAL' ? skill.hpsPerCd : skill.dpsPerCd;
  const effRate = skill.roleType === 'HEAL' ? skill.hpsPerCost : skill.dpsPerCost;

  // 消耗不足时抑制高耗技能，严格优先低耗技能
  let costModifier = 1.0;
  if (isLowResource && skill.resourceCost > 0 && !ctx.isEmergency) {
    costModifier = Math.max(0.25, 1.0 - (skill.resourceCost - 1600) / 3200);
  }

  // 救急技能加成与慢速节能惩罚：当有人濒危时，高HPS技能获大幅度提升，低HPS慢速技能被压制
  let emergencyBonus = 1.0;
  if (ctx.isEmergency && skill.roleType === 'HEAL') {
    if (skill.hps >= 8000) {
      emergencyBonus = 2.2;
    } else {
      emergencyBonus = 0.35;
    }
  }

  // 归一化评分 (基准化处理)
  const normTP = (tpRate / 1000) * 1.5 + (cdRate / 1000) * 0.8;
  const normEff = effRate > 50 ? 50 : effRate * 3.5;

  let baseScore = (normTP * throughputWeight + normEff * efficiencyWeight) * aoeMultiplier * cycleMultiplier * costModifier * emergencyBonus;

  // 6. 随机性微抖动 (±6% 抖动，以 AI 种子和 tick 驱动，打破僵硬机械感)
  const jitter = 1 + (((personality.seed + tickCount) % 13) - 6) * 0.01;
  baseScore *= jitter;

  return Math.max(0, baseScore);
}

// ────────────────────────────────────────────────────────────
// 预置标准化技能库数据 (包含治疗、伤害、坦克与首领技能)
// ────────────────────────────────────────────────────────────

export const PREDEFINED_SKILL_INPUTS: Record<string, SkillEvaluationInput> = {
  // ── 德鲁伊 (Druid) ──
  druid_nourish: {
    id: 'druid_nourish',
    name: '滋养',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 1100,
    rawHeal: 9500,
    isAOE: false,
    description: '常规高效单体慢速治疗，刷新生命绽放',
  },
  druid_regrowth: {
    id: 'druid_regrowth',
    name: '愈合',
    roleType: 'HEAL',
    castTimeMs: 1500,
    cooldownMs: 0,
    resourceCost: 3900,
    rawHeal: 14000,
    isAOE: false,
    description: '快速救急治疗，附加暴击HoT并刷新生命绽放',
  },
  druid_healing_touch: {
    id: 'druid_healing_touch',
    name: '治疗之触',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 3400,
    rawHeal: 25000,
    isAOE: false,
    description: '重度救急大治疗，单次输出量高但耗蓝较重',
  },
  druid_swiftmend: {
    id: 'druid_swiftmend',
    name: '迅捷治愈',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 15000,
    resourceCost: 1600,
    rawHeal: 28000 + 26600, // 直抬 + 百花齐放绿圈
    isAOE: true,
    maxAoeTargets: 5,
    description: '小周期核心瞬发救急，生成百花齐放群体绿圈',
  },
  druid_wild_growth: {
    id: 'druid_wild_growth',
    name: '野性成长',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 8000,
    resourceCost: 4800,
    rawHeal: 16800,
    isAOE: true,
    maxAoeTargets: 5,
    description: '小周期智能群刷 HoT，快速覆盖5名受伤队友',
  },
  druid_tranquility: {
    id: 'druid_tranquility',
    name: '宁静',
    roleType: 'HEAL',
    castTimeMs: 8000,
    cooldownMs: 180000,
    resourceCost: 6800,
    rawHeal: 48000,
    isAOE: true,
    maxAoeTargets: 10,
    description: '大周期全团超大型急救引导治疗',
  },
  druid_innervate: {
    id: 'druid_innervate',
    name: '激活',
    roleType: 'UTILITY',
    castTimeMs: 0,
    cooldownMs: 180000,
    resourceCost: 0,
    rawHeal: 45000,
    isAOE: false,
    description: '大周期法力值回复大招',
  },

  // ── 萨满 (Shaman) ──
  shaman_healing_wave: {
    id: 'shaman_healing_wave',
    name: '治疗波',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 1800,
    rawHeal: 9500,
    isAOE: false,
    description: '常规高性价比慢速治疗，省蓝首选',
  },
  shaman_healing_surge: {
    id: 'shaman_healing_surge',
    name: '治疗之涌',
    roleType: 'HEAL',
    castTimeMs: 1500,
    cooldownMs: 0,
    resourceCost: 3800,
    rawHeal: 16000,
    isAOE: false,
    description: '快速救急技能，高耗低性价，用于防猝死',
  },
  shaman_greater_healing_wave: {
    id: 'shaman_greater_healing_wave',
    name: '强效治疗波',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 4200,
    rawHeal: 32000,
    isAOE: false,
    description: '重度慢速大治疗',
  },
  shaman_chain_heal: {
    id: 'shaman_chain_heal',
    name: '治疗链',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 3400,
    rawHeal: 28000,
    isAOE: true,
    maxAoeTargets: 4,
    description: '智能多目标跳跃治疗，优先弹向生命值百分比最低的受伤队友',
  },
  shaman_riptide: {
    id: 'shaman_riptide',
    name: '激流',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 6000,
    resourceCost: 2200,
    rawHeal: 12500,
    isAOE: false,
    description: '小周期瞬发 HoT，提供潮汐奔涌加速',
  },
  shaman_healing_rain: {
    id: 'shaman_healing_rain',
    name: '大雨 (治疗之雨)',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 10000,
    resourceCost: 6500,
    rawHeal: 32000,
    isAOE: true,
    maxAoeTargets: 6,
    description: '小周期大范围地面群体治疗水圈',
  },
  shaman_mana_tide: {
    id: 'shaman_mana_tide',
    name: '法力之潮图腾',
    roleType: 'UTILITY',
    castTimeMs: 0,
    cooldownMs: 180000,
    resourceCost: 0,
    rawHeal: 40000,
    isAOE: true,
    maxAoeTargets: 10,
    description: '大周期团队法力恢复图腾',
  },

  // ── 法师 (Mage) ──
  mage_fireball: {
    id: 'mage_fireball',
    name: '火球术',
    roleType: 'DAMAGE',
    castTimeMs: 2250,
    cooldownMs: 0,
    resourceCost: 2000,
    rawDamage: 11000,
    isAOE: false,
    description: '常规核心单体读条输出',
  },
  mage_pyroblast: {
    id: 'mage_pyroblast',
    name: '炎爆术 (热力迸发瞬发)',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 0,
    rawDamage: 18500,
    isAOE: false,
    description: '触发后0耗无CD瞬发超高爆发',
  },
  mage_living_bomb: {
    id: 'mage_living_bomb',
    name: '活动炸弹',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 2600,
    rawDamage: 22000,
    isAOE: true,
    maxAoeTargets: 3,
    description: '小周期持续 DoT 与终结范围爆轰',
  },
  mage_evocation: {
    id: 'mage_evocation',
    name: '唤醒',
    roleType: 'UTILITY',
    castTimeMs: 6000,
    cooldownMs: 120000,
    resourceCost: 0,
    rawDamage: 0,
    rawHeal: 40000,
    isAOE: false,
    description: '大周期法力枯竭自我急救恢复',
  },

  // ── 潜行者 (Rogue) ──
  rogue_sinister_strike: {
    id: 'rogue_sinister_strike',
    name: '影袭',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 40,
    resourceType: 'ENERGY',
    rawDamage: 5500,
    isAOE: false,
    description: '常规连击点积攒技能',
  },
  rogue_eviscerate: {
    id: 'rogue_eviscerate',
    name: '刺骨',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 35,
    resourceType: 'ENERGY',
    rawDamage: 19500,
    isAOE: false,
    description: '高爆发终结技',
  },
  rogue_slice_and_dice: {
    id: 'rogue_slice_and_dice',
    name: '切割',
    roleType: 'UTILITY',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 25,
    resourceType: 'ENERGY',
    rawDamage: 15000,
    isAOE: false,
    description: '小周期攻击速度核心增益维护',
  },
  rogue_adrenaline_rush: {
    id: 'rogue_adrenaline_rush',
    name: '冲动',
    roleType: 'UTILITY',
    castTimeMs: 0,
    cooldownMs: 180000,
    resourceCost: 0,
    resourceType: 'ENERGY',
    rawDamage: 30000,
    isAOE: false,
    description: '大周期急速能量回复大爆发',
  },

  // ── 元素萨 (Elemental Shaman) ──
  shaman_lava_burst: {
    id: 'shaman_lava_burst',
    name: '熔岩爆裂',
    roleType: 'DAMAGE',
    castTimeMs: 1500,
    cooldownMs: 8000,
    resourceCost: 2600,
    rawDamage: 16000,
    isAOE: false,
    description: '小周期必暴击高额单体爆发',
  },
  shaman_flame_shock: {
    id: 'shaman_flame_shock',
    name: '烈焰震击',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 6000,
    resourceCost: 2200,
    rawDamage: 16800,
    isAOE: false,
    description: '小周期高性价比持续火焰 DoT',
  },
  shaman_lightning_bolt: {
    id: 'shaman_lightning_bolt',
    name: '闪电箭',
    roleType: 'DAMAGE',
    castTimeMs: 2000,
    cooldownMs: 0,
    resourceCost: 1600,
    rawDamage: 9000,
    isAOE: false,
    description: '常规高性价比低耗输出',
  },
  shaman_chain_lightning: {
    id: 'shaman_chain_lightning',
    name: '闪电链',
    roleType: 'DAMAGE',
    castTimeMs: 2000,
    cooldownMs: 3000,
    resourceCost: 3000,
    rawDamage: 25500,
    isAOE: true,
    maxAoeTargets: 3,
    description: '小周期多目标弹射群体伤害',
  },

  // ── 首领技能通用评估预置 (Boss Skills) ──
  boss_asphyxiate: {
    id: 'asphyxiate',
    name: '窒息术',
    roleType: 'DAMAGE',
    castTimeMs: 4000,
    cooldownMs: 32000,
    resourceCost: 0,
    rawDamage: 65000,
    isAOE: true,
    maxAoeTargets: 10,
    description: '大周期强力全场机制技能',
  },
  boss_stay_of_execution: {
    id: 'stay_of_execution',
    name: '暂缓处决',
    roleType: 'HEAL',
    castTimeMs: 6000,
    cooldownMs: 30000,
    resourceCost: 0,
    rawHeal: 55000,
    isAOE: false,
    description: '大周期高额自愈技能',
  },
  boss_mend_rotten_flesh: {
    id: 'mend_rotten_flesh',
    name: '修补烂肉',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 26000,
    resourceCost: 0,
    rawHeal: 45000,
    isAOE: false,
    description: '小周期紧急自愈技能',
  },
  boss_calamity: {
    id: 'calamity',
    name: '苦痛灾厄',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 20000,
    resourceCost: 0,
    rawDamage: 28000,
    isAOE: true,
    maxAoeTargets: 10,
    description: '小周期全场暗影脉冲',
  },
  boss_pistol_barrage: {
    id: 'pistol_barrage',
    name: '双枪弹幕',
    roleType: 'DAMAGE',
    castTimeMs: 3000,
    cooldownMs: 32000,
    resourceCost: 0,
    rawDamage: 45000,
    isAOE: true,
    maxAoeTargets: 5,
    description: '大周期高额锥形扇形强杀伤害',
  },
  boss_cursed_bullets: {
    id: 'cursed_bullets',
    name: '诅咒之弹',
    roleType: 'DAMAGE',
    castTimeMs: 2000,
    cooldownMs: 16000,
    resourceCost: 0,
    rawDamage: 35000,
    isAOE: true,
    maxAoeTargets: 2,
    description: '小周期双目标点名诅咒与暗影伤害',
  },
  boss_mortal_wound: {
    id: 'mortal_wound',
    name: '重伤',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 15000,
    resourceCost: 0,
    rawDamage: 18000,
    isAOE: false,
    description: '小周期针对坦克的致死打击',
  },
  boss_generic_strike: {
    id: 'generic_strike',
    name: '首领重击',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 8000,
    resourceCost: 0,
    rawDamage: 25000,
    isAOE: false,
    description: '常规循环主坦重击',
  },
};

// 预计算的标准化技能指标字典 (缓存提高运行帧率)
export const COMPUTED_SKILL_METRICS: Record<string, SkillMetrics> = {};
for (const [key, input] of Object.entries(PREDEFINED_SKILL_INPUTS)) {
  COMPUTED_SKILL_METRICS[key] = computeSkillMetrics(input);
}

// ────────────────────────────────────────────────────────────
// AI 通用决策引擎 (Universal AI Decision Engine)
// 统一规则体系，不针对专精写死 if-else，而是根据 AI 拥有的可用技能动态计算
// 优先级 1: 优先判断是否放 AOE 技能
//   - 治疗：判断 Tank 在危险线上 (>=40% HP) 且多名其他队友在健康线下 (<85% HP)，优先释放 AOE 治疗
//   - 输出：判断当前可命中目标 >= 3 个，优先释放 AOE 伤害技能
// 优先级 2: 单体紧急救急 (防猝死)
//   - 目标血线在危险线下 (<40%)，必须使用高吞吐量救急技能，禁止在危急时刻只放慢速节能技能
// 优先级 3: 常规平稳期 (兼顾输出量与性价比，消耗不足优先低耗)
// ────────────────────────────────────────────────────────────

export interface UsableSkillCandidate {
  spellId: string;
  spellName: string;
  metrics: SkillMetrics;
  baseAmt: number;
  castMs: number;
  cost: number;
  resourceType: 'MANA' | 'ENERGY' | 'RUNIC_POWER' | 'NONE';
  isAOE: boolean;
  maxTargets?: number;
  isOnCooldown?: boolean;
}

export interface UniversalAIDecisionInput {
  caster: Unit;
  personality: AIPersonality;
  allies: Unit[];
  enemies: Unit[];
  usableSkills: UsableSkillCandidate[];
  tickCount: number;
}

export interface UniversalAIDecisionResult {
  decisionType: 'AOE' | 'EMERGENCY_ST' | 'SUSTAINED_ST' | 'BUFF_MAINTENANCE' | 'WAIT';
  chosenCandidate: UsableSkillCandidate | null;
  targetUnit: Unit | null;
  reason: string;
  score: number;
}

export function evaluateUniversalAIDecision(input: UniversalAIDecisionInput): UniversalAIDecisionResult {
  const { caster, personality, allies, enemies, usableSkills, tickCount } = input;

  // 1. 过滤可用技能 (未在冷却中，且拥有足够施法资源)
  const available = usableSkills.filter(s => {
    if (s.isOnCooldown) return false;
    if (s.resourceType === 'MANA') {
      return (caster.mp ?? 0) >= s.cost;
    }
    if (s.resourceType === 'ENERGY') {
      return (caster.energy ?? 100) >= s.cost;
    }
    return true;
  });

  if (available.length === 0) {
    return {
      decisionType: 'WAIT',
      chosenCandidate: null,
      targetUnit: null,
      reason: '无可用技能或资源不足/冷却中',
      score: 0,
    };
  }

  // 2. 战场血线与仇恨对象分析
  const livingAllies = allies.filter(a => (a.alive ?? a.isAlive) && a.hp > 0);
  const tankUnit = livingAllies.find(a => a.role === 'TANK');
  const tankHpRatio = tankUnit && tankUnit.maxHp > 0 ? tankUnit.hp / tankUnit.maxHp : 1.0;
  const tankDangerLine = 0.40; // 坦克危险线：40% HP
  const isTankSafe = !tankUnit || tankHpRatio >= tankDangerLine;

  const healthLine = 0.85; // 玩家健康线：85% HP
  const injuredOtherAllies = livingAllies.filter(a => a.id !== tankUnit?.id && (a.hp / a.maxHp) < healthLine);

  const sortedLowestAllies = [...livingAllies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
  const lowestAlly = sortedLowestAllies[0] || caster;
  const lowestHpRatio = lowestAlly.maxHp > 0 ? lowestAlly.hp / lowestAlly.maxHp : 1.0;

  const isAnyEmergency = lowestHpRatio < 0.40 || !isTankSafe;
  const livingEnemies = enemies.filter(e => (e.alive ?? e.isAlive) && e.hp > 0);
  const primaryEnemy = livingEnemies[0] || null;

  // ─────────────────────────────────────────────────────────────
  // 规则一：优先判断是否放 AOE 技能 (通用规则最高优先级)
  // ─────────────────────────────────────────────────────────────
  // 对于治疗：判断 Tank 在危险线上且多名其他玩家在健康线下，优先放 AOE 治疗
  if (caster.role === 'HEALER' || available.some(s => s.metrics.roleType === 'HEAL')) {
    const shouldAoeHeal = isTankSafe && injuredOtherAllies.length >= personality.aoeThresholdCount;
    if (shouldAoeHeal) {
      const aoeHealCandidates = available.filter(s => s.isAOE && s.metrics.roleType === 'HEAL');
      if (aoeHealCandidates.length > 0) {
        const scoredAoe = aoeHealCandidates.map(c => ({
          candidate: c,
          score: scoreSkillCandidate(c.metrics, {
            caster,
            personality,
            target: lowestAlly,
            allies: livingAllies,
            enemies: livingEnemies,
            tickCount,
            isEmergency: false,
          }),
        })).sort((a, b) => b.score - a.score);

        if (scoredAoe.length > 0 && scoredAoe[0].score > 0) {
          return {
            decisionType: 'AOE',
            chosenCandidate: scoredAoe[0].candidate,
            targetUnit: lowestAlly,
            reason: `Tank血线安全(${(tankHpRatio * 100).toFixed(0)}% >= 40%)且${injuredOtherAllies.length}名其他队友在健康线下(<85%)，优先释放群体治疗`,
            score: scoredAoe[0].score,
          };
        }
      }
    }
  }

  // 对于 DPS：可以产生目标大于等于3个时，优先放 AOE 伤害
  if (caster.role === 'DPS' || available.some(s => s.metrics.roleType === 'DAMAGE')) {
    const shouldAoeDps = livingEnemies.length >= 3;
    if (shouldAoeDps) {
      const aoeDpsCandidates = available.filter(s => s.isAOE && s.metrics.roleType === 'DAMAGE');
      if (aoeDpsCandidates.length > 0) {
        const scoredAoe = aoeDpsCandidates.map(c => ({
          candidate: c,
          score: scoreSkillCandidate(c.metrics, {
            caster,
            personality,
            target: primaryEnemy || undefined,
            allies: livingAllies,
            enemies: livingEnemies,
            tickCount,
            isEmergency: false,
          }),
        })).sort((a, b) => b.score - a.score);

        if (scoredAoe.length > 0 && scoredAoe[0].score > 0) {
          return {
            decisionType: 'AOE',
            chosenCandidate: scoredAoe[0].candidate,
            targetUnit: primaryEnemy,
            reason: `可产生目标(${livingEnemies.length})大于等于3个，优先释放群体伤害技能`,
            score: scoredAoe[0].score,
          };
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 规则二：救急判断 (紧急单体救急，防猝死)
  // ─────────────────────────────────────────────────────────────
  if (isAnyEmergency) {
    const emergencyTarget = (!isTankSafe && tankUnit) ? tankUnit : lowestAlly;
    const emergencyHeals = available.filter(s => !s.isAOE && s.metrics.roleType === 'HEAL');
    if (emergencyHeals.length > 0) {
      const scoredEmergency = emergencyHeals.map(c => ({
        candidate: c,
        score: scoreSkillCandidate(c.metrics, {
          caster,
          personality,
          target: emergencyTarget,
          allies: livingAllies,
          enemies: livingEnemies,
          tickCount,
          isEmergency: true,
        }),
      })).sort((a, b) => b.score - a.score);

      if (scoredEmergency.length > 0 && scoredEmergency[0].score > 0) {
        return {
          decisionType: 'EMERGENCY_ST',
          chosenCandidate: scoredEmergency[0].candidate,
          targetUnit: emergencyTarget,
          reason: `目标(${emergencyTarget.name})血线处于危险线下(${((emergencyTarget.hp / emergencyTarget.maxHp) * 100).toFixed(0)}% < 40%)，优先高吞吐量救急`,
          score: scoredEmergency[0].score,
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 规则三：常规平稳期 (性价比与纯输出量平衡，低耗优先)
  // ─────────────────────────────────────────────────────────────
  // 如果是治疗，对当前生命值最低的队友进行常规维护或填充治疗
  if (caster.role === 'HEALER' || available.some(s => s.metrics.roleType === 'HEAL')) {
    if (lowestHpRatio < 0.98) {
      const singleHeals = available.filter(s => s.metrics.roleType === 'HEAL');
      const scoredHeals = singleHeals.map(c => ({
        candidate: c,
        score: scoreSkillCandidate(c.metrics, {
          caster,
          personality,
          target: lowestAlly,
          allies: livingAllies,
          enemies: livingEnemies,
          tickCount,
          isEmergency: false,
        }),
      })).sort((a, b) => b.score - a.score);

      if (scoredHeals.length > 0 && scoredHeals[0].score > 0) {
        return {
          decisionType: 'SUSTAINED_ST',
          chosenCandidate: scoredHeals[0].candidate,
          targetUnit: lowestAlly,
          reason: '常规平稳治疗：根据蓝量与性价比/输出权重平衡选优',
          score: scoredHeals[0].score,
        };
      }
    }
  }

  // 如果是 DPS 或首领，选择当前单体最高得分技能
  const singleDamageSkills = available.filter(s => s.metrics.roleType === 'DAMAGE' || s.metrics.roleType === 'UTILITY');
  if (singleDamageSkills.length > 0) {
    const scoredDps = singleDamageSkills.map(c => ({
      candidate: c,
      score: scoreSkillCandidate(c.metrics, {
        caster,
        personality,
        target: primaryEnemy || undefined,
        allies: livingAllies,
        enemies: livingEnemies,
        tickCount,
        isEmergency: false,
      }),
    })).sort((a, b) => b.score - a.score);

    if (scoredDps.length > 0 && scoredDps[0].score > 0) {
      return {
        decisionType: 'SUSTAINED_ST',
        chosenCandidate: scoredDps[0].candidate,
        targetUnit: primaryEnemy,
        reason: '常规单体输出循环：按性价比与输出综合评分选优',
        score: scoredDps[0].score,
      };
    }
  }

  return {
    decisionType: 'WAIT',
    chosenCandidate: null,
    targetUnit: null,
    reason: '当前状态无需施法',
    score: 0,
  };
}
