// ============================================================
// Cata Raid Sim — Tank AI  [AI-02]
// Blood DK rotation: Soul Strike (Blood Shield) → Heart Strike → D&D
// ============================================================

import { ClassId, Unit, GroundEffect } from '../types.js';
import {
  GameState, Priority, PrioritisedAction, RoleAI,
  getBoss, hpFraction,
} from './AIController.js';
import { getSpellsForClassSpec, yardsToPx, RANGE_40YD_PX } from '../classes/ClassRegistry.js';
import {
  buildUsableCandidatesForUnit,
  createAIPersonality,
  evaluateUniversalAIDecision,
} from './SkillMetricEvaluator.js';
import {
  isFriendlyBuffGroundEffect,
  isSeekableHealGroundEffect,
} from '../engine/AoeRingVisual.js';
import { isStationaryConstructAdd } from './AddAI.js';

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
  DEATH_AND_DECAY: 'dk_dnd',                 // Blood rune: placeable AoE threat ground
  BLOOD_BOIL:      'dk_blood_boil',          // No rune: threat refresh
  OUTBREAK:        'dk_outbreak',            // Apply diseases (threat-booster)
} as const;

// HP thresholds for defensive cooldown activation & tank health line
export const TANK_HEALTHY_THRESHOLD = 0.60; // 60% HP 健康线
const DEFENSIVE_HP_THRESHOLD  = 0.60; // < 60% → use minor CDs
const EMERGENCY_HP_THRESHOLD  = 0.35; // < 35% → use major CDs
/** 开战窗口：接仇满足时前 3 秒可用嘲讽稳仇 */
export const TANK_PULL_TAUNT_WINDOW_MS = 3000;
/** 低 CD 嘲讽：技能表 CD < 30s */
export const TANK_LOW_CD_TAUNT_MS = 30_000;

/**
 * 接仇已满足时，是否实际施放嘲讽：
 * 开战前 3 秒，或仇恨目标不是自己，或（可用嘲讽 > 1 且有 CD<30s 的嘲讽）→ 嘲讽；否则不用。
 */
export function shouldCastTankTaunt(opts: {
  shouldTaunt: boolean;
  elapsedMs: number;
  threatTargetId: string | null | undefined;
  selfId: string;
  /** 当前可用嘲讽的 cooldownMs 列表 */
  availableTauntCooldownMs?: number[];
}): boolean {
  if (!opts.shouldTaunt) return false;
  const inPullWindow = (opts.elapsedMs || 0) < TANK_PULL_TAUNT_WINDOW_MS;
  const notHoldingThreat = opts.threatTargetId !== opts.selfId;
  const cds = opts.availableTauntCooldownMs ?? [];
  const multiWithLowCd =
    cds.length > 1 && cds.some((cd) => cd < TANK_LOW_CD_TAUNT_MS);
  return inPullWindow || notHoldingThreat || multiWithLowCd;
}

/** 优先选 CD<30s 的嘲讽（最短优先）；否则取列表首项。 */
export function pickPreferredTankTaunt<T extends { cooldownMs: number }>(
  taunts: T[]
): T | undefined {
  if (taunts.length === 0) return undefined;
  const low = taunts
    .filter((t) => t.cooldownMs < TANK_LOW_CD_TAUNT_MS)
    .sort((a, b) => a.cooldownMs - b.cooldownMs);
  return low[0] ?? taunts[0];
}

/**
 * 判断指定坦克是否处于健康血线 (>= 60% 且存活)
 */
export function isTankHealthy(tank: Unit): boolean {
  const isAlive = (tank.isAlive ?? tank.alive ?? true) && tank.hp > 0;
  if (!isAlive) return false;
  return (tank.hp / tank.maxHp) >= TANK_HEALTHY_THRESHOLD;
}

/**
 * 稳定主/副坦顺位：玩家坦优先主坦，其余按 id 稳定排序。
 * evaluateTankThreatDecision 依赖数组下标 Rank0=主坦。
 */
