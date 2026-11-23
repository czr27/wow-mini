// ============================================================
// Cata Raid Sim — Unified Cataclysm 10-Class & 30-Spec Registry
// Normalizes both legacy ClassSpec definitions (DK, DRUID, SHAMAN, MAGE, ROGUE)
// and modern ClassDef definitions (WARRIOR, PALADIN, HUNTER, PRIEST, WARLOCK)
// into a single authoritative catalog for Engine, Universal AI, and Web UI.
// ============================================================

import type { ClassDef, ClassId, ResourceKind, RoleId, Spell as ModernSpell, SpellSchool } from '../types.js';
import { GROUND_TARGET_SPELL_DEFS } from '../types.js';
import type { ClassSpec, Spell as LegacySpell } from './DeathKnight.js';
import { DEATH_KNIGHT } from './DeathKnight.js';
import { DRUID } from './Druid.js';
import { SHAMAN } from './Shaman.js';
import { MAGE } from './Mage.js';
import { ROGUE } from './Rogue.js';
import { WARRIOR } from './Warrior.js';
import { PALADIN } from './Paladin.js';
import { HUNTER } from './Hunter.js';
import { PRIEST } from './Priest.js';
import { WARLOCK } from './Warlock.js';
import { CLASS_SPECS_MAP } from '../room/RoomTypes.js';

/** Canvas px ≈ yards: 80≈10yd (melee/chain jump), 120≈15yd (Wild Growth), 200≈25yd, 240≈30yd splash, 320≈40yd cast/ground */
export const RANGE_MELEE_PX = 80;
export const RANGE_10YD_PX = 80;
export const RANGE_15YD_PX = 120;
export const RANGE_SHORT_PX = 200;
export const RANGE_30YD_PX = 240;
export const RANGE_40YD_PX = 320;

/** Convert yards → canvas px (40yd = 320px). */
export function yardsToPx(yards: number): number {
  return Math.round((yards / 40) * RANGE_40YD_PX);
}

/** Cata raid/party buffs: MotW / Arcane Brilliance / Fort / Kings = 30yd cast → whole raid. */
export function isRaidWideBuffSpellId(spellId: string): boolean {
  const id = (spellId || '').toLowerCase();
  return (
    id.includes('mark_of_the_wild') ||
    id.includes('arcane_brilliance') ||
    id.includes('power_word_fortitude') ||
    id.includes('blessing_of_kings') ||
    id.includes('blessing_of_might') ||
    id === 'pw_fortitude'
  );
}

/** Shout-style buffs: cast on self, ~30yd around caster (Horn / Battle Shout). */
export function isCasterRadiusRaidBuffSpellId(spellId: string): boolean {
  const id = (spellId || '').toLowerCase();
  return id.includes('horn_of_winter') || id.includes('battle_shout') || id.includes('commanding_shout');
}

function resolveSpellAoeMeta(opts: {
  spellId: string;
  shortId: string;
  targetType: NormalizedTargetType;
  school: SpellSchool;
  maxAoeTargets: number;
  isAOE: boolean;
  isRaidBuff?: boolean;
}): { aoeRadiusPx: number; aoeCenterMode: 'TARGET' | 'CASTER' | 'RAID' | 'NONE' } {
  const id = opts.spellId;
  const short = opts.shortId;

  // Raid-wide buffs (MotW): no splash radius — entire living raid
  if (opts.isRaidBuff || isRaidWideBuffSpellId(id) || isRaidWideBuffSpellId(short)) {
    if (isCasterRadiusRaidBuffSpellId(id) || isCasterRadiusRaidBuffSpellId(short)) {
      return { aoeRadiusPx: RANGE_30YD_PX, aoeCenterMode: 'CASTER' };
    }
    return { aoeRadiusPx: 0, aoeCenterMode: 'RAID' };
  }

  if (!opts.isAOE) return { aoeRadiusPx: 0, aoeCenterMode: 'NONE' };
  // 野性成长：选中目标为圆心，15 码溅射
  if (short === 'wild_growth' || id.includes('wild_growth')) {
    return { aoeRadiusPx: RANGE_15YD_PX, aoeCenterMode: 'TARGET' };
  }
  if (
    short === 'circle_of_healing' ||
    id.includes('circle_of_healing') ||
    short === 'prayer_of_healing' ||
    id.includes('prayer_of_healing') ||
    short === 'holy_radiance' ||
    id.includes('holy_radiance')
  ) {
    return { aoeRadiusPx: RANGE_30YD_PX, aoeCenterMode: 'TARGET' };
  }
  if (short === 'chain_heal' || id.includes('chain_heal')) {
    return { aoeRadiusPx: RANGE_10YD_PX, aoeCenterMode: 'TARGET' };
  }
  if (short === 'light_of_dawn' || id.includes('light_of_dawn')) {
    return { aoeRadiusPx: RANGE_30YD_PX, aoeCenterMode: 'CASTER' };
  }
  if (short === 'tranquility' || id.includes('tranquility')) {
    return { aoeRadiusPx: RANGE_40YD_PX, aoeCenterMode: 'CASTER' };
  }
  if (opts.targetType === 'AOE_ENEMY' && opts.school === 'PHYSICAL') {
    return { aoeRadiusPx: RANGE_MELEE_PX + 40, aoeCenterMode: 'CASTER' };
  }
  if (opts.targetType === 'SMART_ALLY' || opts.targetType === 'AOE_ALLY') {
    return { aoeRadiusPx: RANGE_30YD_PX, aoeCenterMode: 'TARGET' };
  }
  if (opts.targetType === 'GROUND') {
    return { aoeRadiusPx: 0, aoeCenterMode: 'NONE' };
  }
  return { aoeRadiusPx: RANGE_30YD_PX, aoeCenterMode: 'TARGET' };
}

