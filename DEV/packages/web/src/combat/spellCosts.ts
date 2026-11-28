/**
 * Cataclysm 4.3 spell resource cost matrices (UI / player cast prediction).
 * Prefer ClassRegistry resourceCostAmount when present; these tables are fallbacks.
 */

/** Mana cost matrix (balanced for ~1.2x–2.0x total encounter mana coverage). */
export const SPELL_MANA_COSTS: Record<string, number> = {
  healing_wave: 1800,
  nourish: 1800,
  rejuvenation: 2400,
  lifebloom: 1400,
  wild_growth: 2600,
  chain_heal: 2200,
  healing_surge: 2400,
  regrowth: 5200,
  greater_healing_wave: 5600,
  healing_touch: 5400,
  swiftmend: 1600,
  rebirth: 6800,
  revive: 6800,
  healing_rain: 6500,
  tranquility: 3000,
  wrath: 1600,
  lightning_bolt: 1600,
  frostbolt: 1800,
  fireball: 2000,
  starsurge: 2400,
  lava_burst: 2600,
  pyroblast: 2800,
  starfire: 2800,
  chain_lightning: 3000,
  earth_shield: 1800,
  unleash_life: 1600,
  healing_tide: 1200,
  ascendance: 1000,
  ancestral_guidance: 0,
  thunderstorm: 0,
  moonfire: 2200,
  sunfire: 2200,
  flame_shock: 2200,
  earth_shock: 2400,
  arcane_blast: 2500,
  arcane_barrage: 2400,
  living_bomb: 2600,
  cleanse_spirit: 2200,
  natures_cure: 2200,
  remove_curse: 2200,
  remove_corruption: 2200,
  cleanse: 2200,
  dispel_magic: 2200,
  purify: 2200,
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
