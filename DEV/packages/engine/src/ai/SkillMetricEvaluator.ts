// ============================================================
// Cata Raid Sim — Universal Rule-Driven AI Skill Metric Evaluator
// Computes dynamic metrics (DPS, HPS, DPS/Cost, HPS/Cost, DPS/CD, HPS/CD, isAOE)
// Dynamically inspects ANY unit's owned available skills from ClassRegistry
// (zero per-spec hardcoding!) and applies universal priority rules:
//   1. AoE Priority:
//      - Healer: Tank above danger line (>=45%) & multiple allies below health line (<85%) -> AoE Heal
//      - Healer Raid Crisis: >=3 allies critically low (<45%) -> Raid Major AoE CD / Smart AoE Heal
//      - DPS/Tank: >=3 living hittable enemy targets -> AoE Damage
//   2. Emergency Single-Target Save (anyone <45% HP):
//      - Strictly favors high-HPS fast/heavy heals; suppresses slow low-HPS fillers (e.g. Healing Wave)
//   3. Sustained Cost-Efficiency & Output (性价比与输出平衡)
// ============================================================

import type { ClassId, Unit } from '../types.js';
import {
  getSpellsForClassSpec,
  type NormalizedSpell,
} from '../classes/ClassRegistry.js';
import {
  getHastedCastTimeMs,
  LEVEL_80_MAX_HASTE,
} from '../engine/TierProfile.js';
import { getUnitHaste } from '../engine/BuffEffects.js';

export type SkillCycle = 'MAJOR' | 'MINOR' | 'SUSTAINED';
export type SkillRoleCategory = 'DAMAGE' | 'HEAL' | 'DEFENSIVE' | 'UTILITY' | 'INTERRUPT';
export type EvaluatorResourceType =
  | 'MANA'
  | 'ENERGY'
  | 'RUNIC_POWER'
  | 'RAGE'
  | 'FOCUS'
  | 'HOLY_POWER'
  | 'RUNE'
  | 'COMBO_POINTS'
  | 'NONE';

export interface SkillEvaluationInput {
  id: string;
  name: string;
  roleType: SkillRoleCategory;
  castTimeMs: number;
  cooldownMs: number;
  resourceCost: number;
  resourceType?: EvaluatorResourceType;
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
  resourceType: EvaluatorResourceType;

  // Core metrics:
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
  resourceHealthyThreshold: number;
  energyReserveThreshold: number;

  // 2. 输出量 vs 性价比平衡值浮动 (0.32 ~ 0.68)
  throughputVsEfficiencyBias: number;

  // 3. 周期爆发/救急倾向 (0.85 ~ 1.15)
  cycleAggression: number;

  // 4. 群体偏好目标数门槛 (2 或 3)
  aoeThresholdCount: number;

  // 5. 步调偏移抖动 (0 ~ 29 ticks)
  tickOffset: number;

  /**
   * 6. 多动症 / 站桩不耐烦：原地站太久后小幅走动的意向
   * - fidgetIdleThresholdMs: 默认（坦克/远程/治疗）约 5s~60s；近战 DPS 请用 resolveFidgetIdleThresholdMs
   * - fidgetRadiusPx: 相对意图站位的小幅半径（不影响拉怪/治疗圈决策）
   * - fidgetDurationMs: 单次踱步持续多久后回到意图点
   */
  fidgetIdleThresholdMs: number;
  fidgetRadiusPx: number;
  fidgetDurationMs: number;
}

/**
 * 按角色解析站桩不耐烦阈值：近战非坦 1~10s，坦克/远程/治疗保持人格默认 5~60s
 */
export function resolveFidgetIdleThresholdMs(
  personality: AIPersonality,
  opts: { role?: string; isMeleeDps?: boolean }
): number {
  if (opts.role !== 'TANK' && opts.isMeleeDps) {
    return 1000 + (personality.seed % 9000); // 1s ~ 10s
  }
  return personality.fidgetIdleThresholdMs;
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

  const resourceHealthyThreshold = Number((0.22 + ((pos % 17) / 100)).toFixed(2));
  const energyReserveThreshold = 22 + (pos % 21);
  const throughputVsEfficiencyBias = Number((0.32 + ((pos % 37) / 100)).toFixed(2));
  const cycleAggression = Number((0.85 + ((pos % 31) / 100)).toFixed(2));
  const aoeThresholdCount = 2 + (pos % 2);
  const tickOffset = pos % 30;

  // 多动意向（坦克/远程/治疗默认）：有人 5s 就踱步，有人能站将近一分钟——同名稳定可复现
  const fidgetIdleThresholdMs = 5000 + (pos % 56000); // 5s ~ 61s
  // 多动症半径：人格差异，调用方再硬顶 ≤5 码（FIDGET_MAX_PX）
  const fidgetRadiusPx = 12 + (pos % 29); // 12 ~ 40 px
  const fidgetDurationMs = 900 + ((pos >> 3) % 1400); // 0.9s ~ 2.3s

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
    fidgetIdleThresholdMs,
    fidgetRadiusPx,
    fidgetDurationMs,
  };
}

/**
 * 为单个技能精确计算 DPS, HPS, DPS/消耗, HPS/消耗, DPS/CD, HPS/CD, isAOE 及大小周期分类
 */