function resolveSpellRangePx(opts: {
  classId: ClassId;
  spellId: string;
  shortId: string;
  targetType: NormalizedTargetType;
  school: SpellSchool;
  isInterrupt?: boolean;
  explicitRange?: number;
  isRaidBuff?: boolean;
}): number {
  if (opts.explicitRange && opts.explicitRange > 0) return opts.explicitRange;
  const ground =
    GROUND_TARGET_SPELL_DEFS[opts.shortId] ||
    GROUND_TARGET_SPELL_DEFS[opts.spellId] ||
    GROUND_TARGET_SPELL_DEFS[opts.spellId.replace(/^[^_]+_/, '')];
  if (ground) return ground.maxRange;
  if (opts.targetType === 'GROUND') return RANGE_40YD_PX;
  if (opts.isInterrupt) {
    // Kick / Pummel / Rebuke / Mind Freeze / Skull Bash = melee; others (Counterspell etc.) = short
    const meleeInterruptIds = new Set([
      'pummel',
      'kick',
      'rebuke',
      'mind_freeze',
      'skull_bash',
    ]);
    return meleeInterruptIds.has(opts.shortId) ? RANGE_MELEE_PX : RANGE_SHORT_PX;
  }
  if (isCasterRadiusRaidBuffSpellId(opts.spellId) || isCasterRadiusRaidBuffSpellId(opts.shortId)) {
    return 0;
  }
  if (opts.isRaidBuff || isRaidWideBuffSpellId(opts.spellId) || isRaidWideBuffSpellId(opts.shortId)) {
    return RANGE_30YD_PX;
  }
  const meleeClass =
    opts.classId === 'ROGUE' ||
    opts.classId === 'WARRIOR' ||
    opts.classId === 'DK' ||
    (opts.classId === 'PALADIN' && opts.targetType === 'SINGLE_ENEMY' && opts.school === 'PHYSICAL') ||
    (opts.classId === 'SHAMAN' && (opts.shortId.includes('stormstrike') || opts.shortId.includes('lava_lash'))) ||
    (opts.classId === 'DRUID' && (opts.shortId.includes('mangle') || opts.shortId.includes('shred') || opts.shortId.includes('swipe') || opts.shortId.includes('lacerate')));
  if (
    meleeClass &&
    opts.school === 'PHYSICAL' &&
    (opts.targetType === 'SINGLE_ENEMY' || opts.targetType === 'AOE_ENEMY')
  ) {
    return RANGE_MELEE_PX;
  }
  if (opts.targetType === 'SELF') return 0;
  return RANGE_40YD_PX;
}

export type NormalizedGcdCategory = 'NORMAL' | 'ROGUE' | 'OFF_GCD';

export type NormalizedTargetType =
  | 'SELF'
  | 'SINGLE_ENEMY'
  | 'SINGLE_ALLY'
  | 'AOE_ENEMY'
  | 'AOE_ALLY'
  | 'GROUND'
  | 'SMART_ALLY';

export interface NormalizedSpell {
  /** Full canonical engine ID, e.g. 'shaman_chain_heal', 'warrior_mortal_strike' */
  id: string;
  /** Short UI action-slot ID without class prefix, e.g. 'chain_heal', 'mortal_strike' */
  shortId: string;
  name: string;
  classId: ClassId;
  /** Canonical spec IDs from CLASS_SPECS_MAP (empty = shared across all specs of the class) */
  specIds: string[];
  school: SpellSchool;
  targetType: NormalizedTargetType;
  castTimeMs: number;
  channelDurationMs: number;
  gcdCategory: NormalizedGcdCategory;
  cooldownMs: number;
  resourceKind: ResourceKind | 'NONE';
  resourceCostAmount: number;
  runesRequired?: Array<'BLOOD' | 'FROST' | 'UNHOLY'>;

  // Semantic capability flags (used by Universal AI & Player Action executor)
  isAOE: boolean;
  maxAoeTargets: number;
  isHeal: boolean;
  isDamage: boolean;
  isDot: boolean;
  isHot: boolean;
  isShield: boolean;
  isInterrupt: boolean;
  isTaunt: boolean;
  isDispel: boolean;
  isResurrect: boolean;
  isOutOfCombatOnly: boolean;
  isResourceRestore: boolean;
  isBuff: boolean;
  isDefensive: boolean;
  isMajorCd: boolean;
  isRaidBuff: boolean;

  // Primary numerical effect metrics (Level 80 calibrated)
  directDamage: number;
  dotTotalDamage: number;
  directHeal: number;
  hotTotalHeal: number;
  shieldValue: number;
  resourceRestoreAmount: number;
  threatMultiplier: number;
  auraId?: string;
  durationMs: number;
  tickIntervalMs: number;
  /** Buff/Debuff 最大层数（如大地之盾 9 层） */
  maxStacks: number;
  groundKind?: 'TOTEM' | 'HEAL_ZONE' | 'DAMAGE_ZONE' | 'CONE_WARNING';
  groundColorHex?: string;
  groundRadius?: number;
  /**
   * Max cast/placement range in canvas pixels.
   * Convention: ~80 melee, ~200 short (25yd interrupts), ~320 ≈ 40 yards (heals / ground).
   */
  rangePx: number;
  /**
   * Multi-target splash / jump radius in px (0 = single-target or ground-handled).
   * Smart heals like Wild Growth / Circle of Healing: 240 ≈ 30yd around target.
   */
  aoeRadiusPx: number;
  /**
   * Who anchors multi-target effects:
   * TARGET / CASTER = spatial radius; RAID = entire living raid (MotW etc.); NONE = single.
   */
  aoeCenterMode: 'TARGET' | 'CASTER' | 'RAID' | 'NONE';
  dispelTypes?: string[];
  description: string;
}

