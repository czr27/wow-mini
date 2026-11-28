/**
 * Cataclysm 4.3 spell resource cost matrices (UI / player cast prediction).
 * Prefer ClassRegistry resourceCostAmount when present; these tables are fallbacks.
 */

/** Mana cost fallback matrix (aligned with Lv.80 ClassRegistry SSOT). */
export const SPELL_MANA_COSTS: Record<string, number> = {
  healing_wave: 950,
  nourish: 1200,
  rejuvenation: 1600,
  lifebloom: 1800,
  wild_growth: 2600,
  chain_heal: 2200,
  healing_surge: 2400,
  regrowth: 2300,
  greater_healing_wave: 2700,
  healing_touch: 2600,
  swiftmend: 1600,
  rebirth: 3000,
  revive: 2400,
  healing_rain: 2800,
  tranquility: 3000,
  wrath: 1200,
  lightning_bolt: 1400,
  frostbolt: 1500,
  fireball: 1600,
  starsurge: 1800,
  lava_burst: 1600,
  pyroblast: 2000,
  starfire: 1800,
  chain_lightning: 2000,
  earth_shield: 1800,
  unleash_life: 1600,
  healing_tide: 1200,
  ascendance: 1000,
  ancestral_guidance: 0,
  thunderstorm: 0,
  moonfire: 1400,
  sunfire: 1400,
  flame_shock: 1400,
  earth_shock: 1400,
  arcane_blast: 1800,
  arcane_barrage: 1600,
  living_bomb: 1200,
  cleanse_spirit: 1000,
  natures_cure: 800,
  remove_curse: 1000,
  remove_corruption: 800,
  cleanse: 1000,
  dispel_magic: 1000,
  purify: 1000,
};

/** Rogue energy cost matrix. */
export const SPELL_ENERGY_COSTS: Record<string, number> = {
  sinister_strike: 40,
  mutilate: 55,
  slice_and_dice: 25,
  eviscerate: 35,
  envenom: 35,
  rupture: 25,
  kick: 15,
  feint: 20,
};

/** Bear / Warrior rage cost matrix. */
export const SPELL_RAGE_COSTS: Record<string, number> = {
  mangle: 15,
  lacerate: 15,
  maul: 30,
};

/** Death Knight runic power cost matrix (Cata 4.3 base). */
export const SPELL_RUNIC_COSTS: Record<string, number> = {
  frost_strike: 40,
  rune_strike: 30,
  death_coil: 40,
  summon_gargoyle: 60,
};
