// ============================================================
// Cata Raid Sim — Core TypeScript Data Structures (GDD §8.2)
// ============================================================

// ── Identity enums ──────────────────────────────────────────
export type ClassId =
  | 'DK'
  | 'DRUID'
  | 'SHAMAN'
  | 'MAGE'
  | 'ROGUE'
  | 'WARRIOR'
  | 'PALADIN'
  | 'HUNTER'
  | 'PRIEST'
  | 'WARLOCK';
export type RoleId  = 'TANK' | 'HEALER' | 'DPS';
export type SpellSchool = 'PHYSICAL' | 'FIRE' | 'FROST' | 'SHADOW' | 'NATURE' | 'ARCANE' | 'HOLY';

// ── Run phase state machine ──────────────────────────────────
export type RunPhase =
  | 'LOBBY'
  | 'TRAVEL_RECOVERY'
  | 'BOSS_COMBAT'
  | 'WIPE_VOTE'
  | 'SUMMARY';

// ── Resource ─────────────────────────────────────────────────
export type ResourceKind =
  | 'MANA'
  | 'ENERGY'
  | 'RUNE'
  | 'RUNIC_POWER'
  | 'COMBO_POINTS'
  | 'RAGE'
  | 'FOCUS'
  | 'HOLY_POWER';

export interface Resource {
  kind: ResourceKind;
  current: number;
  max: number;
}

/** DK rune slot state */
export interface RuneSlot {
  index: number;                        // 0-5
  runeType: 'BLOOD' | 'FROST' | 'UNHOLY';
  cooldownMs: number;                   // ms remaining (0 = ready)
  totalCdMs: number;                    // base 10 000 ms
}

// ── Buff / Debuff ─────────────────────────────────────────────
export type AuraKind = 'BUFF' | 'DEBUFF';
export type AuraTag  = 'HOT' | 'DOT' | 'SHIELD' | 'STAT' | 'CC' | 'TAUNT' | 'BLOODLUST' | 'DEBUFF';

export interface Buff {
  id: string;
  spellId: string;
  name: string;
  kind: AuraKind;
  tags: AuraTag[];
  sourceUnitId: string;
  targetUnitId: string;
  durationMs: number;       // total duration
  remainingMs: number;      // time left
  stacks: number;           // current stacks
  maxStacks: number;        // e.g. 3 for Lifebloom
  tickIntervalMs?: number;   // 0 = no tick
  tickElapsedMs?: number;
  /** heal per tick (HoT) or damage per tick (DoT) base value */
  tickValue?: number;
  school?: SpellSchool;
  /** e.g. 20% damage reduction */
  statModifiers?: Partial<UnitStats>;
  /** Each stack's independent remaining ms for rolling HoTs like Lifebloom */
  stackRemainingMs?: number[];
}

// ── Unit stats ────────────────────────────────────────────────
export interface UnitStats {
  attackPower: number;
  spellPower: number;
  critChance: number;        // 0-1 fraction
  haste: number;             // 0-1 fraction (e.g. 0.15 = 15% haste)
  armor: number;
  spellResist: number;
  block: number;             // 0-1
  parry: number;             // 0-1
  dodge: number;             // 0-1
  mastery: number;           // 0-1
  versatility: number;       // 0-1
  speed: number;
}

// ── Unit ─────────────────────────────────────────────────────
export interface Unit {
  id: string;
  name: string;
  classId: ClassId | 'BOSS' | 'NPC';
  spec?: string;
  role: RoleId | 'ENEMY';
  /** Local client controllable character (at most one per engine). */
  isPlayer: boolean;
  /**
   * Real human (local or remote). Host AI must skip these so multi-player
   * roster mates are not bot-driven.
   */
  isHumanControlled?: boolean;
  isPet?: boolean;
  ownerId?: string;
  isAlive: boolean;
  alive?: boolean;
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  energy?: number;
  rage?: number;
  runicPower?: number;
  focus?: number;
  holyPower?: number;
  comboPoints?: number;
  resources: Resource[];
  runes?: RuneSlot[];
  stats: UnitStats;
  buffs: Buff[];
  threatTable: ThreatEntry[];
  /** absorbed damage pool (e.g. Blood Shield) */
  absorb: number;
  position: { x: number; y: number };
  combatStats?: {
    damageDealt: number;
    healingDone: number;
    overhealDone: number;
    damageTaken: number;
    interruptCount: number;
    skillDamage?: Record<string, number>;
    skillHealing?: Record<string, number>;
  };
}