export interface NormalizedClassSpec {
  id: string;
  name: string;
  role: RoleId;
  classId: ClassId;
  spells: NormalizedSpell[];
}

export interface NormalizedClass {
  id: ClassId;
  name: string;
  colorHex: string;
  primaryResource: ResourceKind;
  specs: NormalizedClassSpec[];
  allSpells: NormalizedSpell[];
}

// ── Prefix stripping & alias mapping ──────────────────────────

const CLASS_PREFIXES: Record<ClassId, string> = {
  DK: 'dk_',
  DRUID: 'druid_',
  SHAMAN: 'shaman_',
  MAGE: 'mage_',
  ROGUE: 'rogue_',
  WARRIOR: 'warrior_',
  PALADIN: 'paladin_',
  HUNTER: 'hunter_',
  PRIEST: 'priest_',
  WARLOCK: 'warlock_',
};

/** Legacy Web UI short-ID aliases mapped to canonical engine spell IDs */
const SHORT_ID_ALIASES: Record<string, string> = {
  spirit_link: 'shaman_spirit_link_totem',
  mana_tide: 'shaman_mana_tide_totem',
  healing_tide: 'shaman_healing_tide_totem',
  healing_tide_totem: 'shaman_healing_tide_totem',
  earth_shield: 'shaman_earth_shield',
  unleash_life: 'shaman_unleash_life',
  ascendance: 'shaman_ascendance',
  ancestral_guidance: 'shaman_ancestral_guidance',
  bloodlust: 'shaman_heroism',
  heroism: 'shaman_heroism',
  time_warp: 'mage_time_warp',
  icebound: 'dk_icebound_fortitude',
  ams: 'dk_anti_magic_shell',
  kidney_shot: 'rogue_kick',
  living_bomb: 'mage_living_bomb',
  pw_shield: 'priest_power_word_shield',
  pw_barrier: 'priest_power_word_barrier',
  pw_fortitude: 'priest_power_word_fortitude',
  sw_pain: 'priest_shadow_word_pain',
  sw_death: 'priest_shadow_word_death',
  spell_lock: 'warlock_fel_hunter_spell_lock',
};

export function toShortSpellId(spellId: string, classId?: ClassId): string {
  if (!spellId) return spellId;
  if (classId) {
    const pref = CLASS_PREFIXES[classId];
    if (pref && spellId.startsWith(pref)) {
      return spellId.slice(pref.length);
    }
  }
  for (const pref of Object.values(CLASS_PREFIXES)) {
    if (spellId.startsWith(pref)) {
      return spellId.slice(pref.length);
    }
  }
  return spellId;
}

/**
 * All IDs that should share one cooldown for UI/network sync
 * (e.g. bloodlust ↔ heroism ↔ shaman_heroism).
 */
export function resolveCooldownSpellIds(
  spellId: string,
  preferredClassId?: ClassId | 'BOSS' | 'NPC'
): string[] {
  if (!spellId) return [];
  const ids = new Set<string>([spellId]);
  const aliased = SHORT_ID_ALIASES[spellId] ?? spellId;
  ids.add(aliased);
  const sp = getSpellByAnyId(spellId, preferredClassId);
  if (sp) {
    ids.add(sp.id);
    ids.add(sp.shortId);
    if (sp.auraId) ids.add(sp.auraId);
  }
  for (const [alias, canon] of Object.entries(SHORT_ID_ALIASES)) {
    if (ids.has(canon) || ids.has(alias)) {
      ids.add(alias);
      ids.add(canon);
    }
  }
  return [...ids].filter(Boolean);
}

/** 嗜血 / 英勇 / 时间扭曲 — raid-wide haste lust */
export function isBloodlustSpellId(spellId: string, preferredClassId?: ClassId | 'BOSS' | 'NPC'): boolean {
  const keys = resolveCooldownSpellIds(spellId, preferredClassId).map((k) => k.toLowerCase());
  return keys.some(
    (k) =>
      k === 'bloodlust' ||
      k === 'heroism' ||
      k === 'shaman_heroism' ||
      k === 'time_warp' ||
      k === 'mage_time_warp' ||
      k.includes('heroism') ||
      k.includes('time_warp') ||
      k.includes('bloodlust')
  );
}

function mapLegacySpecTagToCanonicalSpecs(classId: ClassId, specTag?: string): string[] {
  if (!specTag) return [];
  const up = specTag.toUpperCase();
  if (classId === 'DK') {
    if (up.includes('BLOOD')) return ['BLOOD'];
    if (up.includes('FROST')) return ['FROST'];
    if (up.includes('UNHOLY')) return ['UNHOLY'];
  } else if (classId === 'DRUID') {
    if (up.includes('RESTO')) return ['RESTORATION'];
    if (up.includes('BALANCE')) return ['BALANCE'];
    if (up.includes('FERAL') || up.includes('GUARDIAN')) return ['FERAL'];
  } else if (classId === 'SHAMAN') {
    if (up.includes('RESTO')) return ['RESTORATION'];
    if (up.includes('ELEMENTAL')) return ['ELEMENTAL'];
    if (up.includes('ENHANCE')) return ['ENHANCEMENT'];
  } else if (classId === 'MAGE') {
    if (up.includes('FIRE')) return ['FIRE'];
    if (up.includes('FROST') || up.includes('ICE')) return ['FROST'];
    if (up.includes('ARCANE')) return ['ARCANE'];
  } else if (classId === 'ROGUE') {
    if (up.includes('COMBAT')) return ['COMBAT'];
    if (up.includes('ASSASSIN')) return ['ASSASSINATION'];
    if (up.includes('SUBTLET')) return ['SUBTLETY'];
  }
  return [up];
}

