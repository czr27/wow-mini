import type { CombatEngine } from '../engine/CombatEngine.js';
import type { Unit } from '../types.js';

/** Stationary mechanics/constructs that should not chase players or auto-attack in melee */
const STATIONARY_CONSTRUCT_SUMMON_IDS = new Set([
  'jindo_brittle_barrier',
  'hagara_ice_tomb',
  'hagara_conductive_crystal',
  'madness_limb',
  'madness_elementium_bolt',
  'zonozz_void_tentacle',
  'venoxis_bloodvenom',
  'ripsnarl_vapor',
]);

export const ADD_MOVE_SPEED_PX_PER_SEC = 100;
export const ADD_STOP_DISTANCE_PX = 70;
export const ADD_MELEE_RANGE_PX = 85;
export const ADD_ATTACK_INTERVAL_MS = 2000;

export function isStationaryConstructAdd(unit: { summonSpellId?: string } | null | undefined): boolean {
  if (!unit?.summonSpellId) return false;
  if (STATIONARY_CONSTRUCT_SUMMON_IDS.has(unit.summonSpellId)) return true;
  if (unit.summonSpellId.startsWith('yorsahj_blood_')) return true;
  return false;
}

/**
 * Resolve the current threat target for an enemy add.
 * If threat table is empty or top target is dead, pick nearest living friendly unit
 * and seed minimal threat so TankAI can detect and taunt loose adds.
 */
export function resolveAddThreatTarget(add: Unit, engine: CombatEngine): Unit | undefined {
  const livingFriendlies = engine.friendlyUnits.filter(
    (u) => (u.isAlive ?? u.alive) && u.hp > 0
  );
  if (livingFriendlies.length === 0) return undefined;

  const topId =
    engine.threatManager.getTopThreatSource(add.id) ??
    add.threatTable?.[0]?.sourceUnitId ??
    null;
  if (topId) {
    const existing = livingFriendlies.find((u) => u.id === topId);
    if (existing) return existing;
  }

  const aPos = add.position || { x: 400, y: 200 };
  const nonPets = livingFriendlies.filter((u) => !u.isPet && u.unitKind !== 'PET');
  const pool = nonPets.length > 0 ? nonPets : livingFriendlies;
  let nearest = pool[0];
  let bestDist = Infinity;
  for (const u of pool) {
    const p = u.position || { x: 0, y: 0 };
    const d = Math.hypot(p.x - aPos.x, p.y - aPos.y);
    if (d < bestDist) {
      bestDist = d;
      nearest = u;
    }
  }
  if (nearest) {
    engine.threatManager.addThreat(add.id, nearest.id, 1);
  }
  return nearest;
}

/**
 * Host-authoritative tick for all living enemy adds (`unitKind === 'ADD'` / non-boss enemies):
 * moves adds toward their threat target and performs melee auto-attacks.
 */
export function tickEnemyAdds(
  engine: CombatEngine,
  boss: Unit | undefined,
  deltaMs: number,
  lastAttackMsByAddId: Map<string, number>
): void {
  const nowMs = engine.nowMs || 0;
  const is20Man = engine.friendlyUnits.length > 5;
  const stepPx = (ADD_MOVE_SPEED_PX_PER_SEC * Math.max(0, deltaMs)) / 1000;

  for (const add of engine.enemyUnits) {
    if (boss && add.id === boss.id) continue;
    if (!(add.isAlive ?? add.alive) || add.hp <= 0) continue;
    if (isStationaryConstructAdd(add)) continue;

    const target = resolveAddThreatTarget(add, engine);
    if (!target) continue;

    const aPos = add.position || { x: 400, y: 200 };
    const tPos = target.position || { x: 200, y: 200 };
    const dx = tPos.x - aPos.x;
    const dy = tPos.y - aPos.y;
    const dist = Math.hypot(dx, dy);

    if (dist > ADD_STOP_DISTANCE_PX && stepPx > 0) {
      const move = Math.min(stepPx, dist - ADD_STOP_DISTANCE_PX);
      add.position = {
        x: aPos.x + (dx / dist) * move,
        y: aPos.y + (dy / dist) * move,
      };
    }

    const updatedDist = Math.hypot(
      tPos.x - (add.position?.x ?? aPos.x),
      tPos.y - (add.position?.y ?? aPos.y)
    );
    const lastAtk = lastAttackMsByAddId.get(add.id) ?? -ADD_ATTACK_INTERVAL_MS;
    if (updatedDist <= ADD_MELEE_RANGE_PX && nowMs - lastAtk >= ADD_ATTACK_INTERVAL_MS) {
      lastAttackMsByAddId.set(add.id, nowMs);
      const baseDmg = is20Man
        ? target.role === 'TANK'
          ? 12_000
          : 24_000
        : target.role === 'TANK'
          ? 5_500
          : 11_000;
      engine.resolveAttackHit(add, target, baseDmg, 'PHYSICAL', false, `${add.name} 攻击`);
    }
  }
}
