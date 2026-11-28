import type { Unit } from '../../types.js';

/** Human-first boss target priority: always pick randomly from humans while any remain, then fall back to AIs. */
export const HUMAN_BOSS_TARGET_WEIGHT = 1;

export function isHumanTargetUnit(u: Unit | null | undefined): boolean {
  return !!(u && (u.isPlayer || u.isHumanControlled));
}

/**
 * Pick 1 target from an eligible pool:
 * - Always picks uniformly at random from human players when any human exists in the pool.
 * - Falls back to uniform random from AI units only when no human remains.
 * Pets are excluded unless the pool contains only pets.
 */
export function pickWeightedBossTarget<T extends Unit>(
  pool: readonly T[],
  rng: () => number = Math.random
): T | undefined {
  if (!pool || pool.length === 0) return undefined;
  const nonPets = pool.filter((u) => !u.isPet && u.unitKind !== 'PET');
  const effective = nonPets.length > 0 ? nonPets : pool;

  const humans = effective.filter((u) => isHumanTargetUnit(u));
  if (humans.length > 0) {
    return humans[Math.floor(rng() * humans.length)];
  }

  const ais = effective.filter((u) => !isHumanTargetUnit(u));
  return ais[Math.floor(rng() * ais.length)];
}

/**
 * Pick up to `count` distinct targets from an eligible pool:
 * - Exhausts eligible human players first (uniform random order).
 * - Only fills remaining slots from AI units when humans are fewer than `count`.
 */
export function pickWeightedBossTargets<T extends Unit>(
  pool: readonly T[],
  count: number,
  rng: () => number = Math.random
): T[] {
  if (!pool || pool.length === 0 || count <= 0) return [];
  const nonPets = pool.filter((u) => !u.isPet && u.unitKind !== 'PET');
  const remaining = [...(nonPets.length > 0 ? nonPets : pool)];
  const picked: T[] = [];
  const targetCount = Math.min(count, remaining.length);
  for (let i = 0; i < targetCount; i++) {
    const chosen = pickWeightedBossTarget(remaining, rng);
    if (!chosen) break;
    picked.push(chosen);
    const idx = remaining.indexOf(chosen);
    if (idx !== -1) remaining.splice(idx, 1);
  }
  return picked;
}