function normalizeTargetType(tt: string): NormalizedTargetType {
  switch (tt) {
    case 'ENEMY':
    case 'SINGLE_ENEMY':
      return 'SINGLE_ENEMY';
    case 'FRIEND':
    case 'SINGLE_ALLY':
      return 'SINGLE_ALLY';
    case 'AOE_ENEMY':
      return 'AOE_ENEMY';
    case 'AOE_FRIEND':
    case 'AOE_ALLY':
      return 'AOE_ALLY';
    case 'GROUND':
      return 'GROUND';
    case 'SMART_ALLY':
      return 'SMART_ALLY';
    case 'SELF':
    default:
      return 'SELF';
  }
}

function mapLegacyResourceKind(cost: string): ResourceKind | 'NONE' {
  switch (cost) {
    case 'MANA': return 'MANA';
    case 'ENERGY': return 'ENERGY';
    case 'RUNIC_POWER': return 'RUNIC_POWER';
    case 'COMBO_POINT': return 'COMBO_POINTS';
    case 'RAGE': return 'RAGE';
    case 'FOCUS': return 'FOCUS';
    case 'HOLY_POWER': return 'HOLY_POWER';
    case 'BLOOD_RUNE':
    case 'FROST_RUNE':
    case 'UNHOLY_RUNE':
    case 'DEATH_RUNE':
      return 'RUNE';
    default:
      return 'NONE';
  }
}

const DEFENSIVE_SPELL_KEYWORDS = [
  'shield_wall', 'last_stand', 'vampiric_blood', 'icebound_fortitude', 'anti_magic_shell',
  'bone_shield', 'barkskin', 'frenzied_regeneration', 'divine_protection', 'ardent_defender', 'divine_shield',
  'deterrence', 'pain_suppression', 'guardian_spirit', 'dispersion', 'ice_block',
  'ice_barrier', 'feint', 'evasion', 'shamanistic_rage', 'power_word_barrier',
];

const RESURRECT_SPELL_IDS = new Set([
  'druid_revive',
  'druid_rebirth',
  'shaman_ancestral_spirit',
  'paladin_redemption',
  'priest_resurrection',
  'warlock_soulstone',
]);

/** Combat-usable battle rez (in-combat). Others are travel/OOC only. */
const BATTLE_REZ_SPELL_IDS = new Set([
  'druid_rebirth',
  'warlock_soulstone',
]);

