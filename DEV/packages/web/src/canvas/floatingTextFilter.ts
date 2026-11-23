import type { FloatingCombatText, Unit } from '@cata-raid-sim/engine';
import { resolveCombatDisplayPrefs, type CombatDisplayPrefs } from '@cata-raid-sim/engine';

const OUTGOING_DMG_CATS = new Set([
  'DAMAGE_AUTO',
  'DAMAGE_SKILL',
  'DAMAGE_DOT',
  'PHYS_NORMAL',
  'CRIT',
]);

const NON_DAMAGE_ENEMY_CATS = new Set([
  'DODGE',
  'PARRY',
  'BLOCK',
  'RESIST',
  'ABSORB',
  'MISS',
  'IMMUNE',
  'STATUS',
  'HEAL',
  'OVERHEAL',
]);

export type LocalFloatingTextMode = 'OUTGOING' | 'HEAL_SELF' | 'TAKEN_SELF' | 'ALLY_OUTGOING' | 'ALLY_HEAL';

function looksLikeOutgoingDamage(fct: FloatingCombatText): boolean {
  return (
    OUTGOING_DMG_CATS.has(fct.category) ||
    (!NON_DAMAGE_ENEMY_CATS.has(fct.category) &&
      !['闪避', '招架', '格挡', '抵抗', '吸收', '未命中', '免疫'].includes(fct.text))
  );
}

/**
 * Atmosphere SCT filtered by combat display prefs.
 * Defaults match prior hard-coded filter (self dmg/heal/taken on; ally off).
 */
export function resolveLocalFloatingTextMode(
  fct: FloatingCombatText,
  opts: {
    localPlayerId: string | undefined;
    units: Unit[];
    bossUnitId?: string | null;
    prefs?: Partial<CombatDisplayPrefs> | null;
  }
): LocalFloatingTextMode | null {
  const { localPlayerId, units, bossUnitId } = opts;
  if (!localPlayerId) return null;
  const prefs = resolveCombatDisplayPrefs(opts.prefs);

  const targetUnit = units.find((u) => u.id === fct.targetId);
  const isTargetEnemy = fct.targetId === bossUnitId || targetUnit?.role === 'ENEMY';
  const isOnLocalPlayer = fct.targetId === localPlayerId;
  const myPetIds = new Set(
    units.filter((u) => u.isPet && u.ownerId === localPlayerId).map((u) => u.id)
  );
  const hasOtherHumans = units.some(
    (u) => (u.isHumanControlled || u.isPlayer) && u.id !== localPlayerId
  );

  const isMineOutgoing = (() => {
    if (fct.sourceId) {
      return fct.sourceId === localPlayerId || myPetIds.has(fct.sourceId);
    }
    if (hasOtherHumans) return false;
    return Boolean(fct.isFromPlayerOrPet);
  })();

  const isAllyOutgoing = (() => {
    if (isMineOutgoing) return false;
    if (fct.sourceId) {
      if (fct.sourceId === bossUnitId) return false;
      const src = units.find((u) => u.id === fct.sourceId);
      if (!src) return Boolean(fct.isFromPlayerOrPet);
      if (src.role === 'ENEMY') return false;
      if (src.isPet && src.ownerId === localPlayerId) return false;
      return true;
    }
    return Boolean(fct.isFromPlayerOrPet);
  })();

  if (isTargetEnemy) {
    if (!looksLikeOutgoingDamage(fct)) return null;
    if (isMineOutgoing) return prefs.showSctMyDamage ? 'OUTGOING' : null;
    if (isAllyOutgoing) return prefs.showSctAllyDamage ? 'ALLY_OUTGOING' : null;
    return null;
  }

  const isHeal = fct.category === 'HEAL' || fct.category === 'OVERHEAL';

  if (isHeal) {
    if (isOnLocalPlayer) {
      // 治疗于我（任意来源）或我奶自己（我的治疗）
      if (prefs.showSctHealOnMe) return 'HEAL_SELF';
      if (isMineOutgoing && prefs.showSctMyHeal) return 'HEAL_SELF';
      return null;
    }
    if (isMineOutgoing) {
      // 我的治疗打在友方
      return prefs.showSctMyHeal ? 'HEAL_SELF' : null;
    }
    if (!isTargetEnemy && isAllyOutgoing) {
      return prefs.showSctAllyHeal ? 'ALLY_HEAL' : null;
    }
    return null;
  }

  if (isOnLocalPlayer && fct.category === 'DAMAGE_TAKEN') {
    return prefs.showSctDamageOnMe ? 'TAKEN_SELF' : null;
  }

  return null;
}
