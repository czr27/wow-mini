import type { Unit, Spell, CombatEvent, CombatEventKind, Buff, SpellSchool, DungeonDifficulty, CustomDifficultySettings, ResourceKind } from '../types.js';
import { DEFAULT_CUSTOM_DIFFICULTY } from '../types.js';
import { Calculator } from './Calculator.js';
import { ThreatManager } from './ThreatManager.js';
import { AuraManager } from './AuraManager.js';
import { ResourceManager } from './ResourceManager.js';
import { CooldownManager } from './CooldownManager.js';
import { EffectsManager } from './EffectsManager.js';
import {
  getHastedCastTimeMs,
  LEVEL_80_BOSS_DAMAGE_SCALE,
  HEROIC_DIFFICULTY_MULT,
  getDifficultyNumericMult,
} from './TierProfile.js';
import { classifySpellCastMode, getCastLifecyclePolicy, type SpellCastMode } from './CastLifecycle.js';
import { selectAoeHealTargets, selectRaidBuffTargets } from './AoeTargeting.js';
import {
  getSpellByAnyId,
  isCasterRadiusRaidBuffSpellId,
  isRaidWideBuffSpellId,
  RANGE_40YD_PX,
  toShortSpellId,
  yardsToPx,
} from '../classes/ClassRegistry.js';
import {
  applyRaidBuffResourceBonuses,
  applyStaminaRaidBuffHpBonus,
  getIncomingDamageMultiplier,
  getOutgoingDamageMultiplier,
  getUnitHaste,
  unitHasImmunity,
} from './BuffEffects.js';
import { CombatActionLog, type CombatActionEvent } from './CombatActionLog.js';
import {
  resolveUnitKind,
  spawnTimedSummons,
  tickTimedSummons,
  syncPetFollowPositions,
  isTimedSummonSpellId,
} from './UnitSpawn.js';

/** Collapse bounce / bloom / HoT / copy-heal label variants into one meter key. */
export function normalizeCombatSkillName(raw: string): string {
  return raw
    .replace(/[（(]第\d+跳[）)]/g, '')
    .replace(/\s*[（(]大绽放[）)]/g, '')
    .replace(/\s*[（(]HoT[）)]/gi, '')
    .replace(/\s*[（(]DoT[）)]/gi, '')
    .replace(/\s*[（(]\d+层[）)]/g, '')
    .replace(/\s*[（(]复制治疗[）)]/g, '')
    .trim();
}

const HAS_CJK = /[\u4e00-\u9fff]/;
const AURA_SUFFIX_RE = /_(?:dot|hot|buff|debuff|aura|channel|window|stun|slow|armor_bypass|disease_extend|reset|dup)$/i;

/**
 * Resolve a spell id / shortId / already-Chinese name into the meter display key.
 * Prefer SPELL_ID_TO_NAME, then ClassRegistry spell.name, so English ids like
 * `immolation` / `warlock_immolation` never leak into combat stats.
 */
export function resolveCombatSkillDisplayName(
  spellIdOrName: string | undefined,
  fallback = '普通攻击',
): string {
  if (!spellIdOrName) return fallback;
  const raw = String(spellIdOrName).trim();
  if (!raw) return fallback;
  if (HAS_CJK.test(raw)) return normalizeCombatSkillName(raw);

  const tryMapped = (id: string): string | undefined => {
    const hit = SPELL_ID_TO_NAME[id];
    return hit ? normalizeCombatSkillName(hit) : undefined;
  };

  const candidates = [raw];
  const short = toShortSpellId(raw);
  if (short && short !== raw) candidates.push(short);
  const stripped = raw.replace(AURA_SUFFIX_RE, '');
  if (stripped && stripped !== raw) candidates.push(stripped);
  const shortStripped = short ? short.replace(AURA_SUFFIX_RE, '') : '';
  if (shortStripped && !candidates.includes(shortStripped)) candidates.push(shortStripped);

  for (const id of candidates) {
    const mapped = tryMapped(id);
    if (mapped) return mapped;
  }
  for (const id of candidates) {
    const sp = getSpellByAnyId(id);
    if (sp?.name) return normalizeCombatSkillName(sp.name);
  }
  return normalizeCombatSkillName(raw);
}

export const SPELL_ID_TO_NAME: Record<string, string> = {
  // Druid
  rejuvenation: '回春术',
  lifebloom: '生命绽放',
  regrowth: '愈合',
  nourish: '滋养',
  healing_touch: '治疗之触',
  swiftmend: '迅捷治愈',
  wild_growth: '野性成长',
  tranquility: '宁静',
  wrath: '愤怒',
  starfire: '星火术',
  starsurge: '星涌术',
  moonfire: '月火术',
  sunfire: '日炎术',
  lacerate: '割伤',
  mangle: '裂伤',
  druid_mangle: '裂伤',
  druid_lacerate: '割伤',
  druid_shred: '撕碎',
  druid_rip: '割裂',
  druid_frenzied_regeneration: '狂暴回复',
  druid_growl: '低吼',
  shred: '撕碎',
  rip: '割裂',
  frenzied_regeneration: '狂暴回复',
  growl: '低吼',
  efflorescence: '百花齐放',
  rebirth: '复生',
  revive: '起死回生',
  // Shaman
  riptide: '激流',
  healing_wave: '治疗波',
  healing_surge: '治疗之涌',
  greater_healing_wave: '强效治疗波',
  chain_heal: '治疗链',
  healing_rain: '治疗之雨',
  healing_tide_totem: '治疗之潮图腾',
  shaman_healing_tide_totem: '治疗之潮图腾',
  earth_shield: '大地之盾',
  shaman_earth_shield: '大地之盾',
  unleash_life: '生命释放',
  shaman_unleash_life: '生命释放',
  ancestral_guidance: '先祖指引',
  shaman_ancestral_guidance: '先祖指引',
  ascendance: '升腾',
  shaman_ascendance: '升腾',
  ascendance_dup: '升腾',
  thunderstorm: '雷霆风暴',
  shaman_thunderstorm: '雷霆风暴',
  lightning_bolt: '闪电箭',
  chain_lightning: '闪电链',
  lava_burst: '熔岩爆裂',
  flame_shock: '烈焰震击',
  earth_shock: '大地震击',
  shaman_stormstrike: '风暴打击',
  shaman_lava_lash: '熔岩猛击',
  shaman_feral_spirit: '野性狼魂',
  shaman_shamanistic_rage: '萨满之怒',
  shaman_unleash_elements: '元素释放',
  stormstrike: '风暴打击',
  lava_lash: '熔岩猛击',
  feral_spirit: '野性狼魂',
  shamanistic_rage: '萨满之怒',
  unleash_elements: '元素释放',
  // Mage
  fireball: '火球术',
  pyroblast: '炎爆术',
  living_bomb: '活动炸弹',
  combustion: '燃烧',
  frostbolt: '寒冰箭',
  ice_lance: '冰枪术',
  deep_freeze: '深度冻结',
  frozen_orb: '寒冰宝珠',
  arcane_blast: '奥术冲击',
  arcane_missiles: '奥术飞弹',
  arcane_barrage: '奥术弹幕',
  arcane_power: '奥术强化',
  mage_arcane_blast: '奥术冲击',
  mage_arcane_missiles: '奥术飞弹',
  mage_arcane_barrage: '奥术弹幕',
  mage_arcane_power: '奥术强化',
  mage_ice_lance: '冰枪术',
  mage_deep_freeze: '深度冻结',
  // DK
  death_strike: '灵界打击',
  heart_strike: '心脏打击',
  blood_boil: '血液沸腾',
  death_and_decay: '死亡凋零',
  howling_blast: '凛风冲击',
  frost_strike: '冰霜打击',
  obliterate: '湮灭',
  rune_strike: '符文打击',
  dk_scourge_strike: '天灾打击',
  dk_festering_strike: '脓疮打击',
  dk_death_coil: '凋零缠绕',
  dk_dark_transformation: '黑暗突变',
  dk_summon_gargoyle: '召唤石像鬼',
  dk_army_of_the_dead: '亡者大军',
  scourge_strike: '天灾打击',
  festering_strike: '脓疮打击',
  death_coil: '凋零缠绕',
  dark_transformation: '黑暗突变',
  summon_gargoyle: '召唤石像鬼',
  army_of_the_dead: '亡者大军',
  // Rogue
  sinister_strike: '影袭',
  eviscerate: '刺骨',
  mutilate: '毁伤',
  envenom: '毒伤',
  rupture: '割裂',
  rogue_mutilate: '毁伤',
  rogue_envenom: '毒伤',
  rogue_rupture: '割裂',
  rogue_vendetta: '宿敌',
  rogue_shadow_dance: '暗影之舞',
  rogue_backstab: '背刺',
  rogue_ambush: '伏击',
  rogue_premeditation: '预谋',
  rogue_shadowstep: '暗影步',
  rogue_preparation: '伺机待发',
  vendetta: '宿敌',
  shadow_dance: '暗影之舞',
  backstab: '背刺',
  ambush: '伏击',
  premeditation: '预谋',
  shadowstep: '暗影步',
  preparation: '伺机待发',
  // Warrior
  mortal_strike: '致死打击',
  colossus_smash: '巨人打击',
  overpower: '压制',
  slam: '猛击',
  bladestorm: '剑刃风暴',
  execute: '斩杀',
  bloodthirst: '嗜血',
  raging_blow: '怒击',
  whirlwind: '旋风斩',
  berserker_rage: '狂暴之怒',
  shield_slam: '盾牌猛击',
  revenge: '复仇',
  devastate: '毁灭打击',
  thunder_clap: '雷霆一击',
  shockwave: '震荡波',
  taunt: '嘲讽',
  shield_wall: '盾墙',
  last_stand: '破釜沉舟',
  pummel: '拳击',
  battle_shout: '战斗怒吼',
  // Paladin
  holy_shock: '神圣震击',
  flash_of_light: '圣光闪现',
  holy_light: '圣光术',
  divine_light: '神圣之光',
  word_of_glory: '荣耀圣令',
  light_of_dawn: '黎明圣光',
  holy_radiance: '圣光普照',
  beacon_of_light: '圣光道标',
  divine_plea: '神圣恳求',
  cleanse: '清洁术',
  redemption: '救赎',
  shield_of_the_righteous: '正义盾击',
  avengers_shield: '复仇者之盾',
  hammer_of_the_righteous: '正义之锤',
  consecration: '奉献',
  hand_of_reckoning: '清算之手',
  divine_protection: '圣佑术',
  ardent_defender: '炽热防御者',
  divine_shield: '圣盾术',
  crusader_strike: '十字军打击',
  templars_verdict: '圣殿骑士的裁决',
  judgement: '审判',
  divine_storm: '神圣风暴',
  rebuke: '责难',
  avenging_wrath: '复仇之怒',
  blessing_of_kings: '王者祝福',
  // Hunter
  kill_command: '杀戮命令',
  cobra_shot: '眼镜蛇射击',
  steady_shot: '稳固射击',
  arcane_shot: '奥术射击',
  aimed_shot: '瞄准射击',
  chimera_shot: '奇美拉射击',
  explosive_shot: '爆炸射击',
  black_arrow: '黑箭',
  serpent_sting: '毒蛇钉刺',
  multi_shot: '多重射击',
  explosive_trap: '爆炸陷阱',
  kill_shot: '杀戮射击',
  bestial_wrath: '狂野怒火',
  rapid_fire: '急速射击',
  silencing_shot: '沉默射击',
  deterrence: '威慑',
  misdirection: '误导',
  // Priest
  power_word_shield: '真言术：盾',
  penance: '苦修',
  flash_heal: '快速治疗',
  heal: '治疗术',
  greater_heal: '强效治疗术',
  prayer_of_healing: '治疗祷言',
  circle_of_healing: '治疗之环',
  prayer_of_mending: '愈合祷言',
  divine_hymn: '神圣赞美诗',
  holy_word_sanctuary: '圣言术：佑',
  pain_suppression: '痛苦压制',
  power_word_barrier: '真言术：障',
  guardian_spirit: '守护之魂',
  power_infusion: '能量灌注',
  purify: '纯净术',
  dispel_magic: '驱散魔法',
  resurrection: '复活术',
  shadow_word_pain: '暗言术：痛',
  vampiric_touch: '吸血鬼之触',
  devouring_plague: '噬灵疫病',
  mind_blast: '心灵震爆',
  mind_flay: '精神鞭笞',
  mind_sear: '精神灼烧',
  shadow_word_death: '暗言术：灭',
  shadowfiend: '暗影魔',
  dispersion: '消散',
  silence: '沉默',
  power_word_fortitude: '真言术：韧',
  // Warlock
  corruption: '腐蚀术',
  bane_of_agony: '痛苦灾祸',
  unstable_affliction: '痛苦无常',
  haunt: '鬼影缠身',
  shadow_bolt: '暗影箭',
  drain_soul: '吸取灵魂',
  seed_of_corruption: '腐蚀之种',
  metamorphosis: '恶魔变形',
  hand_of_guldan: '古尔丹之手',
  immolation_aura: '献祭光环',
  hellfire: '地狱烈焰',
  immolate: '献祭',
  immolation: '献祭',
  warlock_immolation: '献祭',
  warlock_immolation_aura: '献祭光环',
  incinerate: '烧尽',
  conflagrate: '燃烧',
  chaos_bolt: '混乱之箭',
  shadowburn: '暗影灼烧',
  rain_of_fire: '火焰之雨',
  spell_lock: '法术封锁',
  life_tap: '生命分流',
  soulstone: '灵魂石',
  dark_intent: '黑暗意图',
  // Additional iconic class spells
  flamestorm: '烈焰风暴',
  blizzard: '暴风雪',
  arcane_explosion: '魔爆术',
  dragons_breath: '龙息术',
  scorch: '灼烧',
  icy_veins: '冰冷血脉',
  presence_of_mind: '气定神闲',
  mirror_image: '镜像',
  hurricane: '飓风',
  starfall: '星辰坠落',
  swipe: '横扫',
  thrash: '痛击',
  tree_of_life: '生命之树',
  survival_instincts: '生存本能',
  skull_bash: '迎头痛击',
  solar_beam: '日光术',
  fan_of_knives: '刀扇',
  killing_spree: '杀戮盛筵',
  tricks_of_the_trade: '嫁祸诀窍',
  smoke_bomb: '烟雾弹',
  fire_nova: '火焰新星',
  empower_rune_weapon: '符文武器增效',
  rallying_cry: '集结呐喊',
  recklessness: '鲁莽',
  die_by_the_sword: '剑在人在',
  shield_block: '盾牌格挡',
  lay_on_hands: '圣疗术',
  aura_mastery: '光环掌握',
  hand_of_sacrifice: '牺牲之手',
  hammer_of_wrath: '愤怒之锤',
  feign_death: '假死',
  readiness: '准备就绪',
  renew: '恢复',
  hymn_of_hope: '希望圣歌',
  vampiric_embrace: '吸血鬼的拥抱',
  unending_resolve: '不灭决心',
  death_coil_warlock: '死亡缠绕',
  // Boss
  asphyxiate: '窒息术',
  stay_of_execution: '暂缓处决',
  mend_rotten_flesh: '修补烂肉',
  calamity: '苦痛灾厄',
};