function normalizeLegacySpell(classId: ClassId, sp: LegacySpell): NormalizedSpell {
  const shortId = toShortSpellId(sp.id, classId);
  const targetType = normalizeTargetType(sp.targetType);
  const gcdCategory: NormalizedGcdCategory =
    sp.gcdCategory ||
    (sp.gcdType === 'off' ? 'OFF_GCD' : sp.gcdType === 'rogue' ? 'ROGUE' : 'NORMAL');

  let directDamage = 0;
  let dotTotalDamage = 0;
  let directHeal = 0;
  let hotTotalHeal = 0;
  let shieldValue = 0;
  let resourceRestoreAmount = 0;
  let isInterrupt = false;
  let isTaunt = false;
  let isDispel = false;
  let isResurrect = RESURRECT_SPELL_IDS.has(sp.id);
  let isBuff = false;
  let auraId: string | undefined;
  let durationMs = 0;
  let tickIntervalMs = 0;
  let maxStacks = 1;
  let groundKind: NormalizedSpell['groundKind'];
  let groundColorHex: string | undefined;
  let groundRadius: number | undefined;
  const descParts: string[] = [];

  for (const eff of sp.effects) {
    if (eff.description) descParts.push(eff.description);
    const val = eff.baseValue ?? 0;
    const dur = eff.durationMs ?? 0;
    const tick = eff.tickIntervalMs ?? 0;
    const ticks = dur > 0 && tick > 0 ? Math.max(1, Math.floor(dur / tick)) : 1;
    if (eff.auraId && !auraId) auraId = eff.auraId;
    if (dur > durationMs) durationMs = dur;
    if (tick > 0 && tickIntervalMs === 0) tickIntervalMs = tick;
    if ((eff.maxStacks ?? 0) > maxStacks) maxStacks = eff.maxStacks ?? 1;

    switch (eff.type) {
      case 'PHYSICAL_DAMAGE':
      case 'SPELL_DAMAGE':
        directDamage += val;
        break;
      case 'DOT':
        dotTotalDamage += val * ticks;
        break;
      case 'HEAL':
        directHeal += val;
        break;
      case 'HOT':
        hotTotalHeal += val * ticks;
        break;
      case 'SHIELD':
        shieldValue += val;
        break;
      case 'INTERRUPT':
        isInterrupt = true;
        break;
      case 'TAUNT':
        isTaunt = true;
        break;
      case 'DISPEL':
        isDispel = true;
        break;
      case 'RESURRECT':
        isResurrect = true;
        break;
      case 'RESOURCE_RESTORE':
        resourceRestoreAmount += val;
        break;
      case 'BUFF':
        isBuff = true;
        // 叠层受击触发类护盾（如大地之盾）：按层数×单次回血计入 AI 治疗期望
        if ((eff.maxStacks ?? 0) > 1 && val > 0 && (sp.targetType === 'SINGLE_ALLY' || sp.targetType === 'SMART_ALLY')) {
          hotTotalHeal += val * (eff.maxStacks ?? 1);
        }
        break;
      case 'DEBUFF':
        // Debuff-only skills (Outbreak / Vendetta) must count as real effects, not empty shells
        isBuff = true;
        if (val > 0 && dur > 0 && tick > 0) {
          dotTotalDamage += val * ticks;
        }
        break;
      case 'GROUND_EFFECT':
        groundKind = eff.groundKind;
        groundColorHex = eff.groundColorHex;
        groundRadius = eff.groundRadius;
        if (eff.groundKind === 'HEAL_ZONE' && val > 0) {
          hotTotalHeal += val * ticks;
        } else if (eff.groundKind === 'DAMAGE_ZONE' && val > 0) {
          dotTotalDamage += val * ticks;
        } else if (eff.groundKind === 'TOTEM' && sp.id === 'shaman_mana_tide_totem') {
          resourceRestoreAmount += 11000;
        } else if (eff.groundKind === 'TOTEM' && sp.id === 'shaman_healing_tide_totem') {
          const ticks = Math.max(1, Math.floor((eff.durationMs ?? 10_000) / Math.max(1, eff.tickIntervalMs ?? 2_000)));
          hotTotalHeal += (eff.baseValue ?? 5200) * ticks;
          directHeal += (eff.baseValue ?? 5200) * 2; // AI burst scoring for major CD totem
        } else if (eff.groundKind === 'TOTEM' && sp.id === 'shaman_spirit_link_totem') {
          directHeal += 18000; // Raid stabilization value for AI scoring
        }
        break;
      default:
        break;
    }
  }

  // Handle channeled raid heals like Tranquility where value is per tick over channelDurationMs
  if (sp.castTimeMs === -1 && sp.channelDurationMs && directHeal > 0 && sp.id === 'druid_tranquility') {
    directHeal = Math.max(directHeal, 36000);
  }

  const isGroundHeal =
    groundKind === 'HEAL_ZONE' ||
    sp.id === 'shaman_spirit_link_totem' ||
    sp.id === 'shaman_healing_tide_totem';
  const isGroundDamage = groundKind === 'DAMAGE_ZONE';
  // 单体目标附带 HEAL_ZONE（如迅捷治愈→百花）仍按单体决策，不进群疗池
  const groundImpliesAoe =
    (isGroundHeal || isGroundDamage) &&
    targetType !== 'SINGLE_ALLY' &&
    targetType !== 'SELF';
  const isAOE =
    targetType === 'AOE_ENEMY' ||
    targetType === 'AOE_ALLY' ||
    targetType === 'SMART_ALLY' ||
    groundImpliesAoe ||
    sp.id === 'druid_wild_growth' ||
    sp.id === 'druid_tranquility' ||
    sp.id === 'mage_living_bomb' ||
    sp.id === 'dk_death_and_decay' ||
    sp.id === 'dk_blood_boil';

  const isHeal = (directHeal > 0 || hotTotalHeal > 0 || shieldValue > 0 || isGroundHeal) && !isResurrect;
  const isDamage = directDamage > 0 || dotTotalDamage > 0 || isGroundDamage;
  const isDefensive = DEFENSIVE_SPELL_KEYWORDS.some(k => sp.id.includes(k));
  const isMajorCd = sp.cooldownMs >= 45_000;
  const isOutOfCombatOnly = Boolean(
    sp.travelOnly || (isResurrect && !BATTLE_REZ_SPELL_IDS.has(sp.id))
  );

  const maxAoeTargets = !isAOE
    ? 1
    : sp.id === 'shaman_chain_heal'
    ? 4
    : sp.id === 'shaman_chain_lightning'
    ? 4
    : sp.id === 'druid_tranquility' || sp.id === 'shaman_spirit_link_totem'
    ? 10
    : sp.id === 'shaman_healing_tide_totem'
    ? 5
    : sp.id === 'shaman_healing_rain'
    ? 6
    : 5;

  return {
    id: sp.id,
    shortId,
    name: sp.name,
    classId,
    specIds: mapLegacySpecTagToCanonicalSpecs(classId, sp.spec),
    school: sp.school,
    targetType,
    castTimeMs: sp.castTimeMs === -1 ? (sp.channelDurationMs ?? 6000) : sp.castTimeMs,
    channelDurationMs: sp.castTimeMs === -1 ? (sp.channelDurationMs ?? 6000) : 0,
    gcdCategory,
    cooldownMs: sp.cooldownMs,
    resourceKind: mapLegacyResourceKind(sp.resourceCost),
    resourceCostAmount: sp.resourceCostAmount,
    runesRequired: sp.runesRequired,
    isAOE,
    maxAoeTargets,
    isHeal,
    isDamage,
    isDot: dotTotalDamage > 0,
    isHot: hotTotalHeal > 0,
    isShield: shieldValue > 0,
    isInterrupt,
    isTaunt,
    isDispel,
    isResurrect,
    isOutOfCombatOnly,
    isResourceRestore: resourceRestoreAmount > 0,
    isBuff,
    isDefensive,
    isMajorCd,
    isRaidBuff: Boolean(sp.isRaidBuff),
    directDamage,
    dotTotalDamage,
    directHeal,
    hotTotalHeal,
    shieldValue,
    resourceRestoreAmount,
    threatMultiplier: isTaunt ? 5.0 : sp.spec === 'BLOOD_TANK' ? 3.5 : 1.0,
    auraId,
    durationMs,
    tickIntervalMs,
    maxStacks,
    groundKind,
    groundColorHex,
    groundRadius,
    rangePx: resolveSpellRangePx({
      classId,
      spellId: sp.id,
      shortId,
      targetType,
      school: sp.school,
      isInterrupt,
      explicitRange: (sp as LegacySpell).range,
      isRaidBuff: Boolean(sp.isRaidBuff),
    }),
    ...resolveSpellAoeMeta({
      spellId: sp.id,
      shortId,
      targetType,
      school: sp.school,
      maxAoeTargets,
      isAOE: isAOE || Boolean(sp.isRaidBuff),
      isRaidBuff: Boolean(sp.isRaidBuff),
    }),
    description: descParts.join('；') || sp.name,
  };
}

