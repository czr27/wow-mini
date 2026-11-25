/**
 * Full COMBAT_STATE must only carry host-authority seats / FX.
 * Guest humans (and their pets/totems) arrive via OWNER_SNAPSHOT + EFFECTS.
 */
import type {
  CombatEngine,
  NetworkCastTimeline,
  NetworkCooldownTimeline,
  NetworkGcdTimeline,
  NetworkGroundEffectSnapshot,
  NetworkUnitSnapshot,
  FloatingCombatText,
  NetworkCombatAction,
} from '@cata-raid-sim/engine';
import { getCombatAuthorityContext } from './networkCombatAuthority.js';

export function isHostAuthorityUnitId(unitId: string, engine?: CombatEngine): boolean {
  const { isUnitLocalAuthority, isNetworkHost, localPlayerId } = getCombatAuthorityContext();
  if (!isNetworkHost) return isUnitLocalAuthority(unitId);
  if (isUnitLocalAuthority(unitId)) return true;
  // Defensive: never treat other humans as host-owned even if predicate lags
  const u = engine?.getUnit(unitId);
  if (u && (u.isHumanControlled || u.isPlayer) && u.id !== localPlayerId) return false;
  // Guest-human pets only — AI/boss summons stay in the host full mirror
  if (u?.ownerId && u.ownerId !== localPlayerId) {
    const owner = engine?.getUnit(u.ownerId);
    if (owner && (owner.isHumanControlled || owner.isPlayer) && owner.id !== localPlayerId) {
      return false;
    }
  }
  return isUnitLocalAuthority(unitId);
}

export function filterHostAuthorityUnits(
  units: NetworkUnitSnapshot[],
  engine?: CombatEngine
): NetworkUnitSnapshot[] {
  return units.filter((u) => isHostAuthorityUnitId(u.id, engine));
}

export function filterHostAuthorityCasts(
  casts: NetworkCastTimeline[],
  engine?: CombatEngine
): NetworkCastTimeline[] {
  return casts.filter((c) => isHostAuthorityUnitId(c.unitId, engine));
}

export function filterHostAuthorityCooldowns(
  cds: NetworkCooldownTimeline[],
  engine?: CombatEngine
): NetworkCooldownTimeline[] {
  return cds.filter((c) => isHostAuthorityUnitId(c.unitId, engine));
}

export function filterHostAuthorityGcds(
  gcds: NetworkGcdTimeline[],
  engine?: CombatEngine
): NetworkGcdTimeline[] {
  return gcds.filter((g) => isHostAuthorityUnitId(g.unitId, engine));
}

export function filterHostAuthorityGround(
  ground: NetworkGroundEffectSnapshot[],
  engine?: CombatEngine
): NetworkGroundEffectSnapshot[] {
  return ground.filter((g) => isHostAuthorityUnitId(g.ownerId, engine));
}

export function filterHostAuthorityFloatingTexts(
  texts: FloatingCombatText[],
  engine?: CombatEngine
): FloatingCombatText[] {
  // Only SCT whose target is a host-authority seat (boss/AI/self)
  return texts.filter((t) => !t.targetId || isHostAuthorityUnitId(t.targetId, engine));
}

export function filterHostAuthorityActions(
  actions: NetworkCombatAction[],
  engine?: CombatEngine
): NetworkCombatAction[] {
  return actions.filter((a) => isHostAuthorityUnitId(a.actorId, engine));
}
