import { resolveCooldownSpellIds } from '@cata-raid-sim/engine';

/** Cataclysm 4.3 shared cooldown categories (UI / player CD state). */
export const SHARED_COOLDOWN_GROUPS: Record<string, string[]> = {
  flame_shock: ['flame_shock', 'earth_shock'],
  earth_shock: ['flame_shock', 'earth_shock'],
  healthstone: ['healthstone', 'healing_potion', 'mana_potion'],
  healing_potion: ['healthstone', 'healing_potion', 'mana_potion'],
  mana_potion: ['healthstone', 'healing_potion', 'mana_potion'],
  // 嗜血 / 英勇 / 时间扭曲 互斥
  bloodlust: ['bloodlust', 'heroism', 'shaman_heroism', 'time_warp', 'mage_time_warp'],
  heroism: ['bloodlust', 'heroism', 'shaman_heroism', 'time_warp', 'mage_time_warp'],
  shaman_heroism: ['bloodlust', 'heroism', 'shaman_heroism', 'time_warp', 'mage_time_warp'],
  time_warp: ['bloodlust', 'heroism', 'shaman_heroism', 'time_warp', 'mage_time_warp'],
  mage_time_warp: ['bloodlust', 'heroism', 'shaman_heroism', 'time_warp', 'mage_time_warp'],
  // 德鲁伊驱散（自然之愈 / 清除腐蚀 共享 8 秒冷却）
  natures_cure: ['natures_cure', 'druid_natures_cure', 'remove_corruption', 'druid_remove_corruption'],
  druid_natures_cure: ['natures_cure', 'druid_natures_cure', 'remove_corruption', 'druid_remove_corruption'],
  remove_corruption: ['natures_cure', 'druid_natures_cure', 'remove_corruption', 'druid_remove_corruption'],
  druid_remove_corruption: ['natures_cure', 'druid_natures_cure', 'remove_corruption', 'druid_remove_corruption'],
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
  const fromGroup = SHARED_COOLDOWN_GROUPS[spellId] || [];
  const fromAliases = resolveCooldownSpellIds(spellId);
  const sharedGroup = [...new Set([spellId, ...fromGroup, ...fromAliases])];
  const next = { ...prev };
  for (const sid of sharedGroup) {
    next[sid] = { cdRemainingMs: totalCdMs, totalCdMs };
  }
  return next;
}