// ── Threat ────────────────────────────────────────────────────
export interface ThreatEntry {
  sourceUnitId: string;
  amount: number;
}

// ── Spell & SpellEffect ───────────────────────────────────────
export type SpellEffectKind =
  | 'DAMAGE'
  | 'HEAL'
  | 'SHIELD'
  | 'APPLY_BUFF'
  | 'APPLY_DEBUFF'
  | 'INTERRUPT'
  | 'TAUNT'
  | 'DISPEL'
  | 'RESURRECT'
  | 'RESOURCE_RESTORE'
  | 'SUMMON_GROUND_EFFECT';

export interface SpellEffect {
  kind: SpellEffectKind;
  school: SpellSchool;
  baseValue: number;         // damage / heal / resource amount
  valueVariance?: number;    // ± fraction
  /** ID of the buff/debuff template to apply */
  auraId?: string;
  durationMs?: number;
  tickIntervalMs?: number;
  maxStacks?: number;
  threatMultiplier?: number;
  dispelTypes?: string[];
  description?: string;
  groundEffectKind?: GroundEffect['kind'];
  /** Specify target resource for RESOURCE_RESTORE */
  resourceKind?: ResourceKind;
}

export interface Spell {
  id: string;
  name: string;
  classId: ClassId | 'BOSS';
  school: SpellSchool;
  targetType:
    | 'ENEMY'
    | 'FRIEND'
    | 'SELF'
    | 'AOE_ENEMY'
    | 'AOE_FRIEND'
    | 'SINGLE_ENEMY'
    | 'SINGLE_ALLY'
    | 'AOE_ALLY'
    | 'GROUND'
    | 'SMART_ALLY';
  castTimeMs: number;        // 0 = instant, -1 = channeled
  channelDurationMs?: number;
  gcdCategory: 'NORMAL' | 'ROGUE' | 'OFF_GCD';
  resourceCost: Partial<Record<ResourceKind, number>>;
  cooldownMs: number;
  description?: string;
  effects: SpellEffect[];
  /** rune types consumed (DK) */
  runesRequired?: Array<'BLOOD' | 'FROST' | 'UNHOLY'>;
  /** Max effective range in px (e.g. 80 for melee, 360 for ranged/heals) */
  range?: number;
  /** If true, cannot be cast in combat (e.g. Revive / Ancestral Spirit) */
  outOfCombatOnly?: boolean;
  /** Long-duration raid buff */
  isRaidBuff?: boolean;
}

export interface ClassSpecDef {
  id: string;
  name: string;
  role: RoleId;
  spells: Spell[];
}

export interface ClassDef {
  id: ClassId;
  name: string;
  colorHex: string;
  specs: ClassSpecDef[];
}

// ── Ground Effect ─────────────────────────────────────────────
export interface GroundEffect {
  id: string;
  kind: 'TOTEM' | 'HEAL_ZONE' | 'DAMAGE_ZONE' | 'CONE_WARNING';
  spellId: string;
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  colorHex: string;
  remainingMs: number;
  tickIntervalMs?: number;
  tickElapsedMs?: number;
  tickValue?: number;         // heal or damage per tick
}

// ── Ground Targeting Spell State ─────────────────────────────
export interface GroundTargetState {
  slotIdx: number;
  spellId: string;
  name: string;
  radius: number;
  color: string;
  maxRange: number;
}

export const GROUND_TARGET_SPELL_DEFS: Record<
  string,
  { radius: number; color: string; maxRange: number; name: string }
