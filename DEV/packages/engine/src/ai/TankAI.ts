// ============================================================
// Cata Raid Sim — Tank AI  [AI-02]
// Blood DK rotation: Soul Strike (Blood Shield) → Heart Strike → D&D
// ============================================================

import { ClassId, Unit, GroundEffect } from '../types.js';
import {
  GameState, Priority, PrioritisedAction, RoleAI,
  getBoss, hpFraction,
} from './AIController.js';
import { getSpellsForClassSpec } from '../classes/ClassRegistry.js';
import {
  buildUsableCandidatesForUnit,
  createAIPersonality,
  evaluateUniversalAIDecision,
} from './SkillMetricEvaluator.js';

// Spell IDs must match those registered in DeathKnight.ts (class-dev)
const SPELLS = {
  // Defensive / taunt
  DARK_COMMAND:    'dk_dark_command',       // Taunt
  RUNE_STRIKE:     'dk_rune_strike',         // High-threat runic power dump
  BONE_SHIELD:     'dk_bone_shield',         // 6-stack 20% DR buff
  VAMPIRIC_BLOOD:  'dk_vampiric_blood',      // +15% HP / +25% heal rcv 10s
  ICEBOUND_FORT:   'dk_icebound_fortitude',  // 50% DR 12s (long CD)
  ANTI_MAGIC:      'dk_anti_magic_shell',    // Absorb magic 5s

  // Rotation
  SOUL_STRIKE:     'dk_souls_strike',        // Blood rune: self-heal + Blood Shield
  HEART_STRIKE:    'dk_heart_strike',        // Blood rune: high-threat cleave
  DEATH_AND_DECAY: 'dk_death_and_decay',     // Unholy rune: AoE threat ground
  BLOOD_BOIL:      'dk_blood_boil',          // No rune: threat refresh
  OUTBREAK:        'dk_outbreak',            // Apply diseases (threat-booster)
} as const;

// HP thresholds for defensive cooldown activation & tank health line
export const TANK_HEALTHY_THRESHOLD = 0.60; // 60% HP 健康线
const DEFENSIVE_HP_THRESHOLD  = 0.60; // < 60% → use minor CDs
const EMERGENCY_HP_THRESHOLD  = 0.35; // < 35% → use major CDs

/**
 * 判断指定坦克是否处于健康血线 (>= 60% 且存活)
 */
export function isTankHealthy(tank: Unit): boolean {
  const isAlive = (tank.isAlive ?? tank.alive ?? true) && tank.hp > 0;
  if (!isAlive) return false;
  return (tank.hp / tank.maxHp) >= TANK_HEALTHY_THRESHOLD;
}

export interface TankThreatDecision {
  shouldTaunt: boolean;
  pauseThreat: boolean;
  reason: string;
}

/**
 * 评估坦克仇恨与嘲讽决策：
 * - 排名靠前的坦克 (主坦/Rank 0): 在自己血量健康时积极稳固仇恨；血量不健康时暂停拉仇恨直到过健康线。
 * - 排名靠后的坦克 (副坦/Rank > 0): 只有在自己血量健康，且排名靠前的坦克血量都不健康时才主动拉仇恨。
 * - 此时其他坦克要暂停拉仇恨直到自己过健康线。
 */