type EventHandler = (event: CombatEvent) => void;

/**
 * [E-02] CombatEngine — 20 Hz战斗循环主控制器
 *
 * 每50ms推进一次战斗状态：
 *  - Tick所有Buff/DoT/HoT
 *  - 恢复资源
 *  - 推进冷却
 *  - 处理AI行为队列
 *  - 分发战斗事件
 */
export class CombatEngine {
  private units: Map<string, Unit> = new Map();
  private spellBook: Map<string, Spell> = new Map();
  private eventHandlers: Map<CombatEventKind | '*', EventHandler[]> = new Map();
  private pendingCasts: Array<{
    casterId: string;
    spell: Spell;
    targetId: string;
    remainingMs: number;
    totalMs: number;
    mode: SpellCastMode;
    costsToDeduct?: Array<{ kind: ResourceKind; cost: number }>;
    runesReq?: Array<'BLOOD' | 'FROST' | 'UNHOLY'>;
  }> = [];
  private schoolLockouts: Map<string, Map<SpellSchool, number>> = new Map();
  private earthShieldLastProcMs: Map<string, number> = new Map();
  private elapsedMs = 0;

  /** 影牙1号等首领战窒息术后安全治疗窗口剩余时长 (ms)，在此期间首领无法对友方造成任何伤害 */
  public bossHealingGraceRemainingMs = 0;

  /** 挑战难度与自定义系数 */
  public difficulty: DungeonDifficulty = 'HEROIC';
  public customDifficulty: CustomDifficultySettings = { ...DEFAULT_CUSTOM_DIFFICULTY };

  readonly calculator: Calculator;
  readonly threatManager: ThreatManager;
  readonly auraManager: AuraManager;
  readonly resourceManager: ResourceManager;
  readonly cooldownManager: CooldownManager;
  readonly effectsManager: EffectsManager;
  /** Host→guest action echo (cast/ground/summon) for FX sync */
  readonly actionLog: CombatActionLog;
  /** Optional hook so host UI can paint FX immediately when actions are logged */
  onCombatAction: ((ev: CombatActionEvent) => void) | null = null;

  private static readonly TICK_MS = 50; // 20 Hz

  constructor() {
    this.calculator    = new Calculator(this);
    this.threatManager = new ThreatManager();
    this.auraManager   = new AuraManager(this);
    this.resourceManager = new ResourceManager(this);
    this.cooldownManager = new CooldownManager();
    this.effectsManager  = new EffectsManager(this);
    this.actionLog       = new CombatActionLog();
  }

  /** Record a player/AI action for room FX sync (host only). */
  logCombatAction(partial: Omit<CombatActionEvent, 'id' | 'atMs'> & { id?: string; atMs?: number }): CombatActionEvent {
    const ev = this.actionLog.push(partial);
    try {
      this.onCombatAction?.(ev);
    } catch {
      /* UI hook must never break sim */
    }
    return ev;
  }

  /** Drain recent actions for the next COMBAT_STATE broadcast. */
  drainRecentActions(): CombatActionEvent[] {
    return this.actionLog.drain();
  }

  // ── Unit registry ────────────────────────────────────────────
  addUnit(unit: Unit): void {
    this.units.set(unit.id, unit);
    this.threatManager.registerUnit(unit.id);
  }

  removeUnit(id: string): void {
    this.units.delete(id);
  }

  getUnit(id: string): Unit | undefined {
    return this.units.get(id);
  }

  getAllUnits(): Unit[] {
    return Array.from(this.units.values());
  }

  getLivingUnits(): Unit[] {
    return this.getAllUnits().filter(u => u.isAlive);
  }

  // ── Spell book ───────────────────────────────────────────────
  registerSpell(spell: Spell): void {
    this.spellBook.set(spell.id, spell);
  }

  getSpell(id: string): Spell | undefined {
    return this.spellBook.get(id);
  }

  // ── Spell School Lockout ───────────────────────────────────────
  lockSchool(unitId: string, school: SpellSchool, durationMs: number): void {
    if (!this.schoolLockouts.has(unitId)) {
      this.schoolLockouts.set(unitId, new Map());
    }
    this.schoolLockouts.get(unitId)!.set(school, durationMs);
  }

  isSchoolLocked(unitId: string, school: SpellSchool): boolean {
    const schoolMap = this.schoolLockouts.get(unitId);
    if (!schoolMap) return false;
    return (schoolMap.get(school) ?? 0) > 0;
  }

  getSchoolLockoutRemaining(unitId: string, school: SpellSchool): number {
    const schoolMap = this.schoolLockouts.get(unitId);
    if (!schoolMap) return 0;
    return schoolMap.get(school) ?? 0;
  }

  // ── Tick ─────────────────────────────────────────────────────
  /**
   * Advance combat by deltaMs. Called by the host (browser rAF or Node setInterval)
   * which tracks wall-clock time. Internally processes in TICK_MS steps.
   */
  tick(deltaMs: number): void {
    let remaining = deltaMs;
    while (remaining > 0) {
      const step = Math.min(remaining, CombatEngine.TICK_MS);
      this.processTick(step);
      remaining -= step;
    }
  }

  private processTick(deltaMs: number): void {
    this.elapsedMs += deltaMs;

    // 0. Tick boss healing grace period (e.g. Baron Ashbury post-asphyxiate window)
    if (this.bossHealingGraceRemainingMs > 0) {
      this.bossHealingGraceRemainingMs = Math.max(0, this.bossHealingGraceRemainingMs - deltaMs);
    }

    // 1. Tick cooldowns
    this.cooldownManager.tick(deltaMs);

    // 1.5. Tick school lockouts
    for (const [, schoolMap] of this.schoolLockouts) {
      for (const [school, remaining] of schoolMap) {
        const next = Math.max(0, remaining - deltaMs);
        if (next <= 0) {
          schoolMap.delete(school);
        } else {
          schoolMap.set(school, next);
        }
      }
    }

    // 2. Tick resource regeneration
    this.resourceManager.tickAll(this.units, deltaMs);

    // 3. Tick auras (HoT / DoT / buff durations)
    this.auraManager.tickAll(this.units, deltaMs);

    // 4. Tick ground effects (totems / zones expire + splice out)
    this.effectsManager.tick(this.units, deltaMs);

    // 4.5 Timed summons expire; pets follow owners (positions → unit snapshots)
    tickTimedSummons(this);
    syncPetFollowPositions(this);

    // 5. Advance pending casts
    this.tickPendingCasts(deltaMs);
  }

  // ── Pending casts queue ───────────────────────────────────────
  private tickPendingCasts(deltaMs: number): void {
    const resolved: typeof this.pendingCasts = [];
    for (const cast of this.pendingCasts) {
      cast.remainingMs -= deltaMs;
      if (cast.remainingMs <= 0) {
        if (cast.mode === 'CASTED') {
          const caster = this.units.get(cast.casterId);
          if (!caster || (!caster.alive && !caster.isAlive)) continue;
          const costs = cast.costsToDeduct ?? [];
          if (!this.hasSpellResources(caster, costs, cast.runesReq)) continue;
          this.deductSpellResources(cast.casterId, caster, costs, cast.runesReq);
          this.cooldownManager.startSpellCooldownOnly(cast.casterId, cast.spell.id, cast.spell);
          this.resolveSpell(cast.casterId, cast.spell, cast.targetId);
        }
        // CHANNELED spells already deducted resources, entered CD, and started resolving on initiation
      } else {
        resolved.push(cast);
      }
    }
    this.pendingCasts = resolved;
  }

