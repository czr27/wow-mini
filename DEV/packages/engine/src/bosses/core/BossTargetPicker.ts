import type { Unit } from '../../types.js';

/** Combined probability that a random boss target pick selects a human player when both humans and AIs exist in the pool. */
export const HUMAN_BOSS_TARGET_WEIGHT = 0.6;

export function isHumanTargetUnit(u: Unit | null | undefined): boolean {
  return !!(u && (u.isPlayer || u.isHumanControlled));
}

/**
 * Pick 1 target from an eligible pool with 60% combined probability for human players
 * and 40% combined probability for AI units (when both exist in the pool).
 * Within each group (humans / AIs), selection is uniform random.
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
  const ais = effective.filter((u) => !isHumanTargetUnit(u));

  if (humans.length === 0) {
    return ais[Math.floor(rng() * ais.length)];
  }
  if (ais.length === 0) {
    return humans[Math.floor(rng() * humans.length)];
  }

  const bucket = rng() < HUMAN_BOSS_TARGET_WEIGHT ? humans : ais;
  return bucket[Math.floor(rng() * bucket.length)];
}

/**
 * Pick up to `count` distinct targets from an eligible pool, applying the 60/40
 * human-vs-AI weighting on each pick from the remaining candidates.
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