export function evaluateTankThreatDecision(
  unit: Unit,
  allTanks: Unit[],
  currentBossTargetId?: string | null,
  isTopThreat: boolean = false
): TankThreatDecision {
  if (unit.role !== 'TANK') {
    return { shouldTaunt: false, pauseThreat: false, reason: 'NOT_A_TANK' };
  }

  const isAlive = (unit.isAlive ?? unit.alive ?? true) && unit.hp > 0;
  if (!isAlive) {
    return { shouldTaunt: false, pauseThreat: true, reason: 'TANK_DEAD' };
  }

  const myRank = allTanks.findIndex(t => t.id === unit.id);
  const selfHealthy = isTankHealthy(unit);

  // 1. 如果自己血量不健康 (<60%)：
  // 此时其他坦克要暂停拉仇恨直到自己过健康线
  if (!selfHealthy) {
    return {
      shouldTaunt: false,
      pauseThreat: true,
      reason: 'SELF_UNHEALTHY_PAUSE_THREAT',
    };
  }

  // 2. 自己血量健康 (>=60%)：
  if (myRank <= 0) {
    // 排名最靠前的主坦 (Rank 0 或未指定顺序)：
    // 没有更高顺位的坦克，且自己健康，主动接怪并维持仇恨
    const needsTaunt = !isTopThreat || (currentBossTargetId !== unit.id);
    return {
      shouldTaunt: needsTaunt,
      pauseThreat: false,
      reason: 'PRIMARY_TANK_HEALTHY_ACTIVE',
    };
  }

  // 3. 排名靠后的坦克 (myRank > 0)：
  // 只有在自己血量健康，且排名靠前坦克血量都不健康时主动拉仇恨
  const higherTanks = allTanks.slice(0, myRank);
  const allHigherUnhealthy = higherTanks.length > 0 && higherTanks.every(t => !isTankHealthy(t));

  if (allHigherUnhealthy) {
    const needsTaunt = !isTopThreat || (currentBossTargetId !== unit.id);
    return {
      shouldTaunt: needsTaunt,
      pauseThreat: false,
      reason: 'LOWER_TANK_TAUNT_HIGHER_UNHEALTHY',
    };
  } else {
    // 排名靠前坦克仍有健康者，排名靠后坦克不得抢拉仇恨，暂停拉仇恨
    return {
      shouldTaunt: false,
      pauseThreat: true,
      reason: 'LOWER_TANK_PAUSE_HIGHER_HEALTHY',
    };
  }
}

// ── 地面阵法走位与负面阵型权衡评估 ────────────────────────────

export const MELEE_ATTACK_RANGE = 80;
export const DPS_HEALTHY_THRESHOLD = 0.60;

/**
 * 判断指定单位是否为近战 DPS
 */
export function isMeleeDps(unit: Unit): boolean {
  if (!unit || unit.role !== 'DPS') return false;
  return (
    unit.classId === 'ROGUE' ||
    unit.classId === 'DK' ||
    (unit as any).isMelee === true ||
    (unit.classId as string) === 'WARRIOR' ||
    (unit.classId as string) === 'PALADIN'
  );
}

/**
 * 判断单位血量是否达到健康线 (默认 >= 60%)
 */
export function isUnitHealthy(unit: Unit, threshold: number = DPS_HEALTHY_THRESHOLD): boolean {
  if (!unit || !unit.isAlive || (unit.alive === false) || unit.hp <= 0) return false;
  return unit.maxHp > 0 && (unit.hp / unit.maxHp) >= threshold;
}

/**
 * 判断指定坐标是否在首领近战攻击范围内
 */
export function canHitBoss(
  pos: { x: number; y: number },
  bossPos: { x: number; y: number },
  range: number = MELEE_ATTACK_RANGE
): boolean {
  return Math.hypot(pos.x - bossPos.x, pos.y - bossPos.y) <= range;
}

export interface GroundFormationTradeOffInput {
  currentPos: { x: number; y: number };
  unit: Unit;
  groundEffects: GroundEffect[];
  defaultTarget?: { x: number; y: number };
  bossPos?: { x: number; y: number };
  meleeRange?: number;
}

export interface GroundFormationTradeOffResult {
  targetPos: { x: number; y: number };
  currentHealZoneId: string | null;
  tradeOffDecision:
    | 'STAY_IN_CURRENT_HEAL_ZONE'
    | 'DODGE_HAZARD_SHIFT_IN_ZONE'
    | 'DODGE_HAZARD_LEAVE_ZONE'
    | 'STAY_DESPITE_HAZARD'
    | 'SEEK_HEAL_ZONE'
    | 'DEFAULT_POSITION'
    | 'RETURN_TO_BOSS';
  inHazard: boolean;
  hazardId?: string;
  reason: string;
}

/**
 * 判断指定坐标是否在地面法阵效果半径内
 */