  private hasSpellResources(
    caster: Unit,
    costsToDeduct: Array<{ kind: ResourceKind; cost: number }>,
    runesReq?: Array<'BLOOD' | 'FROST' | 'UNHOLY'>
  ): boolean {
    for (const { kind, cost } of costsToDeduct) {
      const res = caster.resources?.find(r => r.kind === kind);
      const cur = res?.current ?? (
        kind === 'MANA' ? (caster.mp ?? 0) :
        kind === 'ENERGY' ? (caster.energy ?? 0) :
        kind === 'RAGE' ? (caster.rage ?? 0) :
        kind === 'FOCUS' ? (caster.focus ?? 0) :
        kind === 'HOLY_POWER' ? (caster.holyPower ?? 0) :
        kind === 'RUNIC_POWER' ? (caster.runicPower ?? 0) :
        kind === 'COMBO_POINTS' ? (caster.comboPoints ?? 0) : 0
      );
      if (cur < cost) return false;
    }
    if (runesReq && runesReq.length > 0) {
      const readyRunes = caster.runes?.filter(r => r.cooldownMs === 0) ?? [];
      if (readyRunes.length < runesReq.length) return false;
      const temp = [...readyRunes];
      for (const req of runesReq) {
        const idx = temp.findIndex(r => r.runeType === req);
        if (idx === -1) return false;
        temp.splice(idx, 1);
      }
    }
    return true;
  }

  private deductSpellResources(
    casterId: string,
    caster: Unit,
    costsToDeduct: Array<{ kind: ResourceKind; cost: number }>,
    runesReq?: Array<'BLOOD' | 'FROST' | 'UNHOLY'>
  ): void {
    for (const { kind, cost } of costsToDeduct) {
      const res = caster.resources?.find(r => r.kind === kind);
      if (res) {
        res.current -= cost;
      }
      if (kind === 'MANA') caster.mp = (caster.mp ?? res?.current ?? 0) - (res ? 0 : cost);
      else if (kind === 'ENERGY') caster.energy = (caster.energy ?? res?.current ?? 0) - (res ? 0 : cost);
      else if (kind === 'RAGE') caster.rage = (caster.rage ?? res?.current ?? 0) - (res ? 0 : cost);
      else if (kind === 'FOCUS') caster.focus = (caster.focus ?? res?.current ?? 0) - (res ? 0 : cost);
      else if (kind === 'HOLY_POWER') caster.holyPower = (caster.holyPower ?? res?.current ?? 0) - (res ? 0 : cost);
      else if (kind === 'RUNIC_POWER') caster.runicPower = (caster.runicPower ?? res?.current ?? 0) - (res ? 0 : cost);
      else if (kind === 'COMBO_POINTS') caster.comboPoints = (caster.comboPoints ?? res?.current ?? 0) - (res ? 0 : cost);

      if (res) {
        if (kind === 'MANA') caster.mp = res.current;
        else if (kind === 'ENERGY') caster.energy = res.current;
        else if (kind === 'RAGE') caster.rage = res.current;
        else if (kind === 'FOCUS') caster.focus = res.current;
        else if (kind === 'HOLY_POWER') caster.holyPower = res.current;
        else if (kind === 'RUNIC_POWER') caster.runicPower = res.current;
        else if (kind === 'COMBO_POINTS') caster.comboPoints = res.current;
      }

      this.emitEvent({
        kind: 'RESOURCE_CHANGE',
        sourceId: casterId,
        targetId: casterId,
        value: -cost,
        resourceKind: kind,
        timestamp: this.elapsedMs,
      });
    }

    if (runesReq && runesReq.length > 0) {
      this.resourceManager.consumeRunes(casterId, runesReq);
      const rpGain = runesReq.length * 10;
      this.resourceManager.restore(casterId, 'RUNIC_POWER', rpGain);
    }
  }

  private getSpellResourceCost(spell: Spell, kind: ResourceKind): number {
    if (!spell.resourceCost) return 0;
    if (typeof spell.resourceCost === 'object' && (spell.resourceCost as any)[kind] !== undefined) {
      return (spell.resourceCost as any)[kind] ?? 0;
    }
    const costType = (spell as any).resourceCost;
    const amount = (spell as any).resourceCostAmount ?? 0;
    if (costType === kind) return amount;
    if (costType === 'COMBO_POINT' && kind === 'COMBO_POINTS') return amount;
    return 0;
  }

  // ── Cast a spell ──────────────────────────────────────────────
  castSpell(casterId: string, spellId: string, targetId: string): boolean {
    const caster = this.units.get(casterId);
    const target = this.units.get(targetId);
    const spell  = this.spellBook.get(spellId);
    if (!caster || !caster.isAlive || !target || !spell) return false;

    // Hard CC (Asphyxiate airborne stun, etc.): cannot start new casts
    if (this.isUnitCrowdControlled(caster)) return false;

    if (!this.cooldownManager.canCastSpell(casterId, spell, caster)) return false;
    if (spell.school && this.isSchoolLocked(casterId, spell.school)) return false;

    // Check resource requirements across all consumable kinds
    const requiredKinds: ResourceKind[] = ['MANA', 'ENERGY', 'RAGE', 'FOCUS', 'HOLY_POWER', 'RUNIC_POWER', 'COMBO_POINTS'];
    const costsToDeduct: Array<{ kind: ResourceKind; cost: number }> = [];

    for (const kind of requiredKinds) {
      const cost = this.getSpellResourceCost(spell, kind);
      if (cost > 0) {
        const res = caster.resources ? caster.resources.find(r => r.kind === kind) : undefined;
        let cur = res?.current;
        if (cur === undefined) {
          if (kind === 'MANA') cur = caster.mp;
          else if (kind === 'ENERGY') cur = caster.energy;
          else if (kind === 'RAGE') cur = caster.rage;
          else if (kind === 'FOCUS') cur = caster.focus;
          else if (kind === 'HOLY_POWER') cur = caster.holyPower;
          else if (kind === 'RUNIC_POWER') cur = caster.runicPower;
          else if (kind === 'COMBO_POINTS') cur = caster.comboPoints;
        }
        if ((cur ?? 0) < cost) {
          return false;
        }
        costsToDeduct.push({ kind, cost });
      }
    }

    // Check DK Runes if required
    let runesReq: Array<'BLOOD' | 'FROST' | 'UNHOLY'> | undefined = spell.runesRequired ?? (spell as any).runesRequired;
    if (!runesReq || runesReq.length === 0) {
      const legacyCost = (spell as any).resourceCost;
      if (legacyCost === 'BLOOD_RUNE') runesReq = ['BLOOD'];
      else if (legacyCost === 'FROST_RUNE') runesReq = ['FROST'];
      else if (legacyCost === 'UNHOLY_RUNE') runesReq = ['UNHOLY'];
    }
    if (runesReq && runesReq.length > 0) {
      if (!caster.runes) return false;
      const readyRunes = caster.runes.filter(r => r.cooldownMs === 0);
      const temp = [...readyRunes];
      for (const req of runesReq) {
        const idx = temp.findIndex(r => r.runeType === req);
        if (idx === -1) return false;
        temp.splice(idx, 1);
      }
    }

    const castMode = classifySpellCastMode({
      spellId,
      castTimeMs: spell.castTimeMs,
      channelDurationMs: (spell as any).channelDurationMs,
    });
    const lifecycle = getCastLifecyclePolicy(castMode);

    // Deduct resources immediately ONLY for INSTANT & CHANNELED (CASTED defers until cast completion)
    if (lifecycle.deductResourceOnStart) {
      this.deductSpellResources(casterId, caster, costsToDeduct, runesReq);
    }

    // Start GCD + spell CD for INSTANT & CHANNELED; for CASTED start GCD only (spell CD starts on completion)
    if (lifecycle.triggerCooldownOnStart) {
      this.cooldownManager.startCooldown(casterId, spellId, spell, caster);
    } else if (lifecycle.triggerGcdOnStart) {
      this.cooldownManager.startGcdForSpell(casterId, spell, caster);
    }

    this.emitEvent({
      kind: 'SPELL_CAST',
      sourceId: casterId,
      targetId,
      spellId,
      timestamp: this.elapsedMs,
    });

    if (castMode === 'CASTED') {
      const hastedCastMs = getHastedCastTimeMs(spell.castTimeMs, getUnitHaste(caster, 0));
      this.pendingCasts.push({
        casterId,
        spell,
        targetId,
        remainingMs: hastedCastMs,
        totalMs: hastedCastMs,
        mode: 'CASTED',
        costsToDeduct,
        runesReq,
      });
    } else if (castMode === 'CHANNELED') {
      const baseChannelMs = (spell as any).channelDurationMs && (spell as any).channelDurationMs > 0
        ? (spell as any).channelDurationMs
        : (spell.castTimeMs > 0 ? spell.castTimeMs : 4000);
      const hastedChannelMs = getHastedCastTimeMs(baseChannelMs, getUnitHaste(caster, 0));
      this.pendingCasts.push({
        casterId,
        spell,
        targetId,
        remainingMs: hastedChannelMs,
        totalMs: hastedChannelMs,
        mode: 'CHANNELED',
      });
      this.resolveSpell(casterId, spell, targetId);
    } else {
      this.resolveSpell(casterId, spell, targetId);
    }
    return true;
  }

  getPendingCasts(): ReadonlyArray<{
    casterId: string;
    spellId: string;
    spellName: string;
    remainingMs: number;
    totalMs: number;
    mode: SpellCastMode;
    targetId: string;
  }> {
    return this.pendingCasts.map((c) => ({
      casterId: c.casterId,
      spellId: c.spell.id,
      spellName: c.spell.name || c.spell.id,
      remainingMs: c.remainingMs,
      totalMs: c.totalMs || c.remainingMs,
      mode: c.mode,
      targetId: c.targetId,
    }));
  }

  /** Interrupt a caster's current cast */
  interruptCast(casterId: string, lockoutMs = 4000): boolean {
    const idx = this.pendingCasts.findIndex(c => c.casterId === casterId);
    if (idx === -1) return false;
    const [interrupted] = this.pendingCasts.splice(idx, 1);
    if (interrupted.spell.school && interrupted.spell.school !== 'PHYSICAL' && lockoutMs > 0) {
      this.lockSchool(casterId, interrupted.spell.school, lockoutMs);
    }
    this.emitEvent({ kind: 'INTERRUPT', sourceId: casterId, targetId: casterId, timestamp: this.elapsedMs });
    return true;
  }

