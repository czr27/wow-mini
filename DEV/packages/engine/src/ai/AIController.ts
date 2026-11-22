// ============================================================
// Cata Raid Sim — AI Controller  [AI-01]
// 200ms decision cycle (every 4 × 50ms ticks)
// Priority queue: INTERRUPT > DEFENSIVE > BUFF > HEAL > DPS
// ============================================================

import { Unit, RunPhase, SpellSchool } from '../types.js';

export * from './SkillMetricEvaluator.js';

// ── Action returned by AI decision ──────────────────────────
export interface Action {
  spellId: string;
  targetId: string;
  /** true = cast immediately, false = queue for next GCD */
  immediate: boolean;
  targetX?: number;
  targetY?: number;
}

// ── Minimal GameState view passed to AI ───────────────────────
export interface GameState {
  phase: RunPhase;
  elapsedMs: number;
  units: Unit[];
  /** ID of the current boss (or null outside BOSS_COMBAT) */
  bossId: string | null;
  /** Is the boss currently channelling a spell? */
  bossChannelSpellId: string | null;
  bossChannelRemainingMs: number;
  groundEffects?: import('../types.js').GroundEffect[];
}

// ── Priority levels (lower number = higher priority) ─────────
export const enum Priority {
  INTERRUPT  = 0,
  DEFENSIVE  = 1,
  BUFF       = 2,
  HEAL       = 3,
  DPS        = 4,
}

export interface PrioritisedAction {
  priority: Priority;
  action: Action;
}

// ── Base interface every role-AI implements ───────────────────
export interface RoleAI {
  decide(unit: Unit, gameState: GameState): PrioritisedAction[];
}

// ── AIController — drives one Unit at 200ms cadence ──────────
export class AIController {
  private tickCounter = 0;
  private readonly DECISION_TICKS = 4; // 4 × 50ms = 200ms

  constructor(private readonly roleAI: RoleAI) {}

  /**
   * Called every engine tick (50ms).
   * Returns an ordered action list every 4th call; otherwise [].
   */
  tick(unit: Unit, gameState: GameState): Action[] {
    this.tickCounter++;
    if (this.tickCounter < this.DECISION_TICKS) return [];
    this.tickCounter = 0;
    return this.decide(unit, gameState);
  }

  decide(unit: Unit, gameState: GameState): Action[] {
    if (!unit.isAlive) return [];

    const candidates = this.roleAI.decide(unit, gameState);

    // Sort by ascending priority (lower = more urgent)
    candidates.sort((a, b) => a.priority - b.priority);

    // Deduplicate: keep at most one action per spell per cycle
    const seen = new Set<string>();
    const actions: Action[] = [];
    for (const { action } of candidates) {
      if (!seen.has(action.spellId)) {
        seen.add(action.spellId);
        actions.push(action);
      }
    }
    return actions;
  }
}

// ── Helpers shared across RoleAI implementations ─────────────

/** Return the main tank (lowest index alive TANK unit) */
export function getMainTank(units: Unit[]): Unit | undefined {
  return units.find(u => u.role === 'TANK' && u.isAlive);
}

/** Return the boss unit */
export function getBoss(units: Unit[], bossId: string | null): Unit | undefined {
  if (!bossId) return undefined;
  return units.find(u => u.id === bossId);
}

/** hp fraction 0-1 */
export function hpFraction(unit: Unit): number {
  return unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
}

/** True if unit has buff/debuff with given spellId */
export function hasAura(unit: Unit, spellId: string): boolean {
  return unit.buffs.some(b => b.spellId === spellId);
}

/** Stacks of a named aura (0 if absent) */
export function auraStacks(unit: Unit, spellId: string): number {
  return unit.buffs.find(b => b.spellId === spellId)?.stacks ?? 0;
}

export interface UnitPersonality {
  tickOffset: number;
  individualMod: number;
  critMod: number;
}

/**
 * Derives a deterministic individual personality profile for an AI unit:
 * - tickOffset: 0 ~ 29 ticks staggered cadence to break synchronous lockstep casting
 * - individualMod: ~0.94 ~ 1.06 individual gear / proficiency variance
 * - critMod: -0.03 ~ +0.03 individual crit variance
 */
export function getUnitPersonality(unit: Unit): UnitPersonality {
  let hash = 0;
  const str = (unit.name || '') + (unit.id || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const posHash = Math.abs(hash);
  const tickOffset = posHash % 30;
  const individualMod = 0.94 + ((posHash % 13) / 100);
  const critMod = ((posHash % 7) - 3) * 0.01;
  return { tickOffset, individualMod, critMod };
}

/**
 * Calculates organic skill damage for AI unit hitting a monster/boss:
 * - Injects natural damage roll variance (default ±8%)
 * - Incorporates individual personality modifier & AP/SP scaling
 * - Supports genuine critical strike multiplier (~1.95x - 2.05x)
 * - Returns realistic integer damage avoiding robotic static numbers
 */
export function rollAiDamage(
  unit: Unit,
  baseDamage: number,
  school: SpellSchool,
  isCrit: boolean,
  varianceRatio = 0.08
): number {
  const { individualMod } = getUnitPersonality(unit);
  const statVal =
    school === 'PHYSICAL'
      ? (unit.stats.attackPower || 8500)
      : (unit.stats.spellPower || 8500);
  const statScale = statVal / 8500;

  // Natural WoW damage roll: ±varianceRatio (e.g. ±8%)
  const roll = 1 + (Math.random() * 2 - 1) * varianceRatio;

  // Crit multiplier: ~1.95x ~ 2.05x on critical hits
  const critMult = isCrit ? (1.95 + (Math.random() * 2 - 1) * 0.05) : 1.0;

  const rawDmg = baseDamage * individualMod * statScale * roll * critMult;
  return Math.max(1, Math.round(rawDmg));
}

/**
 * Calculates organic healing for AI unit:
 * - Injects natural heal roll variance (default ±8%)
 * - Incorporates individual personality modifier & SP scaling
 * - Supports genuine critical heal multiplier (~1.95x - 2.05x)
 */
export function rollAiHeal(
  unit: Unit,
  baseHeal: number,
  isCrit: boolean,
  varianceRatio = 0.08
): number {
  const { individualMod } = getUnitPersonality(unit);
  const statScale = (unit.stats.spellPower || 9000) / 9000;
  const roll = 1 + (Math.random() * 2 - 1) * varianceRatio;
  const critMult = isCrit ? (1.95 + (Math.random() * 2 - 1) * 0.05) : 1.0;
  const rawHeal = baseHeal * individualMod * statScale * roll * critMult;
  return Math.max(1, Math.round(rawHeal));
}