export function isPosInEffect(pos: { x: number; y: number }, effect: GroundEffect): boolean {
  return Math.hypot(pos.x - effect.x, pos.y - effect.y) <= effect.radius;
}

/**
 * 判断指定坐标是否在负面阵型（伤害圈、扇形预警）的危险范围内
 */
export function isPosInHazard(pos: { x: number; y: number }, eff: GroundEffect): boolean {
  if (eff.remainingMs <= 0) return false;
  if (eff.kind === 'DAMAGE_ZONE') {
    return isPosInEffect(pos, eff);
  }
  if (eff.kind === 'CONE_WARNING') {
    const facing = (eff as any).facingRad ?? Math.PI;
    const coneAngle = (eff as any).coneAngleRad ?? (Math.PI / 3);
    const dx = pos.x - eff.x;
    const dy = pos.y - eff.y;
    const dist = Math.hypot(dx, dy);
    if (dist > eff.radius) return false;
    const angle = Math.atan2(dy, dx);
    let diff = Math.abs(angle - facing);
    while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
    return diff <= coneAngle / 2;
  }
  return false;
}

/**
 * 寻找当前治疗阵法内是否包含远离负面阵型的安全子区域 (部分重叠时的微调站位)
 */
export function findSafeSpotInHealZone(
  healZone: GroundEffect,
  hazard: GroundEffect
): { x: number; y: number } | null {
  const dx = healZone.x - hazard.x;
  const dy = healZone.y - hazard.y;
  const dist = Math.hypot(dx, dy);

  const testRadii = [healZone.radius * 0.7, healZone.radius * 0.85, healZone.radius * 0.5];
  for (const r of testRadii) {
    let testX: number;
    let testY: number;
    if (dist > 0.001) {
      testX = healZone.x + (dx / dist) * r;
      testY = healZone.y + (dy / dist) * r;
    } else {
      testX = healZone.x + r;
      testY = healZone.y;
    }
    if (isPosInEffect({ x: testX, y: testY }, healZone) && !isPosInHazard({ x: testX, y: testY }, hazard)) {
      return { x: testX, y: testY };
    }
  }
  return null;
}

/**
 * 寻找治疗法阵内既能受到治疗又能攻击到首领且脱离危险的近战有效站位
 */
export function findMeleeHealZonePosition(
  healZone: GroundEffect,
  bossPos: { x: number; y: number },
  meleeRange: number = MELEE_ATTACK_RANGE,
  hazards: GroundEffect[] = [],
  preferredTarget?: { x: number; y: number }
): { x: number; y: number } | null {
  const dx = bossPos.x - healZone.x;
  const dy = bossPos.y - healZone.y;
  const dist = Math.hypot(dx, dy);

  // 若治疗法阵中心距离首领已超过 (法阵半径 + 近战攻击范围)，则法阵内任何一点都无法打到首领
  if (dist > healZone.radius + meleeRange) {
    return null;
  }

  const candidatePoints: { x: number; y: number }[] = [];

  // 候选项 1：若提供了首选攻击站位 (如 defaultTarget)，且其本身处于该法阵内，优先使用
  if (preferredTarget) {
    candidatePoints.push(preferredTarget);
  }

  // 候选项 2：法阵中心 (若中心处于近战范围)
  if (dist <= meleeRange) {
    candidatePoints.push({ x: healZone.x, y: healZone.y });
  }

  // 候选项 3：沿着法阵中心朝向首领的连线采样有效重叠点
  if (dist > 0.001) {
    const dirX = dx / dist;
    const dirY = dy / dist;

    const testOffsets = [
      Math.min(healZone.radius * 0.5, dist),
      Math.min(healZone.radius * 0.8, dist),
      Math.max(0, dist - meleeRange * 0.7),
      Math.max(0, dist - meleeRange * 0.9),
      0,
    ];

    for (const offset of testOffsets) {
      candidatePoints.push({
        x: healZone.x + dirX * offset,
        y: healZone.y + dirY * offset,
      });
    }
  }

  for (const pt of candidatePoints) {
    const inHeal = isPosInEffect(pt, healZone);
    const inMelee = canHitBoss(pt, bossPos, meleeRange);
    const inHaz = hazards.some(h => isPosInHazard(pt, h));
    if (inHeal && inMelee && !inHaz) {
      return pt;
    }
  }

  return null;
}