  // ── Resolve spell effects ─────────────────────────────────────
  private resolveSpell(casterId: string, spell: Spell, targetId: string): void {
    const caster = this.units.get(casterId);
    const target = this.units.get(targetId);
    if (!caster || !target) return;

    // Class-specific resource generation on cast resolve
    if (spell.classId === 'PALADIN') {
      if (spell.id === 'paladin_holy_shock' || spell.id === 'paladin_flash_of_light' || spell.id === 'paladin_crusader_strike') {
        this.resourceManager.restore(casterId, 'HOLY_POWER', 1);
      }
    } else if (spell.classId === 'DRUID') {
      if (spell.id === 'druid_mangle' || spell.id === 'druid_mangle_cat' || spell.id === 'druid_shred' || spell.id === 'druid_rake') {
        this.resourceManager.restore(casterId, 'COMBO_POINTS', 1);
      }
      if (spell.id === 'druid_rip' || spell.id === 'druid_ferocious_bite') {
        this.resourceManager.consume(casterId, 'COMBO_POINTS', caster.comboPoints ?? 0);
        caster.comboPoints = 0;
      }
    }

    for (const eff of spell.effects) {
      const effect = eff as any;
      let kind = effect.kind;
      let school: SpellSchool = effect.school ?? spell.school ?? 'PHYSICAL';

      if (!kind && effect.type) {
        if (effect.type === 'PHYSICAL_DAMAGE') {
          kind = 'DAMAGE';
          school = 'PHYSICAL';
        } else if (effect.type === 'SPELL_DAMAGE') {
          kind = 'DAMAGE';
          school = effect.school ?? spell.school ?? 'SHADOW';
        } else if (effect.type === 'HEAL') {
          kind = 'HEAL';
        } else if (effect.type === 'HOT') {
          kind = 'APPLY_HOT';
        } else if (effect.type === 'DOT') {
          kind = 'APPLY_DOT';
        } else if (effect.type === 'BUFF') {
          kind = 'APPLY_BUFF';
        } else if (effect.type === 'DEBUFF') {
          kind = 'APPLY_DEBUFF';
        } else if (effect.type === 'TAUNT') {
          kind = 'TAUNT';
        } else if (effect.type === 'INTERRUPT') {
          kind = 'INTERRUPT';
        } else if (effect.type === 'RESOURCE_RESTORE') {
          kind = 'RESOURCE_RESTORE';
        } else if (effect.type === 'GROUND_EFFECT') {
          kind = 'SUMMON_GROUND_EFFECT';
        } else if (effect.type === 'SHIELD') {
          kind = 'SHIELD';
        } else if (effect.type === 'DISPEL') {
          kind = 'DISPEL';
        } else if (effect.type === 'RESURRECT') {
          kind = 'RESURRECT';
        }
      }

      // Handle combo point builder auras
      if (effect.auraId === 'combo_point_add_1') {
        this.resourceManager.restore(casterId, 'COMBO_POINTS', 1);
      } else if (effect.auraId === 'combo_point_add_2') {
        this.resourceManager.restore(casterId, 'COMBO_POINTS', 2);
      }

      const baseValue = effect.baseValue ?? 0;
      const valueVariance = effect.valueVariance ?? 0.05;
      const durationMs = effect.durationMs ?? 0;
      const tickIntervalMs = effect.tickIntervalMs ?? 0;
      const auraId = effect.auraId as string | undefined;
      const maxStacks = effect.maxStacks ?? 1;

      const applyTimedAura = (
        auraTargetId: string,
        opts: {
          spellId: string;
          name: string;
          kind: 'BUFF' | 'DEBUFF';
          tags: Array<'HOT' | 'DOT' | 'SHIELD' | 'STAT'>;
          tickValue?: number;
          stacks?: number;
        }
      ) => {
        const auraTarget = this.units.get(auraTargetId);
        if (!auraTarget) return;
        // Prefer registered templates when present; otherwise apply from spell effect data
        if (auraId && this.auraManager.applyAuraById(auraId, casterId, auraTargetId)) {
          const applied = auraTarget.buffs.find(b => b.spellId === auraId && b.sourceUnitId === casterId);
          if (applied) {
            if (opts.tickValue && opts.tickValue > 0) applied.tickValue = opts.tickValue;
            if (opts.stacks) {
              applied.stacks = opts.stacks;
              applied.maxStacks = Math.max(applied.maxStacks || 1, opts.stacks);
            }
            if (durationMs > 0) {
              applied.durationMs = durationMs;
              applied.remainingMs = durationMs;
            }
            if (tickIntervalMs > 0) applied.tickIntervalMs = tickIntervalMs;
          }
          // Template path skips applyBuff — still apply MotW/Kings/Fort HP/MP bumps
          applyRaidBuffResourceBonuses(auraTarget, auraId || opts.spellId);
          return;
        }
        this.applyBuff(auraTarget, {
          id: `${opts.spellId}_${auraTargetId}_${this.elapsedMs}`,
          spellId: opts.spellId,
          name: opts.name,
          kind: opts.kind,
          tags: opts.tags,
          sourceUnitId: casterId,
          targetUnitId: auraTargetId,
          stacks: opts.stacks ?? 1,
          maxStacks: Math.max(maxStacks, opts.stacks ?? 1),
          durationMs: durationMs || 10_000,
          remainingMs: durationMs || 10_000,
          school,
          tickIntervalMs: tickIntervalMs || undefined,
          tickValue: opts.tickValue,
        });
      };

      switch (kind) {
        case 'DAMAGE': {
          const variance = 1 + (Math.random() * 2 - 1) * valueVariance;
          const base = baseValue * variance;

          let result: { damage: number; isCrit: boolean; blocked: boolean; absorbed: number };
          if (school === 'PHYSICAL') {
            result = this.calculator.calcPhysicalDamage(caster, target, base);
          } else {
            result = this.calculator.calcSpellDamage(caster, target, base, school);
          }

          this.applyDamage(casterId, targetId, result.damage, result.isCrit, spell.id, school);
          break;
        }

        case 'HEAL': {
          const variance = 1 + (Math.random() * 2 - 1) * valueVariance;
          const base = baseValue * variance;
          const healTargets = this.expandSmartHealTargets(caster, target, spell);
          for (const ht of healTargets) {
            const { healing, isCrit, overheal } = this.calculator.calcHealing(caster, ht, base);
            this.applyHeal(casterId, ht.id, healing, isCrit, overheal, spell.id);
          }
          break;
        }

        case 'SHIELD': {
          target.absorb = (target.absorb ?? 0) + baseValue;
          applyTimedAura(targetId, {
            spellId: auraId || spell.id,
            name: spell.name,
            kind: 'BUFF',
            tags: ['SHIELD'],
            stacks: maxStacks,
          });
          break;
        }

        case 'APPLY_HOT': {
          if (target.role === 'ENEMY') {
            applyTimedAura(casterId, {
              spellId: auraId || spell.id,
              name: `${spell.name} (HoT)`,
              kind: 'BUFF',
              tags: ['HOT'],
              tickValue: baseValue,
              stacks: 1,
            });
          } else {
            const hotTargets = this.expandSmartHealTargets(caster, target, spell);
            for (const ht of hotTargets) {
              applyTimedAura(ht.id, {
                spellId: auraId || spell.id,
                name: `${spell.name} (HoT)`,
                kind: 'BUFF',
                tags: ['HOT'],
                tickValue: baseValue,
                stacks: 1,
              });
            }
          }
          break;
        }

        case 'APPLY_DOT': {
          applyTimedAura(targetId, {
            spellId: auraId || spell.id,
            name: `${spell.name} (DoT)`,
            kind: 'DEBUFF',
            tags: ['DOT'],
            tickValue: baseValue,
            stacks: 1,
          });
          break;
        }

        case 'APPLY_BUFF':
        case 'APPLY_DEBUFF': {
          const isDebuff = kind === 'APPLY_DEBUFF';
          const isSelfBuff =
            spell.targetType === 'SELF' ||
            auraId === 'unleash_life' ||
            auraId === 'ascendance' ||
            auraId === 'ancestral_guidance';
          const stacks =
            auraId === 'earth_shield' || spell.id === 'shaman_earth_shield' ? Math.max(9, maxStacks) : 1;
          const isRaidBuff =
            Boolean((spell as any).isRaidBuff) ||
            isRaidWideBuffSpellId(spell.id) ||
            isCasterRadiusRaidBuffSpellId(spell.id);

          const applyOne = (buffTargetId: string) => {
            applyTimedAura(buffTargetId, {
              spellId: auraId || spell.id,
              name:
                auraId === 'earth_shield' || spell.id === 'shaman_earth_shield'
                  ? `${spell.name} (${stacks}层)`
                  : spell.name,
              kind: isDebuff ? 'DEBUFF' : 'BUFF',
              tags:
                auraId === 'earth_shield' || spell.id === 'shaman_earth_shield'
                  ? ['SHIELD']
                  : isDebuff
                  ? ['STAT']
                  : ['STAT'],
              tickValue: tickIntervalMs > 0 && baseValue > 0 ? baseValue : undefined,
              stacks,
            });
          };

          if (!isDebuff && isRaidBuff) {
            const recipients = selectRaidBuffTargets({
              spellId: spell.id,
              allies: this.friendlyUnits,
              caster,
              isRaidBuff: true,
            });
            for (const r of recipients) applyOne(r.id);
          } else {
            const buffTargetId = isDebuff
              ? targetId
              : isSelfBuff
              ? casterId
              : target.role === 'ENEMY'
              ? casterId
              : targetId;
            applyOne(buffTargetId);
          }
          break;
        }

        case 'INTERRUPT':
          this.interruptCast(targetId, 4000);
          this.emitEvent({ kind: 'INTERRUPT', sourceId: casterId, targetId, spellId: spell.id, timestamp: this.elapsedMs });
          break;

        case 'TAUNT': {
          // Non-tank AI must never taunt (Feral Growl etc. stay tank-role only)
          const isAiCaster = !caster.isPlayer && !caster.isHumanControlled;
          if (isAiCaster && caster.role !== 'TANK') break;
          this.threatManager.applyTaunt(targetId, casterId);
          break;
        }

        case 'RESOURCE_RESTORE': {
          let resKind = effect.resourceKind;
          if (!resKind) {
            if (spell.classId === 'WARRIOR') resKind = 'RAGE';
            else if (spell.classId === 'HUNTER') resKind = 'FOCUS';
            else if (spell.classId === 'PALADIN' && baseValue <= 3) resKind = 'HOLY_POWER';
            else resKind = 'MANA';
          }
          const isPersonalResource = resKind !== 'MANA';
          const restoreTargetId = (target.role === 'ENEMY' || (target.role as string) === 'BOSS' || !(target as any).isPlayer || spell.targetType === 'SELF' || isPersonalResource) ? casterId : targetId;
          this.resourceManager.restore(restoreTargetId, resKind, baseValue);
          break;
        }

        case 'RESURRECT':
          this.resurrectUnit(targetId, 0.35, 0.35);
          break;

        case 'SUMMON_GROUND_EFFECT': {
          const groundKind = effect.groundKind || effect.groundEffectKind;
          if (groundKind) {
            const isHealingTide =
              spell.id === 'shaman_healing_tide_totem' ||
              spell.id.includes('healing_tide');
            // Registry groundRadius is yards (HTT=40 → RANGE_40YD_PX); convert to canvas px.
            const radiusYd = isHealingTide
              ? 40
              : (effect.groundRadius ?? (groundKind === 'TOTEM' ? 10 : 8));
            const radiusPx = yardsToPx(radiusYd);
            this.effectsManager.addGroundEffect({
              id: `${spell.id}_${this.elapsedMs}`,
              kind: groundKind,
              spellId: isHealingTide ? 'healing_tide' : spell.id,
              ownerId: casterId,
              x: target.position?.x ?? caster.position?.x ?? 0,
              y: target.position?.y ?? caster.position?.y ?? 0,
              radius: radiusPx,
              colorHex: effect.groundColorHex ?? '#38BDF8',
              remainingMs: durationMs || 10_000,
              tickIntervalMs: tickIntervalMs || (isHealingTide ? 2_000 : 1_000),
              tickElapsedMs: 0,
              tickValue: baseValue || (isHealingTide ? 5200 : 0),
            });
          }
          break;
        }
      }
    }
  }

  /** Expand SMART/AOE ally heals (Wild Growth, Circle of Healing, …) to spatial targets. */
  private expandSmartHealTargets(caster: Unit, primary: Unit, spell: Spell): Unit[] {
    const tt = String(spell.targetType || '');
    const id = spell.id || '';
    const needsSplash =
      tt === 'SMART_ALLY' ||
      tt === 'AOE_ALLY' ||
      tt === 'AOE_FRIEND' ||
      id.includes('wild_growth') ||
      id.includes('circle_of_healing') ||
      id.includes('prayer_of_healing') ||
      id.includes('light_of_dawn') ||
      id.includes('tranquility') ||
      id.includes('holy_radiance');
    if (!needsSplash) return [primary];
    const picked = selectAoeHealTargets({
      spellId: id,
      allies: this.friendlyUnits,
      caster,
      primaryTarget: primary,
      maxAoeTargets: (spell as any).maxAoeTargets || 5,
      targetType: tt,
    });
    return picked.length > 0 ? picked : [primary];
  }