export function computeSkillMetrics(params: SkillEvaluationInput): SkillMetrics {
  // 80级满急速下瞬发技能占 1.0s GCD
  const castSec = params.castTimeMs > 0 ? params.castTimeMs / 1000 : 1.0;
  const cdSec = params.cooldownMs > 0 ? params.cooldownMs / 1000 : castSec;
  const dmg = params.rawDamage || 0;
  const heal = params.rawHeal || 0;
  const cost = params.resourceCost || 0;

  const dps = dmg > 0 ? Math.round(dmg / castSec) : 0;
  const hps = heal > 0 ? Math.round(heal / castSec) : 0;

  const dpsPerCost = cost > 0 ? Number((dmg / cost).toFixed(2)) : (dmg > 0 ? 999 : 0);
  const hpsPerCost = cost > 0 ? Number((heal / cost).toFixed(2)) : (heal > 0 ? 999 : 0);

  const dpsPerCd = dmg > 0 ? Math.round(dmg / cdSec) : 0;
  const hpsPerCd = heal > 0 ? Math.round(heal / cdSec) : 0;

  const isAOE = Boolean(params.isAOE);
  const maxAoeTargets = params.maxAoeTargets || (isAOE ? 5 : 1);

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

/**
 * 从 ClassRegistry 的 NormalizedSpell 动态构建技能指标（自动应用 80 级满急速读条缩减）
 */
export function computeMetricsFromNormalizedSpell(
  spell: NormalizedSpell,
  haste: number = LEVEL_80_MAX_HASTE
): SkillMetrics {
  const effectiveCastMs = spell.castTimeMs > 0
    ? getHastedCastTimeMs(spell.castTimeMs, haste)
    : 0;

  // HoT 总量按 45% 折算进吞吐，避免回春等纯 HoT 被当成等量瞬抬
  const HOT_THROUGHPUT_FACTOR = 0.45;
  const totalHeal =
    spell.directHeal + spell.shieldValue + Math.round(spell.hotTotalHeal * HOT_THROUGHPUT_FACTOR);
  const totalDamage = spell.directDamage + spell.dotTotalDamage;

  let roleType: SkillRoleCategory = 'UTILITY';
  if (spell.isInterrupt) roleType = 'INTERRUPT';
  else if (spell.isHeal && !spell.isDamage) roleType = 'HEAL';
  else if (spell.isDamage) roleType = 'DAMAGE';
  else if (spell.isDefensive) roleType = 'DEFENSIVE';

  // For AoE skills, single-target base value scales when hitting multiple targets
  const rawHeal = totalHeal;
  const rawDamage = totalDamage;

  return computeSkillMetrics({
    id: spell.id,
    name: spell.name,
    roleType,
    castTimeMs: effectiveCastMs,
    cooldownMs: spell.cooldownMs,
    resourceCost: spell.resourceCostAmount,
    resourceType: spell.resourceKind,
    rawDamage,
    rawHeal,
    isAOE: spell.isAOE,
    maxAoeTargets: spell.maxAoeTargets,
    description: spell.description,
  });
}

/**
 * 通用资源余额查询（支持魔兽世界全 10 职业所有资源）
 */
export function getUnitResourceAmount(unit: Unit, kind: EvaluatorResourceType): number {
  if (kind === 'NONE') return Number.MAX_SAFE_INTEGER;
  if (kind === 'MANA') {
    const res = unit.resources?.find(r => r.kind === 'MANA');
    return res ? res.current : (unit.mp ?? 0);
  }
  if (kind === 'ENERGY') {
    const res = unit.resources?.find(r => r.kind === 'ENERGY');
    return res ? res.current : (unit.energy ?? 100);
  }
  if (kind === 'RAGE') {
    const res = unit.resources?.find(r => r.kind === 'RAGE');
    return res ? res.current : (unit.rage ?? 50);
  }
  if (kind === 'FOCUS') {
    const res = unit.resources?.find(r => r.kind === 'FOCUS');
    return res ? res.current : (unit.focus ?? 100);
  }
  if (kind === 'RUNIC_POWER') {
    const res = unit.resources?.find(r => r.kind === 'RUNIC_POWER');
    return res ? res.current : (unit.runicPower ?? 0);
  }
  if (kind === 'HOLY_POWER') {
    const res = unit.resources?.find(r => r.kind === 'HOLY_POWER');
    return res ? res.current : (unit.holyPower ?? 0);
  }
  if (kind === 'COMBO_POINTS') {
    const res = unit.resources?.find(r => r.kind === 'COMBO_POINTS');
    return res ? res.current : (unit.comboPoints ?? 0);
  }
  if (kind === 'RUNE') {
    if (!unit.runes || unit.runes.length === 0) return 6;
    return unit.runes.filter(r => r.cooldownMs <= 0).length;
  }
  return 0;
}

export function getUnitResourceMax(unit: Unit, kind: EvaluatorResourceType): number {
  if (kind === 'MANA') {
    const res = unit.resources?.find(r => r.kind === 'MANA');
    return res ? res.max : (unit.maxMp || 45000);
  }
  if (kind === 'ENERGY' || kind === 'RAGE' || kind === 'FOCUS' || kind === 'RUNIC_POWER') {
    const res = unit.resources?.find(r => r.kind === kind);
    return res ? res.max : 100;
  }
  if (kind === 'HOLY_POWER') return 3;
  if (kind === 'COMBO_POINTS') return 5;
  if (kind === 'RUNE') return 6;
  return 100;
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
 * 通用技能综合评分函数（无职业硬编码）：
 * 综合输出吞吐量 (DPS/HPS)、性价比 (输出/消耗)、群体覆盖收益、冷却节奏与个体抖动
 */
export function scoreSkillCandidate(skill: SkillMetrics, ctx: SkillScoreContext): number {
  const { caster, personality, allies, enemies, tickCount } = ctx;

  // 1. 通用资源可用性与健康线判定
  let isLowResource = false;
  let mpRatio = 1.0;
  if (skill.resourceType !== 'NONE') {
    const cur = getUnitResourceAmount(caster, skill.resourceType);
    if (cur < skill.resourceCost) return -1;

    if (skill.resourceType === 'MANA') {
      const maxMp = getUnitResourceMax(caster, 'MANA');
      mpRatio = maxMp > 0 ? cur / maxMp : 1;
      isLowResource = mpRatio < 0.65; // 三阶控蓝：低于 65% 即进入控蓝与节能关注
    } else if (skill.resourceType === 'ENERGY' || skill.resourceType === 'FOCUS') {
      isLowResource = cur < personality.energyReserveThreshold;
    } else if (skill.resourceType === 'RAGE') {
      isLowResource = cur < 25;
    }
  }

  // 2. 吞吐量 vs 性价比权重分配（三阶控蓝阶梯）
  let throughputWeight: number;
  let efficiencyWeight: number;

  if (ctx.isEmergency) {
    // 急救防猝死状态：纯吞吐量与出伤/出疗速度压倒一切，严禁贪省蓝
    throughputWeight = 0.94 + personality.throughputVsEfficiencyBias * 0.04;
    efficiencyWeight = 1 - throughputWeight;
  } else if (skill.resourceType === 'MANA' && mpRatio < 0.35) {
    // 极限节能期（蓝量 < 35%）：极度注重性价比，禁止挥霍
    efficiencyWeight = 0.88;
    throughputWeight = 0.12;
  } else if (skill.resourceType === 'MANA' && mpRatio < 0.65) {
    // 控蓝平稳期（35% ~ 65%）：高性价比优先，平刷控蓝
    efficiencyWeight = 0.68 + (1 - personality.throughputVsEfficiencyBias) * 0.12;
    throughputWeight = 1 - efficiencyWeight;
  } else if (isLowResource) {
    // 物理系低能量/集中值节能
    efficiencyWeight = 0.78 + (1 - personality.throughputVsEfficiencyBias) * 0.14;
    throughputWeight = 1 - efficiencyWeight;
  } else {
    // 资源充沛常规期（蓝量 >= 65%）：兼顾输出与性价比，偏重吞吐量
    throughputWeight = 0.66 + personality.throughputVsEfficiencyBias * 0.22;
    efficiencyWeight = 1 - throughputWeight;
  }

  // 3. 群体覆盖系数 (isAOE)
  let aoeMultiplier = 1.0;
  if (skill.isAOE) {
    if (skill.roleType === 'HEAL') {
      const injuredCount = allies.filter(a => (a.alive ?? a.isAlive) && a.hp < a.maxHp * 0.85).length;
      if (injuredCount >= personality.aoeThresholdCount) {
        aoeMultiplier = Math.min(skill.maxAoeTargets, injuredCount) * 0.95;
      } else {
        aoeMultiplier = 0.35;
      }
    } else {
      const enemyCount = enemies.filter(e => (e.alive ?? e.isAlive) && e.hp > 0).length;
      if (enemyCount >= 3) {
        aoeMultiplier = Math.min(skill.maxAoeTargets, enemyCount) * 1.05;
      } else if (enemyCount === 2) {
        aoeMultiplier = 1.25;
      } else {
        aoeMultiplier = 0.55;
      }
    }
  }

  // 4. 大小周期冷却利用率
  let cycleMultiplier = 1.0;
  if (skill.cycle === 'MAJOR') {
    if (skill.roleType === 'HEAL') {
      const criticalCount = allies.filter(a => (a.alive ?? a.isAlive) && a.hp < a.maxHp * 0.50).length;
      if (criticalCount >= 3 || (criticalCount >= 2 && ctx.isEmergency)) {
        cycleMultiplier = 2.8 * personality.cycleAggression;
      } else {
        cycleMultiplier = 0.12; // 平时保留全团大招
      }
    } else {
      const bossTarget = enemies[0];
      const bossHpPct = bossTarget && bossTarget.maxHp > 0 ? bossTarget.hp / bossTarget.maxHp : 1;
      cycleMultiplier = (bossHpPct < 0.35 || ctx.isEmergency ? 2.0 : 1.25) * personality.cycleAggression;
    }
  } else if (skill.cycle === 'MINOR') {
    cycleMultiplier = 1.32 * personality.cycleAggression;
  }

  // 5. 核心量化打分（修复量纲失衡：保证吞吐量与性价比同量纲可比）
  const tpRate = skill.roleType === 'HEAL' ? skill.hps : skill.dps;
  const cdRate = skill.roleType === 'HEAL' ? skill.hpsPerCd : skill.dpsPerCd;
  const effRate = skill.roleType === 'HEAL' ? skill.hpsPerCost : skill.dpsPerCost;

  // 低资源非紧急时，按三阶控蓝阶梯抑制高耗技能
  let costModifier = 1.0;
  if (isLowResource && skill.resourceType === 'MANA' && skill.resourceCost > 0 && !ctx.isEmergency) {
    if (mpRatio < 0.35) {
      costModifier = skill.resourceCost > 2000 ? Math.max(0.18, 2000 / skill.resourceCost) : 1.0;
    } else if (mpRatio < 0.65) {
      costModifier = skill.resourceCost > 3000 ? Math.max(0.50, 3000 / skill.resourceCost) : 1.0;
    }
  }

  // 救急加速与慢速低疗惩罚：急救时快速/重型大疗获强加权，慢速低HPS填充技能大幅降权
  let emergencyBonus = 1.0;
  if (ctx.isEmergency && skill.roleType === 'HEAL') {
    if (skill.hps >= 8000 || (skill.castTimeMs <= 1200 && skill.rawThroughput >= 9000)) {
      emergencyBonus = 2.6;
    } else if (skill.hps >= 6000) {
      emergencyBonus = 1.3;
    } else {
      emergencyBonus = 0.22;
    }
  }

  // 零消耗瞬发/核心技能（如圣能终结技、免费触发）给予合理性价比上限，避免 999 扭曲
  const cappedEff = effRate > 25 ? 25 : effRate;
  const normTP = (tpRate / 1000) * 2.4 + (cdRate / 1000) * 0.6;
  const normEff = cappedEff * 2.2;

  let baseScore =
    (normTP * throughputWeight + normEff * efficiencyWeight) *
    aoeMultiplier *
    cycleMultiplier *
    costModifier *
    emergencyBonus;

  // 6. 随机性微抖动 (±5%)
  const jitter = 1 + (((personality.seed + tickCount) % 11) - 5) * 0.01;
  baseScore *= jitter;

  return Math.max(0, baseScore);
}

// ────────────────────────────────────────────────────────────
// 预置标准化技能库数据 (保持向后兼容 + 80 级标定)
// ────────────────────────────────────────────────────────────

export const PREDEFINED_SKILL_INPUTS: Record<string, SkillEvaluationInput> = {
  // ── 德鲁伊 (Druid) ──
  druid_nourish: {
    id: 'druid_nourish',
    name: '滋养',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 950,
    rawHeal: 8500,
    isAOE: false,
    description: '常规高效单体慢速治疗，刷新生命绽放',
  },
  druid_regrowth: {
    id: 'druid_regrowth',
    name: '愈合',
    roleType: 'HEAL',
    castTimeMs: 1500,
    cooldownMs: 0,
    resourceCost: 2600,
    rawHeal: 12500,
    isAOE: false,
    description: '快速救急治疗，附加暴击HoT并刷新生命绽放',
  },
  druid_healing_touch: {
    id: 'druid_healing_touch',
    name: '治疗之触',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 2500,
    rawHeal: 20500,
    isAOE: false,
    description: '重度救急大治疗，单次输出量高',
  },
  druid_swiftmend: {
    id: 'druid_swiftmend',
    name: '迅捷治愈',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 15000,
    resourceCost: 1200,
    rawHeal: 24000,
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
    resourceCost: 2400,
    rawHeal: 15400,
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
    resourceCost: 3400,
    rawHeal: 42000,
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
    rawHeal: 15000,
    isAOE: false,
    description: '大周期法力值回复大招',
  },

  // ── 萨满 (Shaman — 80级满级标定，治疗链无CD 2.5s基础读条) ──
  shaman_healing_wave: {
    id: 'shaman_healing_wave',
    name: '治疗波',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 950,
    rawHeal: 8800,
    isAOE: false,
    description: '常规高性价比慢速治疗，省蓝首选',
  },
  shaman_healing_surge: {
    id: 'shaman_healing_surge',
    name: '治疗之涌',
    roleType: 'HEAL',
    castTimeMs: 1500,
    cooldownMs: 0,
    resourceCost: 2400,
    rawHeal: 12400,
    isAOE: false,
    description: '快速救急技能，用于危急防猝死',
  },
  shaman_greater_healing_wave: {
    id: 'shaman_greater_healing_wave',
    name: '强效治疗波',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 2700,
    rawHeal: 20500,
    isAOE: false,
    description: '重度大治疗，坦克危急核心抬血',
  },
  shaman_chain_heal: {
    id: 'shaman_chain_heal',
    name: '治疗链',
    roleType: 'HEAL',
    castTimeMs: 2500,
    cooldownMs: 0,
    resourceCost: 2200,
    rawHeal: 23500,
    isAOE: true,
    maxAoeTargets: 4,
    description: '2.5s读条无CD智能多目标跳跃治疗，优先弹向低血量队友',
  },
  shaman_riptide: {
    id: 'shaman_riptide',
    name: '激流',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 6000,
    resourceCost: 1600,
    rawHeal: 15000,
    isAOE: false,
    description: '小周期瞬发直疗+HoT',
  },
  shaman_healing_rain: {
    id: 'shaman_healing_rain',
    name: '治疗之雨',
    roleType: 'HEAL',
    castTimeMs: 2000,
    cooldownMs: 10000,
    resourceCost: 2800,
    rawHeal: 21000,
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
    resourceCost: 800,
    rawHeal: 15000,
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
    resourceCost: 1400,
    rawDamage: 10500,
    isAOE: false,
    description: '常规核心单体读条输出',
  },
  mage_pyroblast: {
    id: 'mage_pyroblast',
    name: '炎爆术',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 0,
    rawDamage: 16500,
    isAOE: false,
    description: '瞬发高爆发',
  },
  mage_living_bomb: {
    id: 'mage_living_bomb',
    name: '活动炸弹',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 1800,
    rawDamage: 18000,
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
    rawHeal: 25000,
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
    rawDamage: 6500,
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
    rawDamage: 16500,
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
    rawDamage: 12000,
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
    rawDamage: 24000,
    isAOE: false,
    description: '大周期急速能量回复大爆发',
  },

  // ── 元素萨 (Elemental Shaman) ──
  shaman_lava_burst: {
    id: 'shaman_lava_burst',
    name: '熔岩爆裂',
    roleType: 'DAMAGE',
    castTimeMs: 2000,
    cooldownMs: 8000,
    resourceCost: 1600,
    rawDamage: 14000,
    isAOE: false,
    description: '小周期必暴击高额单体爆发',
  },
  shaman_flame_shock: {
    id: 'shaman_flame_shock',
    name: '烈焰震击',
    roleType: 'DAMAGE',
    castTimeMs: 0,
    cooldownMs: 6000,
    resourceCost: 1200,
    rawDamage: 13800,
    isAOE: false,
    description: '小周期高性价比持续火焰 DoT',
  },
  shaman_lightning_bolt: {
    id: 'shaman_lightning_bolt',
    name: '闪电箭',
    roleType: 'DAMAGE',
    castTimeMs: 2000,
    cooldownMs: 0,
    resourceCost: 1400,
    rawDamage: 8500,
    isAOE: false,
    description: '常规高性价比低耗输出',
  },
  shaman_chain_lightning: {
    id: 'shaman_chain_lightning',
    name: '闪电链',
    roleType: 'DAMAGE',
    castTimeMs: 2000,
    cooldownMs: 3000,
    resourceCost: 2200,
    rawDamage: 25800,
    isAOE: true,
    maxAoeTargets: 4,
    description: '小周期多目标弹射群体伤害，命中回蓝',
  },
  shaman_earth_shield: {
    id: 'shaman_earth_shield',
    name: '大地之盾',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 0,
    resourceCost: 1800,
    rawHeal: 20000,
    isAOE: false,
    description: '坦克维护：9层受击回血护盾 + 受疗+20%',
  },
  shaman_unleash_life: {
    id: 'shaman_unleash_life',
    name: '生命释放',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 15000,
    resourceCost: 1600,
    rawHeal: 8500,
    isAOE: false,
    description: '瞬发治疗并强化下一次直接治疗+30%',
  },
  shaman_healing_tide_totem: {
    id: 'shaman_healing_tide_totem',
    name: '治疗之潮图腾',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 180000,
    resourceCost: 1200,
    rawHeal: 26000,
    isAOE: true,
    maxAoeTargets: 5,
    description: '大周期群体治疗图腾冷却',
  },
  shaman_ascendance: {
    id: 'shaman_ascendance',
    name: '升腾',
    roleType: 'UTILITY',
    castTimeMs: 0,
    cooldownMs: 180000,
    resourceCost: 1000,
    rawHeal: 30000,
    rawDamage: 20000,
    isAOE: true,
    maxAoeTargets: 5,
    description: '大周期升腾爆发：伤害+35% / 治疗复制',
  },
  shaman_ancestral_guidance: {
    id: 'shaman_ancestral_guidance',
    name: '先祖指引',
    roleType: 'HEAL',
    castTimeMs: 0,
    cooldownMs: 120000,
    resourceCost: 0,
    rawHeal: 18000,
    isAOE: true,
    maxAoeTargets: 3,
    description: '大周期伤害/治疗转化群体治疗',
  },

  // ── 首领技能通用评估预置 (Boss Skills) ──
  boss_asphyxiate: {
    id: 'asphyxiate',
    name: '窒息术',
    roleType: 'DAMAGE',
    castTimeMs: 4000,
    cooldownMs: 32000,
    resourceCost: 0,
    rawDamage: 42000,
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
    rawHeal: 40000,
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
    rawHeal: 32000,
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
    rawDamage: 18000,
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
    rawDamage: 28000,
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
    rawDamage: 22000,
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
    rawDamage: 12000,
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
    rawDamage: 16000,
    isAOE: false,
    description: '常规循环主坦重击',
  },
};

export const COMPUTED_SKILL_METRICS: Record<string, SkillMetrics> = {};
for (const [key, input] of Object.entries(PREDEFINED_SKILL_INPUTS)) {
  COMPUTED_SKILL_METRICS[key] = computeSkillMetrics(input);
}

// ────────────────────────────────────────────────────────────
// AI 通用决策引擎 (Universal AI Decision Engine)
// 统一规则体系：不针对专精写死 if-else，而是根据 AI 拥有的可用技能动态算分
// ────────────────────────────────────────────────────────────

export interface UsableSkillCandidate {
  spellId: string;
  spellName: string;
  /** 可选：关联的标准化技能定义 */
  normalizedSpell?: NormalizedSpell;
  metrics: SkillMetrics;
  baseAmt: number;
  castMs: number;
  cost: number;
  resourceType: EvaluatorResourceType;
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

/** 是否为治疗向维护/增效 Buff（大地之盾、圣光道标、升腾、先祖指引等）——纯数据驱动，不按 spellId 硬编码 */
export function isHealSupportBuffSpell(sp: NormalizedSpell): boolean {
  if (!sp.isBuff || sp.isDamage || sp.isRaidBuff || sp.isDefensive) return false;
  if (sp.isHeal) return true; // 如生命释放（直疗+Buff）
  // 友方维护 Buff（道标/大地之盾等）
  if (sp.targetType === 'SINGLE_ALLY' || sp.targetType === 'SMART_ALLY' || sp.targetType === 'AOE_ALLY') {
    return true;
  }
  // 自身治疗增效大招（升腾/先祖指引等 MAJOR CD）
  if (sp.targetType === 'SELF' && sp.isMajorCd) {
    return true;
  }
  return false;
}

/** 外置减伤/保命（痛苦压制、守护之魂等）：友方单体防御大招 */
export function isExternalSaveSpell(sp: NormalizedSpell): boolean {
  if (!sp.isDefensive || sp.isDamage) return false;
  return sp.targetType === 'SINGLE_ALLY' || sp.targetType === 'SMART_ALLY';
}

/** 单位是否持有任一匹配 aura / spellId */
export function unitHasAnyAura(unit: Unit, ids: string[]): boolean {
  if (!unit.buffs?.length || ids.length === 0) return false;
  const set = new Set(ids.map(s => s.toLowerCase()));
  return unit.buffs.some(b => {
    const sid = (b.spellId || '').toLowerCase();
    return set.has(sid);
  });
}

/** 迅捷治愈类：需要目标身上有回春/愈合 */
export function canCastSwiftmendOn(unit: Unit): boolean {
  return unitHasAnyAura(unit, [
    'rejuvenation',
    'regrowth',
    'druid_rejuvenation',
    'druid_regrowth',
    '回春术',
    '愈合',
  ]);
}

function isSwiftmendSpell(sp: NormalizedSpell | undefined): boolean {
  if (!sp) return false;
  const id = `${sp.id} ${sp.shortId}`.toLowerCase();
  return id.includes('swiftmend');
}

/** 轻量 triage：坦克/治疗加权，已有护盾降权；分数越高越优先抬 */
export function triageHealUrgency(unit: Unit): number {
  const maxHp = Math.max(1, unit.maxHp || 1);
  const hpPct = Math.max(0, Math.min(1, unit.hp / maxHp));
  let urgency = 1 - hpPct;
  if (unit.role === 'TANK') urgency *= 1.35;
  else if (unit.role === 'HEALER') urgency *= 1.15;
  const absorb = unit.absorb || 0;
  if (absorb >= maxHp * 0.08) urgency *= 0.82;
  return urgency;
}

/** 治疗候选相对目标的 aura 修正（已有同名 HoT/盾则大幅降权；缺 HoT 的轻伤铺垫加权） */
export function adjustHealScoreForTargetAuras(
  candidate: UsableSkillCandidate,
  target: Unit,
  baseScore: number,
  opts?: { isEmergency?: boolean },
): number {
  const sp = candidate.normalizedSpell;
  if (!sp || baseScore <= 0) return baseScore;
  let score = baseScore;
  const auraKeys = [sp.auraId, sp.shortId, sp.id].filter(Boolean) as string[];

  if (sp.isHot && auraKeys.length > 0 && unitHasAnyAura(target, auraKeys)) {
    score *= opts?.isEmergency ? 0.15 : 0.22;
  }
  if (sp.isShield && auraKeys.length > 0 && unitHasAnyAura(target, auraKeys)) {
    score *= 0.08;
  }
  if (sp.isShield && (target.absorb || 0) >= target.maxHp * 0.12) {
    score *= 0.2;
  }
  // 轻伤时优先补缺失 HoT，而不是重复刷直疗
  const hpPct = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  if (!opts?.isEmergency && sp.isHot && hpPct >= 0.7 && auraKeys.length > 0 && !unitHasAnyAura(target, auraKeys)) {
    score *= 1.45;
  }
  if (isSwiftmendSpell(sp) && !canCastSwiftmendOn(target)) {
    return -1;
  }
  return score;
}

function pickTriageTarget(allies: Unit[], caster: Unit, tickCount: number): Unit {
  if (allies.length === 0) return caster;
  const ranked = [...allies].sort((a, b) => triageHealUrgency(b) - triageHealUrgency(a));
  if (ranked.length === 1) return ranked[0];
  const top = ranked[0];
  const second = ranked[1];
  const topPct = top.hp / Math.max(1, top.maxHp);
  const secondPct = second.hp / Math.max(1, second.maxHp);
  // 前两名血量接近时，按治疗者 id 分流，减轻多奶叠抬同一人
  if (Math.abs(topPct - secondPct) <= 0.08) {
    let hash = 0;
    const key = `${caster.id}:${tickCount}`;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(hash) % 2 === 0 ? top : second;
  }
  return top;
}

/** 是否为输出向增效 Buff（宿敌、元素释放、狂野怒火等） */
export function isDamageSupportBuffSpell(sp: NormalizedSpell): boolean {
  if (!sp.isBuff || sp.isHeal || sp.isRaidBuff) return false;
  if (sp.isDamage) return true;
  if (sp.targetType === 'SINGLE_ENEMY' || sp.targetType === 'AOE_ENEMY') return true;
  if (sp.targetType === 'SELF' && (sp.isMajorCd || sp.cooldownMs >= 15_000)) return true;
  return false;
}

/**
 * 通用候选技能生成器：直接根据单位职业/专精拥有的技能与当前冷却/资源生成候选集（零专精硬编码）
 * 新技能只要在 ClassRegistry 标好 isHeal/isDamage/isBuff/isAOE/cooldown 等标签，就会自动进入评估。
 */
export function buildUsableCandidatesForUnit(
  caster: Unit,
  specId: string | undefined,
  isCdReady: (spell: NormalizedSpell) => boolean,
  options?: {
    roleFilter?: 'HEAL' | 'DAMAGE' | 'ALL';
    useShortId?: boolean;
  }
): UsableSkillCandidate[] {
  if (caster.classId === 'BOSS' || caster.classId === 'NPC') return [];
  const spells = getSpellsForClassSpec(caster.classId as ClassId, specId);
  const haste = getUnitHaste(caster, LEVEL_80_MAX_HASTE);
  const roleFilter = options?.roleFilter ?? (caster.role === 'HEALER' ? 'HEAL' : 'DAMAGE');
  const useShortId = options?.useShortId ?? false;

  const candidates: UsableSkillCandidate[] = [];
  for (const sp of spells) {
    // 跳过非战斗/复活/纯打断/纯嘲讽/纯驱散/团队常驻Buff/纯资源恢复（由独立触发器处理）
    if (sp.isOutOfCombatOnly || sp.isResurrect || sp.isInterrupt || sp.isTaunt || sp.isDispel || sp.isRaidBuff) {
      continue;
    }
    const healSupport = isHealSupportBuffSpell(sp);
    const dmgSupport = isDamageSupportBuffSpell(sp);
    const externalSave = isExternalSaveSpell(sp);

    if (
      sp.isDefensive &&
      !sp.isHeal &&
      !sp.isDamage &&
      !healSupport &&
      !dmgSupport &&
      !externalSave
    ) {
      continue;
    }
    if (sp.isResourceRestore && !sp.isHeal && !sp.isDamage) continue;

    if (roleFilter === 'HEAL' && !sp.isHeal && !healSupport && !externalSave) continue;
    if (roleFilter === 'DAMAGE' && !sp.isDamage && !dmgSupport) continue;

    const effectiveCastMs = sp.castTimeMs > 0 ? getHastedCastTimeMs(sp.castTimeMs, haste) : 0;
    let baseAmt =
      roleFilter === 'HEAL' || (roleFilter === 'ALL' && (sp.isHeal || healSupport || externalSave))
        ? externalSave && !sp.isHeal
          ? 24_000 // 外置减伤等效急救吞吐，便于进评分
          : sp.directHeal + Math.round(sp.hotTotalHeal * 0.45) + sp.shieldValue
        : sp.directDamage + sp.dotTotalDamage;

    // 纯 Buff / 外置减伤：给 AI 一个合理的“等效吞吐”以便参与优先级排序（不依赖具体 spellId）
    if (baseAmt <= 0 && (healSupport || dmgSupport || externalSave)) {
      if (externalSave) {
        baseAmt = 24_000;
      } else if (sp.isMajorCd) {
        baseAmt = 28000; // 大招增效等效爆发
      } else if (sp.targetType === 'SINGLE_ALLY' || sp.targetType === 'SMART_ALLY') {
        baseAmt = 14000; // 维护型友方 Buff
      } else {
        baseAmt = 10000;
      }
    }

    if (baseAmt <= 0) continue;

    let metrics = computeMetricsFromNormalizedSpell(sp, haste);
    // 纯增效 Buff / 外置减伤：补齐吞吐指标，并把 roleType 对齐到当前职责
    if ((healSupport || dmgSupport || externalSave) && metrics.rawThroughput <= 0) {
      metrics = computeSkillMetrics({
        id: sp.id,
        name: sp.name,
        roleType: healSupport || externalSave ? 'HEAL' : 'DAMAGE',
        castTimeMs: effectiveCastMs,
        cooldownMs: sp.cooldownMs,
        resourceCost: sp.resourceCostAmount,
        resourceType: sp.resourceKind,
        rawHeal: healSupport || externalSave ? baseAmt : 0,
        rawDamage: dmgSupport ? baseAmt : 0,
        isAOE: sp.isAOE,
        maxAoeTargets: sp.maxAoeTargets,
        description: sp.description,
      });
    } else if ((healSupport || externalSave) && metrics.roleType === 'UTILITY') {
      (metrics as { roleType: SkillRoleCategory }).roleType = 'HEAL';
    } else if (externalSave && metrics.roleType === 'DEFENSIVE') {
      (metrics as { roleType: SkillRoleCategory }).roleType = 'HEAL';
    } else if (dmgSupport && metrics.roleType === 'UTILITY') {
      (metrics as { roleType: SkillRoleCategory }).roleType = 'DAMAGE';
    }

    candidates.push({
      spellId: useShortId ? sp.shortId : sp.id,
      spellName: sp.name,
      normalizedSpell: sp,
      metrics,
      baseAmt,
      castMs: effectiveCastMs,
      cost: sp.resourceCostAmount,
      resourceType: sp.resourceKind,
      isAOE: sp.isAOE,
      maxTargets: sp.maxAoeTargets,
      isOnCooldown: !isCdReady(sp),
    });
  }
  return candidates;
}

export function evaluateUniversalAIDecision(input: UniversalAIDecisionInput): UniversalAIDecisionResult {
  const { caster, personality, allies, enemies, usableSkills, tickCount } = input;

  // 1. 过滤可用技能（未在冷却中，且当前资源足够）
  const available = usableSkills.filter(s => {
    if (s.isOnCooldown) return false;
    if (s.resourceType === 'NONE') return true;
    return getUnitResourceAmount(caster, s.resourceType) >= s.cost;
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

  // 2. 战场血线与目标态势分析
  const livingAllies = allies.filter(a => (a.alive ?? a.isAlive) && a.hp > 0);
  const tankUnit = livingAllies.find(a => a.role === 'TANK');
  const tankHpRatio = tankUnit && tankUnit.maxHp > 0 ? tankUnit.hp / tankUnit.maxHp : 1.0;
  const tankDangerLine = 0.45; // 坦克危险线：45% HP
  const isTankSafe = !tankUnit || tankHpRatio >= tankDangerLine;

  const healthLine = 0.85; // 团队健康线：85% HP
  const injuredOtherAllies = livingAllies.filter(
    a => a.id !== tankUnit?.id && a.maxHp > 0 && (a.hp / a.maxHp) < healthLine
  );
  const criticalAllies = livingAllies.filter(
    a => a.maxHp > 0 && (a.hp / a.maxHp) < 0.45
  );

  const sortedLowestAllies = [...livingAllies].sort(
    (a, b) => (a.hp / (a.maxHp || 1)) - (b.hp / (b.maxHp || 1))
  );
  const lowestByHp = sortedLowestAllies[0] || caster;
  const lowestHpRatio = lowestByHp.maxHp > 0 ? lowestByHp.hp / lowestByHp.maxHp : 1.0;
  // triage：坦克/治疗加权 + 多奶分流；血线判定仍用纯 HP%
  const lowestAlly = pickTriageTarget(livingAllies, caster, tickCount);

  const isAnyEmergency = lowestHpRatio < 0.45 || !isTankSafe;
  const livingEnemies = enemies.filter(e => (e.alive ?? e.isAlive) && e.hp > 0);
  const primaryEnemy = livingEnemies[0] || null;

  // ─────────────────────────────────────────────────────────────
  // 规则一（最高优先级）：在可用技能中优先判断是否放 AOE 技能
  // ─────────────────────────────────────────────────────────────
  if (caster.role === 'HEALER' || available.some(s => s.metrics.roleType === 'HEAL')) {
    const aoeHealCandidates = available.filter(s => s.isAOE && s.metrics.roleType === 'HEAL');

    if (aoeHealCandidates.length > 0) {
      // 场景 1A：全团危机（>=3 名队友濒危 <45%），优先释放全团大招或群体抬血
      if (criticalAllies.length >= 3) {
        const majorAoe = aoeHealCandidates.filter(c => c.metrics.cycle === 'MAJOR');
        const crisisPool = majorAoe.length > 0 ? majorAoe : (tankHpRatio >= 0.25 ? aoeHealCandidates : []);
        if (crisisPool.length > 0) {
          const scoredCrisis = crisisPool.map(c => ({
            candidate: c,
            score: scoreSkillCandidate(c.metrics, {
              caster,
              personality,
              target: lowestAlly,
              allies: livingAllies,
              enemies: livingEnemies,
              tickCount,
              isEmergency: true,
            }),
          })).sort((a, b) => b.score - a.score);

          if (scoredCrisis.length > 0 && scoredCrisis[0].score > 0) {
            return {
              decisionType: 'AOE',
              chosenCandidate: scoredCrisis[0].candidate,
              targetUnit: lowestAlly,
              reason: `全团危急(${criticalAllies.length}名队友低于45%血线)，优先释放群体急救技能`,
              score: scoredCrisis[0].score,
            };
          }
        }
      }

      // 场景 1B：Tank 在危险线上 (>=45%) 且多名其他玩家在健康线下 (<85%) -> 优先 AOE 治疗
      // 结合三阶控蓝阶梯：
      // - 充沛期 (mpRatio >= 0.65): 达到基础阈值即积极释放 AOE 压制团血波动
      // - 控蓝期 (0.35 <= mpRatio < 0.65): 提高 AOE 触发人数门槛（20人团本需 >= 5 人受创），控蓝平刷
      // - 节能期 (mpRatio < 0.35): 锁定昂贵常规 AOE，严禁挥霍，仅在全团极危急(1A)时破例
      const casterCurMp = getUnitResourceAmount(caster, 'MANA');
      const casterMaxMp = getUnitResourceMax(caster, 'MANA');
      const casterMpRatio = casterMaxMp > 0 ? casterCurMp / casterMaxMp : 1.0;

      let effectiveAoeThreshold = livingAllies.length <= 5 ? 2 : personality.aoeThresholdCount;
      if (casterMpRatio < 0.65) {
        effectiveAoeThreshold = livingAllies.length <= 5 ? 3 : 5;
      }
      const canCastRoutineAoe = casterMpRatio >= 0.35;
      const shouldAoeHeal = isTankSafe && canCastRoutineAoe && injuredOtherAllies.length >= effectiveAoeThreshold;
      if (shouldAoeHeal) {
        // 常规团血压力时优先常规/小周期 AOE（如治疗链、治疗之雨、野性成长、治疗之环、黎明圣光），留住 3 分钟大招应对全团危急
        const nonMajorAoe = aoeHealCandidates.filter(c => c.metrics.cycle !== 'MAJOR');
        const pool = nonMajorAoe.length > 0 ? nonMajorAoe : aoeHealCandidates;

        const scoredAoe = pool.map(c => ({
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
            reason: `Tank血线安全(${(tankHpRatio * 100).toFixed(0)}% >= 45%)且${injuredOtherAllies.length}名其他队友在健康线下(<85%)，优先释放群体治疗`,
            score: scoredAoe[0].score,
          };
        }
      }
    }
  }

  // 对于 DPS / 坦克：可命中敌方目标 >= 3 个（多目标场景）优先放 AOE 伤害技能
  if (caster.role === 'DPS' || caster.role === 'TANK' || available.some(s => s.metrics.roleType === 'DAMAGE')) {
    const aoeThreshold = caster.role === 'TANK' ? 2 : 3;
    const shouldAoeDps = livingEnemies.length >= aoeThreshold;
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
            reason: `可命中目标(${livingEnemies.length})达到群体阈值，优先释放群体伤害技能`,
            score: scoredAoe[0].score,
          };
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 规则二：单体紧急救急（防坦克或队友猝死）——优先于 Buff 维护
  // ─────────────────────────────────────────────────────────────
  if (isAnyEmergency) {
    const emergencyTarget = !isTankSafe && tankUnit ? tankUnit : lowestAlly;
    const emergHpPct = emergencyTarget.maxHp > 0 ? emergencyTarget.hp / emergencyTarget.maxHp : 1;

    // 极危时先上外置减伤（痛苦压制/守护之魂），目标尚无同类 buff
    const externalSaves = available.filter(s => s.normalizedSpell && isExternalSaveSpell(s.normalizedSpell));
    if (externalSaves.length > 0 && emergHpPct < 0.35) {
      const usableSave = externalSaves.find(c => {
        const sp = c.normalizedSpell!;
        const keys = [sp.auraId, sp.shortId, sp.id].filter(Boolean) as string[];
        return !unitHasAnyAura(emergencyTarget, keys);
      });
      if (usableSave) {
        return {
          decisionType: 'EMERGENCY_ST',
          chosenCandidate: usableSave,
          targetUnit: emergencyTarget,
          reason: `目标(${emergencyTarget.name})极危(${(emergHpPct * 100).toFixed(0)}% < 35%)，优先外置减伤（${usableSave.spellName}）`,
          score: 95,
        };
      }
    }

    // 多人危急时才先开自身治疗增效大招（升腾/先祖指引等）；单体保坦直接抬血
    const majorAmplify = available.filter(
      s =>
        s.normalizedSpell &&
        isHealSupportBuffSpell(s.normalizedSpell) &&
        s.normalizedSpell.isMajorCd &&
        s.normalizedSpell.targetType === 'SELF'
    );
    if (majorAmplify.length > 0 && criticalAllies.length >= 2) {
      return {
        decisionType: 'EMERGENCY_ST',
        chosenCandidate: majorAmplify[0],
        targetUnit: caster,
        reason: `多人危急(${criticalAllies.length})，先开启治疗增效大招（${majorAmplify[0].spellName}）`,
        score: 80,
      };
    }

    // 单体急救：排除真·群疗；允许 SINGLE_ALLY（含迅捷治愈附带地面圈）
    const emergencyHeals = available.filter(s => {
      if (s.metrics.roleType !== 'HEAL') return false;
      const sp = s.normalizedSpell;
      if (sp && isHealSupportBuffSpell(sp) && !sp.isHeal) return false;
      if (sp && isExternalSaveSpell(sp)) return false;
      if (s.isAOE && sp && sp.targetType !== 'SINGLE_ALLY') return false;
      if (isSwiftmendSpell(sp) && !canCastSwiftmendOn(emergencyTarget)) return false;
      return true;
    });
    if (emergencyHeals.length > 0) {
      const scoredEmergency = emergencyHeals
        .map(c => {
          const raw = scoreSkillCandidate(c.metrics, {
            caster,
            personality,
            target: emergencyTarget,
            allies: livingAllies,
            enemies: livingEnemies,
            tickCount,
            isEmergency: true,
          });
          return {
            candidate: c,
            score: adjustHealScoreForTargetAuras(c, emergencyTarget, raw, { isEmergency: true }),
          };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scoredEmergency.length > 0) {
        return {
          decisionType: 'EMERGENCY_ST',
          chosenCandidate: scoredEmergency[0].candidate,
          targetUnit: emergencyTarget,
          reason: `目标(${emergencyTarget.name})血线低于危险线(${(emergHpPct * 100).toFixed(0)}% < 45%)，优先高吞吐量急救`,
          score: scoredEmergency[0].score,
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 规则三：Buff 维护（仅在团队整体较健康时；有人需要抬血时让位给治疗）
  // ─────────────────────────────────────────────────────────────
  if (
    !isAnyEmergency &&
    lowestHpRatio >= 0.90 &&
    (caster.role === 'HEALER' || available.some(s => s.normalizedSpell && isHealSupportBuffSpell(s.normalizedSpell)))
  ) {
    const maintenanceBuffs = available.filter(s => {
      const sp = s.normalizedSpell;
      if (!sp || !sp.isBuff || sp.isDamage) return false;
      if (sp.isMajorCd) return false;
      if (sp.targetType !== 'SINGLE_ALLY' && sp.targetType !== 'SMART_ALLY' && sp.targetType !== 'AOE_ALLY') {
        return false;
      }
      if (sp.isHeal && sp.directHeal > 0 && (sp.maxStacks || 1) <= 1) return false;
      return true;
    });

    if (maintenanceBuffs.length > 0 && tankUnit) {
      const missing = maintenanceBuffs.filter(c => {
        const auraId = c.normalizedSpell?.auraId || c.normalizedSpell?.shortId || '';
        const alreadyUp = livingAllies.some(
          a =>
            a.buffs?.some(
              b =>
                (b.spellId === auraId ||
                  b.spellId === c.normalizedSpell?.shortId ||
                  b.spellId === c.normalizedSpell?.id) &&
                (!b.sourceUnitId || b.sourceUnitId === caster.id)
            )
        );
        return !alreadyUp;
      });

      if (missing.length > 0) {
        const chosen = missing[0];
        return {
          decisionType: 'BUFF_MAINTENANCE',
          chosenCandidate: chosen,
          targetUnit: tankUnit,
          reason: `维护型友方 Buff（${chosen.spellName}）缺失，优先补上坦克/友方`,
          score: 50,
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 规则四：性价比与输出综合选优
  // ─────────────────────────────────────────────────────────────
  if (caster.role === 'HEALER' || available.some(s => s.metrics.roleType === 'HEAL')) {
    if (lowestHpRatio < 0.98) {
      const sustainTarget = pickTriageTarget(
        livingAllies.filter(a => a.maxHp > 0 && a.hp / a.maxHp < 0.98),
        caster,
        tickCount,
      );
      // 单体或轻伤维护：过滤掉非必要 3 分钟大招、纯维护 Buff、外置减伤与真·群疗（群疗已在规则一处理）
      const regularHeals = available.filter(s => {
        if (s.metrics.roleType !== 'HEAL' || s.metrics.cycle === 'MAJOR') return false;
        const sp = s.normalizedSpell;
        if (sp && isHealSupportBuffSpell(sp) && sp.directHeal <= 0) return false;
        if (sp && isExternalSaveSpell(sp)) return false;
        // 常规抬血以单体/SMART 为主；真 AOE_ALLY 大圈留给规则一
        if (s.isAOE && sp && sp.targetType === 'AOE_ALLY') return false;
        if (isSwiftmendSpell(sp) && !canCastSwiftmendOn(sustainTarget)) return false;
        return true;
      });
      const pool = regularHeals.length > 0 ? regularHeals : available.filter(s => s.metrics.roleType === 'HEAL');
      const emergish = lowestHpRatio < 0.6;

      const scoredHeals = pool
        .map(c => {
          const raw = scoreSkillCandidate(c.metrics, {
            caster,
            personality,
            target: sustainTarget,
            allies: livingAllies,
            enemies: livingEnemies,
            tickCount,
            isEmergency: emergish,
          });
          return {
            candidate: c,
            score: adjustHealScoreForTargetAuras(c, sustainTarget, raw, { isEmergency: emergish }),
          };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scoredHeals.length > 0) {
        return {
          decisionType: 'SUSTAINED_ST',
          chosenCandidate: scoredHeals[0].candidate,
          targetUnit: sustainTarget,
          reason: '常规治疗：triage 目标 + HoT/护盾感知后按性价比与吞吐选优',
          score: scoredHeals[0].score,
        };
      }
    }
  }

  // DPS / 坦克常规单体输出：按性价比与输出综合选优
  const singleDamageSkills = available.filter(
    s => s.metrics.roleType === 'DAMAGE' || s.metrics.roleType === 'UTILITY'
  );
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
