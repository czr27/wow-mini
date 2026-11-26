/**
 * Mechanical effects of raid buffs, immunities, and damage-reduction auras.
 * Applied at calc / applyDamage time so UI-only buff icons become real combat modifiers.
 */
import type { Buff, SpellSchool, Unit, UnitStats } from '../types.js';

function buffIds(unit: Unit | undefined | null): string[] {
  if (!unit?.buffs?.length) return [];
  return unit.buffs.map(b => (b.spellId || b.id || '').toLowerCase());
}

function hasAny(ids: string[], needles: string[]): boolean {
  return ids.some(id => needles.some(n => id === n || id.includes(n)));
}

/** Full immunity — damage becomes 0 (Divine Shield / Ice Block / Deterrence). */
const IMMUNITY_IDS = [
  'divine_shield',
  'ice_block',
  'hand_of_protection',
  'hand_of_protection_on',
  'deterrence',
  'cloak_of_shadows', // spell/harmful effects — treat as full for sim simplicity when school is magic
];

/** Magic-only immunity / heavy DR */
const MAGIC_IMMUNITY_IDS = ['cloak_of_shadows', 'anti_magic_zone'];

/**
 * Incoming damage multipliers (1 = full damage). Multiplicative across different auras.
 * Values match our class spell descriptions / Cata-calibrated tank CDs.
 */
const DAMAGE_TAKEN_MULT: Array<{ ids: string[]; mult: number; magicOnly?: boolean; physicalOnly?: boolean }> = [
  { ids: ['dispersion'], mult: 0.1 },
  { ids: ['icebound_fortitude'], mult: 0.5 },
  { ids: ['shield_wall'], mult: 0.6 },
  { ids: ['pain_suppression'], mult: 0.6 },
  { ids: ['guardian_spirit'], mult: 0.6 },
  { ids: ['anti_magic_shell', 'ams'], mult: 0.25, magicOnly: true },
  { ids: ['feint'], mult: 0.5 }, // AoE DR — applied to all incoming for sim (boss abilities are mostly AoE)
  { ids: ['barkskin'], mult: 0.8 },
  { ids: ['divine_protection'], mult: 0.8 },
  { ids: ['ardent_defender'], mult: 0.8 },
  { ids: ['bone_shield'], mult: 0.8 }, // approx per-stack DR simplified
  { ids: ['shamanistic_rage'], mult: 0.7 },
  { ids: ['power_word_barrier', 'pw_barrier'], mult: 0.75 },
  { ids: ['spirit_link', 'spirit_link_totem'], mult: 0.9 }, // 灵魂链接图腾：范围内 10% 减伤
];

export function unitHasImmunity(unit: Unit, school: SpellSchool = 'PHYSICAL'): boolean {
  const ids = buffIds(unit);
  if (hasAny(ids, ['divine_shield', 'ice_block', 'hand_of_protection', 'deterrence'])) return true;
  if (school !== 'PHYSICAL' && hasAny(ids, MAGIC_IMMUNITY_IDS)) return true;
  // Cloak: magic only
  if (school !== 'PHYSICAL' && hasAny(ids, ['cloak_of_shadows'])) return true;
  return false;
}

/** Product of all matching DR auras (after immunity check). */
export function getIncomingDamageMultiplier(unit: Unit, school: SpellSchool = 'PHYSICAL'): number {
  if (unitHasImmunity(unit, school)) return 0;
  const ids = buffIds(unit);
  let mult = 1;
  for (const row of DAMAGE_TAKEN_MULT) {
    if (row.magicOnly && school === 'PHYSICAL') continue;
    if (row.physicalOnly && school !== 'PHYSICAL') continue;
    if (hasAny(ids, row.ids)) mult *= row.mult;
  }
  const anger = (unit.buffs || []).find((b) => b.spellId === 'focused_anger');
  if (anger) {
    const stacks = Math.max(1, anger.stacks || 1);
    mult *= 1 + stacks * 0.15;
  }
  return Math.max(0, mult);
}

/**
 * Effective combat stats with raid buffs applied (calc-time, non-mutating).
 * MotW/BoK ≈ +5% AP/SP/armor; AB ≈ +5% crit + SP; Horn/Shout ≈ +AP; Fort ≈ armor/HP proxy via SP/AP skip.
 */