export function orderTanksByThreatPriority(tanks: Unit[]): Unit[] {
  return [...tanks]
    .filter((t) => t.role === 'TANK' && ((t.isAlive ?? t.alive ?? true) && t.hp > 0))
    .sort((a, b) => {
      if (!!a.isPlayer !== !!b.isPlayer) return a.isPlayer ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Find the nearest living non-boss combat add whose top threat is missing or held by a non-tank.
 */
export function findLooseAddForTank(
  tank: Unit,
  enemies: Unit[],
  boss: Unit | undefined,
  allTanks: Unit[]
): Unit | null {
  const tankIds = new Set(
    allTanks
      .filter((t) => t.role === 'TANK' && ((t.isAlive ?? t.alive ?? true) && t.hp > 0))
      .map((t) => t.id)
  );
  const looseAdds = enemies.filter((e) => {
    if (boss && e.id === boss.id) return false;
    if (!(e.isAlive ?? e.alive ?? true) || e.hp <= 0) return false;
    if (isStationaryConstructAdd(e)) return false;
    const table = e.threatTable || [];
    if (table.length === 0) return true;
    let top = table[0];
    for (let i = 1; i < table.length; i++) {
      if (table[i].amount > top.amount) top = table[i];
    }
    return !top || !tankIds.has(top.sourceUnitId);
  });
  if (looseAdds.length === 0) return null;
  const tPos = tank.position || { x: 0, y: 0 };
  let best = looseAdds[0];
  let bestDist = Infinity;
  for (const add of looseAdds) {
    const aPos = add.position || { x: 0, y: 0 };
    const d = Math.hypot(aPos.x - tPos.x, aPos.y - tPos.y);
    if (d < bestDist) {
      bestDist = d;
      best = add;
    }
  }
  return best;
}

export interface TankThreatDecision {
  shouldTaunt: boolean;
  pauseThreat: boolean;
  reason: string;
}

/**
 * 评估坦克仇恨与嘲讽决策：
 * - 主坦 (Rank 0): 健康时主动稳仇/嘲讽；危险时暂停拉仇恨，让健康副坦接。
 * - 副坦 (Rank > 0): 仅当自己健康且所有更高顺位坦均危险时嘲讽接仇；主坦恢复后压仇恨（不嘲讽），主坦可拉回。
 * - pauseThreat=true：不嘲讽、压低威胁；近战仍可输出（低威胁倍率）。
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

  const ranked = orderTanksByThreatPriority(allTanks);
  const myRank = ranked.findIndex((t) => t.id === unit.id);
  const selfHealthy = isTankHealthy(unit);

  // 1. 自己危险：暂停拉仇恨（不嘲讽），由健康副坦接
  if (!selfHealthy) {
    return {
      shouldTaunt: false,
      pauseThreat: true,
      reason: 'SELF_UNHEALTHY_PAUSE_THREAT',
    };
  }

  // 2. 主坦健康：主动接怪并维持仇恨
  if (myRank <= 0) {
    const needsTaunt = !isTopThreat || (currentBossTargetId !== unit.id);
    return {
      shouldTaunt: needsTaunt,
      pauseThreat: false,
      reason: 'PRIMARY_TANK_HEALTHY_ACTIVE',
    };
  }

  // 3. 副坦健康：仅当所有更高顺位坦均危险时接仇
  const higherTanks = ranked.slice(0, myRank);
  const allHigherUnhealthy = higherTanks.length > 0 && higherTanks.every((t) => !isTankHealthy(t));

  if (allHigherUnhealthy) {
    const needsTaunt = !isTopThreat || (currentBossTargetId !== unit.id);
    return {
      shouldTaunt: needsTaunt,
      pauseThreat: false,
      reason: 'LOWER_TANK_TAUNT_HIGHER_UNHEALTHY',
    };
  }

  // 主坦已恢复健康：副坦压仇恨，便于主坦嘲讽拉回
  return {
    shouldTaunt: false,
    pauseThreat: true,
    reason: 'LOWER_TANK_PAUSE_HIGHER_HEALTHY',
  };
}

// ── 地面阵法走位：高优约束逐级求交 ────────────────────────────

export const MELEE_ATTACK_RANGE = 80;
/** 普通攻击（白字）统一射程：近战/远程均须 ≤5 码，否则打不出 */
export const AUTO_ATTACK_RANGE_YD = 5;
export const AUTO_ATTACK_RANGE_PX = yardsToPx(AUTO_ATTACK_RANGE_YD);
/** 远程输出不丢技能射程的默认上限（40 码）；与普攻射程无关 */
export const RANGED_ATTACK_RANGE = RANGE_40YD_PX;
/** 走位血线：低于此值优先最大绿圈叠层（可牺牲输出） */
export const DPS_HEALTHY_THRESHOLD = 0.5;

/** 非主坦最终须尽量保持在主坦此码数内（与更高优求交仍非空时生效） */
export const TANK_STACK_RANGE_YD = 25;
export const TANK_STACK_RANGE_PX = yardsToPx(TANK_STACK_RANGE_YD);

/** 远程尽量靠近最近奶妈的上限 */
export const HEALER_LEASH_YD = 10;
export const HEALER_LEASH_PX = yardsToPx(HEALER_LEASH_YD);

/** Boss 正面锥角（总张角 30° = ±15°） */
export const BOSS_FRONTAL_CONE_RAD = Math.PI / 6;

/** 多动症单次位移上限 */
export const FIDGET_MAX_YD = 5;
export const FIDGET_MAX_PX = yardsToPx(FIDGET_MAX_YD);

/** 出红圈安全边距（px） */
export const HAZARD_CLEAR_MARGIN_PX = 25;

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
 * 判断单位血量是否达到健康线 (默认 >= 50%)
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

export interface DungeonPriorityZone {
  mode: 'STACK' | 'SPREAD';
  /** STACK: center to stack at; SPREAD: anchor center */
  center: { x: number; y: number };
  /** STACK: max distance from center; SPREAD: min separation distance from allies */
  radiusPx: number;
  /** For SPREAD: living ally positions */
  allyPositions?: Array<{ id: string; x: number; y: number }>;
  label?: string;
}

export interface ComputeDungeonPriorityZoneInput {
  unit: Unit;
  boss?: Unit | null;
  bossPos?: { x: number; y: number };
  allies?: Array<{ id: string; x: number; y: number; unit?: Unit }>;
  groundEffects?: GroundEffect[];
  bossCastingSpellName?: string | null;
  activeAdvices?: string[];
}

/**
 * Computes the current dungeon priority positioning zone (STACK / SPREAD) from
 * boss casts, active DBM advices, unit debuffs, and ground effects.
 */
export function computeDungeonPriorityZone(
  input: ComputeDungeonPriorityZoneInput
): DungeonPriorityZone | null {
  const {
    unit,
    bossPos,
    allies = [],
    groundEffects = [],
    bossCastingSpellName,
    activeAdvices = [],
  } = input;

  const anchor = bossPos ?? { x: 500, y: 200 };
  const signals = [bossCastingSpellName || '', ...activeAdvices].filter(Boolean).join(' ');

  // 最高优保命：ZUG 温诺希斯「毒性链接」— 被连线双方必须立刻彼此拉开 ≥ 95px 扯断链接
  const hasToxicLink = unit.buffs?.some((b) => b.spellId === 'toxic_link');
  if (hasToxicLink) {
    const linkedPartner = allies.find(
      (a) => a.id !== unit.id && a.unit?.buffs?.some((b) => b.spellId === 'toxic_link')
    );
    if (linkedPartner) {
      return {
        mode: 'SPREAD',
        center: anchor,
        radiusPx: 95,
        allyPositions: [{ id: linkedPartner.id, x: linkedPartner.x, y: linkedPartner.y }],
        label: '保命机制：拉开扯断毒性链接',
      };
    }
  }

  const hasChestBomb =
    unit.buffs?.some((b) => b.spellId === 'chest_bomb') ||
    allies.some((a) => a.unit?.buffs?.some((b) => b.spellId === 'chest_bomb'));
  if (hasChestBomb || /分散|散开|胸弹/.test(signals)) {
    return {
      mode: 'SPREAD',
      center: anchor,
      radiusPx: 75,
      allyPositions: allies.map((a) => ({ id: a.id, x: a.x, y: a.y })),
      label: '副本机制：优先分散站位',
    };
  }

  if (/践踏|分摊|集中|集合|柱子后|暮光时刻/.test(signals)) {
    // Ultraxion: units phased out with Heroic Will do not stack
    if (unit.buffs?.some((b) => b.spellId === 'heroic_will')) {
      return null;
    }
    return {
      mode: 'STACK',
      center: anchor,
      radiusPx: 85,
      label: '副本机制：优先集中分摊',
    };
  }

  const soakZone = groundEffects.find(
    (e) =>
      e.remainingMs > 0 &&
      e.kind !== 'DAMAGE_ZONE' &&
      e.kind !== 'CONE_WARNING' &&
      /soak|stack|pillar|crystal/i.test(e.spellId || '')
  );
  if (soakZone) {
    return {
      mode: 'STACK',
      center: { x: soakZone.x, y: soakZone.y },
      radiusPx: Math.max(40, (soakZone.radius || 75) * 0.85),
      label: '副本机制：优先进入集中区',
    };
  }

  return null;
}

export interface GroundFormationTradeOffInput {
  currentPos: { x: number; y: number };
  unit: Unit;
  groundEffects: GroundEffect[];
  defaultTarget?: { x: number; y: number };
  bossPos?: { x: number; y: number };
  /** 单位当前攻击目标位置（近战射程圆心）；缺省用 bossPos */
  attackTargetPos?: { x: number; y: number };
  meleeRange?: number;
  /** 主坦世界坐标；缺省则不做「离坦 25 码」约束 */
  tankPos?: { x: number; y: number };
  /** 离坦最大距离（px），默认 TANK_STACK_RANGE_PX（25 码） */
  tankStackRangePx?: number;
  /**
   * Boss 朝向（弧度）：移动中用移动方向，否则朝打击目标。
   * 可用 resolveUnitFacingRad 计算。
   */
  bossFacingRad?: number;
  /** Boss 当前目标单位 id（用于判断非坦持仇） */
  bossTargetUnitId?: string | null;
  /** 威胁榜第一的单位 id；缺省则用 bossTargetUnitId */
  topThreatUnitId?: string | null;
  /** 为 true 时表示当前持仇者是非坦克（触发坦拉怪 / OT 靠主坦） */
  aggroIsNonTank?: boolean;
  /** 最近存活奶妈位置（远程 10 码约束） */
  nearestHealerPos?: { x: number; y: number };
  /** 当前单位是否主坦（Rank0）；缺省按 role===TANK 且无 tankPos 视为主坦 */
  isPrimaryTank?: boolean;
  /** 副本机制优先走位区域（集中/分散）：优先级低于躲避红圈，高于自身施法/战斗距离 */
  dungeonPriorityZone?: DungeonPriorityZone | null;
  /** 友方单位 ID 集合：用于区分玩家/友方 AoE（不躲避）与敌方红圈（需躲避） */
  friendlyUnitIds?: Set<string>;
}

export type GroundFormationDecision =
  | 'STAY_IN_CURRENT_HEAL_ZONE'
  | 'DODGE_HAZARD_SHIFT_IN_ZONE'
  | 'DODGE_HAZARD_LEAVE_ZONE'
  | 'STAY_DESPITE_HAZARD'
  | 'SEEK_HEAL_ZONE'
  | 'DEFAULT_POSITION'
  | 'RETURN_TO_BOSS'
  | 'AGGRO_TANK_PULL'
  | 'AGGRO_OT_TO_MT'
  | 'DUNGEON_STACK'
  | 'DUNGEON_SPREAD';

export interface GroundFormationTradeOffResult {
  targetPos: { x: number; y: number };
  currentHealZoneId: string | null;
  tradeOffDecision: GroundFormationDecision;
  inHazard: boolean;
  hazardId?: string;
  reason: string;
  /** 本帧走路区允许多动症踱步 */
  allowFidget: boolean;
  /** 多动症半径上限（≤5 码） */
  fidgetMaxRadiusPx: number;
}

/** 可突破「离坦 25 码」硬约束的更高优先级走位意图 */
const TANK_STACK_OVERRIDE_DECISIONS = new Set<GroundFormationDecision>([
  'DODGE_HAZARD_SHIFT_IN_ZONE',
  'DODGE_HAZARD_LEAVE_ZONE',
  'SEEK_HEAL_ZONE',
  'STAY_IN_CURRENT_HEAL_ZONE',
  'STAY_DESPITE_HAZARD',
  'AGGRO_TANK_PULL',
  'AGGRO_OT_TO_MT',
  'DUNGEON_STACK',
  'DUNGEON_SPREAD',
]);

/**
 * 单位朝向：移动中用移动方向，否则朝打击目标；都没有则用 fallback。
 */
export function resolveUnitFacingRad(opts: {
  position: { x: number; y: number };
  isMoving?: boolean;
  moveDx?: number;
  moveDy?: number;
  targetPos?: { x: number; y: number } | null;
  fallbackFacingRad?: number;
}): number {
  const moveLen = Math.hypot(opts.moveDx ?? 0, opts.moveDy ?? 0);
  if (opts.isMoving && moveLen > 1e-3) {
    return Math.atan2(opts.moveDy!, opts.moveDx!);
  }
  if (opts.targetPos) {
    const dx = opts.targetPos.x - opts.position.x;
    const dy = opts.targetPos.y - opts.position.y;
    if (Math.hypot(dx, dy) > 1e-3) return Math.atan2(dy, dx);
  }
  return opts.fallbackFacingRad ?? 0;
}

/** 点是否落在 Boss 正面 ±(cone/2) 锥内 */
export function isInBossFrontalCone(
  pos: { x: number; y: number },
  bossPos: { x: number; y: number },
  bossFacingRad: number,
  coneRad: number = BOSS_FRONTAL_CONE_RAD
): boolean {
  const dx = pos.x - bossPos.x;
  const dy = pos.y - bossPos.y;
  if (Math.hypot(dx, dy) < 1e-3) return true;
  const angle = Math.atan2(dy, dx);
  let diff = Math.abs(angle - bossFacingRad);
  while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
  return diff <= coneRad / 2;
}

/**
 * 将目标点拉回到主坦 maxRangePx 圆内（已在圆内则原样返回）
 */
export function clampPosWithinTankRange(
  pos: { x: number; y: number },
  tankPos: { x: number; y: number },
  maxRangePx: number = TANK_STACK_RANGE_PX
): { x: number; y: number } {
  const dx = pos.x - tankPos.x;
  const dy = pos.y - tankPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxRangePx || dist < 1e-6) return { x: pos.x, y: pos.y };
  const scale = maxRangePx / dist;
  return { x: tankPos.x + dx * scale, y: tankPos.y + dy * scale };
}

/**
 * 默认站位 / 回 Boss 等低优意图：非坦须落在主坦 25 码内；
 * 躲避负面地形、寻/留治疗圈、仇恨纠偏等更高优先级意图不受限。
 */
export function applyTankStackConstraint(
  result: GroundFormationTradeOffResult,
  unit: Unit,
  tankPos?: { x: number; y: number },
  tankStackRangePx: number = TANK_STACK_RANGE_PX
): GroundFormationTradeOffResult {
  if (!tankPos || unit.role === 'TANK') return result;
  if (TANK_STACK_OVERRIDE_DECISIONS.has(result.tradeOffDecision)) return result;

  const clamped = clampPosWithinTankRange(result.targetPos, tankPos, tankStackRangePx);
  if (clamped.x === result.targetPos.x && clamped.y === result.targetPos.y) return result;

  return {
    ...result,
    targetPos: clamped,
    reason: `${result.reason}；拉回主坦 ${TANK_STACK_RANGE_YD} 码内`,
  };
}

/**
 * 判断指定坐标是否在地面法阵效果半径内
 */
export function isPosInEffect(pos: { x: number; y: number }, effect: GroundEffect): boolean {
  return Math.hypot(pos.x - effect.x, pos.y - effect.y) <= effect.radius;
}

/**
 * 判断地面效果是否由友方/玩家施放（如暴风雪、凋零、奉献、烈焰风暴等），友方 AoE 不应被坦克/AI/Boss 当作敌方红圈躲避。
 */
export function isFriendlyGroundEffect(
  eff: GroundEffect,
  friendlyUnitIds?: Set<string>
): boolean {
  const oid = eff.ownerId;
  if (!oid) return false;
  if (friendlyUnitIds && friendlyUnitIds.size > 0) {
    return friendlyUnitIds.has(oid);
  }
  return (
    oid === 'player' ||
    oid.startsWith('player_') ||
    oid.startsWith('ai_') ||
    oid.startsWith('pet_') ||
    oid.startsWith('guest_')
  );
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
 * 统计某点被多少个可寻治疗光环覆盖（绿圈叠层）。
 */
export function countHealAurasAt(
  pos: { x: number; y: number },
  healZones: GroundEffect[]
): number {
  let n = 0;
  for (const hz of healZones) {
    if (hz.remainingMs > 0 && isPosInEffect(pos, hz)) n += 1;
  }
  return n;
}

/** 绿圈 + 黄圈（友好非治疗图腾）叠层 */
export function countBeneficialAurasAt(
  pos: { x: number; y: number },
  zones: GroundEffect[]
): number {
  let n = 0;
  for (const z of zones) {
    if (z.remainingMs > 0 && isPosInEffect(pos, z)) n += 1;
  }
  return n;
}

export interface HealAuraStandCandidate {
  pos: { x: number; y: number };
  stackCount: number;
  primaryZoneId: string | null;
}

/**
 * 在避开红色危险地形的前提下，寻找治疗光环叠层最多的站位点。
 * - requireAttackRange：健康血线时由近战/远程传入，保证不影响输出；
 * - 危险血线不传射程约束，可牺牲输出换最大叠层。
 */
export function findBestHealAuraStandPosition(opts: {
  healZones: GroundEffect[];
  hazards: GroundEffect[];
  currentPos: { x: number; y: number };
  defaultTarget?: { x: number; y: number };
  requireAttackRange?: { bossPos: { x: number; y: number }; range: number };
  /** 至少需要的叠层；0 表示只要安全蹭到光环即可 */
  minStack?: number;
}): HealAuraStandCandidate | null {
  const {
    healZones,
    hazards,
    currentPos,
    defaultTarget,
    requireAttackRange,
    minStack = 1,
  } = opts;
  if (healZones.length === 0) return null;

  const candidates: { x: number; y: number }[] = [];
  const push = (p?: { x: number; y: number } | null) => {
    if (!p) return;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    candidates.push({ x: p.x, y: p.y });
  };

  push(currentPos);
  push(defaultTarget);

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.707, 0.707],
    [-0.707, 0.707],
    [0.707, -0.707],
    [-0.707, -0.707],
  ];

  for (const hz of healZones) {
    push({ x: hz.x, y: hz.y });
    for (const [dx, dy] of dirs) {
      push({ x: hz.x + dx * hz.radius * 0.55, y: hz.y + dy * hz.radius * 0.55 });
      push({ x: hz.x + dx * hz.radius * 0.85, y: hz.y + dy * hz.radius * 0.85 });
    }
    if (requireAttackRange) {
      push(
        findMeleeHealZonePosition(
          hz,
          requireAttackRange.bossPos,
          requireAttackRange.range,
          hazards,
          defaultTarget
        )
      );
    }
  }

  // 两两光环中点：叠层热点
  for (let i = 0; i < healZones.length; i++) {
    for (let j = i + 1; j < healZones.length; j++) {
      const a = healZones[i];
      const b = healZones[j];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      push(mid);
      // 加权靠较大半径一侧
      const w = a.radius + b.radius || 1;
      push({
        x: (a.x * b.radius + b.x * a.radius) / w,
        y: (a.y * b.radius + b.y * a.radius) / w,
      });
    }
  }

  let best: HealAuraStandCandidate | null = null;
  let bestScore = -Infinity;

  for (const pos of candidates) {
    if (hazards.some((h) => isPosInHazard(pos, h))) continue;
    if (
      requireAttackRange &&
      !canHitBoss(pos, requireAttackRange.bossPos, requireAttackRange.range)
    ) {
      continue;
    }
    const stackCount = countHealAurasAt(pos, healZones);
    if (stackCount < minStack) continue;

    let primaryZoneId: string | null = null;
    let nearest = Infinity;
    for (const hz of healZones) {
      if (!isPosInEffect(pos, hz)) continue;
      const d = Math.hypot(pos.x - hz.x, pos.y - hz.y);
      if (d < nearest) {
        nearest = d;
        primaryZoneId = hz.id;
      }
    }

    const distCur = Math.hypot(pos.x - currentPos.x, pos.y - currentPos.y);
    // 叠层绝对优先；同叠层取更近，减少无意义来回跑
    const score = stackCount * 1_000_000 - distCur;
    if (score > bestScore) {
      bestScore = score;
      best = { pos: { x: pos.x, y: pos.y }, stackCount, primaryZoneId };
    }
  }

  return best;
}

/**
 * 地面走位：高优先级约束逐级与候选点求交，取最后一个非空可行域中的最优点。
 * 1 躲红圈 → 2 非坦持仇时坦/OT 纠偏 → 3 危血最大绿圈 → 4 健康输出位+叠层 → 5 主坦 25 码
 */
export function evaluateGroundFormationPosition(
  input: GroundFormationTradeOffInput
): GroundFormationTradeOffResult {
  // 坦克 25 码已在求交层处理；保留 apply 作为决策标签回退保险
  const raw = evaluateGroundFormationPositionCore(input);
  return applyTankStackConstraint(raw, input.unit, input.tankPos, input.tankStackRangePx);
}

function dodgeAwayFromHazard(
  currentPos: { x: number; y: number },
  hazard: GroundEffect
): { x: number; y: number } {
  const dx = currentPos.x - hazard.x;
  const dy = currentPos.y - hazard.y;
  const dist = Math.hypot(dx, dy) || 1;
  const dodgeDist = (hazard.radius || 48) + HAZARD_CLEAR_MARGIN_PX;
  return {
    x: hazard.x + (dx / dist) * dodgeDist,
    y: hazard.y + (dy / dist) * dodgeDist,
  };
}

type WalkCand = { x: number; y: number };

function pushCand(out: WalkCand[], p?: WalkCand | null) {
  if (!p) return;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  out.push({ x: p.x, y: p.y });
}

function sampleRing(
  out: WalkCand[],
  center: WalkCand,
  radius: number,
  n: number = 8
) {
  if (radius <= 0) {
    pushCand(out, center);
    return;
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pushCand(out, {
      x: center.x + Math.cos(a) * radius,
      y: center.y + Math.sin(a) * radius,
    });
  }
}

function intersectKeep(
  prev: WalkCand[],
  pred: (p: WalkCand) => boolean
): WalkCand[] {
  const next = prev.filter(pred);
  return next.length > 0 ? next : prev;
}

function primaryZoneIdAt(pos: WalkCand, zones: GroundEffect[]): string | null {
  let bestId: string | null = null;
  let nearest = Infinity;
  for (const z of zones) {
    if (!isPosInEffect(pos, z)) continue;
    const d = Math.hypot(pos.x - z.x, pos.y - z.y);
    if (d < nearest) {
      nearest = d;
      bestId = z.id;
    }
  }
  return bestId;
}

function pickBestCand(
  cands: WalkCand[],
  currentPos: WalkCand,
  scoreFn: (p: WalkCand) => number
): WalkCand {
  let best = cands[0];
  let bestScore = -Infinity;
  for (const p of cands) {
    const dist = Math.hypot(p.x - currentPos.x, p.y - currentPos.y);
    const score = scoreFn(p) * 1_000_000 - dist;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function makeResult(
  partial: Omit<GroundFormationTradeOffResult, 'allowFidget' | 'fidgetMaxRadiusPx'> & {
    allowFidget?: boolean;
  }
): GroundFormationTradeOffResult {
  const settled =
    partial.tradeOffDecision === 'DEFAULT_POSITION' ||
    partial.tradeOffDecision === 'RETURN_TO_BOSS' ||
    partial.tradeOffDecision === 'STAY_IN_CURRENT_HEAL_ZONE';
  return {
    ...partial,
    allowFidget: partial.allowFidget ?? settled,
    fidgetMaxRadiusPx: FIDGET_MAX_PX,
  };
}

function evaluateGroundFormationPositionCore(
  input: GroundFormationTradeOffInput
): GroundFormationTradeOffResult {
  const {
    currentPos,
    unit,
    groundEffects,
    defaultTarget,
    bossPos,
    attackTargetPos,
    meleeRange = MELEE_ATTACK_RANGE,
    tankPos,
    tankStackRangePx = TANK_STACK_RANGE_PX,
    bossFacingRad,
    nearestHealerPos,
    isPrimaryTank,
    aggroIsNonTank = false,
    dungeonPriorityZone,
    friendlyUnitIds,
  } = input;

  const greenZones = groundEffects.filter((e) => isSeekableHealGroundEffect(e));
  const yellowZones = groundEffects.filter((e) => isFriendlyBuffGroundEffect(e));
  const stackZonesHealthy = [...greenZones, ...yellowZones];
  const activeHazards = groundEffects.filter(
    (e) =>
      (e.kind === 'DAMAGE_ZONE' || e.kind === 'CONE_WARNING') &&
      e.remainingMs > 0 &&
      !isFriendlyGroundEffect(e, friendlyUnitIds)
  );

  const isMelee = isMeleeDps(unit);
  const isRangedDps = unit.role === 'DPS' && !isMelee;
  const hpFrac = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
  const isHealthy = hpFrac >= DPS_HEALTHY_THRESHOLD;
  const hitPos = attackTargetPos ?? bossPos;
  const attackRange = isMelee ? meleeRange : RANGED_ATTACK_RANGE;
  const threateningHazard = activeHazards.find((hz) => isPosInHazard(currentPos, hz));
  const inHazard = !!threateningHazard;

  const primaryTankFlag =
    isPrimaryTank ?? (unit.role === 'TANK' && !tankPos);
  const isOtTank = unit.role === 'TANK' && !primaryTankFlag;

  // ── 候选点生成 ──
  const candidates: WalkCand[] = [];
  pushCand(candidates, currentPos);
  pushCand(candidates, defaultTarget);
  pushCand(candidates, hitPos);
  pushCand(candidates, tankPos);
  pushCand(candidates, nearestHealerPos);

  for (const hz of [...greenZones, ...yellowZones]) {
    pushCand(candidates, { x: hz.x, y: hz.y });
    sampleRing(candidates, { x: hz.x, y: hz.y }, hz.radius * 0.55);
    sampleRing(candidates, { x: hz.x, y: hz.y }, hz.radius * 0.85);
  }
  for (let i = 0; i < greenZones.length; i++) {
    for (let j = i + 1; j < greenZones.length; j++) {
      const a = greenZones[i];
      const b = greenZones[j];
      pushCand(candidates, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }

  if (hitPos) {
    sampleRing(candidates, hitPos, attackRange * 0.7);
    sampleRing(candidates, hitPos, attackRange * 0.95);
    // 侧翼采样：相对 Boss 朝向 ±90° / ±135°
    if (bossPos && bossFacingRad != null) {
      for (const offset of [Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, -(3 * Math.PI) / 4]) {
        const a = bossFacingRad + offset;
        pushCand(candidates, {
          x: bossPos.x + Math.cos(a) * meleeRange * 0.85,
          y: bossPos.y + Math.sin(a) * meleeRange * 0.85,
        });
      }
    }
  }

  if (nearestHealerPos) {
    sampleRing(candidates, nearestHealerPos, HEALER_LEASH_PX * 0.7);
    sampleRing(candidates, nearestHealerPos, HEALER_LEASH_PX * 0.95);
  }

  if (tankPos) {
    sampleRing(candidates, tankPos, tankStackRangePx * 0.7);
    sampleRing(candidates, tankPos, tankStackRangePx * 0.95);
  }

  for (const hz of activeHazards) {
    pushCand(candidates, dodgeAwayFromHazard(currentPos, hz));
    sampleRing(candidates, { x: hz.x, y: hz.y }, (hz.radius || 48) + HAZARD_CLEAR_MARGIN_PX);
  }

  if (dungeonPriorityZone) {
    if (dungeonPriorityZone.mode === 'STACK') {
      pushCand(candidates, dungeonPriorityZone.center);
      sampleRing(candidates, dungeonPriorityZone.center, dungeonPriorityZone.radiusPx * 0.45, 12);
      sampleRing(candidates, dungeonPriorityZone.center, dungeonPriorityZone.radiusPx * 0.85, 12);
    } else {
      sampleRing(candidates, currentPos, dungeonPriorityZone.radiusPx * 0.85, 12);
      sampleRing(candidates, currentPos, dungeonPriorityZone.radiusPx * 1.15, 12);
      if (defaultTarget) {
        sampleRing(candidates, defaultTarget, dungeonPriorityZone.radiusPx * 0.85, 12);
      }
      if (hitPos) {
        sampleRing(candidates, hitPos, dungeonPriorityZone.radiusPx * 1.1, 12);
      }
    }
  }

  const isSafe = (p: WalkCand) => !activeHazards.some((h) => isPosInHazard(p, h));

  // 层1：不在红圈（硬约束；若全集被滤空则强制加入径向逃离点）
  let region = candidates.filter(isSafe);
  if (region.length === 0) {
    for (const hz of activeHazards) {
      pushCand(region, dodgeAwayFromHazard(currentPos, hz));
    }
    region = region.filter(isSafe);
    if (region.length === 0) {
      region = [{ x: currentPos.x, y: currentPos.y }];
    }
  }

  let decision: GroundFormationDecision = 'DEFAULT_POSITION';
  let reason = '默认站位可行域';
  let dominantLayer = 1;

  if (inHazard) {
    decision = 'DODGE_HAZARD_LEAVE_ZONE';
    reason = '躲避红色地形';
    dominantLayer = 1;
    // 优先：当前绿圈内安全微调
    const currentHeal = greenZones.find((hz) => isPosInEffect(currentPos, hz));
    if (currentHeal && threateningHazard) {
      const shift = findSafeSpotInHealZone(currentHeal, threateningHazard);
      if (shift && isSafe(shift)) {
        return makeResult({
          targetPos: shift,
          currentHealZoneId: currentHeal.id,
          tradeOffDecision: 'DODGE_HAZARD_SHIFT_IN_ZONE',
          inHazard: true,
          hazardId: threateningHazard.id,
          reason: '躲避红色地形：微调至当前治疗光环内的安全点',
          allowFidget: false,
        });
      }
    }
  }

  // 层2：非坦持仇 → 主坦进攻击/嘲讽距；OT 向主坦
  if (aggroIsNonTank) {
    if (primaryTankFlag && hitPos) {
      const pull = region.filter((p) => canHitBoss(p, hitPos, meleeRange));
      if (pull.length > 0) {
        region = pull;
        decision = 'AGGRO_TANK_PULL';
        reason = '非坦持仇：主坦进入攻击/嘲讽可及范围拉怪';
        dominantLayer = 2;
      }
    } else if (isOtTank && tankPos) {
      const toMt = region.filter(
        (p) => Math.hypot(p.x - tankPos.x, p.y - tankPos.y) <= tankStackRangePx * 0.5
      );
      if (toMt.length > 0) {
        region = toMt;
        decision = 'AGGRO_OT_TO_MT';
        reason = '非坦持仇：副坦向主坦靠拢';
        dominantLayer = 2;
      } else {
        // 无近点则取 region 中离主坦最近
        region = [pickBestCand(region, currentPos, (p) => -Math.hypot(p.x - tankPos.x, p.y - tankPos.y))];
        decision = 'AGGRO_OT_TO_MT';
        reason = '非坦持仇：副坦向主坦靠拢';
        dominantLayer = 2;
      }
    }
  }

  // 层2.5：副本机制优先走位区域（集中/分散）：低于必须躲避（层1），高于自身施法/战斗距离（层4）
  if (dungeonPriorityZone && dominantLayer < 2) {
    if (dungeonPriorityZone.mode === 'STACK') {
      const inStack = region.filter(
        (p) =>
          Math.hypot(p.x - dungeonPriorityZone.center.x, p.y - dungeonPriorityZone.center.y) <=
          dungeonPriorityZone.radiusPx
      );
      if (inStack.length > 0) {
        region = inStack;
      } else {
        region = [
          pickBestCand(
            region,
            currentPos,
            (p) => -Math.hypot(p.x - dungeonPriorityZone.center.x, p.y - dungeonPriorityZone.center.y)
          ),
        ];
      }
      if (!inHazard) {
        decision = 'DUNGEON_STACK';
        reason = dungeonPriorityZone.label || '副本机制：优先集中站位';
        dominantLayer = 2.5;
      }
    } else if (dungeonPriorityZone.mode === 'SPREAD') {
      const peers = (dungeonPriorityZone.allyPositions || []).filter((a) => a.id !== unit.id);
      if (peers.length > 0) {
        const minPeerDist = (p: WalkCand) => {
          let m = Infinity;
          for (const a of peers) {
            const d = Math.hypot(p.x - a.x, p.y - a.y);
            if (d < m) m = d;
          }
          return m;
        };
        const spreadOk = region.filter((p) => minPeerDist(p) >= dungeonPriorityZone.radiusPx);
        if (spreadOk.length > 0) {
          region = spreadOk;
        } else {
          region = [pickBestCand(region, currentPos, (p) => minPeerDist(p))];
        }
      }
      if (!inHazard) {
        decision = 'DUNGEON_SPREAD';
        reason = dungeonPriorityZone.label || '副本机制：优先分散站位';
        dominantLayer = 2.5;
      }
    }
  }

  // 层3：危血 → 最大绿圈叠层（可牺牲输出）
  if (!isHealthy && greenZones.length > 0) {
    let maxGreen = 0;
    for (const p of region) {
      maxGreen = Math.max(maxGreen, countHealAurasAt(p, greenZones));
    }
    if (maxGreen > 0) {
      const stacked = region.filter((p) => countHealAurasAt(p, greenZones) >= maxGreen);
      if (stacked.length > 0) {
        region = stacked;
        if (dominantLayer < 3) {
          const cur = countHealAurasAt(currentPos, greenZones);
          if (cur >= maxGreen && Math.hypot(currentPos.x - region[0].x, currentPos.y - region[0].y) <= 18 && isSafe(currentPos)) {
            decision = 'STAY_IN_CURRENT_HEAL_ZONE';
            reason = `血线危险：已处于治疗叠层×${cur}，站定抬血`;
          } else {
            decision = 'SEEK_HEAL_ZONE';
            reason = `血线危险：前往治疗光环叠层最多处（×${maxGreen}）`;
          }
          dominantLayer = 3;
        }
      }
    }
  }

  // 层4：健康 → 近战/远程输出约束 + 绿黄叠层（身在红圈时不覆盖躲圈决策；副本走位优先于战斗距离）
  if (isHealthy && !inHazard && dominantLayer !== 2) {
    const canOverrideDecision = dominantLayer < 2.5;
    if (isMelee && hitPos) {
      const inMelee = region.filter((p) => canHitBoss(p, hitPos, meleeRange));
      if (inMelee.length > 0) {
        region = inMelee;
        if (bossPos != null && bossFacingRad != null) {
          const flank = region.filter(
            (p) => !isInBossFrontalCone(p, bossPos, bossFacingRad, BOSS_FRONTAL_CONE_RAD)
          );
          if (flank.length > 0) region = flank;
        }
        if (stackZonesHealthy.length > 0) {
          let maxS = 0;
          for (const p of region) maxS = Math.max(maxS, countBeneficialAurasAt(p, stackZonesHealthy));
          if (maxS > 0) {
            const stacked = region.filter(
              (p) => countBeneficialAurasAt(p, stackZonesHealthy) >= maxS
            );
            if (stacked.length > 0) {
              region = stacked;
              if (canOverrideDecision) {
                decision = 'SEEK_HEAL_ZONE';
                reason = `血线健康：近战射程内绿黄叠层×${maxS}（避开正面）`;
              }
            }
          }
        }
        if (canOverrideDecision && (decision === 'DEFAULT_POSITION' || decision === 'DODGE_HAZARD_LEAVE_ZONE')) {
          if (!canHitBoss(currentPos, hitPos, meleeRange)) {
            decision = 'RETURN_TO_BOSS';
            reason = '血线健康：返回近战攻击位';
          } else {
            decision = 'DEFAULT_POSITION';
            reason = '血线健康：近战输出位可行域';
          }
        }
        dominantLayer = Math.max(dominantLayer, 4);
      }
    } else if (isRangedDps && hitPos) {
      let next = region.filter((p) => canHitBoss(p, hitPos, RANGED_ATTACK_RANGE));
      if (next.length > 0) region = next;
      if (nearestHealerPos) {
        next = region.filter(
          (p) => Math.hypot(p.x - nearestHealerPos.x, p.y - nearestHealerPos.y) <= HEALER_LEASH_PX
        );
        if (next.length > 0) region = next;
      }
      if (stackZonesHealthy.length > 0) {
        let maxS = 0;
        for (const p of region) maxS = Math.max(maxS, countBeneficialAurasAt(p, stackZonesHealthy));
        if (maxS > 0) {
          const stacked = region.filter(
            (p) => countBeneficialAurasAt(p, stackZonesHealthy) >= maxS
          );
          if (stacked.length > 0) {
            region = stacked;
            if (canOverrideDecision) {
              decision = 'SEEK_HEAL_ZONE';
              reason = `血线健康：远程射程内绿黄叠层×${maxS}（近奶≤${HEALER_LEASH_YD}码）`;
            }
          }
        }
      }
      if (canOverrideDecision && decision === 'DEFAULT_POSITION') {
        reason = '血线健康：远程输出位可行域';
      }
      dominantLayer = Math.max(dominantLayer, 4);
    } else if (unit.role === 'HEALER' && stackZonesHealthy.length > 0) {
      let maxS = 0;
      for (const p of region) maxS = Math.max(maxS, countBeneficialAurasAt(p, stackZonesHealthy));
      if (maxS > 0) {
        const stacked = region.filter(
          (p) => countBeneficialAurasAt(p, stackZonesHealthy) >= maxS
        );
        if (stacked.length > 0) {
          region = stacked;
          if (canOverrideDecision) {
            decision = 'SEEK_HEAL_ZONE';
            reason = `治疗：绿黄叠层×${maxS}`;
          }
          dominantLayer = Math.max(dominantLayer, 4);
        }
      }
    }
  }

  // 层5：主坦 25 码（与更高优求交仍非空才收紧）
  if (tankPos && unit.role !== 'TANK' && !TANK_STACK_OVERRIDE_DECISIONS.has(decision)) {
    const within = region.filter(
      (p) => Math.hypot(p.x - tankPos.x, p.y - tankPos.y) <= tankStackRangePx
    );
    if (within.length > 0) {
      region = within;
      dominantLayer = Math.max(dominantLayer, 5);
    }
  } else if (
    tankPos &&
    unit.role !== 'TANK' &&
    TANK_STACK_OVERRIDE_DECISIONS.has(decision) &&
    dominantLayer >= 3
  ) {
    // 危血/躲圈已占优：不强制 25 码
  } else if (tankPos && unit.role !== 'TANK' && dominantLayer <= 1 && !inHazard) {
    const within = intersectKeep(
      region,
      (p) => Math.hypot(p.x - tankPos.x, p.y - tankPos.y) <= tankStackRangePx
    );
    region = within;
  }

  // 若仍在红圈意图下，确保目标安全且宁可选逃离点
  if (inHazard) {
    region = region.filter(isSafe);
    if (region.length === 0 && threateningHazard) {
      region = [dodgeAwayFromHazard(currentPos, threateningHazard)];
      decision = 'DODGE_HAZARD_LEAVE_ZONE';
    }
  }

  // 禁止默认/回 Boss 点落在红圈：再滤一次
  region = region.filter(isSafe);
  if (region.length === 0) {
    region = [dodgeAwayFromHazard(currentPos, threateningHazard ?? activeHazards[0] ?? {
      id: 'virtual',
      kind: 'DAMAGE_ZONE',
      spellId: '',
      ownerId: '',
      x: currentPos.x,
      y: currentPos.y,
      radius: 48,
      colorHex: '#000',
      remainingMs: 1,
    } as GroundEffect)];
  }

  const scoreStacks = (p: WalkCand) =>
    !isHealthy
      ? countHealAurasAt(p, greenZones)
      : countBeneficialAurasAt(p, stackZonesHealthy);

  let target = pickBestCand(region, currentPos, scoreStacks);

  // 已在可行域内且叠层不差则站定，减少抽动
  if (
    isSafe(currentPos) &&
    region.some((p) => Math.hypot(p.x - currentPos.x, p.y - currentPos.y) <= 18) &&
    scoreStacks(currentPos) >= scoreStacks(target)
  ) {
    const inMeleeOk =
      !isMelee ||
      !isHealthy ||
      !hitPos ||
      canHitBoss(currentPos, hitPos, meleeRange);
    const healerOk =
      !isRangedDps ||
      !isHealthy ||
      !nearestHealerPos ||
      Math.hypot(currentPos.x - nearestHealerPos.x, currentPos.y - nearestHealerPos.y) <=
        HEALER_LEASH_PX;
    const tankOk =
      !tankPos ||
      unit.role === 'TANK' ||
      TANK_STACK_OVERRIDE_DECISIONS.has(decision) ||
      Math.hypot(currentPos.x - tankPos.x, currentPos.y - tankPos.y) <= tankStackRangePx;
    if (inMeleeOk && healerOk && tankOk) {
      target = { x: currentPos.x, y: currentPos.y };
      if (scoreStacks(target) > 0 && (decision === 'SEEK_HEAL_ZONE' || decision === 'DEFAULT_POSITION')) {
        decision = 'STAY_IN_CURRENT_HEAL_ZONE';
        reason = `站定于当前可行域（叠层×${scoreStacks(target)}）`;
      }
    }
  }

  // 健康近战若目标仍在正面且有侧翼更好点已在层4处理

  if (inHazard && decision === 'DEFAULT_POSITION') {
    decision = 'DODGE_HAZARD_LEAVE_ZONE';
    reason = '躲避红色地形至安全空地';
  }

  // defaultTarget 若在 region 且同分，偏默认阵型
  if (
    defaultTarget &&
    isSafe(defaultTarget) &&
    decision === 'DEFAULT_POSITION' &&
    region.some(
      (p) => Math.hypot(p.x - defaultTarget.x, p.y - defaultTarget.y) < 2
    )
  ) {
    target = { ...defaultTarget };
  }

  return makeResult({
    targetPos: { x: target.x, y: target.y },
    currentHealZoneId: primaryZoneIdAt(target, greenZones.length ? greenZones : stackZonesHealthy),
    tradeOffDecision: decision,
    inHazard,
    hazardId: threateningHazard?.id,
    reason,
    allowFidget:
      decision === 'DEFAULT_POSITION' ||
      decision === 'RETURN_TO_BOSS' ||
      decision === 'STAY_IN_CURRENT_HEAL_ZONE',
  });
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

    const allTanks = orderTanksByThreatPriority(gs.units.filter(u => u.role === 'TANK'));
    const looseAdd = findLooseAddForTank(unit, livingEnemies, boss, allTanks);
    const threatTargetId = boss.threatTable?.[0]?.sourceUnitId ?? null;
    const threatDecision = evaluateTankThreatDecision(
      unit,
      allTanks,
      threatTargetId,
      isTauntTop
    );

    const specId = (unit as any).spec as string | undefined;
    const ownedSpells = getSpellsForClassSpec(unit.classId as ClassId, specId);

    // 1. 自身减伤（最高）：<35% 大减伤，<60% 小减伤；已有对应 aura 不再开
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

    // 2. 嘲讽：优先嘲讽未接仇的小怪；其次按接仇决策嘲讽首领
    if (unit.role === 'TANK') {
      const tauntSpells = ownedSpells.filter((s) => s.isTaunt);
      const tauntCds = tauntSpells.map((s) => s.cooldownMs);
      const tauntSpell = pickPreferredTankTaunt(tauntSpells);
      if (looseAdd && tauntSpell && isTankHealthy(unit)) {
        actions.push(act(tauntSpell.id, looseAdd.id, Priority.DEFENSIVE, true));
      } else if (
        shouldCastTankTaunt({
          shouldTaunt: threatDecision.shouldTaunt,
          elapsedMs: gs.elapsedMs || 0,
          threatTargetId,
          selfId: unit.id,
          availableTauntCooldownMs: tauntCds,
        })
      ) {
        if (tauntSpell) {
          actions.push(act(tauntSpell.id, boss.id, Priority.DEFENSIVE, true));
        }
      }
    }

    // 3. 通用规则输出/群拉循环（坦克 >= 2 目标自动优先 AOE 群拉技能；有散落小怪时优先打小怪建仇）
    // pauseThreat 只表示「不抢嘲讽/压仇恨」，副坦仍须持续输出；威胁倍率由执行层下调。
    {
      const personality = createAIPersonality(unit.name, unit.id);
      const candidates = buildUsableCandidatesForUnit(unit, specId, () => true, {
        roleFilter: 'DAMAGE',
        useShortId: false,
      });

      const orderedEnemies = looseAdd
        ? [looseAdd, ...livingEnemies.filter((e) => e.id !== looseAdd.id)]
        : livingEnemies;

      const decision = evaluateUniversalAIDecision({
        caster: unit,
        personality,
        allies: livingAllies,
        enemies: orderedEnemies,
        usableSkills: candidates,
        tickCount: Math.floor((gs.elapsedMs || 0) / 100),
      });

      if (decision.chosenCandidate) {
        actions.push(
          act(
            decision.chosenCandidate.spellId,
            (decision.targetUnit ?? looseAdd ?? boss).id,
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

/** 默认战斗站位（单机与服务端共用 SSOT，开怪与空闲回位一致） */
export function getCombatFormationPos(
  u: Unit,
  idx: number,
  bossPos: { x: number; y: number },
  hpPct = 1
): { x: number; y: number } {
  if (u.role === 'TANK') {
    const tankOffset = idx % 2 === 0 ? -12 : 16;
    return hpPct >= 0.6
      ? { x: 445, y: 180 + tankOffset }
      : { x: 400, y: 180 + tankOffset };
  }
  if (isMeleeDps(u)) {
    const meleeAngle = Math.PI - 0.45 + (idx % 4) * 0.32;
    const meleeDist = 48 + ((idx * 6) % 12);
    return {
      x: bossPos.x + Math.cos(meleeAngle) * meleeDist,
      y: bossPos.y + Math.sin(meleeAngle) * meleeDist,
    };
  }
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  const nameCode = u.name ? u.name.charCodeAt(0) : 65;
  const hashX = ((idx * 31 + nameCode) % 17) - 8;
  const hashY = ((idx * 43 + nameCode) % 21) - 10;
  return {
    x: 210 + col * 50 + hashX,
    y: 105 + (row % 5) * 36 + hashY,
  };
}

function auraStacks(unit: Unit, spellId: string): number {
  return unit.buffs.find(b => b.spellId === spellId)?.stacks ?? 0;
}