  /** Local-seat or networked human (host or guest). */
  private isHumanUnit(unit: Unit | undefined | null): boolean {
    return Boolean(unit && (unit.isPlayer || unit.isHumanControlled));
  }

  /** Outgoing FCT: human caster or pet owned by a human. */
  private isFromHumanOrPet(source: Unit | undefined | null): boolean {
    if (!source) return false;
    if (this.isHumanUnit(source)) return true;
    if (source.isPet || source.ownerId) {
      const owner = source.ownerId ? this.units.get(source.ownerId) : undefined;
      return this.isHumanUnit(owner);
    }
    return false;
  }

  // ── Damage application ────────────────────────────────────────
  applyDamage(
    sourceId: string,
    targetId: string,
    amount: number,
    isCrit: boolean,
    spellId?: string,
    school: SpellSchool = 'PHYSICAL',
    isDot = false,
  ): void {
    const target = this.units.get(targetId);
    if (!target || !target.isAlive) return;

    const source = this.units.get(sourceId);
    const isFromPlayerOrPet = this.isFromHumanOrPet(source);
    const isToPlayer = this.isHumanUnit(target);

    // 影牙1号窒息术后安全治疗窗口保护：若首领处于窒息后治疗窗口期，严格阻断来自首领/环境对友方的非窒息伤害
    if (this.bossHealingGraceRemainingMs > 0 && target.role !== 'ENEMY' && spellId !== '窒息术' && spellId !== 'asphyxiate') {
      const src = this.units.get(sourceId);
      if (!src || src.role === 'ENEMY' || src.id === this.bossUnit?.id) {
        return;
      }
    }

    // 无敌：圣盾 / 寒冰屏障 / 保护之手 / 威慑 等 → 伤害为 0
    if (unitHasImmunity(target, school)) {
      this.effectsManager.addFloatingText({
        id: `imm_${Date.now()}_${targetId}_${Math.random()}`,
        targetId,
        sourceId,
        text: '免疫',
        category: 'STATUS',
        isCrit: false,
        isToPlayer: isToPlayer || undefined,
        isFromPlayerOrPet: target.role === 'ENEMY' && isFromPlayerOrPet ? true : undefined,
        createdAtMs: Date.now(),
      });
      return;
    }

    // 萨满升腾(元素/增强/通用) 伤害增效 (+35%)
    let modifiedAmount = amount;
    if (
      source &&
      source.buffs?.some(
        b =>
          b.spellId === 'ascendance_ele' ||
          b.spellId === 'ascendance_enh' ||
          b.spellId === 'ascendance' ||
          b.spellId === 'shaman_ascendance'
      ) &&
      target.role === 'ENEMY'
    ) {
      modifiedAmount = Math.round(modifiedAmount * 1.35);
    }

    // 盗贼宿敌：对标记目标伤害 +20%
    if (
      source &&
      target.role === 'ENEMY' &&
      target.buffs?.some(
        b =>
          (b.spellId === 'vendetta_debuff' || b.spellId === 'vendetta' || b.spellId === 'rogue_vendetta') &&
          (!b.sourceUnitId || b.sourceUnitId === sourceId)
      )
    ) {
      modifiedAmount = Math.round(modifiedAmount * 1.20);
    }

    // 通用输出增幅（冰霜之柱 / 奥术强化 / 鲁莽等）
    if (source) {
      modifiedAmount = Math.round(modifiedAmount * getOutgoingDamageMultiplier(source));
    }

    // 减伤 aura：树皮 / 冰封 / 盾墙 / 痛苦压制 / 消散…
    const drMult = getIncomingDamageMultiplier(target, school);
    if (drMult < 1) {
      modifiedAmount = Math.round(modifiedAmount * drMult);
    }

    // Apply absorb shield
    let effective = modifiedAmount;
    let absorbedAmount = 0;
    if (target.absorb > 0) {
      absorbedAmount = Math.min(target.absorb, effective);
      target.absorb -= absorbedAmount;
      effective -= absorbedAmount;
    }

    if (absorbedAmount > 0) {
      if (isToPlayer) {
        this.effectsManager.addFloatingText({
          id: `abs_${Date.now()}_${targetId}_${Math.random()}`,
          targetId,
          sourceId,
          text: '吸收',
          category: 'ABSORB',
          isCrit: false,
          isToPlayer: true,
          createdAtMs: Date.now(),
        });
      } else if (target.role === 'ENEMY' && isFromPlayerOrPet) {
        this.effectsManager.addFloatingText({
          id: `abs_${Date.now()}_${targetId}_${Math.random()}`,
          targetId,
          sourceId,
          text: '吸收',
          category: 'ABSORB',
          isCrit: false,
          isFromPlayerOrPet: true,
          createdAtMs: Date.now(),
        });
      }
    }

    target.hp = Math.max(0, target.hp - effective);

    // Threat: 1:1 ratio for damage
    this.threatManager.addThreat(targetId, sourceId, effective);

    // 统一战斗统计更新（避免漏计）
    if (source) {
      if (!source.combatStats) {
        source.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
      }
      source.combatStats.damageDealt += effective;
      if (!source.combatStats.skillDamage) source.combatStats.skillDamage = {};
      const skillName = resolveCombatSkillDisplayName(spellId, '普通攻击');
      source.combatStats.skillDamage[skillName] = (source.combatStats.skillDamage[skillName] || 0) + effective;
    }
    if (!target.combatStats) {
      target.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
    }
    target.combatStats.damageTaken += effective;
    if (!target.combatStats.skillDamageTaken) target.combatStats.skillDamageTaken = {};
    {
      const takenName = resolveCombatSkillDisplayName(spellId, '普通攻击');
      target.combatStats.skillDamageTaken[takenName] =
        (target.combatStats.skillDamageTaken[takenName] || 0) + effective;
    }

    if (effective > 0) {
      if (isToPlayer) {
        // 打到人类玩家身上的伤害（客户端按 targetId 过滤本地）
        this.effectsManager.addFloatingText({
          id: `dmg_${Date.now()}_${targetId}_${Math.random()}`,
          targetId,
          sourceId,
          text: Math.round(effective).toLocaleString(),
          category: 'DAMAGE_TAKEN',
          isCrit,
          isToPlayer: true,
          createdAtMs: Date.now(),
        });
      } else if (target.role === 'ENEMY') {
        // 友方（人类/AI/宠物）对敌人的伤害；客户端按氛围跳字偏好过滤
        const sourceFriendly = Boolean(source && source.role !== 'ENEMY');
        if (isFromPlayerOrPet || sourceFriendly) {
          let cat = 'DAMAGE_SKILL';
          if (isDot) {
            cat = 'DAMAGE_DOT';
          } else if (spellId === '普通攻击' || spellId === 'auto_attack' || (school === 'PHYSICAL' && !spellId)) {
            cat = 'DAMAGE_AUTO';
          } else {
            cat = 'DAMAGE_SKILL';
          }
          this.effectsManager.addFloatingText({
            id: `dmg_${Date.now()}_${targetId}_${Math.random()}`,
            targetId,
            sourceId,
            text: Math.round(effective).toLocaleString(),
            category: cat,
            isCrit,
            isFromPlayerOrPet: isFromPlayerOrPet || undefined,
            createdAtMs: Date.now(),
          });
        }
      }
      // AI 队友受伤：默认不发；友方伤害跳字仅覆盖对怪输出
    }

    this.emitEvent({
      kind: 'DAMAGE',
      sourceId,
      targetId,
      spellId,
      value: effective,
      isCrit,
      isDot,
      timestamp: this.elapsedMs,
    });

    // Target generates Rage on taking damage (if has RAGE resource)
    if (target.resources?.some(r => r.kind === 'RAGE') && effective > 0) {
      const rageGain = Math.max(1, Math.min(20, Math.round((effective / target.maxHp) * 50)));
      this.resourceManager.restore(targetId, 'RAGE', rageGain);
    }
    // Attacker generates Rage on physical auto-attacks
    if (source && source.resources?.some(r => r.kind === 'RAGE') && (!spellId || spellId === '普通攻击' || spellId === 'auto_attack')) {
      this.resourceManager.restore(sourceId, 'RAGE', 10);
    }

    // ── 1. 大地之盾 (Earth Shield) 受击触发治疗（消耗 1 层，3 秒内置 CD） ──
    if (effective > 0 && target.hp > 0 && target.role !== 'ENEMY' && target.buffs?.length) {
      const esIdx = target.buffs.findIndex(
        b => b.spellId === 'earth_shield' || b.spellId === 'shaman_earth_shield'
      );
      if (esIdx !== -1) {
        const esBuff = target.buffs[esIdx];
        const lastProc = this.earthShieldLastProcMs.get(targetId) ?? -99999;
        if ((esBuff.stacks || 0) > 0 && this.elapsedMs - lastProc >= 3000) {
          this.earthShieldLastProcMs.set(targetId, this.elapsedMs);
          esBuff.stacks = Math.max(0, (esBuff.stacks || 1) - 1);
          const esCrit = Math.random() < 0.25;
          const esHeal = Math.round(6800 * (esCrit ? 1.5 : 1.0));
          const esSourceId = esBuff.sourceUnitId || targetId;
          this.applyHeal(esSourceId, targetId, esHeal, esCrit, 0, 'earth_shield', true);
          if (esBuff.stacks <= 0) {
            target.buffs.splice(esIdx, 1);
          }
        }
      }
    }

    // ── 2. 萨满大地之流 (Telluric Currents)：闪电链 / 闪电箭命中敌人回蓝 ──
    // Cata 元素天赋：闪电箭伤害的一部分转化为法力；本模拟按技能描述对闪电链同样生效。
    if (source && source.classId === 'SHAMAN' && target.role === 'ENEMY' && effective > 0 && spellId) {
      const spLower = spellId.toLowerCase();
      const isChainLightning =
        spLower === 'chain_lightning' ||
        spLower === 'shaman_chain_lightning' ||
        spellId === '闪电链';
      const isLightningBolt =
        spLower === 'lightning_bolt' ||
        spLower === 'shaman_lightning_bolt' ||
        spellId === '闪电箭';
      if ((isChainLightning || isLightningBolt) && (source.maxMp ?? 0) > 0) {
        const maxMp = source.maxMp || 45000;
        // 80 级满级标定：闪电箭约回 8% 最大法力（上限），闪电链每次命中约回 5%（上限）
        // 同时保底按伤害比例回蓝，避免低伤时几乎无回蓝体感。
        const manaGain = isChainLightning
          ? Math.max(Math.round(effective * 0.25), Math.min(Math.round(maxMp * 0.05), Math.round(effective * 0.40)))
          : Math.max(Math.round(effective * 0.30), Math.min(Math.round(maxMp * 0.08), Math.round(effective * 0.45)));
        source.mp = Math.min(maxMp, (source.mp ?? 0) + manaGain);
        const manaRes = source.resources?.find(r => r.kind === 'MANA');
        if (manaRes) {
          manaRes.current = source.mp;
          manaRes.max = maxMp;
        }
        this.effectsManager.addFloatingText({
          id: `tc_mana_${Date.now()}_${sourceId}_${Math.random()}`,
          targetId: sourceId,
          text: `💧 +${manaGain.toLocaleString()} 法力 (大地之流)`,
          category: 'STATUS',
          isCrit: false,
          isToPlayer: Boolean(source.isPlayer),
          createdAtMs: Date.now(),
        });
      }
    }

    // ── 3. 先祖指引 (Ancestral Guidance)：造成直接伤害的 40% 转化为智能群体治疗（最多 3 名伤员）──
    if (
      source &&
      !isDot &&
      effective > 0 &&
      target.role === 'ENEMY' &&
      source.buffs?.some(b => b.spellId === 'ancestral_guidance' || b.spellId === 'shaman_ancestral_guidance')
    ) {
      const injuredAllies = this.friendlyUnits
        .filter(u => u.isAlive && u.hp > 0 && u.hp < u.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
        .slice(0, 3);
      const targets = injuredAllies.length > 0 ? injuredAllies : this.friendlyUnits.filter(u => u.isAlive && u.hp > 0).slice(0, 3);
      if (targets.length > 0) {
        const totalConverted = Math.round(effective * 0.40);
        const perAlly = Math.max(1, Math.round(totalConverted / targets.length));
        for (const ally of targets) {
          this.applyHeal(sourceId, ally.id, perAlly, false, 0, 'ancestral_guidance', true);
        }
      }
    }

    // ── 4. 暗牧吸血鬼的拥抱 (Vampiric Embrace)：伤害的 25% 转化为群体治疗 ──
    if (
      source &&
      effective > 0 &&
      target.role === 'ENEMY' &&
      source.buffs?.some(b => b.spellId === 'vampiric_embrace' || b.spellId === 'priest_vampiric_embrace')
    ) {
      const injuredAllies = this.friendlyUnits
        .filter(u => u.isAlive && u.hp > 0 && u.hp < u.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
        .slice(0, 3);
      if (injuredAllies.length > 0) {
        const perAlly = Math.max(1, Math.round((effective * 0.25) / injuredAllies.length));
        for (const ally of injuredAllies) {
          this.applyHeal(sourceId, ally.id, perAlly, false, 0, 'vampiric_embrace', true);
        }
      }
    }

    if (target.hp <= 0) {
      this.killUnit(targetId);
    }
  }

  /** Healing-received multiplier from debuffs (Veil / Mortal Wound / explicit healingReceivedMod). */
  getHealingReceivedMultiplier(target: { buffs?: Buff[] }): number {
    let mult = 1;
    for (const b of target.buffs ?? []) {
      if (b.spellId === 'mortal_wound') {
        // Godfrey: ~10% less healing per stack (floor 5% received)
        mult *= Math.max(0.05, 1 - 0.1 * Math.max(1, b.stacks || 1));
        continue;
      }
      if (typeof b.healingReceivedMod === 'number' && Number.isFinite(b.healingReceivedMod)) {
        mult *= Math.max(0, b.healingReceivedMod);
        continue;
      }
      // Fallbacks when buffs were applied without healingReceivedMod
      if (
        b.spellId === 'cursed_veins' ||
        b.spellId === 'veil_of_shadow' ||
        b.spellId === 'cursed_veil' ||
        b.spellId === 'veil_of_shadows'
      ) {
        mult *= 0.25; // -75% healing
      }
    }
    return Math.max(0, Math.min(2, mult));
  }

  /** Restoration Ascendance heal-copy is resto-only (damage +35% remains for all specs). */
  private isRestoAscendanceActive(source: Unit): boolean {
    const buffs = source.buffs || [];
    if (buffs.some(b => b.spellId === 'ascendance_resto')) return true;
    const hasGeneric = buffs.some(
      b => b.spellId === 'ascendance' || b.spellId === 'shaman_ascendance'
    );
    if (!hasGeneric || source.classId !== 'SHAMAN') return false;
    const spec = String((source as { spec?: string; specId?: string }).spec
      || (source as { specId?: string }).specId
      || '').toUpperCase();
    if (spec === 'RESTORATION' || spec === 'RESTO' || spec === 'RESTO_HEAL') return true;
    if (!spec && source.role === 'HEALER') return true;
    return false;
  }

  // ── Heal application ──────────────────────────────────────────
  applyHeal(
    sourceId: string,
    targetId: string,
    amount: number,
    isCrit: boolean,
    overheal: number,
    spellId?: string,
    isDerived = false,
    /** HoT / ground-tick heals — still real healing, but not "direct" for UL / AG. */
    isPeriodic = false,
  ): void {
    const target = this.units.get(targetId);
    if (!target || !target.isAlive) return;

    const source = this.units.get(sourceId);
    let safeAmount = Math.max(0, amount);

    // Healing-received debuffs (always apply, including derived heals like beacon)
    if (safeAmount > 0) {
      const recvMult = this.getHealingReceivedMultiplier(target);
      if (recvMult !== 1) {
        safeAmount = Math.round(safeAmount * recvMult);
      }
    }

    // ── 真实治疗增效触发器（仅作用于非衍生直接治疗，避免循环触发）──
    if (!isDerived && safeAmount > 0 && source) {
      const spLower = (spellId || '').toLowerCase();
      // 1. 生命释放 (Unleash Life): 仅下一次直接治疗 +30%（HoT / 潮图腾跳字不消耗；治疗之雨由 EffectsManager 单独结算）
      if (
        !isPeriodic &&
        spLower !== 'unleash_life' &&
        spLower !== 'shaman_unleash_life' &&
        spellId !== '生命释放'
      ) {
        const ulIdx = source.buffs?.findIndex(
          b => b.spellId === 'unleash_life' || b.spellId === 'shaman_unleash_life'
        );
        if (ulIdx !== undefined && ulIdx !== -1) {
          safeAmount = Math.round(safeAmount * 1.30);
          source.buffs.splice(ulIdx, 1);
        }
      }
      // 2. 大地之盾 (Earth Shield): 目标受到该萨满治疗效果 +20%（含 HoT）
      if (
        target.buffs?.some(
          b => (b.spellId === 'earth_shield' || b.spellId === 'shaman_earth_shield') && (!b.sourceUnitId || b.sourceUnitId === sourceId)
        )
      ) {
        safeAmount = Math.round(safeAmount * 1.20);
      }
      // 3. 德鲁伊生命之树化身 (Tree of Life): 治疗量 +20%
      if (source.buffs?.some(b => b.spellId === 'tree_of_life' || b.spellId === 'druid_tree_of_life')) {
        safeAmount = Math.round(safeAmount * 1.20);
      }
    }

    const prevHp = Math.min(target.maxHp, Math.max(0, target.hp));
    target.hp = Math.min(target.maxHp, prevHp + safeAmount);
    const effectiveHeal = Math.max(0, target.hp - prevHp);
    const excess = Math.max(0, safeAmount - effectiveHeal);
    const finalOverheal = Math.max(0, overheal > 0 ? overheal : excess);

    // Threat: 0.5:1 ratio for effective healing
    this.threatManager.addThreat(
      /* pick first enemy */ this.getFirstEnemy(targetId) ?? '',
      sourceId,
      effectiveHeal * 0.5,
    );

    // 统一战斗统计更新（包含直接治疗与HoT跳字，严格保证非负）
    if (source) {
      if (!source.combatStats) {
        source.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
      }
      source.combatStats.healingDone = Math.max(0, (source.combatStats.healingDone || 0) + effectiveHeal);
      source.combatStats.overhealDone = Math.max(0, (source.combatStats.overhealDone || 0) + finalOverheal);
      if (!source.combatStats.skillHealing) source.combatStats.skillHealing = {};
      const skillName = resolveCombatSkillDisplayName(spellId, '治疗术');
      source.combatStats.skillHealing[skillName] = Math.max(
        0,
        (source.combatStats.skillHealing[skillName] || 0) + effectiveHeal
      );
    }

    const healToHuman = Boolean(target.isPlayer || target.isHumanControlled);
    // 友方目标治疗跳字（含 AI）；客户端按氛围跳字偏好过滤
    if (target.role !== 'ENEMY' && effectiveHeal > 0) {
      const healSource = this.units.get(sourceId);
      this.effectsManager.addFloatingText({
        id: `heal_${Date.now()}_${targetId}_${Math.random()}`,
        targetId,
        sourceId,
        text: `${Math.round(effectiveHeal).toLocaleString()}`,
        category: 'HEAL',
        isCrit,
        isToPlayer: healToHuman || undefined,
        isFromPlayerOrPet: this.isFromHumanOrPet(healSource) || undefined,
        createdAtMs: Date.now(),
      });
    }

    this.emitEvent({
      kind: 'HEAL',
      sourceId,
      targetId,
      spellId,
      value: safeAmount,
      isCrit,
      overheal: finalOverheal,
      timestamp: this.elapsedMs,
    });

    // ── 衍生复制治疗触发器（仅当 !isDerived 时触发，严格防递归死循环）──
    if (!isDerived && safeAmount > 0 && source) {
      // A. 升腾 (Ascendance - Restoration only): 100% 治疗量均摊复制给附近(40码)最多 5 名受伤友方
      if (this.isRestoAscendanceActive(source)) {
        const sx = source.position?.x ?? 0;
        const sy = source.position?.y ?? 0;
        const inRange = (u: Unit) => {
          const dx = (u.position?.x ?? 0) - sx;
          const dy = (u.position?.y ?? 0) - sy;
          return Math.hypot(dx, dy) <= RANGE_40YD_PX;
        };
        const injured = this.friendlyUnits
          .filter(u => u.isAlive && u.hp > 0 && u.hp < u.maxHp && inRange(u))
          .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
          .slice(0, 5);
        if (injured.length > 0) {
          const perAlly = Math.max(1, Math.round(safeAmount / injured.length));
          for (const ally of injured) {
            this.applyHeal(sourceId, ally.id, perAlly, false, 0, 'ascendance_dup', true);
          }
        }
      }

      // B. 先祖指引 (Ancestral Guidance): 仅直接治疗的 60%（HoT / 图腾跳字不触发）
      if (
        !isPeriodic &&
        source.buffs?.some(b => b.spellId === 'ancestral_guidance' || b.spellId === 'shaman_ancestral_guidance')
      ) {
        const injured = this.friendlyUnits
          .filter(u => u.isAlive && u.hp > 0 && u.hp < u.maxHp)
          .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))
          .slice(0, 3);
        const agTargets = injured.length > 0
          ? injured
          : this.friendlyUnits.filter(u => u.isAlive && u.hp > 0).slice(0, 3);
        if (agTargets.length > 0) {
          const perAlly = Math.max(1, Math.round((safeAmount * 0.60) / agTargets.length));
          for (const ally of agTargets) {
            this.applyHeal(sourceId, ally.id, perAlly, false, 0, 'ancestral_guidance', true);
          }
        }
      }

      // C. 圣光道标 (Beacon of Light): 对非道标目标的直接治疗复制 50% 给携带道标的友方
      const beaconCarrier = this.friendlyUnits.find(
        u =>
          u.id !== targetId &&
          u.isAlive &&
          u.hp > 0 &&
          u.buffs?.some(
            b => (b.spellId === 'beacon_of_light' || b.spellId === 'paladin_beacon_of_light') && (!b.sourceUnitId || b.sourceUnitId === sourceId)
          )
      );
      if (beaconCarrier) {
        const beaconAmt = Math.max(1, Math.round(safeAmount * 0.50));
        this.applyHeal(sourceId, beaconCarrier.id, beaconAmt, false, 0, 'beacon_of_light', true);
      }
    }
  }