function normalizeModernSpell(classId: ClassId, specId: string, sp: ModernSpell): NormalizedSpell {
  const shortId = toShortSpellId(sp.id, classId);
  const targetType = normalizeTargetType(sp.targetType);

  let resourceKind: ResourceKind | 'NONE' = 'NONE';
  let resourceCostAmount = 0;
  for (const [k, v] of Object.entries(sp.resourceCost || {})) {
    if (typeof v === 'number' && v > 0) {
      resourceKind = k as ResourceKind;
      resourceCostAmount = v;
      break;
    }
  }

  let directDamage = 0;
  let dotTotalDamage = 0;
  let directHeal = 0;
  let hotTotalHeal = 0;
  let shieldValue = 0;
  let resourceRestoreAmount = 0;
  let threatMultiplier = 1.0;
  let isInterrupt = false;
  let isTaunt = false;
  let isDispel = false;
  let isResurrect = RESURRECT_SPELL_IDS.has(sp.id);
  let isBuff = false;
  let auraId: string | undefined;
  let durationMs = 0;
  let tickIntervalMs = 0;
  let maxStacks = 1;
  let dispelTypes: string[] | undefined;

  for (const eff of sp.effects) {
    const val = eff.baseValue ?? 0;
    const dur = eff.durationMs ?? 0;
    const tick = eff.tickIntervalMs ?? 0;
    const ticks = dur > 0 && tick > 0 ? Math.max(1, Math.floor(dur / tick)) : 1;
    if (eff.auraId && !auraId) auraId = eff.auraId;
    if (dur > durationMs) durationMs = dur;
    if (tick > 0 && tickIntervalMs === 0) tickIntervalMs = tick;
    if ((eff.maxStacks ?? 0) > maxStacks) maxStacks = eff.maxStacks ?? 1;
    if (eff.threatMultiplier && eff.threatMultiplier > threatMultiplier) {
      threatMultiplier = eff.threatMultiplier;
    }
    if (eff.dispelTypes) dispelTypes = eff.dispelTypes;

    switch (eff.kind) {
      case 'DAMAGE':
        directDamage += val;
        break;
      case 'HEAL':
        directHeal += val;
        break;
      case 'SHIELD':
        shieldValue += val;
        break;
      case 'APPLY_DEBUFF':
        isBuff = true;
        if (val > 0 && dur > 0 && tick > 0) {
          dotTotalDamage += val * ticks;
        }
        break;
      case 'APPLY_BUFF':
        isBuff = true;
        if (val > 0 && dur > 0 && tick > 0 && (targetType === 'SINGLE_ALLY' || targetType === 'AOE_ALLY' || targetType === 'SELF')) {
          hotTotalHeal += val * ticks;
        }
        break;
      case 'INTERRUPT':
        isInterrupt = true;
        break;
      case 'TAUNT':
        isTaunt = true;
        break;
      case 'DISPEL':
        isDispel = true;
        break;
      case 'RESURRECT':
        isResurrect = true;
        break;
      case 'RESOURCE_RESTORE':
        resourceRestoreAmount += val;
        break;
      default:
        break;
    }
  }

  // Divine Hymn / Penance / Mind Flay / Mind Sear / Drain Soul channel or multi-pulse handling
  const isChanneled =
    sp.id === 'priest_divine_hymn' ||
    sp.id === 'priest_penance' ||
    sp.id === 'priest_mind_flay' ||
    sp.id === 'priest_mind_sear' ||
    sp.id === 'warlock_drain_soul' ||
    sp.id === 'warlock_rain_of_fire';

  const isAOE =
    targetType === 'AOE_ENEMY' ||
    targetType === 'AOE_ALLY' ||
    targetType === 'SMART_ALLY' ||
    sp.id === 'priest_power_word_barrier' ||
    sp.id === 'priest_divine_hymn' ||
    sp.id === 'priest_circle_of_healing' ||
    sp.id === 'priest_prayer_of_healing' ||
    sp.id === 'paladin_light_of_dawn' ||
    sp.id === 'paladin_holy_radiance';

  // Prayer of Mending & PW:Barrier count as heals/shields for Healer AI
  if (sp.id === 'priest_power_word_barrier' && shieldValue === 0 && directHeal === 0) {
    shieldValue = 28000;
  }

  const isHeal = (directHeal > 0 || hotTotalHeal > 0 || shieldValue > 0) && !isResurrect;
  const isDamage = directDamage > 0 || dotTotalDamage > 0;
  const isDefensive = DEFENSIVE_SPELL_KEYWORDS.some(k => sp.id.includes(k));
  const isMajorCd = sp.cooldownMs >= 45_000;
  const isOutOfCombatOnly = Boolean(sp.outOfCombatOnly || (isResurrect && sp.id !== 'warlock_soulstone'));
  const isRaidBuff = Boolean(
    sp.isRaidBuff ||
    sp.id === 'warrior_battle_shout' ||
    sp.id === 'paladin_blessing_of_kings' ||
    sp.id === 'priest_power_word_fortitude'
  );

  const maxAoeTargets = !isAOE
    ? 1
    : sp.id === 'priest_divine_hymn' || sp.id === 'priest_power_word_barrier'
    ? 10
    : sp.id === 'paladin_light_of_dawn' || sp.id === 'priest_circle_of_healing' || sp.id === 'priest_prayer_of_healing'
    ? 5
    : 6;

  return {
    id: sp.id,
    shortId,
    name: sp.name,
    classId,
    specIds: [specId],
    school: sp.school,
    targetType,
    castTimeMs: sp.castTimeMs,
    channelDurationMs: isChanneled ? sp.castTimeMs : 0,
    gcdCategory: sp.gcdCategory,
    cooldownMs: sp.cooldownMs,
    resourceKind,
    resourceCostAmount,
    runesRequired: sp.runesRequired,
    isAOE,
    maxAoeTargets,
    isHeal,
    isDamage,
    isDot: dotTotalDamage > 0,
    isHot: hotTotalHeal > 0,
    isShield: shieldValue > 0,
    isInterrupt,
    isTaunt,
    isDispel,
    isResurrect,
    isOutOfCombatOnly,
    isResourceRestore: resourceRestoreAmount > 0,
    isBuff,
    isDefensive,
    isMajorCd,
    isRaidBuff,
    directDamage,
    dotTotalDamage,
    directHeal,
    hotTotalHeal,
    shieldValue,
    resourceRestoreAmount,
    threatMultiplier,
    auraId,
    durationMs,
    tickIntervalMs,
    maxStacks,
    rangePx: resolveSpellRangePx({
      classId,
      spellId: sp.id,
      shortId,
      targetType,
      school: sp.school,
      isInterrupt,
      explicitRange: sp.range,
      isRaidBuff,
    }),
    ...resolveSpellAoeMeta({
      spellId: sp.id,
      shortId,
      targetType,
      school: sp.school,
      maxAoeTargets,
      isAOE: isAOE || isRaidBuff,
      isRaidBuff,
    }),
    dispelTypes,
    description: sp.description || sp.name,
  };
}

