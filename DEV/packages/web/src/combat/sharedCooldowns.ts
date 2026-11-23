/** Cataclysm 4.3 shared cooldown categories (UI / player CD state). */
export const SHARED_COOLDOWN_GROUPS: Record<string, string[]> = {
  flame_shock: ['flame_shock', 'earth_shock'],
  earth_shock: ['flame_shock', 'earth_shock'],
  healthstone: ['healthstone', 'healing_potion', 'mana_potion'],
  healing_potion: ['healthstone', 'healing_potion', 'mana_potion'],
  mana_potion: ['healthstone', 'healing_potion', 'mana_potion'],
};

export type PlayerCooldownEntry = { cdRemainingMs: number; totalCdMs: number };

/**
 * Apply a spell CD (and its shared group) onto a cooldown map snapshot.
 * Pure — caller owns React setState.
 */
export function applySharedCooldown(
  prev: Record<string, PlayerCooldownEntry>,
  spellId: string,
  totalCdMs: number
): Record<string, PlayerCooldownEntry> {
  const sharedGroup = SHARED_COOLDOWN_GROUPS[spellId] || [spellId];
  const next = { ...prev };
  for (const sid of sharedGroup) {
    next[sid] = { cdRemainingMs: totalCdMs, totalCdMs };
  }
  return next;
}