  killUnit(unitId: string): void {
    const unit = this.units.get(unitId);
    if (!unit) return;
    unit.isAlive = false;
    unit.alive = false;
    unit.hp = 0;
    this.threatManager.onUnitDeath(unitId);
    this.auraManager.removeAllAuras(unitId);
    this.emitEvent({ kind: 'DEATH', sourceId: unitId, targetId: unitId, timestamp: this.elapsedMs });
  }

  /**
   * Resurrect a fallen party member
   */
  resurrectUnit(unitId: string, hpFraction = 0.35, mpFraction = 0.35): boolean {
    const unit = this.units.get(unitId);
    if (!unit || (unit.isAlive && unit.alive)) return false;
    unit.isAlive = true;
    unit.alive = true;
    unit.hp = Math.round(unit.maxHp * hpFraction);
    if (unit.maxMp) {
      unit.mp = Math.round(unit.maxMp * mpFraction);
    }
    this.emitEvent({ kind: 'HEAL', sourceId: unitId, targetId: unitId, value: unit.hp, isCrit: false, timestamp: this.elapsedMs });
    return true;
  }

  /**
   * Get boss's current target based on authentic threat table and OT thresholds
   */
  getBossTargetId(): string | undefined {
    const boss = this.bossUnit;
    if (!boss || (!boss.isAlive && !boss.alive)) return undefined;
    return this.threatManager.resolveTarget(
      boss.id,
      (uid) => {
        const u = this.units.get(uid);
        return !!(u && (u.isAlive ?? u.alive));
      },
      (uid) => {
        const u = this.units.get(uid);
        return u?.role === 'TANK' || u?.classId === 'ROGUE' || u?.classId === 'DK';
      }
    );
  }

