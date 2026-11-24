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
export type AuraTag =
  | 'HOT'
  | 'DOT'
  | 'SHIELD'
  | 'STAT'
  | 'CC'
  | 'STUN'
  | 'SILENCE'
  | 'TAUNT'
  | 'BLOODLUST'
  | 'DEBUFF';

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
  /**
   * Multiplier applied to healing received while this aura is active (e.g. 0.25 = -75% healing).
   * For stacking auras like mortal_wound, engine may also derive from stacks when unset.
   */
  healingReceivedMod?: number;
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
  /**
   * Room-shared spawn identity: PLAYER/AI/PET/ADD/NPC/BOSS.
   * Synced via NetworkUnitSnapshot so guests keep pets/adds distinct.
   */
  unitKind?: 'PLAYER' | 'AI' | 'PET' | 'ADD' | 'NPC' | 'BOSS';
  /**
   * Engine elapsedMs when a timed summon (wolf / gargoyle / …) must despawn.
   * Host removes the unit; guests drop it when the next unit snapshot omits the id.
   */
  despawnAtElapsedMs?: number;
  /** Canonical short spell id that spawned this timed pet (e.g. feral_spirit). */
  summonSpellId?: string;
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
    /** Outgoing damage by skill display name */
    skillDamage?: Record<string, number>;
    /** Outgoing healing by skill display name */
    skillHealing?: Record<string, number>;
    /** Incoming damage by skill / swing that hit this unit */
    skillDamageTaken?: Record<string, number>;
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
  /** CONE_WARNING：朝向（弧度，atan2）；缺省朝左 Math.PI */
  facingRad?: number;
  /** CONE_WARNING：张开角（弧度）；缺省 60° = Math.PI/3 */
  coneAngleRad?: number;
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
    maxRange: 240, // 30 码点地（与描述一致）
  },
  /** 技能书 shortId / 引擎 id 别名，与 death_and_decay 相同点地逻辑 */
  dnd: {
    name: '枯萎凋零',
    radius: 60,
    color: '#ef4444',
    maxRange: 240,
  },
  dk_dnd: {
    name: '枯萎凋零',
    radius: 60,
    color: '#ef4444',
    maxRange: 240,
  },
  lightwell: {
    name: '圣光井',
    radius: 80, // ≈10 码
    color: '#10b981',
    maxRange: 320,
  },
  priest_lightwell: {
    name: '圣光井',
    radius: 80,
    color: '#10b981',
    maxRange: 320,
  },
  blizzard: {
    name: '暴风雪',
    radius: 80, // ≈10 码
    color: '#ef4444',
    maxRange: 320,
  },
  mage_blizzard: {
    name: '暴风雪',
    radius: 80,
    color: '#ef4444',
    maxRange: 320,
  },
  healing_rain: {
    name: '治疗之雨',
    radius: 60,
    color: '#10b981', // 治疗绿
    maxRange: 320, // 40 码点地
  },
  spirit_link: {
    name: '灵魂链接图腾',
    radius: 80, // ≈10 码图腾半径（40码=320）
    color: '#eab308', // 增益黄
    maxRange: 320,
  },
  healing_tide: {
    name: '治疗之潮图腾',
    radius: 320, // 40 码 = RANGE_40YD_PX（8px/码）
    color: '#10b981', // 治疗绿
    maxRange: 320,
  },
  healing_tide_totem: {
    name: '治疗之潮图腾',
    radius: 320, // 40 码 = RANGE_40YD_PX
    color: '#10b981',
    maxRange: 320,
  },
  shaman_healing_tide_totem: {
    name: '治疗之潮图腾',
    radius: 320, // 40 码 = RANGE_40YD_PX
    color: '#10b981',
    maxRange: 320,
  },
  mana_tide: {
    name: '法力之潮图腾',
    radius: 80,
    color: '#eab308', // 增益黄
    maxRange: 320,
  },
  mana_tide_totem: {
    name: '法力之潮图腾',
    radius: 80,
    color: '#eab308',
    maxRange: 320,
  },
  spirit_link_totem: {
    name: '灵魂链接图腾',
    radius: 80,
    color: '#eab308',
    maxRange: 320,
  },
  windfury_totem: {
    name: '风怒图腾',
    radius: 80,
    color: '#eab308', // 增益黄
    maxRange: 320,
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
  skillDamageTaken?: Record<string, number>;
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

export type RaidFramesUiLayout = UiPosition & { width?: number; height?: number };

/** Local combat canvas camera: top-down (default) vs faux-isometric orbit. */
export type CanvasViewMode = 'TOPDOWN' | 'ISO';

/** Canvas combat overlay toggles — persisted per character on the server. */
export interface CombatDisplayPrefs {
  /**
   * 画布视角：俯视（不可右键转镜） / 伪等距斜视（右键按住平滑无限转）。
   * 仅影响本机绘制与点选投影，不改变逻辑坐标与多人同步。
   */
  canvasViewMode: CanvasViewMode;
  /**
   * 2.5D 环绕（yaw）灵敏度倍率。默认 1.0，可调 ±50% → [0.5, 1.5]。
   * 仅影响本机右键水平拖动，不参与同步。
   */
  isoOrbitSensitivity: number;
  /**
   * 2.5D 俯仰灵敏度倍率。默认 1.0，可调 ±50% → [0.5, 1.5]。
   * 仅影响本机右键垂直拖动，不参与同步。
   */
  isoPitchSensitivity: number;
  /**
   * WASD / 方向键移动速度倍率。默认 1.0，可调 ±50% → [0.5, 1.5]。
   * 仅影响本机键盘移动，不参与同步。
   */
  moveSensitivity: number;
  /** 本人血条 / 名称 */
  showSelfHp: boolean;
  showSelfName: boolean;
  /** 全员（友方）血条 / 名称 */
  showAllHp: boolean;
  showAllNames: boolean;
  /** Boss 血条 / 名称 */
  showBossHp: boolean;
  showBossName: boolean;
  /** 当前目标（对象）血条 / 名称 */
  showTargetHp: boolean;
  showTargetName: boolean;
  /** 焦点血条 / 名称 */
  showFocusHp: boolean;
  showFocusName: boolean;
  /** 友方投掷物 / 近战切割 */
  showFriendlyProjectiles: boolean;
  showFriendlySlash: boolean;
  /** 敌方投掷物 / 近战切割 */
  showEnemyProjectiles: boolean;
  showEnemySlash: boolean;
  /** 治疗 / 加成 / 伤害地形光环 */
  showHealTerrain: boolean;
  showBuffTerrain: boolean;
  showDamageTerrain: boolean;
  /** 团队框架：名称 / buff / debuff / 常驻团 buff（爪、智、韧、王等） */
  showRaidFrameNames: boolean;
  showRaidFrameBuffs: boolean;
  showRaidFrameDebuffs: boolean;
  showRaidFrameStandingBuffs: boolean;
  /**
   * 氛围跳字范围（默认与旧客户端过滤一致：
   * 我的伤害 / 我的治疗 / 治疗于我 / 伤害于我 = 开；友方伤害 / 友方治疗 = 关）
   */
  showSctMyDamage: boolean;
  showSctMyHeal: boolean;
  showSctHealOnMe: boolean;
  showSctDamageOnMe: boolean;
  showSctAllyDamage: boolean;
  showSctAllyHeal: boolean;
  /** 2.5D: body foreshortens with pitch (less cardboard). */
  isoBodyPitchFx: boolean;
  /** Body Y-scale at min pitch (20deg); 1 at 90deg. */
  isoBodyPitchSquash: number;
  /** Foot shadow drawn in ground ISO space. */
  isoGroundShadow: boolean;
  /** Ground foot-shadow alpha. */
  isoShadowAlpha: number;
  /** Soft contact darkening under feet. */
  isoContactShade: boolean;
  /** Stronger 8-dir shoulder/depth volume. */
  isoOctantVolume: boolean;
  /** Side lighting from camera-relative sun. */
  isoSideLight: boolean;
  /** Side-light strength 0..1. */
  isoSideLightStrength: number;
  /** Fade distant ground by viewDepthKey. */
  isoDepthFog: boolean;
  /** Depth fog strength 0..1. */
  isoDepthFogStrength: number;
  /** Flying proj/AoE cast a ground shadow at landing height. */
  isoFxHeightShadow: boolean;
}


/** Defaults match prior hard-coded visibility (self/boss/target/focus nameplates + all FX/terrain). */
/** 2.5D orbit/pitch sensitivity: default 1.0, clamp ±50%. */
export const ISO_VIEW_SENSITIVITY_DEFAULT = 1;
export const ISO_VIEW_SENSITIVITY_MIN = 0.5;
export const ISO_VIEW_SENSITIVITY_MAX = 1.5;

export function clampIsoViewSensitivity(value: number): number {
  if (!Number.isFinite(value)) return ISO_VIEW_SENSITIVITY_DEFAULT;
  return Math.min(
    ISO_VIEW_SENSITIVITY_MAX,
    Math.max(ISO_VIEW_SENSITIVITY_MIN, value)
  );
}

/** Body pitch squash at 20deg look-down. */
export const ISO_BODY_PITCH_SQUASH_DEFAULT = 0.78;
export const ISO_BODY_PITCH_SQUASH_MIN = 0.6;
export const ISO_BODY_PITCH_SQUASH_MAX = 1;

export function clampIsoBodyPitchSquash(value: number): number {
  if (!Number.isFinite(value)) return ISO_BODY_PITCH_SQUASH_DEFAULT;
  return Math.min(ISO_BODY_PITCH_SQUASH_MAX, Math.max(ISO_BODY_PITCH_SQUASH_MIN, value));
}

/** Generic 0..1 strength slider (shadow / light / fog). */
export function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function clampIsoShadowAlpha(value: number): number {
  if (!Number.isFinite(value)) return 0.45;
  return Math.min(0.8, Math.max(0.15, value));
}

export function clampIsoSideLightStrength(value: number): number {
  if (!Number.isFinite(value)) return 0.35;
  return Math.min(0.7, Math.max(0.1, value));
}

export function clampIsoDepthFogStrength(value: number): number {
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(0.8, Math.max(0.1, value));
}

export const DEFAULT_COMBAT_DISPLAY_PREFS: CombatDisplayPrefs = {
  canvasViewMode: 'TOPDOWN',
  isoOrbitSensitivity: ISO_VIEW_SENSITIVITY_DEFAULT,
  isoPitchSensitivity: ISO_VIEW_SENSITIVITY_DEFAULT,
  moveSensitivity: ISO_VIEW_SENSITIVITY_DEFAULT,
  showSelfHp: true,
  showSelfName: true,
  showAllHp: false,
  showAllNames: false,
  showBossHp: true,
  showBossName: true,
  showTargetHp: true,
  showTargetName: true,
  showFocusHp: true,
  showFocusName: true,
  showFriendlyProjectiles: true,
  showFriendlySlash: true,
  showEnemyProjectiles: true,
  showEnemySlash: true,
  showHealTerrain: true,
  showBuffTerrain: true,
  showDamageTerrain: true,
  showRaidFrameNames: true,
  showRaidFrameBuffs: true,
  showRaidFrameDebuffs: true,
  showRaidFrameStandingBuffs: false,
  showSctMyDamage: true,
  showSctMyHeal: true,
  showSctHealOnMe: true,
  showSctDamageOnMe: true,
  showSctAllyDamage: false,
  showSctAllyHeal: false,
  isoBodyPitchFx: true,
  isoBodyPitchSquash: ISO_BODY_PITCH_SQUASH_DEFAULT,
  isoGroundShadow: true,
  isoShadowAlpha: 0.45,
  isoContactShade: true,
  isoOctantVolume: true,
  isoSideLight: true,
  isoSideLightStrength: 0.35,
  isoDepthFog: true,
  isoDepthFogStrength: 0.4,
  isoFxHeightShadow: true,
};

export function resolveCombatDisplayPrefs(
  partial?: Partial<CombatDisplayPrefs> | null
): CombatDisplayPrefs {
  const merged = { ...DEFAULT_COMBAT_DISPLAY_PREFS, ...(partial || {}) };
  merged.canvasViewMode = partial?.canvasViewMode === 'ISO' ? 'ISO' : 'TOPDOWN';
  merged.isoOrbitSensitivity = clampIsoViewSensitivity(merged.isoOrbitSensitivity as number);
  merged.isoPitchSensitivity = clampIsoViewSensitivity(merged.isoPitchSensitivity as number);
  merged.moveSensitivity = clampIsoViewSensitivity(merged.moveSensitivity as number);
  merged.isoBodyPitchFx = merged.isoBodyPitchFx !== false;
  merged.isoBodyPitchSquash = clampIsoBodyPitchSquash(merged.isoBodyPitchSquash as number);
  merged.isoGroundShadow = merged.isoGroundShadow !== false;
  merged.isoShadowAlpha = clampIsoShadowAlpha(merged.isoShadowAlpha as number);
  merged.isoContactShade = merged.isoContactShade !== false;
  merged.isoOctantVolume = merged.isoOctantVolume !== false;
  merged.isoSideLight = merged.isoSideLight !== false;
  merged.isoSideLightStrength = clampIsoSideLightStrength(merged.isoSideLightStrength as number);
  merged.isoDepthFog = merged.isoDepthFog !== false;
  merged.isoDepthFogStrength = clampIsoDepthFogStrength(merged.isoDepthFogStrength as number);
  merged.isoFxHeightShadow = merged.isoFxHeightShadow !== false;
  return merged;
}

export interface CharacterUiLayout {
  /** @deprecated Prefer raidFrames5man / raidFrames20man; kept for migrate. */
  raidFrames?: RaidFramesUiLayout | null;
  /** 5-man (影牙等) 团队框架位置与大小 */
  raidFrames5man?: RaidFramesUiLayout | null;
  /** 20-man (巨龙之魂等) 团队框架位置与大小 */
  raidFrames20man?: RaidFramesUiLayout | null;
  actionBar?: UiPosition | null;
  playerFrame?: UiPosition | null;
  targetFrame?: UiPosition | null;
  statsPanel?: UiPosition | null;
  /** 画布显示偏好（血条/名称/投掷物/地形） */
  combatDisplay?: CombatDisplayPrefs | null;
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