/**
 * 地面阵法走位与负面阵型权衡评估：
 * 1. 存在多个地面治疗阵法时，若已经在其中一个法阵内，严禁跑向其他治疗阵法；
 * 2. 若当前站位遭遇负面阵型（伤害圈/扇形预警），进行避险与站位权衡：
 *    - 若危险度高（锥形斩杀预警、伤害高于治疗、低血量），优先躲避；
 *    - 优先微调在当前治疗圈内的安全区域站位，实现治疗与规避兼得；
 *    - 若治疗阵完全被危险覆盖，则移步至安全区域（或另一个安全的治疗阵）；
 *    - 若负面效果轻微或即将结束且血量安全，权衡后可继续站位；
 * 3. 近战DPS专属战场战术决策：
 *    - 近战DPS如果血线健康，不要为了走到治疗地形而远离Boss；
 *    - 如果走到治疗地形不影响打Boss（处于近战攻击范围内），可以走；
 *    - 如果在治疗地形中血线恢复到健康血线，若此时打不到Boss，必须离开治疗阵回去打Boss。
 */
export function evaluateGroundFormationPosition(
  input: GroundFormationTradeOffInput
): GroundFormationTradeOffResult {
  const {
    currentPos,
    unit,
    groundEffects,
    defaultTarget,
    bossPos,
    meleeRange = MELEE_ATTACK_RANGE,
  } = input;
  const activeHealZones = groundEffects.filter(e => e.kind === 'HEAL_ZONE' && e.remainingMs > 0);
  const activeHazards = groundEffects.filter(
    e => (e.kind === 'DAMAGE_ZONE' || e.kind === 'CONE_WARNING') && e.remainingMs > 0
  );

  const isMelee = isMeleeDps(unit);
  const hpFraction = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
  const isHealthy = hpFraction >= DPS_HEALTHY_THRESHOLD;

  // 1. 检查当前是否已经在某个治疗阵法内
  const currentHealZone = activeHealZones.find(hz => isPosInEffect(currentPos, hz));

  // 2. 检查当前是否身处负面阵型
  const threateningHazard = activeHazards.find(hz => isPosInHazard(currentPos, hz));

  // ── 情况一：已经在某个治疗阵法内 ──
  if (currentHealZone) {
    // 存在负面阵型威胁，进行权衡 (Trade-Off) 评估：
    if (threateningHazard) {
      const isConeLethal = threateningHazard.kind === 'CONE_WARNING';
      const hazardTick = threateningHazard.tickValue ?? 5000;
      const healTick = currentHealZone.tickValue ?? 4500;
      const isHpLow = hpFraction < 0.40;
      const hazardExpiring = threateningHazard.remainingMs <= 300;

      // 权衡判定：
      const mustDodge = isConeLethal || isHpLow || (!hazardExpiring && hazardTick > healTick * 1.1);

      if (!mustDodge && !isConeLethal && hazardExpiring) {
        // 如果是健康近战DPS且无法打到Boss，即使负面阵型快结束也应回Boss位
        if (isMelee && isHealthy && bossPos && !canHitBoss(currentPos, bossPos, meleeRange)) {
          return {
            targetPos: defaultTarget ? { ...defaultTarget } : { ...bossPos },
            currentHealZoneId: null,
            tradeOffDecision: 'RETURN_TO_BOSS',
            inHazard: true,
            hazardId: threateningHazard.id,
            reason: '近战DPS已恢复健康血线且当前位置无法攻击首领，脱离受害治疗阵返回攻击Boss',
          };
        }
        // 权衡结果：负面阵型即将消失且血量可承受，选择继续站位
        return {
          targetPos: { x: currentPos.x, y: currentPos.y },
          currentHealZoneId: currentHealZone.id,
          tradeOffDecision: 'STAY_DESPITE_HAZARD',
          inHazard: true,
          hazardId: threateningHazard.id,
          reason: '负面阵型即将结束且治疗可抵消，权衡后选择继续站位',
        };
      }

      // 权衡结果为需要躲避：
      // 策略 A: 尝试在当前治疗圈内寻找安全子区域（部分重叠）
      const safeSpotInZone = findSafeSpotInHealZone(currentHealZone, threateningHazard);
      if (safeSpotInZone) {
        // 如果是近战DPS，优先确认微调点是否能打到Boss
        if (!isMelee || !bossPos || !isHealthy || canHitBoss(safeSpotInZone, bossPos, meleeRange)) {
          return {
            targetPos: safeSpotInZone,
            currentHealZoneId: currentHealZone.id,
            tradeOffDecision: 'DODGE_HAZARD_SHIFT_IN_ZONE',
            inHazard: true,
            hazardId: threateningHazard.id,
            reason: '权衡判定躲避负面阵型：微调至当前治疗阵内的安全子区域',
          };
        }
      }

      // 策略 B: 当前治疗阵完全被危险覆盖，必须脱离当前治疗阵
      // 近战DPS健康状态下：优先寻找能打Boss的安全治疗阵，若无则直接回Boss近战位
      if (isMelee && isHealthy && bossPos) {
        let altMeleePos: { x: number; y: number } | null = null;
        let altZone: GroundEffect | null = null;
        for (const hz of activeHealZones) {
          if (hz.id === currentHealZone.id) continue;
          const pt = findMeleeHealZonePosition(hz, bossPos, meleeRange, activeHazards, defaultTarget);
          if (pt) {
            altMeleePos = pt;
            altZone = hz;
            break;
          }
        }
        if (altMeleePos && altZone) {
          return {
            targetPos: altMeleePos,
            currentHealZoneId: altZone.id,
            tradeOffDecision: 'DODGE_HAZARD_LEAVE_ZONE',
            inHazard: true,
            hazardId: threateningHazard.id,
            reason: '权衡判定规避负面阵型：转移至安全的近战位替代治疗阵',
          };
        }
        return {
          targetPos: defaultTarget ? { ...defaultTarget } : { ...bossPos },
          currentHealZoneId: null,
          tradeOffDecision: 'RETURN_TO_BOSS',
          inHazard: true,
          hazardId: threateningHazard.id,
          reason: '权衡判定躲避负面阵型且无其他近战治疗阵，撤离法阵返回攻击Boss',
        };
      }

      // 常规脱离策略：优先查看是否存在另一个完全安全的治疗阵法
      const otherSafeHealZone = activeHealZones.find(
        hz => hz.id !== currentHealZone.id && !activeHazards.some(haz => isPosInHazard({ x: hz.x, y: hz.y }, haz))
      );
      if (otherSafeHealZone) {
        return {
          targetPos: { x: otherSafeHealZone.x, y: otherSafeHealZone.y },
          currentHealZoneId: otherSafeHealZone.id,
          tradeOffDecision: 'DODGE_HAZARD_LEAVE_ZONE',
          inHazard: true,
          hazardId: threateningHazard.id,
          reason: '权衡判定躲避负面阵型：当前治疗阵完全受害，转移至安全的替代治疗阵',
        };
      }

      // 无其他安全治疗阵，避开危险法阵向安全空地躲避
      const dx = currentPos.x - threateningHazard.x;
      const dy = currentPos.y - threateningHazard.y;
      const dist = Math.hypot(dx, dy) || 1;
      const dodgeDist = (threateningHazard.radius || 48) + 25;
      const dodgeX = threateningHazard.x + (dx / dist) * dodgeDist;
      const dodgeY = threateningHazard.y + (dy / dist) * dodgeDist;

      return {
        targetPos: { x: dodgeX, y: dodgeY },
        currentHealZoneId: null,
        tradeOffDecision: 'DODGE_HAZARD_LEAVE_ZONE',
        inHazard: true,
        hazardId: threateningHazard.id,
        reason: '权衡判定躲避负面阵型：当前治疗阵完全受害，脱离至阵外安全区域',
      };
    }

    // ── 无负面阵型威胁 ──
    // 近战 DPS 专属逻辑：如果恢复到健康血线，若此时打不到Boss要回去打Boss
    if (isMelee && bossPos) {
      const inAttackRange = canHitBoss(currentPos, bossPos, meleeRange);
      if (isHealthy) {
        if (!inAttackRange) {
          // "同样的如果恢复到健康血线如果这时候打不到boss要回去打boss"
          return {
            targetPos: defaultTarget ? { ...defaultTarget } : { ...bossPos },
            currentHealZoneId: null,
            tradeOffDecision: 'RETURN_TO_BOSS',
            inHazard: false,
            reason: '近战DPS已恢复健康血线且当前位置无法攻击首领，脱离治疗阵返回攻击Boss',
          };
        } else {
          // "如果走到治疗地形不影响打boss可以走" -> 已经在治疗阵内且处于近战攻击范围内，继续保持攻击与受疗兼备
          return {
            targetPos: { x: currentPos.x, y: currentPos.y },
            currentHealZoneId: currentHealZone.id,
            tradeOffDecision: 'STAY_IN_CURRENT_HEAL_ZONE',
            inHazard: false,
            reason: '近战DPS身处治疗阵且处于首领近战攻击范围内，保持边打Boss边受疗站位',
          };
        }
      } else {
        // 血线未达健康线 (<60%)：在治疗阵内受疗保命
        return {
          targetPos: { x: currentPos.x, y: currentPos.y },
          currentHealZoneId: currentHealZone.id,
          tradeOffDecision: 'STAY_IN_CURRENT_HEAL_ZONE',
          inHazard: false,
          reason: '已经在治疗阵法中且血量未达到健康线，优先受疗抬血',
        };
      }
    }

    // 默认行为：已经在治疗阵法中且无负面阵型，保持站位不切换其他治疗阵
    return {
      targetPos: { x: currentPos.x, y: currentPos.y },
      currentHealZoneId: currentHealZone.id,
      tradeOffDecision: 'STAY_IN_CURRENT_HEAL_ZONE',
      inHazard: false,
      reason: '已经在治疗阵法中且无负面阵型，保持站位不切换其他治疗阵',
    };
  }

  // ── 情况二：不在任何治疗阵法内 ──

  // 近战 DPS 专属战术逻辑
  if (isMelee && bossPos) {
    if (isHealthy) {
      // "近战dps如果血线是健康的不要为了走到治疗地形而远离boss，但是如果走到治疗地形不影响打boss可以走"
      let meleeSafePos: { x: number; y: number } | null = null;
      let meleeSafeZone: GroundEffect | null = null;

      for (const hz of activeHealZones) {
        const pt = findMeleeHealZonePosition(hz, bossPos, meleeRange, activeHazards, defaultTarget);
        if (pt) {
          meleeSafePos = pt;
          meleeSafeZone = hz;
          break;
        }
      }

      if (meleeSafePos && meleeSafeZone) {
        // 走到治疗地形不影响打Boss，可以走！
        return {
          targetPos: meleeSafePos,
          currentHealZoneId: meleeSafeZone.id,
          tradeOffDecision: 'SEEK_HEAL_ZONE',
          inHazard: false,
          reason: '近战DPS血量健康，前往不影响攻击首领的近战位治疗阵',
        };
      } else {
        // 无近战治疗阵：不要为了走到治疗地形而远离Boss，保持在默认Boss近战输出位
        return {
          targetPos: defaultTarget ? { ...defaultTarget } : { ...currentPos },
          currentHealZoneId: null,
          tradeOffDecision: 'DEFAULT_POSITION',
          inHazard: false,
          reason: '近战DPS血量健康且治疗阵超出近战范围，不远离首领保持攻击',
        };
      }
    } else {
      // 近战DPS血线不健康 (<60%)：需要寻找治疗阵
      // 优先在近战范围内寻找治疗阵，兼顾输出与保命
      let candidateZone: GroundEffect | null = null;
      let candidatePos: { x: number; y: number } | null = null;

      for (const hz of activeHealZones) {
        const pt = findMeleeHealZonePosition(hz, bossPos, meleeRange, activeHazards, defaultTarget);
        if (pt) {
          candidatePos = pt;
          candidateZone = hz;
          break;
        }
      }

      // 若近战范围内无治疗阵，则为了保命前往最近的安全治疗阵受疗
      if (!candidateZone && activeHealZones.length > 0) {
        const safeHealZones = activeHealZones.filter(
          hz => !activeHazards.some(haz => isPosInHazard({ x: hz.x, y: hz.y }, haz))
        );
        const candidatePool = safeHealZones.length > 0 ? safeHealZones : activeHealZones;
        candidateZone = [...candidatePool].sort(
          (a, b) => Math.hypot(currentPos.x - a.x, currentPos.y - a.y) - Math.hypot(currentPos.x - b.x, currentPos.y - b.y)
        )[0];
        candidatePos = { x: candidateZone.x, y: candidateZone.y };
      }

      if (candidateZone && candidatePos) {
        return {
          targetPos: candidatePos,
          currentHealZoneId: candidateZone.id,
          tradeOffDecision: 'SEEK_HEAL_ZONE',
          inHazard: !!threateningHazard,
          hazardId: threateningHazard?.id,
          reason: '近战DPS血量不足，步入安全治疗阵抬血',
        };
      }

      if (threateningHazard) {
        const dx = currentPos.x - threateningHazard.x;
        const dy = currentPos.y - threateningHazard.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dodgeDist = (threateningHazard.radius || 48) + 25;
        return {
          targetPos: { x: threateningHazard.x + (dx / dist) * dodgeDist, y: threateningHazard.y + (dy / dist) * dodgeDist },
          currentHealZoneId: null,
          tradeOffDecision: 'DODGE_HAZARD_LEAVE_ZONE',
          inHazard: true,
          hazardId: threateningHazard.id,
          reason: '脱离危险区域',
        };
      }

      return {
        targetPos: defaultTarget ? { ...defaultTarget } : { ...currentPos },
        currentHealZoneId: null,
        tradeOffDecision: 'DEFAULT_POSITION',
        inHazard: false,
        reason: '正常阵型站位',
      };
    }
  }

  // 非近战DPS或未提供bossPos时的常规逻辑
  const needsHeal = unit.hp < unit.maxHp * 0.60;
  if (needsHeal && activeHealZones.length > 0) {
    const safeHealZones = activeHealZones.filter(
      hz => !activeHazards.some(haz => isPosInHazard({ x: hz.x, y: hz.y }, haz))
    );
    const candidateZones = safeHealZones.length > 0 ? safeHealZones : activeHealZones;
    const closestZone = [...candidateZones].sort(
      (a, b) => Math.hypot(currentPos.x - a.x, currentPos.y - a.y) - Math.hypot(currentPos.x - b.x, currentPos.y - b.y)
    )[0];

    return {
      targetPos: { x: closestZone.x, y: closestZone.y },
      currentHealZoneId: closestZone.id,
      tradeOffDecision: 'SEEK_HEAL_ZONE',
      inHazard: !!threateningHazard,
      hazardId: threateningHazard?.id,
      reason: '未在治疗阵中且血量不足，步入最近的安全治疗阵',
    };
  }

  if (threateningHazard) {
    const dx = currentPos.x - threateningHazard.x;
    const dy = currentPos.y - threateningHazard.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dodgeDist = (threateningHazard.radius || 48) + 25;
    return {
      targetPos: { x: threateningHazard.x + (dx / dist) * dodgeDist, y: threateningHazard.y + (dy / dist) * dodgeDist },
      currentHealZoneId: null,
      tradeOffDecision: 'DODGE_HAZARD_LEAVE_ZONE',
      inHazard: true,
      hazardId: threateningHazard.id,
      reason: '脱离危险区域',
    };
  }

  return {
    targetPos: defaultTarget ? { ...defaultTarget } : { ...currentPos },
    currentHealZoneId: null,
    tradeOffDecision: 'DEFAULT_POSITION',
    inHazard: false,
    reason: '正常阵型站位',
  };
}