  private getFirstEnemy(friendId: string): string | undefined {
    const friend = this.units.get(friendId);
    if (!friend) return undefined;
    // Rough heuristic: enemy is on the other side (role === 'ENEMY' vs non-enemy)
    for (const [id, u] of this.units) {
      if (u.role === 'ENEMY' && u.isAlive && friend.role !== 'ENEMY') return id;
      if (u.role !== 'ENEMY' && u.isAlive && friend.role === 'ENEMY') return id;
    }
    return undefined;
  }

  // ── Event system ──────────────────────────────────────────────
  on(kind: CombatEventKind | '*', handler: EventHandler): () => void {
    const list = this.eventHandlers.get(kind) ?? [];
    list.push(handler);
    this.eventHandlers.set(kind, list);
    return () => this.off(kind, handler);
  }

  off(kind: CombatEventKind | '*', handler: EventHandler): void {
    const list = this.eventHandlers.get(kind) ?? [];
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  emitEvent(event: CombatEvent): void {
    const specific = this.eventHandlers.get(event.kind) ?? [];
    const wildcard = this.eventHandlers.get('*') ?? [];
    for (const h of [...specific, ...wildcard]) h(event);
  }

  get elapsed(): number { return this.elapsedMs; }
  get nowMs(): number { return this.elapsedMs; }

  get friendlyUnits(): Unit[] {
    return Array.from(this.units.values()).filter(u => u.role !== 'ENEMY');
  }

  get enemyUnits(): Unit[] {
    return Array.from(this.units.values()).filter(u => u.role === 'ENEMY');
  }

  get allUnits(): Unit[] {
    return Array.from(this.units.values());
  }

  get bossUnit(): Unit | undefined {
    return Array.from(this.units.values()).find(u => u.role === 'ENEMY');
  }

  spawnBoss(id: string, name: string, hp: number): Unit {
    // Remove old boss if any
    for (const [uid, u] of this.units.entries()) {
      if (u.role === 'ENEMY') {
        this.units.delete(uid);
      }
    }
    // Dungeon configs store 英雄本预算血量；普通本除回 HEROIC_DIFFICULTY_MULT，自定义走 coeff。
    let finalHp = hp;
    if (this.difficulty === 'CUSTOM') {
      finalHp = Math.max(1000, Math.round(hp * (this.customDifficulty.bossHpCoeff ?? 1.0)));
    } else if (this.difficulty === 'NORMAL') {
      finalHp = Math.max(1000, Math.round(hp / HEROIC_DIFFICULTY_MULT));
    }
    const boss: Unit = {
      id,
      name,
      classId: 'BOSS',
      role: 'ENEMY',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: finalHp,
      maxHp: finalHp,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 450, y: 220 },
      stats: {
        attackPower: 3000,
        spellPower: 3000,
        critChance: 0.05,
        haste: 0,
        armor: 12000,
        spellResist: 0,
        block: 0,
        parry: 0,
        dodge: 0,
        mastery: 0,
        versatility: 0,
        speed: 1,
      },
    };
    this.addUnit(boss);
    return boss;
  }

  resetCooldowns(): void {
    this.cooldownManager.reset();
  }

  /** 首领当前是否处于窒息术后安全治疗保护窗口期 */
  isBossHealingGraceActive(): boolean {
    return this.bossHealingGraceRemainingMs > 0;
  }

  /** Hard CC that blocks actions (Asphyxiate / Ice Tomb / explicit STUN). Not Veil/Mortal Wound. */
  isUnitCrowdControlled(unit: { buffs?: Buff[] } | null | undefined): boolean {
    if (!unit?.buffs?.length) return false;
    return unit.buffs.some(
      b =>
        b.spellId === 'asphyxiate' ||
        b.spellId === 'ice_tomb' ||
        (b.tags as string[] | undefined)?.includes('STUN') ||
        (b.tags as string[] | undefined)?.includes('SILENCE')
    );
  }

  /**
   * Drain HP toward a floor without ever killing (used by Asphyxiate).
   * Bypasses difficulty / boss damage scaling.
   */
  drainHpTowardFloor(
    target: Unit,
    amount: number,
    floorHp = 1,
    spellName = '窒息术',
  ): number {
    if (!target.isAlive && !target.alive) return 0;
    if (target.hp <= floorHp) {
      target.hp = floorHp;
      return 0;
    }
    const drained = Math.min(Math.max(0, Math.round(amount)), target.hp - floorHp);
    if (drained <= 0) return 0;
    target.hp = Math.max(floorHp, target.hp - drained);
    this.effectsManager.addFloatingText({
      id: `drain_${Date.now()}_${target.id}_${Math.random()}`,
      targetId: target.id,
      text: Math.round(drained).toLocaleString(),
      category: 'DAMAGE_TAKEN',
      isCrit: false,
      isToPlayer: Boolean(target.isPlayer),
      createdAtMs: Date.now(),
    });
    if (!target.combatStats) {
      target.combatStats = {
        damageDealt: 0,
        healingDone: 0,
        overhealDone: 0,
        damageTaken: 0,
        interruptCount: 0,
        skillDamage: {},
        skillHealing: {},
        skillDamageTaken: {},
      };
    }
    target.combatStats.damageTaken += drained;
    if (!target.combatStats.skillDamageTaken) target.combatStats.skillDamageTaken = {};
    const takenName = resolveCombatSkillDisplayName(spellName, '窒息术');
    target.combatStats.skillDamageTaken[takenName] =
      (target.combatStats.skillDamageTaken[takenName] || 0) + drained;
    this.emitEvent({
      kind: 'DAMAGE',
      sourceId: this.bossUnit?.id || 'boss',
      targetId: target.id,
      spellId: spellName,
      value: drained,
      isCrit: false,
      timestamp: this.elapsedMs,
    });
    return drained;
  }

  dealDamage(
    source: Unit,
    target: Unit,
    amount: number,
    school: SpellSchool = 'PHYSICAL',
    isCrit = false,
    spellName = '普通攻击',
    isDot = false,
  ): void {
    const isAsphyxiate = spellName === '窒息术' || spellName === 'asphyxiate';

    // 影牙1号窒息术后安全治疗窗口保护：若首领处于窒息后治疗窗口期，严格阻断来自首领/环境对友方的非窒息伤害
    if (this.bossHealingGraceRemainingMs > 0 && target.role !== 'ENEMY' && !isAsphyxiate) {
      if (source.role === 'ENEMY' || source.id === this.bossUnit?.id) {
        return;
      }
    }

    // 窒息昏迷期间：禁止首领对其它技能/普攻误杀（窒息本身走 drainHpTowardFloor）
    if (
      !isAsphyxiate &&
      target.role !== 'ENEMY' &&
      (source.role === 'ENEMY' || source.id === this.bossUnit?.id) &&
      target.buffs?.some(b => b.spellId === 'asphyxiate')
    ) {
      return;
    }

    let finalAmount = amount;
    // Scale legacy boss/enemy hits to Level 80 HP pools (Tank 65k / DPS 36k)
    // 窒息术禁止一切倍率，避免「压到 1 血」被英雄/自定义系数打成击杀
    if (!isAsphyxiate && source.role === 'ENEMY' && target.role !== 'ENEMY') {
      finalAmount *= LEVEL_80_BOSS_DAMAGE_SCALE;
    }
    if (!isAsphyxiate && this.difficulty === 'CUSTOM') {
      if (source.isPlayer) {
        finalAmount *= (this.customDifficulty.playerDamageCoeff ?? 1.0);
      } else if (source.role !== 'ENEMY') {
        finalAmount *= (this.customDifficulty.aiDamageCoeff ?? 1.0);
      } else if (source.role === 'ENEMY') {
        finalAmount *= (this.customDifficulty.enemyDamageCoeff ?? 1.0);
      }
    } else if (!isAsphyxiate && source.role === 'ENEMY' && target.role !== 'ENEMY') {
      // 英雄本敌方伤害 ×1.2（相对普通本）；血量另用 HEROIC_DIFFICULTY_MULT ×1.5
      finalAmount *= getDifficultyNumericMult(this.difficulty);
    }
    finalAmount = Math.max(0, Math.round(finalAmount));

    // 窒息术保底：无论如何不低于 1 血
    if (isAsphyxiate && target.role !== 'ENEMY') {
      finalAmount = Math.min(finalAmount, Math.max(0, target.hp - 1));
    }

    this.applyDamage(source.id, target.id, finalAmount, isCrit, spellName, school, isDot);
  }