> = {
  death_and_decay: {
    name: '枯萎凋零',
    radius: 60,
    color: '#ef4444',
    maxRange: 320,
  },
  healing_rain: {
    name: '治疗之雨',
    radius: 60,
    color: '#38bdf8',
    maxRange: 320,
  },
  spirit_link: {
    name: '灵魂链接图腾',
    radius: 55,
    color: '#2dd4bf',
    maxRange: 280,
  },
  healing_tide: {
    name: '治疗之潮图腾',
    radius: 70,
    color: '#0ea5e9',
    maxRange: 280,
  },
  healing_tide_totem: {
    name: '治疗之潮图腾',
    radius: 70,
    color: '#0ea5e9',
    maxRange: 280,
  },
  mana_tide: {
    name: '法力之潮图腾',
    radius: 70,
    color: '#38bdf8',
    maxRange: 280,
  },
  mana_tide_totem: {
    name: '法力之潮图腾',
    radius: 70,
    color: '#38bdf8',
    maxRange: 280,
  },
  spirit_link_totem: {
    name: '灵魂链接图腾',
    radius: 55,
    color: '#2dd4bf',
    maxRange: 280,
  },
};

// ── Floating Combat Text ──────────────────────────────────────
export interface FloatingCombatText {
  id: string;
  targetId: string;
  sourceId?: string;
  text: string;
  category:
    | 'PHYS_NORMAL'
    | 'CRIT'
    | 'SPELL_FIRE'
    | 'SPELL_FROST'
    | 'SPELL_SHADOW'
    | 'SPELL_NATURE'
    | 'HEAL'
    | 'OVERHEAL'
    | 'INTERRUPT'
    | 'STATUS'
    | 'DAMAGE_AUTO'
    | 'DAMAGE_SKILL'
    | 'DAMAGE_DOT'
    | 'DAMAGE_TAKEN'
    | 'DODGE'
    | 'PARRY'
    | 'BLOCK'
    | 'RESIST'
    | 'ABSORB'
    | 'MISS'
    | 'IMMUNE'
    | string;
  isCrit: boolean;
  isFromPlayerOrPet?: boolean;
  isToPlayer?: boolean;
  xOffset?: number;
  createdAtMs: number;
}

// ── Encounter Report ──────────────────────────────────────────
export interface UnitCombatStats {
  unitId: string;
  name: string;
  classId: string;
  role: string;
  isPlayer: boolean;
  totalDamage: number;
  dps: number;
  totalHealing: number;
  hps: number;
  overhealPct: number;
  damageTaken: number;
  interrupts: number;
  deaths: number;
  skillDamage?: Record<string, number>;
  skillHealing?: Record<string, number>;
}

export interface EncounterReport {
  bossIndex: number;
  bossId: string;
  bossName: string;
  result: 'KILL' | 'WIPE' | 'BOSS_WIN';
  durationSec: number;
  wipesBeforeKill: number;
  unitStats: UnitCombatStats[];
  bossRemainingHpPct?: number;
  wipeCause?: string;
  firstDeath?: string;
}

// ── Dungeon Run Export ────────────────────────────────────────
export interface DungeonRunExport {
  dungeonId: string;
  dungeonName: string;
  exportedAtIso: string;
  totalDurationSec: number;
  encounters: EncounterReport[];
}

// ── Instance Tier Profile & Difficulty ─────────────────────────
export type DungeonDifficulty = 'NORMAL' | 'HEROIC' | 'CUSTOM';

export interface CustomDifficultySettings {
  // 玩家专属系数
  playerDamageCoeff: number;   // 玩家攻击系数
  playerHealingCoeff: number;  // 玩家治疗系数
  playerHpCoeff: number;       // 玩家血量系数
  playerMpCoeff: number;       // 玩家蓝量系数

  // 友方 AI 专属系数
  aiDamageCoeff: number;       // AI攻击系数
  aiHealingCoeff: number;      // AI治疗系数
  aiHpCoeff: number;           // AI血量系数
  aiMpCoeff: number;           // AI蓝量系数

  // 敌方 / BOSS 系数
  enemyDamageCoeff: number;    // 敌方攻击系数
  bossHpCoeff: number;         // BOSS血量系数
}

export const DEFAULT_CUSTOM_DIFFICULTY: CustomDifficultySettings = {
  playerDamageCoeff: 1.0,
  playerHealingCoeff: 1.0,
  playerHpCoeff: 1.0,
  playerMpCoeff: 1.0,
  aiDamageCoeff: 1.0,
  aiHealingCoeff: 1.0,
  aiHpCoeff: 1.0,
  aiMpCoeff: 1.0,
  enemyDamageCoeff: 1.0,
  bossHpCoeff: 1.0,
};

