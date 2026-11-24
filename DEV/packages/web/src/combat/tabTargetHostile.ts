import type { Unit } from '@cata-raid-sim/engine';

function isLivingHostile(u: Unit): boolean {
  return (u.isAlive ?? u.alive) !== false && (u.hp ?? 0) > 0;
}

/**
 * Pick the nearest living hostile relative to `from`, excluding `excludeId`
 * (current target). Used by Tab target cycling.
 */
export function pickNearestHostileExcluding(opts: {
  enemies: readonly Unit[];
  from: { x: number; y: number };
  excludeId?: string | null;
}): Unit | null {
  const exclude = opts.excludeId ?? null;
  const candidates = opts.enemies.filter((u) => isLivingHostile(u) && u.id !== exclude);
  if (candidates.length === 0) return null;

  const pX = opts.from.x;
  const pY = opts.from.y;
  let best = candidates[0];
  let bestDist = Infinity;
  for (const enemy of candidates) {
    const eX = enemy.position?.x ?? 520;
    const eY = enemy.position?.y ?? 190;
    const dist = Math.hypot(eX - pX, eY - pY);
    if (dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  return best;
}