export function getEffectiveUnitStats(unit: Unit): UnitStats {
  const base = unit.stats || ({} as UnitStats);
  const ids = buffIds(unit);
  let attackPower = base.attackPower ?? 0;
  let spellPower = base.spellPower ?? 0;
  let critChance = base.critChance ?? 0;
  let armor = base.armor ?? 0;
  let spellResist = base.spellResist ?? 0;
  let mastery = base.mastery ?? 0;
  let haste = base.haste ?? 0;
  let block = base.block ?? 0;
  let parry = base.parry ?? 0;
  let dodge = base.dodge ?? 0;
  let versatility = base.versatility ?? 0;
  let speed = base.speed ?? 0;

  const hasMotwOrKings =
    hasAny(ids, ['mark_of_the_wild', 'blessing_of_kings']) ||
    hasAny(ids, ['motw']);
  if (hasMotwOrKings) {
    attackPower *= 1.05;
    spellPower *= 1.05;
    armor *= 1.05;
    spellResist += 10; // flat resist proxy for MotW resistances
  }

  if (hasAny(ids, ['arcane_brilliance'])) {
    spellPower *= 1.1;
    critChance = Math.min(1, critChance + 0.05);
  }

  if (hasAny(ids, ['horn_of_winter', 'battle_shout', 'roar_of_courage', 'strength_of_earth'])) {
    attackPower *= 1.1;
  }

  if (hasAny(ids, ['power_word_fortitude', 'pw_fortitude', 'blood_pact'])) {
    // Stamina → treated as toughness: slight armor bump; HP handled on buff apply
    armor *= 1.05;
  }

  if (hasAny(ids, ['blessing_of_might', 'abominations_might'])) {
    attackPower *= 1.1;
  }

  if (hasAny(ids, ['windfury', 'windfury_totem'])) {
    haste = Math.min(2, haste + 0.16);
  }

  // 嗜血 / 英勇 / 时间扭曲：+30% 急速
  if (
    hasAny(ids, ['heroism', 'bloodlust', 'time_warp', 'shaman_heroism', 'mage_time_warp']) ||
    (unit.buffs || []).some((b) => (b.tags || []).includes('BLOODLUST'))
  ) {
    haste = Math.min(2, haste + 0.3);
  }

  return {
    attackPower: Math.round(attackPower),
    spellPower: Math.round(spellPower),
    critChance,
    haste,
    armor: Math.round(armor),
    spellResist,
    block,
    parry,
    dodge,
    mastery,
    versatility,
    speed,
  };
}

/**
 * Cast / GCD / channel haste including raid buffs (bloodlust, windfury, …).
 * Prefer this over `unit.stats.haste` wherever read-bar length is computed.
 */
export function getUnitHaste(unit: Unit | undefined | null, fallback = 0): number {
  if (!unit) return fallback;
  return getEffectiveUnitStats(unit).haste ?? fallback;
}

/** Outgoing damage amp from source buffs (beyond dedicated CombatEngine hooks). */
export function getOutgoingDamageMultiplier(source: Unit): number {
  const ids = buffIds(source);
  let mult = 1;
  // Pillar of Frost / Arcane Power style
  if (hasAny(ids, ['pillar_of_frost'])) mult *= 1.2;
  if (hasAny(ids, ['arcane_power'])) mult *= 1.2;
  if (hasAny(ids, ['recklessness'])) mult *= 1.5;
  return mult;
}

/** Healing received multiplier (e.g. Vampiric Blood +25% healing taken). */
export function getHealingTakenMultiplier(target: Unit): number {
  const ids = buffIds(target);
  let mult = 1;
  if (hasAny(ids, ['vampiric_blood'])) mult *= 1.25;
  if (hasAny(ids, ['guardian_spirit'])) mult *= 1.4; // GS also increases healing taken substantially in spirit
  return mult;
}

/**
 * Raise max HP only — current HP stays put (intentional % drop / 「变残」).
 * MotW / Kings / Fortitude: stamina proxy lifts the ceiling without topping off.
 */
function bumpMaxHp(unit: Unit, mult: number, flag: string): void {
  if ((unit as any)[flag]) return;
  const before = unit.maxHp;
  if (!(before > 0)) return;
  const after = Math.round(before * mult);
  unit.maxHp = after;
  // Clamp only if somehow over new max; do NOT add the delta to current HP.
  unit.hp = Math.min(after, Math.max(0, unit.hp));
  (unit as any)[flag] = true;
}

function bumpMaxMp(unit: Unit, mult: number, flag: string): void {
  if ((unit as any)[flag]) return;
  const before = unit.maxMp ?? 0;
  if (!(before > 0)) return;
  const after = Math.round(before * mult);
  const delta = after - before;
  unit.maxMp = after;
  unit.mp = Math.min(after, (unit.mp ?? 0) + delta);
  const manaRes = unit.resources?.find(r => r.kind === 'MANA');
  if (manaRes) {
    manaRes.max = after;
    manaRes.current = Math.min(after, manaRes.current + delta);
  }
  (unit as any)[flag] = true;
}

/**
 * Raid buff resource proxies (stamina → HP, intellect → mana).
 * Idempotent per buff family via unit flags — safe to call on re-apply / refresh.
 */
export function applyStaminaRaidBuffHpBonus(unit: Unit, spellId: string): void {
  applyRaidBuffResourceBonuses(unit, spellId);
}

/**
 * MotW/Kings: +5% maxHp (current HP unchanged) & +5% MP;
 * Fort: +5% maxHp only; Arcane Brilliance: +10% MP.
 */
export function applyRaidBuffResourceBonuses(unit: Unit, spellId: string): void {
  const id = (spellId || '').toLowerCase();
  const isMotwOrKings =
    id.includes('mark_of_the_wild') || id.includes('blessing_of_kings') || id.includes('motw');
  const isFort = id.includes('power_word_fortitude') || id.includes('pw_fortitude');
  const isArcaneBrilliance = id.includes('arcane_brilliance');

  if (isMotwOrKings) {
    bumpMaxHp(unit, 1.05, '__sta_hp_motw_kings');
    bumpMaxMp(unit, 1.05, '__int_mp_motw_kings');
  }
  if (isFort) {
    bumpMaxHp(unit, 1.05, '__sta_hp_fort');
  }
  if (isArcaneBrilliance) {
    bumpMaxMp(unit, 1.1, '__int_mp_arcane_brilliance');
  }
}

export function describeDamageMitigation(unit: Unit, school: SpellSchool): {
  immune: boolean;
  multiplier: number;
} {
  const immune = unitHasImmunity(unit, school);
  return { immune, multiplier: getIncomingDamageMultiplier(unit, school) };
}

export type { Buff };