function getPrimaryResourceForClass(classId: ClassId): ResourceKind {
  switch (classId) {
    case 'DK': return 'RUNIC_POWER';
    case 'ROGUE': return 'ENERGY';
    case 'WARRIOR': return 'RAGE';
    case 'HUNTER': return 'FOCUS';
    case 'DRUID':
    case 'SHAMAN':
    case 'MAGE':
    case 'PALADIN':
    case 'PRIEST':
    case 'WARLOCK':
    default:
      return 'MANA';
  }
}

export function getClassPrimaryResource(classId: ClassId | 'BOSS' | 'NPC', specId?: string): ResourceKind {
  if (classId === 'BOSS' || classId === 'NPC') return 'MANA';
  if (classId === 'DRUID' && specId?.toUpperCase() === 'FERAL') {
    return 'ENERGY';
  }
  return getPrimaryResourceForClass(classId);
}

export function isMeleeClassSpec(classId: ClassId | 'BOSS' | 'NPC', specId?: string): boolean {
  if (classId === 'BOSS' || classId === 'NPC') return false;
  const sp = (specId || '').toUpperCase();
  if (classId === 'DK' || classId === 'ROGUE' || classId === 'WARRIOR') return true;
  if (classId === 'PALADIN') return sp !== 'HOLY';
  if (classId === 'SHAMAN') return sp === 'ENHANCEMENT';
  if (classId === 'DRUID') return sp === 'FERAL';
  return false;
}

function buildLegacyNormalizedClass(spec: ClassSpec): NormalizedClass {
  const allNormalized = spec.spells.map(s => normalizeLegacySpell(spec.classId, s));
  const canonicalSpecs = CLASS_SPECS_MAP[spec.classId] || [];

  const specs: NormalizedClassSpec[] = canonicalSpecs.map(cs => {
    const specSpells = allNormalized.filter(
      s => s.specIds.length === 0 || s.specIds.includes(cs.id)
    );
    return {
      id: cs.id,
      name: cs.name,
      role: cs.role,
      classId: spec.classId,
      spells: specSpells,
    };
  });

  return {
    id: spec.classId,
    name: spec.className,
    colorHex: spec.classColor,
    primaryResource: getPrimaryResourceForClass(spec.classId),
    specs,
    allSpells: allNormalized,
  };
}

function buildModernNormalizedClass(def: ClassDef): NormalizedClass {
  const spellMap = new Map<string, NormalizedSpell>();
  const specs: NormalizedClassSpec[] = def.specs.map(specDef => {
    const normalizedList: NormalizedSpell[] = [];
    for (const sp of specDef.spells) {
      const existing = spellMap.get(sp.id);
      if (existing) {
        if (!existing.specIds.includes(specDef.id)) {
          existing.specIds.push(specDef.id);
        }
        normalizedList.push(existing);
      } else {
        const norm = normalizeModernSpell(def.id, specDef.id, sp);
        spellMap.set(sp.id, norm);
        normalizedList.push(norm);
      }
    }
    return {
      id: specDef.id,
      name: specDef.name,
      role: specDef.role,
      classId: def.id,
      spells: normalizedList,
    };
  });

  return {
    id: def.id,
    name: def.name,
    colorHex: def.colorHex,
    primaryResource: getPrimaryResourceForClass(def.id),
    specs,
    allSpells: Array.from(spellMap.values()),
  };
}

