import type { Unit, Spell, CombatEvent, CombatEventKind, Buff, SpellSchool, DungeonDifficulty, CustomDifficultySettings, ResourceKind } from '../types.js';
import { DEFAULT_CUSTOM_DIFFICULTY } from '../types.js';
import { Calculator } from './Calculator.js';
import { ThreatManager } from './ThreatManager.js';
import { AuraManager } from './AuraManager.js';
import { ResourceManager } from './ResourceManager.js';
import { CooldownManager } from './CooldownManager.js';
import { EffectsManager } from './EffectsManager.js';

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
  private pendingCasts: Array<{ casterId: string; spell: Spell; targetId: string; remainingMs: number }> = [];
  private schoolLockouts: Map<string, Map<SpellSchool, number>> = new Map();
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

  private static readonly TICK_MS = 50; // 20 Hz

  constructor() {
    this.calculator    = new Calculator(this);
    this.threatManager = new ThreatManager();
    this.auraManager   = new AuraManager(this);
    this.resourceManager = new ResourceManager(this);
    this.cooldownManager = new CooldownManager();
    this.effectsManager  = new EffectsManager(this);
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

    // 4. Tick ground effects
    this.effectsManager.tick(this.units, deltaMs);

    // 5. Advance pending casts
    this.tickPendingCasts(deltaMs);
  }

  // ── Pending casts queue ───────────────────────────────────────
  private tickPendingCasts(deltaMs: number): void {
    const resolved: typeof this.pendingCasts = [];
    for (const cast of this.pendingCasts) {
      cast.remainingMs -= deltaMs;
      if (cast.remainingMs <= 0) {
        this.resolveSpell(cast.casterId, cast.spell, cast.targetId);
      } else {
        resolved.push(cast);
      }
    }
    this.pendingCasts = resolved;
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

    // Atomically deduct resources
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

    // Consume DK Runes & generate Runic Power
    if (runesReq && runesReq.length > 0) {
      this.resourceManager.consumeRunes(casterId, runesReq);
      // In Cataclysm, spending runes generates 10 RP per rune spent
      const rpGain = runesReq.length * 10;
      this.resourceManager.restore(casterId, 'RUNIC_POWER', rpGain);
    }

    // Start GCD + spell CD
    this.cooldownManager.startCooldown(casterId, spellId, spell, caster);

    this.emitEvent({
      kind: 'SPELL_CAST',
      sourceId: casterId,
      targetId,
      spellId,
      timestamp: this.elapsedMs,
    });

    if (spell.castTimeMs > 0) {
      // Queue as cast-in-progress
      this.pendingCasts.push({ casterId, spell, targetId, remainingMs: spell.castTimeMs });
    } else {
      this.resolveSpell(casterId, spell, targetId);
    }
    return true;
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
          const { healing, isCrit, overheal } = this.calculator.calcHealing(caster, target, base);
          this.applyHeal(casterId, targetId, healing, isCrit, overheal, spell.id);
          break;
        }

        case 'SHIELD': {
          target.absorb = (target.absorb ?? 0) + baseValue;
          break;
        }

        case 'APPLY_BUFF':
        case 'APPLY_DEBUFF':
          if (effect.auraId) {
            // Aura templates are resolved by the caller; here we just signal
            this.auraManager.applyAuraById(effect.auraId, casterId, targetId);
          }
          break;

        case 'INTERRUPT':
          this.interruptCast(targetId, 4000);
          this.emitEvent({ kind: 'INTERRUPT', sourceId: casterId, targetId, spellId: spell.id, timestamp: this.elapsedMs });
          break;

        case 'TAUNT':
          this.threatManager.applyTaunt(targetId, casterId);
          break;

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

        case 'SUMMON_GROUND_EFFECT':
          if (effect.groundEffectKind) {
            this.effectsManager.addGroundEffect({
              id: `${spell.id}_${this.elapsedMs}`,
              kind: effect.groundEffectKind,
              spellId: spell.id,
              ownerId: casterId,
              x: target.position?.x ?? 0,
              y: target.position?.y ?? 0,
              radius: 5,
              colorHex: '#00FF00',
              remainingMs: 10_000,
              tickIntervalMs: 1_000,
              tickElapsedMs: 0,
              tickValue: baseValue,
            });
          }
          break;
      }
    }
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
    const isPlayerSource = Boolean(source?.isPlayer);
    const isPetSource = Boolean(source?.isPet || (source?.ownerId && this.units.get(source.ownerId)?.isPlayer));
    const isFromPlayerOrPet = isPlayerSource || isPetSource;
    const isToPlayer = Boolean(target.isPlayer);

    // 影牙1号窒息术后安全治疗窗口保护：若首领处于窒息后治疗窗口期，严格阻断来自首领/环境对友方的非窒息伤害
    if (this.bossHealingGraceRemainingMs > 0 && target.role !== 'ENEMY' && spellId !== '窒息术' && spellId !== 'asphyxiate') {
      const src = this.units.get(sourceId);
      if (!src || src.role === 'ENEMY' || src.id === this.bossUnit?.id) {
        return;
      }
    }

    // Apply absorb shield
    let effective = amount;
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
      const skillName = spellId ? (SPELL_ID_TO_NAME[spellId] || spellId) : '普通攻击';
      source.combatStats.skillDamage[skillName] = (source.combatStats.skillDamage[skillName] || 0) + effective;
    }
    if (!target.combatStats) {
      target.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
    }
    target.combatStats.damageTaken += effective;

    if (effective > 0) {
      if (isToPlayer) {
        // 敌人对你造成的伤害（红字数字）
        this.effectsManager.addFloatingText({
          id: `dmg_${Date.now()}_${targetId}_${Math.random()}`,
          targetId,
          text: Math.round(effective).toLocaleString(),
          category: 'DAMAGE_TAKEN',
          isCrit,
          isToPlayer: true,
          createdAtMs: Date.now(),
        });
      } else if (target.role === 'ENEMY') {
        // 敌人头顶数字：仅显示 你 & 你的宠物 对敌人造成的伤害
        if (isFromPlayerOrPet) {
          let cat = 'DAMAGE_SKILL';
          if (isDot) {
            cat = 'DAMAGE_DOT'; // DOT持续伤害
          } else if (spellId === '普通攻击' || spellId === 'auto_attack' || (school === 'PHYSICAL' && !spellId)) {
            cat = 'DAMAGE_AUTO'; // 白字普攻
          } else {
            cat = 'DAMAGE_SKILL'; // 黄字技能
          }
          this.effectsManager.addFloatingText({
            id: `dmg_${Date.now()}_${targetId}_${Math.random()}`,
            targetId,
            text: Math.round(effective).toLocaleString(),
            category: cat,
            isCrit,
            isFromPlayerOrPet: true,
            createdAtMs: Date.now(),
          });
        }
      } else {
        // 队友受伤普通处理
        const fctCat = isCrit ? 'CRIT' : (school === 'PHYSICAL' ? 'PHYS_NORMAL' : `SPELL_${school}` as any);
        this.effectsManager.addFloatingText({
          id: `dmg_${Date.now()}_${targetId}_${Math.random()}`,
          targetId,
          text: Math.round(effective).toLocaleString(),
          category: fctCat,
          isCrit,
          isToPlayer: false,
          isFromPlayerOrPet: false,
          createdAtMs: Date.now(),
        });
      }
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

    if (target.hp <= 0) {
      this.killUnit(targetId);
    }
  }

  // ── Heal application ──────────────────────────────────────────
  applyHeal(
    sourceId: string,
    targetId: string,
    amount: number,
    isCrit: boolean,
    overheal: number,
    spellId?: string,
  ): void {
    const target = this.units.get(targetId);
    if (!target || !target.isAlive) return;

    const safeAmount = Math.max(0, amount);
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
    const source = this.units.get(sourceId);
    if (source) {
      if (!source.combatStats) {
        source.combatStats = { damageDealt: 0, healingDone: 0, overhealDone: 0, damageTaken: 0, interruptCount: 0 };
      }
      source.combatStats.healingDone = Math.max(0, (source.combatStats.healingDone || 0) + effectiveHeal);
      source.combatStats.overhealDone = Math.max(0, (source.combatStats.overhealDone || 0) + finalOverheal);
      if (!source.combatStats.skillHealing) source.combatStats.skillHealing = {};
      const skillName = spellId ? (SPELL_ID_TO_NAME[spellId] || spellId) : '治疗术';
      source.combatStats.skillHealing[skillName] = Math.max(
        0,
        (source.combatStats.skillHealing[skillName] || 0) + effectiveHeal
      );
    }

    this.effectsManager.addFloatingText({
      id: `heal_${Date.now()}_${targetId}_${Math.random()}`,
      targetId,
      text: `${Math.round(safeAmount).toLocaleString()}`,
      category: 'HEAL',
      isCrit,
      isToPlayer: Boolean(target.isPlayer),
      createdAtMs: Date.now(),
    });

    if (finalOverheal > 0) {
      this.effectsManager.addFloatingText({
        id: `overheal_${Date.now()}_${targetId}_${Math.random()}`,
        targetId,
        text: `(${Math.round(finalOverheal).toLocaleString()})`,
        category: 'OVERHEAL',
        isCrit: false,
        createdAtMs: Date.now(),
      });
    }

    this.emitEvent({
      kind: 'HEAL',
      sourceId,
      targetId,
      spellId,
      value: amount,
      isCrit,
      overheal,
      timestamp: this.elapsedMs,
    });
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
    let finalHp = hp;
    if (this.difficulty === 'CUSTOM') {
      finalHp = Math.max(1000, Math.round(hp * (this.customDifficulty.bossHpCoeff ?? 1.0)));
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

  dealDamage(
    source: Unit,
    target: Unit,
    amount: number,
    school: SpellSchool = 'PHYSICAL',
    isCrit = false,
    spellName = '普通攻击',
    isDot = false,
  ): void {
    // 影牙1号窒息术后安全治疗窗口保护：若首领处于窒息后治疗窗口期，严格阻断来自首领/环境对友方的非窒息伤害
    if (this.bossHealingGraceRemainingMs > 0 && target.role !== 'ENEMY' && spellName !== '窒息术') {
      if (source.role === 'ENEMY' || source.id === this.bossUnit?.id) {
        return;
      }
    }

    let finalAmount = amount;
    if (this.difficulty === 'CUSTOM') {
      if (source.isPlayer) {
        finalAmount *= (this.customDifficulty.playerDamageCoeff ?? 1.0);
      } else if (source.role !== 'ENEMY') {
        finalAmount *= (this.customDifficulty.aiDamageCoeff ?? 1.0);
      } else if (source.role === 'ENEMY') {
        finalAmount *= (this.customDifficulty.enemyDamageCoeff ?? 1.0);
      }
    }
    finalAmount = Math.max(0, Math.round(finalAmount));

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
    const isPlayerAttacker = Boolean(attacker.isPlayer || attacker.isPet || (attacker.ownerId && this.units.get(attacker.ownerId)?.isPlayer));
    const isPlayerDefender = Boolean(defender.isPlayer);

    // DoT持续伤害不参与普通挥砍闪招判定
    if (!isDot && school === 'PHYSICAL') {
      // 1. 未命中判定 (Miss)
      const missChance = defender.role === 'ENEMY' ? 0.02 : 0.03;
      if (Math.random() < missChance) {
        if (isPlayerDefender) {
          this.effectsManager.addFloatingText({
            id: `miss_${Date.now()}_${defender.id}_${Math.random()}`,
            targetId: defender.id,
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

  healUnit(source: Unit, target: Unit, amount: number, isCrit = false, spellName = '治疗术'): void {
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
    this.applyHeal(source.id, target.id, finalAmount, isCrit, overheal, spellName);

    // 有生命绽放buff的角色可以被治疗之触、愈合、滋养对该单体刷新
    if (['治疗之触', '愈合', '滋养', 'healing_touch', 'regrowth', 'nourish', 'druid_healing_touch', 'druid_regrowth', 'druid_nourish'].includes(spellName)) {
      this.refreshLifebloom(target, source.id);
    }
  }

  refreshLifebloom(target: Unit, sourceId?: string): boolean {
    return this.auraManager.refreshLifebloom(target, sourceId);
  }

  applyBuff(target: Unit, buff: Buff): void {
    this.auraManager.applyAura(target.id, buff);
  }

  reset(): void {
    this.elapsedMs = 0;
    this.bossHealingGraceRemainingMs = 0;
    this.pendingCasts = [];
    this.units.clear();
    this.threatManager.resetAll();
    this.cooldownManager.reset();
    this.effectsManager.clearAll();
  }
}