export interface InstanceTierProfile {
  tierId: string;              // e.g. 'cata_5h_346' | 'cata_ds_397'
  playerHpMult: number;        // surface HP multiplier
  playerOutputMult: number;    // damage/heal multiplier
  bossHpMult: number;
  bossDamageMult: number;
  difficultyPressure: number;  // ~1.0 for 5-man, ~1.2 for 20-man
  tankBaseHp: number;
  dpsHealerBaseHp: number;
  baseDps: number;
  baseHps: number;
}

// ── Combat Events (emitted by CombatEngine) ──────────────────
export type CombatEventKind =
  | 'DAMAGE'
  | 'HEAL'
  | 'DEATH'
  | 'SPELL_CAST'
  | 'BUFF_APPLIED'
  | 'BUFF_REMOVED'
  | 'INTERRUPT'
  | 'RESOURCE_CHANGE';

export interface CombatEvent {
  kind: CombatEventKind;
  sourceId: string;
  targetId: string;
  spellId?: string;
  value?: number;
  isCrit?: boolean;
  isDot?: boolean;
  overheal?: number;
  resourceKind?: ResourceKind;
  timestamp: number;
}


// ── User, Character, Keybindings, Rewards & Leaderboards ──────

export interface KeybindingMap {
  [slotIndex: number]: string; // slotIndex 0-35 -> key (e.g. '1', '2', 'Q', 'E', 'Shift+1')
}

export interface UiPosition {
  x: number;
  y: number;
}

export interface CharacterUiLayout {
  raidFrames?: (UiPosition & { width?: number; height?: number }) | null;
  actionBar?: UiPosition | null;
  playerFrame?: UiPosition | null;
  targetFrame?: UiPosition | null;
  statsPanel?: UiPosition | null;
}

export interface CharacterRecord {
  id: string;
  name: string;
  classId: ClassId;
  lastSpec: string;
  // Per-spec keybinding habit map: specId -> slotIndex -> hotkey
  specKeybindings: Record<string, KeybindingMap>;
  // Per-spec action slot layout: specId -> (slotIndex -> spellId)
  specSlotLayouts?: Record<string, Record<number, string>>;
  // Dungeon clear reward certificates
  clearCertificates: DungeonClearCertificate[];
  createdAtIso: string;
  /** Last local/server mutation time for LWW cross-client merge (ms epoch) */
  updatedAtMs?: number;
  // Raid target marks habit/persisted for team players: playerName -> mark string (e.g. '💀', '⭐')
  savedRaidMarks?: Record<string, string>;
  // Last selected dungeon tier ('5man' | '20man')
  lastDungeonTier?: '5man' | '20man';
  // Last selected dungeon difficulty ('NORMAL' | 'HEROIC' | 'CUSTOM')
  lastDungeonDifficulty?: DungeonDifficulty;
  // Last custom difficulty coefficients
  lastCustomDifficulty?: CustomDifficultySettings;
  // Per-character floating UI HUD layout (RaidFrames, Draggable ActionBar, etc.)
  uiLayout?: CharacterUiLayout;
}

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  characters: CharacterRecord[];
  createdAtIso: string;
  /** Last account-level mutation time for LWW cross-client merge (ms epoch) */
  updatedAtMs?: number;
}

export interface DungeonClearCertificate {
  id: string;
  dungeonId: string;
  dungeonName: string;
  clearedAtIso: string;
  characterName: string;
  characterClass: ClassId;
  characterSpec: string;
  totalDurationSec: number;
  encounters: EncounterReport[];
  characterStats: {
    totalDamage: number;
    dps: number;
    totalHealing: number;
    effectiveHealing: number;
    effectiveHps: number;
    overhealPct: number;
    damageTaken: number;
    interrupts: number;
    deaths: number;
  };
}

export type LeaderboardMetric = 'FAST_KILL' | 'MAX_DPS' | 'MAX_EFFECTIVE_HPS';

export interface LeaderboardEntry {
  id: string;
  characterName: string;
  characterClass: ClassId;
  characterSpec: string;
  dungeonId: string;
  bossId?: string;
  bossName?: string;
  metric: LeaderboardMetric;
  value: number; // For FAST_KILL: seconds (lower is better); For DPS/HPS: number (higher is better)
  unit: 'SEC' | 'DPS' | 'HPS';
  recordedAtIso: string;
  certificateId: string;
}