  /**
   * 攻击命中判定与防御判定（闪避/招架/格挡/抵抗/未命中），分你打出的、打到你身上的
   */
  resolveAttackHit(
    attacker: Unit,
    defender: Unit,
    baseDamage: number,
    school: SpellSchool = 'PHYSICAL',
    isCrit = false,
    spellName = '普通攻击',
    isDot = false,
  ): { outcome: 'HIT' | 'DODGE' | 'PARRY' | 'BLOCK' | 'MISS' | 'RESIST'; damage: number } {
    const isPlayerAttacker = this.isFromHumanOrPet(attacker);
    const isPlayerDefender = this.isHumanUnit(defender);

    // DoT持续伤害不参与普通挥砍闪招判定
    if (!isDot && school === 'PHYSICAL') {
      // 1. 未命中判定 (Miss)
      const missChance = defender.role === 'ENEMY' ? 0.02 : 0.03;
      if (Math.random() < missChance) {
        if (isPlayerDefender) {
          this.effectsManager.addFloatingText({
            id: `miss_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '未命中',
            category: 'MISS',
            isCrit: false,
            isToPlayer: true,
            createdAtMs: Date.now(),
          });
        } else if (defender.role === 'ENEMY' && isPlayerAttacker) {
          this.effectsManager.addFloatingText({
            id: `miss_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '未命中',
            category: 'MISS',
            isCrit: false,
            isFromPlayerOrPet: true,
            createdAtMs: Date.now(),
          });
        }
        return { outcome: 'MISS', damage: 0 };
      }

      // 2. 闪避判定 (Dodge)
      const dodgeChance = defender.stats.dodge || (defender.role === 'ENEMY' ? 0.05 : 0.03);
      if (Math.random() < dodgeChance) {
        if (isPlayerDefender) {
          this.effectsManager.addFloatingText({
            id: `dodge_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '闪避',
            category: 'DODGE',
            isCrit: false,
            isToPlayer: true,
            createdAtMs: Date.now(),
          });
        } else if (defender.role === 'ENEMY' && isPlayerAttacker) {
          this.effectsManager.addFloatingText({
            id: `dodge_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '闪避',
            category: 'DODGE',
            isCrit: false,
            isFromPlayerOrPet: true,
            createdAtMs: Date.now(),
          });
        }
        return { outcome: 'DODGE', damage: 0 };
      }

      // 3. 招架判定 (Parry)
      const parryChance = defender.stats.parry || (defender.role === 'ENEMY' ? 0.04 : 0);
      if (parryChance > 0 && Math.random() < parryChance) {
        if (isPlayerDefender) {
          this.effectsManager.addFloatingText({
            id: `parry_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '招架',
            category: 'PARRY',
            isCrit: false,
            isToPlayer: true,
            createdAtMs: Date.now(),
          });
        } else if (defender.role === 'ENEMY' && isPlayerAttacker) {
          this.effectsManager.addFloatingText({
            id: `parry_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '招架',
            category: 'PARRY',
            isCrit: false,
            isFromPlayerOrPet: true,
            createdAtMs: Date.now(),
          });
        }
        return { outcome: 'PARRY', damage: 0 };
      }

      // 4. 格挡判定 (Block) - 减免 30% 伤害
      const blockChance = defender.stats.block || 0;
      if (blockChance > 0 && Math.random() < blockChance) {
        if (isPlayerDefender) {
          this.effectsManager.addFloatingText({
            id: `block_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '格挡',
            category: 'BLOCK',
            isCrit: false,
            isToPlayer: true,
            createdAtMs: Date.now(),
          });
        } else if (defender.role === 'ENEMY' && isPlayerAttacker) {
          this.effectsManager.addFloatingText({
            id: `block_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '格挡',
            category: 'BLOCK',
            isCrit: false,
            isFromPlayerOrPet: true,
            createdAtMs: Date.now(),
          });
        }
        const blockedDamage = Math.round(baseDamage * 0.7);
        this.dealDamage(attacker, defender, blockedDamage, school, isCrit, spellName, isDot);
        return { outcome: 'BLOCK', damage: blockedDamage };
      }
    } else if (!isDot && school !== 'PHYSICAL') {
      // 5. 法术抵抗判定 (Resist)
      if (defender.stats.spellResist > 0 && Math.random() < (defender.stats.spellResist / 160)) {
        if (isPlayerDefender) {
          this.effectsManager.addFloatingText({
            id: `resist_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '抵抗',
            category: 'RESIST',
            isCrit: false,
            isToPlayer: true,
            createdAtMs: Date.now(),
          });
        } else if (defender.role === 'ENEMY' && isPlayerAttacker) {
          this.effectsManager.addFloatingText({
            id: `resist_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
            sourceId: attacker.id,
            text: '抵抗',
            category: 'RESIST',
            isCrit: false,
            isFromPlayerOrPet: true,
            createdAtMs: Date.now(),
          });
        }
        const resistedDmg = Math.round(baseDamage * 0.5);
        this.dealDamage(attacker, defender, resistedDmg, school, isCrit, spellName, isDot);
        return { outcome: 'RESIST', damage: resistedDmg };
      }
    }

    this.dealDamage(attacker, defender, baseDamage, school, isCrit, spellName, isDot);
    return { outcome: 'HIT', damage: baseDamage };
  }

  healUnit(
    source: Unit,
    target: Unit,
    amount: number,
    isCrit = false,
    spellName = '治疗术',
    isPeriodic = false,
  ): void {
    let finalAmount = amount;
    if (this.difficulty === 'CUSTOM') {
      if (source.isPlayer) {
        finalAmount *= (this.customDifficulty.playerHealingCoeff ?? 1.0);
      } else if (source.role !== 'ENEMY') {
        finalAmount *= (this.customDifficulty.aiHealingCoeff ?? 1.0);
      }
    }
    finalAmount = Math.max(0, Math.round(finalAmount));

    const overheal = Math.max(0, (target.hp + finalAmount) - target.maxHp);
    this.applyHeal(source.id, target.id, finalAmount, isCrit, overheal, spellName, false, isPeriodic);

    // 有生命绽放buff的角色可以被治疗之触、愈合、滋养对该单体刷新
    if (['治疗之触', '愈合', '滋养', 'healing_touch', 'regrowth', 'nourish', 'druid_healing_touch', 'druid_regrowth', 'druid_nourish'].includes(spellName)) {
      this.refreshLifebloom(target, source.id);
    }
  }

  refreshLifebloom(target: Unit, sourceId?: string): boolean {
    return this.auraManager.refreshLifebloom(target, sourceId);
  }

  applyBuff(target: Unit, buff: Buff): void {
    // Resolve on the live unit object so auto raid buffs always land.
    this.auraManager.addBuff(target, buff);
    // MotW / Kings / Fort → HP; MotW / Kings / Arcane Brilliance → mana
    applyStaminaRaidBuffHpBonus(target, buff.spellId || buff.id || '');
  }

  reset(): void {
    this.elapsedMs = 0;
    this.bossHealingGraceRemainingMs = 0;
    this.pendingCasts = [];
    this.schoolLockouts.clear();
    this.earthShieldLastProcMs.clear();
    this.units.clear();
    this.threatManager.resetAll();
    this.cooldownManager.reset();
    this.effectsManager.clearAll();
    this.actionLog.clear();
  }

  /** Host-side compact snapshot for room combat sync (guests apply, do not tick). */
  buildNetworkUnitSnapshots(): Array<{
    id: string;
    name: string;
    classId: string;
    spec?: string;
    role: string;
    isPlayer: boolean;
    isHumanControlled?: boolean;
    isAi?: boolean;
    isPet?: boolean;
    ownerId?: string;
    unitKind?: Unit['unitKind'];
    isBoss?: boolean;
    isAlive: boolean;
    hp: number;
    maxHp: number;
    mp?: number;
    maxMp?: number;
    energy?: number;
    rage?: number;
    runicPower?: number;
    focus?: number;
    absorb: number;
    position: { x: number; y: number };
    buffs: Buff[];
    combatStats?: Unit['combatStats'];
  }> {
    const bossId = this.bossUnit?.id;
    return this.getAllUnits().map((u) => {
      const unitKind = resolveUnitKind(u);
      // Prefer explicit unitKind/classId so dungeon ADDs are not mislabeled BOSS
      // when bossUnit() still returns the first ENEMY in a multi-enemy room.
      const isBoss =
        unitKind === 'BOSS' ||
        u.classId === 'BOSS' ||
        (!!bossId && u.id === bossId && unitKind !== 'ADD' && unitKind !== 'NPC' && unitKind !== 'PET');
      return {
        id: u.id,
        name: u.name,
        classId: u.classId,
        spec: u.spec,
        role: u.role,
        isPlayer: u.isPlayer,
        isHumanControlled: !!u.isHumanControlled || u.isPlayer,
        isAi: unitKind === 'AI',
        isPet: !!u.isPet || unitKind === 'PET',
        ownerId: u.ownerId,
        unitKind,
        isBoss,
        isAlive: u.isAlive,
        hp: u.hp,
        maxHp: u.maxHp,
        mp: u.mp,
        maxMp: u.maxMp,
        energy: u.energy,
        rage: u.rage,
        runicPower: u.runicPower,
        focus: u.focus,
        absorb: u.absorb,
        position: { ...u.position },
        buffs: u.buffs.map((b) => ({ ...b })),
        combatStats: u.combatStats ? { ...u.combatStats } : undefined,
      };
    });
  }

  /** Guest-side: overlay host snapshot onto local units (create stubs if missing). */
  applyNetworkUnitSnapshots(
    snapshots: Array<{
      id: string;
      name: string;
      classId: string;
      spec?: string;
      role: string;
      isPlayer: boolean;
      isHumanControlled?: boolean;
      isAi?: boolean;
      isPet?: boolean;
      ownerId?: string;
      unitKind?: Unit['unitKind'];
      isAlive: boolean;
      hp: number;
      maxHp: number;
      mp?: number;
      maxMp?: number;
      energy?: number;
      rage?: number;
      runicPower?: number;
      focus?: number;
      absorb: number;
      position: { x: number; y: number };
      buffs: Buff[];
      combatStats?: Unit['combatStats'];
    }>
  ): void {
    const seen = new Set<string>();
    for (const s of snapshots) {
      seen.add(s.id);
      let unit = this.units.get(s.id);
      const unitKind = resolveUnitKind(s);
      if (!unit) {
        unit = {
          id: s.id,
          name: s.name,
          classId: s.classId as Unit['classId'],
          spec: s.spec,
          role: s.role as Unit['role'],
          isPlayer: s.isPlayer,
          isHumanControlled: !!s.isHumanControlled || s.isPlayer,
          isPet: !!s.isPet || unitKind === 'PET',
          ownerId: s.ownerId,
          unitKind,
          isAlive: s.isAlive,
          hp: s.hp,
          maxHp: s.maxHp,
          mp: s.mp,
          maxMp: s.maxMp,
          energy: s.energy,
          rage: s.rage,
          runicPower: s.runicPower,
          focus: s.focus,
          resources: [],
          stats: {
            attackPower: 0,
            spellPower: 0,
            critChance: 0,
            haste: 0,
            armor: 0,
            spellResist: 0,
            block: 0,
            parry: 0,
            dodge: 0,
            mastery: 0,
            versatility: 0,
            speed: 0,
          },
          buffs: [],
          threatTable: [],
          absorb: s.absorb,
          position: { ...s.position },
        };
        this.addUnit(unit);
      }
      // Hot-join / roster remap: keep identity in sync with host (name/class/role/spec)
      unit.name = s.name;
      unit.classId = s.classId as Unit['classId'];
      unit.spec = s.spec;
      unit.role = s.role as Unit['role'];
      unit.isAlive = s.isAlive;
      (unit as any).alive = s.isAlive;
      unit.hp = s.hp;
      unit.maxHp = s.maxHp;
      unit.mp = s.mp;
      unit.maxMp = s.maxMp;
      unit.energy = s.energy;
      unit.rage = s.rage;
      unit.runicPower = s.runicPower;
      unit.focus = s.focus;
      unit.absorb = s.absorb;
      unit.position = { ...s.position };
      unit.buffs = s.buffs.map((b) => ({ ...b }));
      if (s.isHumanControlled != null) unit.isHumanControlled = !!s.isHumanControlled || s.isPlayer;
      if (s.isPet != null || s.unitKind === 'PET') unit.isPet = !!s.isPet || s.unitKind === 'PET';
      if (s.ownerId !== undefined) unit.ownerId = s.ownerId;
      // Drop stale AI kind when seat is now human-controlled so resolveUnitKind → PLAYER
      if (unit.isHumanControlled || unit.isPlayer) {
        delete (unit as { unitKind?: string }).unitKind;
        unit.unitKind = resolveUnitKind(unit);
      } else {
        unit.unitKind = unitKind;
      }
      if (s.combatStats) unit.combatStats = { ...s.combatStats };
    }
    for (const id of Array.from(this.units.keys())) {
      if (!seen.has(id)) this.units.delete(id);
    }
  }
}
