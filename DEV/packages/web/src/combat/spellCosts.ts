/**
 * Cataclysm 4.3 spell resource cost matrices (UI / player cast prediction).
 * Prefer ClassRegistry resourceCostAmount when present; these tables are fallbacks.
 */

/** Mana cost fallback matrix (aligned with Lv.80 ClassRegistry SSOT, 0.8x scaled). */
export const SPELL_MANA_COSTS: Record<string, number> = {
  healing_wave: 760,
  nourish: 960,
  rejuvenation: 1280,
  lifebloom: 1440,
  wild_growth: 2080,
  chain_heal: 1760,
  healing_surge: 1920,
  regrowth: 1840,
  greater_healing_wave: 2160,
  healing_touch: 2080,
  swiftmend: 1280,
  rebirth: 2400,
  revive: 1920,
  healing_rain: 2240,
  tranquility: 2400,
  wrath: 960,
  lightning_bolt: 1120,
  frostbolt: 1200,
  fireball: 1280,
  starsurge: 1440,
  lava_burst: 1280,
  pyroblast: 1600,
  starfire: 1440,
  chain_lightning: 1600,
  earth_shield: 1440,
  unleash_life: 1280,
  healing_tide: 960,
  ascendance: 800,
  ancestral_guidance: 0,
  thunderstorm: 0,
  moonfire: 1120,
  sunfire: 1120,
  flame_shock: 1120,
  earth_shock: 1120,
  arcane_blast: 1440,
  arcane_barrage: 1280,
  living_bomb: 960,
  cleanse_spirit: 800,
  natures_cure: 640,
  remove_curse: 800,
  remove_corruption: 640,
  cleanse: 800,
  dispel_magic: 800,
  purify: 800,
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