export class TankAI implements RoleAI {
  decide(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    if (unit.classId === 'BOSS' || unit.classId === 'NPC') return actions;

    const livingEnemies = gs.units.filter(u => u.role === 'ENEMY' && u.isAlive && u.hp > 0);
    const boss = getBoss(gs.units, gs.bossId) ?? livingEnemies[0];
    if (!boss) return actions;

    const livingAllies = gs.units.filter(u => u.role !== 'ENEMY' && u.isAlive && u.hp > 0);
    const myHp = hpFraction(unit);
    const isTauntTop = this.isTopThreat(unit, boss);

    const allTanks = gs.units.filter(u => u.role === 'TANK');
    const threatDecision = evaluateTankThreatDecision(
      unit,
      allTanks,
      boss.threatTable?.[0]?.sourceUnitId,
      isTauntTop
    );

    const specId = (unit as any).spec as string | undefined;
    const ownedSpells = getSpellsForClassSpec(unit.classId as ClassId, specId);

    // 1. 通用嘲讽：拥有任意嘲讽技能且需要接怪
    if (threatDecision.shouldTaunt) {
      const tauntSpell = ownedSpells.find(s => s.isTaunt);
      if (tauntSpell) {
        actions.push(act(tauntSpell.id, boss.id, Priority.DEFENSIVE, true));
      }
    }

    // 2. 通用减伤大招：血线低于60%开启小减伤，低于35%开启大减伤
    if (myHp < DEFENSIVE_HP_THRESHOLD) {
      const defensiveSpells = ownedSpells.filter(s => s.isDefensive && (!s.auraId || !hasAura(unit, s.auraId)));
      const minorDef = defensiveSpells.find(s => !s.isMajorCd);
      const majorDef = defensiveSpells.find(s => s.isMajorCd);
      if (myHp < EMERGENCY_HP_THRESHOLD && majorDef) {
        actions.push(act(majorDef.id, unit.id, Priority.DEFENSIVE, true));
      } else if (minorDef) {
        actions.push(act(minorDef.id, unit.id, Priority.DEFENSIVE, true));
      }
    }

    // 3. 通用规则输出/群拉循环（目标 >= 3 自动优先 AOE 群拉技能，否则按仇恨/性价比/输出选优）
    if (!threatDecision.pauseThreat || boss.threatTable.length === 0) {
      const personality = createAIPersonality(unit.name, unit.id);
      const candidates = buildUsableCandidatesForUnit(unit, specId, () => true, {
        roleFilter: 'DAMAGE',
        useShortId: false,
      });

      const decision = evaluateUniversalAIDecision({
        caster: unit,
        personality,
        allies: livingAllies,
        enemies: livingEnemies,
        usableSkills: candidates,
        tickCount: Math.floor((gs.elapsedMs || 0) / 100),
      });

      if (decision.chosenCandidate) {
        actions.push(
          act(
            decision.chosenCandidate.spellId,
            (decision.targetUnit ?? boss).id,
            Priority.DPS,
            decision.chosenCandidate.castMs === 0
          )
        );
      }
    }

    return actions;
  }

  /** True if `tank` is highest-threat unit on boss's threat table */
  private isTopThreat(tank: Unit, boss: Unit): boolean {
    if (!boss.threatTable.length) return true;
    const sorted = [...boss.threatTable].sort((a, b) => b.amount - a.amount);
    return sorted[0].sourceUnitId === tank.id;
  }
}

// ── Helper ─────────────────────────────────────────────────────
function act(
  spellId: string,
  targetId: string,
  priority: Priority,
  immediate = false,
): PrioritisedAction {
  return { priority, action: { spellId, targetId, immediate } };
}

function hasAura(unit: Unit, spellId: string): boolean {
  return unit.buffs.some(b => b.spellId === spellId);
}

function auraStacks(unit: Unit, spellId: string): number {
  return unit.buffs.find(b => b.spellId === spellId)?.stacks ?? 0;
}