// ── Build Master Registry ─────────────────────────────────────

export const ALL_CLASSES_NORMALIZED: Record<ClassId, NormalizedClass> = {
  DK: buildLegacyNormalizedClass(DEATH_KNIGHT),
  DRUID: buildLegacyNormalizedClass(DRUID),
  SHAMAN: buildLegacyNormalizedClass(SHAMAN),
  MAGE: buildLegacyNormalizedClass(MAGE),
  ROGUE: buildLegacyNormalizedClass(ROGUE),
  WARRIOR: buildModernNormalizedClass(WARRIOR),
  PALADIN: buildModernNormalizedClass(PALADIN),
  HUNTER: buildModernNormalizedClass(HUNTER),
  PRIEST: buildModernNormalizedClass(PRIEST),
  WARLOCK: buildModernNormalizedClass(WARLOCK),
};

export const ALL_CLASS_IDS: ClassId[] = [
  'DK',
  'DRUID',
  'SHAMAN',
  'MAGE',
  'ROGUE',
  'WARRIOR',
  'PALADIN',
  'HUNTER',
  'PRIEST',
  'WARLOCK',
];

const SPELL_BY_FULL_ID = new Map<string, NormalizedSpell>();
const SPELL_BY_SHORT_ID = new Map<string, NormalizedSpell>();

for (const cls of Object.values(ALL_CLASSES_NORMALIZED)) {
  for (const sp of cls.allSpells) {
    SPELL_BY_FULL_ID.set(sp.id, sp);
    if (!SPELL_BY_SHORT_ID.has(sp.shortId)) {
      SPELL_BY_SHORT_ID.set(sp.shortId, sp);
    }
  }
}

export function getNormalizedClass(classId: ClassId): NormalizedClass {
  return ALL_CLASSES_NORMALIZED[classId];
}

export function getSpellsForClassSpec(classId: ClassId | 'BOSS' | 'NPC', specId?: string): NormalizedSpell[] {
  if (classId === 'BOSS' || classId === 'NPC') return [];
  const cls = ALL_CLASSES_NORMALIZED[classId];
  if (!cls) return [];
  if (!specId) return cls.specs[0]?.spells ?? cls.allSpells;
  const up = specId.toUpperCase();
  const found = cls.specs.find(s => s.id.toUpperCase() === up);
  return found ? found.spells : (cls.specs[0]?.spells ?? cls.allSpells);
}

export function getAllSpellsForClass(classId: ClassId | 'BOSS' | 'NPC'): NormalizedSpell[] {
  if (classId === 'BOSS' || classId === 'NPC') return [];
  return ALL_CLASSES_NORMALIZED[classId]?.allSpells ?? [];
}

/**
 * Resolves any spell ID (canonical prefixed ID like 'shaman_chain_heal',
 * short UI ID like 'chain_heal', or legacy alias like 'spirit_link') to NormalizedSpell.
 */
export function getSpellByAnyId(id: string, preferredClassId?: ClassId | 'BOSS' | 'NPC'): NormalizedSpell | undefined {
  if (!id) return undefined;
  const aliased = SHORT_ID_ALIASES[id] ?? id;
  if (SPELL_BY_FULL_ID.has(aliased)) return SPELL_BY_FULL_ID.get(aliased);
  if (preferredClassId && preferredClassId !== 'BOSS' && preferredClassId !== 'NPC') {
    const prefixed = `${CLASS_PREFIXES[preferredClassId]}${id}`;
    if (SPELL_BY_FULL_ID.has(prefixed)) return SPELL_BY_FULL_ID.get(prefixed);
  }
  return SPELL_BY_SHORT_ID.get(id);
}

export function isOffGcdSpellId(id: string, preferredClassId?: ClassId | 'BOSS' | 'NPC'): boolean {
  const sp = getSpellByAnyId(id, preferredClassId);
  return sp ? sp.gcdCategory === 'OFF_GCD' : false;
}

export function getSpellGcdCategory(
  id: string,
  classId?: ClassId | 'BOSS' | 'NPC',
  specId?: string
): NormalizedGcdCategory {
  const sp = getSpellByAnyId(id, classId);
  if (sp) return sp.gcdCategory;
  // Fallback based on class/spec mechanics (Rogue, Hunter, Cat Druid, Unholy DK = 1.0s fixed GCD)
  if (
    classId === 'ROGUE' ||
    classId === 'HUNTER' ||
    (classId === 'DK' && specId?.toUpperCase() === 'UNHOLY') ||
    (classId === 'DRUID' && specId?.toUpperCase() === 'FERAL')
  ) {
    return 'ROGUE';
  }
  return 'NORMAL';
}

export function getSpellCooldownMs(id: string, preferredClassId?: ClassId | 'BOSS' | 'NPC'): number {
  return getSpellByAnyId(id, preferredClassId)?.cooldownMs ?? 0;
}

export function getSpellResourceCost(
  id: string,
  preferredClassId?: ClassId | 'BOSS' | 'NPC'
): { kind: ResourceKind | 'NONE'; amount: number } {
  const sp = getSpellByAnyId(id, preferredClassId);
  if (!sp) return { kind: 'NONE', amount: 0 };
  return { kind: sp.resourceKind, amount: sp.resourceCostAmount };
}
