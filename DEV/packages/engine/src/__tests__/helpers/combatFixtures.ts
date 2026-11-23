/**
 * Shared combat test fixtures — unit factories, registry asserts, cast helpers.
 */
import assert from 'node:assert/strict';
import { CombatEngine } from '../../engine/CombatEngine.js';
import {
  ALL_CLASSES_NORMALIZED,
  getSpellByAnyId,
  type NormalizedSpell,
  type ClassId,
} from '../../classes/ClassRegistry.js';
import { createLevel80BaseStats, LEVEL_80_STATS } from '../../engine/TierProfile.js';
import type { RoleId, Spell, Unit, ResourceKind } from '../../types.js';
import { SHAMAN } from '../../classes/Shaman.js';
import { DRUID } from '../../classes/Druid.js';
import { DEATH_KNIGHT } from '../../classes/DeathKnight.js';
import { MAGE } from '../../classes/Mage.js';
import { ROGUE } from '../../classes/Rogue.js';
import { WARRIOR } from '../../classes/Warrior.js';
import { PALADIN } from '../../classes/Paladin.js';
import { HUNTER } from '../../classes/Hunter.js';
import { PRIEST } from '../../classes/Priest.js';
import { WARLOCK } from '../../classes/Warlock.js';

export type UnitFactoryOverrides = Partial<Unit> & { spec?: string };

function roleMaxHp(role: RoleId | 'ENEMY'): number {
  if (role === 'TANK') return LEVEL_80_STATS.tankBaseHp;
  if (role === 'ENEMY') return 500_000;
  return LEVEL_80_STATS.dpsHealerBaseHp;
}

function roleMaxMp(role: RoleId | 'ENEMY', classId: ClassId | 'BOSS'): number {
  if (role === 'ENEMY' || classId === 'BOSS') return 0;
  if (role === 'HEALER') return LEVEL_80_STATS.healerBaseMp;
  if (classId === 'MAGE' || classId === 'WARLOCK' || classId === 'PRIEST' || classId === 'SHAMAN' || classId === 'DRUID' || classId === 'PALADIN' || classId === 'HUNTER') {
    return LEVEL_80_STATS.casterBaseMp;
  }
  return 0;
}

export function makeUnit(overrides: UnitFactoryOverrides = {}): Unit {
  const role = (overrides.role ?? 'HEALER') as RoleId | 'ENEMY';
  const classId = (overrides.classId ?? 'SHAMAN') as ClassId | 'BOSS';
  const maxHp = overrides.maxHp ?? roleMaxHp(role === 'ENEMY' ? 'ENEMY' : role);
  const maxMp = overrides.maxMp ?? roleMaxMp(role, classId);
  const mp = overrides.mp ?? maxMp;
  const statsRole = role === 'ENEMY' ? 'DPS' : role;
  const u: Unit = {
    id: overrides.id ?? 'unit_1',
    name: overrides.name ?? '测试单位',
    classId: classId as ClassId,
    role,
    isPlayer: overrides.isPlayer ?? false,
    isAlive: overrides.isAlive ?? true,
    alive: overrides.alive ?? true,
    hp: overrides.hp ?? maxHp,
    maxHp,
    mp,
    maxMp,
    energy: overrides.energy ?? (classId === 'ROGUE' ? 100 : 0),
    rage: overrides.rage ?? (classId === 'WARRIOR' ? 50 : 0),
    focus: overrides.focus ?? (classId === 'HUNTER' ? 100 : 0),
    runicPower: overrides.runicPower ?? 0,
    holyPower: overrides.holyPower ?? 0,
    comboPoints: overrides.comboPoints ?? 0,
    absorb: overrides.absorb ?? 0,
    buffs: overrides.buffs ?? [],
    threatTable: overrides.threatTable ?? [],
    resources: overrides.resources ?? (maxMp > 0
      ? [{ kind: 'MANA', current: mp, max: maxMp }]
      : classId === 'ROGUE'
        ? [{ kind: 'ENERGY', current: 100, max: 100 }]
        : classId === 'WARRIOR'
          ? [{ kind: 'RAGE', current: 50, max: 100 }]
          : classId === 'HUNTER'
            ? [{ kind: 'FOCUS', current: 100, max: 100 }]
            : classId === 'DK'
              ? [{ kind: 'RUNIC_POWER', current: 0, max: 100 }]
              : classId === 'PALADIN'
                ? [{ kind: 'HOLY_POWER', current: 0, max: 3 }]
                : []),
    position: overrides.position ?? { x: 200, y: 200 },
    stats: overrides.stats ?? createLevel80BaseStats(statsRole as RoleId, classId === 'BOSS' ? 'WARRIOR' : classId),
    combatStats: overrides.combatStats ?? {
      damageDealt: 0,
      healingDone: 0,
      overhealDone: 0,
      damageTaken: 0,
      interruptCount: 0,
    },
  };
  if (classId === 'DK' && !u.runes) {
    u.runes = [
      { runeType: 'BLOOD', cooldownMs: 0 },
      { runeType: 'BLOOD', cooldownMs: 0 },
      { runeType: 'FROST', cooldownMs: 0 },
      { runeType: 'FROST', cooldownMs: 0 },
      { runeType: 'UNHOLY', cooldownMs: 0 },
      { runeType: 'UNHOLY', cooldownMs: 0 },
    ];
  }
  if (overrides.spec) (u as any).spec = overrides.spec;
  return u;
}

export function makeHealer(classId: ClassId = 'SHAMAN', overrides: UnitFactoryOverrides = {}): Unit {
  return makeUnit({
    id: `${classId.toLowerCase()}_healer`,
    name: `测试${classId}治疗`,
    classId,
    role: 'HEALER',
    isPlayer: true,
    ...overrides,
  });
}

export function makeTank(classId: ClassId = 'WARRIOR', overrides: UnitFactoryOverrides = {}): Unit {
  return makeUnit({
    id: `${classId.toLowerCase()}_tank`,
    name: `测试${classId}坦克`,
    classId,
    role: 'TANK',
    isPlayer: false,
    hp: Math.round(LEVEL_80_STATS.tankBaseHp * 0.45),
    ...overrides,
  });
}

export function makeDps(classId: ClassId = 'MAGE', overrides: UnitFactoryOverrides = {}): Unit {
  return makeUnit({
    id: `${classId.toLowerCase()}_dps`,
    name: `测试${classId}输出`,
    classId,
    role: 'DPS',
    isPlayer: true,
    ...overrides,
  });
}

export function makeAlly(id: string, hpRatio = 0.5, overrides: UnitFactoryOverrides = {}): Unit {
  const maxHp = LEVEL_80_STATS.dpsHealerBaseHp;
  return makeUnit({
    id,
    name: id,
    classId: 'WARRIOR',
    role: 'TANK',
    isPlayer: false,
    maxHp,
    hp: Math.round(maxHp * hpRatio),
    position: { x: 210, y: 210 },
    ...overrides,
  });
}

export function makeBoss(id = 'boss_1', overrides: UnitFactoryOverrides = {}): Unit {
  return makeUnit({
    id,
    name: '测试首领',
    classId: 'BOSS',
    role: 'ENEMY',
    isPlayer: false,
    maxHp: 500_000,
    hp: 500_000,
    position: { x: 300, y: 200 },
    ...overrides,
  });
}

export interface SpellRegistryExpectations {
  exists?: boolean;
  isHeal?: boolean;
  isDamage?: boolean;
  isBuff?: boolean;
  isHot?: boolean;
  isDot?: boolean;
  isInterrupt?: boolean;
  isAOE?: boolean;
  gcdCategory?: NormalizedSpell['gcdCategory'];
  minDirectHeal?: number;
  minDirectDamage?: number;
  cooldownMs?: number;
  castTimeMs?: number;
  specId?: string;
  classId?: ClassId;
}

export function assertSpellRegistry(
  spellId: string,
  expectations: SpellRegistryExpectations = {},
  classId?: ClassId
): NormalizedSpell {
  const sp = getSpellByAnyId(spellId, classId);
  assert.ok(sp, `缺少技能 ${spellId}`);
  if (expectations.classId) assert.equal(sp!.classId, expectations.classId);
  if (expectations.isHeal !== undefined) assert.equal(sp!.isHeal, expectations.isHeal, `${spellId} isHeal`);
  if (expectations.isDamage !== undefined) assert.equal(sp!.isDamage, expectations.isDamage, `${spellId} isDamage`);
  if (expectations.isBuff !== undefined) assert.equal(sp!.isBuff, expectations.isBuff, `${spellId} isBuff`);
  if (expectations.isHot !== undefined) assert.equal(sp!.isHot, expectations.isHot, `${spellId} isHot`);
  if (expectations.isDot !== undefined) assert.equal(sp!.isDot, expectations.isDot, `${spellId} isDot`);
  if (expectations.isInterrupt !== undefined) assert.equal(sp!.isInterrupt, expectations.isInterrupt, `${spellId} isInterrupt`);
  if (expectations.isAOE !== undefined) assert.equal(sp!.isAOE, expectations.isAOE, `${spellId} isAOE`);
  if (expectations.gcdCategory) assert.equal(sp!.gcdCategory, expectations.gcdCategory, `${spellId} gcd`);
  if (expectations.cooldownMs !== undefined) assert.equal(sp!.cooldownMs, expectations.cooldownMs, `${spellId} cd`);
  if (expectations.castTimeMs !== undefined) assert.equal(sp!.castTimeMs, expectations.castTimeMs, `${spellId} cast`);
  if (expectations.minDirectHeal !== undefined) {
    assert.ok((sp!.directHeal || 0) >= expectations.minDirectHeal, `${spellId} directHeal`);
  }
  if (expectations.minDirectDamage !== undefined) {
    assert.ok((sp!.directDamage || 0) >= expectations.minDirectDamage, `${spellId} directDamage`);
  }
  if (expectations.specId) {
    const ok =
      sp!.specIds.length === 0 ||
      sp!.specIds.includes(expectations.specId);
    assert.ok(ok, `${spellId} should be available to ${expectations.specId}, got [${sp!.specIds}]`);
  }
  return sp!;
}

function mapResourceKind(raw: unknown): ResourceKind | null {
  if (!raw || raw === 'NONE') return null;
  if (raw === 'COMBO_POINT') return 'COMBO_POINTS';
  if (raw === 'BLOOD_RUNE' || raw === 'FROST_RUNE' || raw === 'UNHOLY_RUNE' || raw === 'DEATH_RUNE') return null;
  return raw as ResourceKind;
}

/** Convert legacy / modern class spell defs into engine Spell and register them. */
export function registerRawSpells(engine: CombatEngine, rawSpells: any[], classId: ClassId): void {
  for (const sp of rawSpells) {
    const kind = mapResourceKind(typeof sp.resourceCost === 'string' ? sp.resourceCost : null);
    const amount = sp.resourceCostAmount ?? 0;
    let resourceCost: Partial<Record<ResourceKind, number>> = {};
    if (typeof sp.resourceCost === 'object' && sp.resourceCost) {
      resourceCost = sp.resourceCost;
    } else if (kind && amount > 0) {
      resourceCost = { [kind]: amount };
    }

    const gcdCategory =
      sp.gcdCategory ||
      (sp.gcdType === 'off' || sp.gcdType === 'OFF_GCD' ? 'OFF_GCD' : 'NORMAL');

    const engineSpell: Spell = {
      id: sp.id,
      name: sp.name,
      classId: sp.classId || classId,
      school: sp.school || 'PHYSICAL',
      targetType: sp.targetType || 'SINGLE_ENEMY',
      castTimeMs: sp.castTimeMs ?? 0,
      channelDurationMs: sp.channelDurationMs,
      gcdCategory,
      resourceCost,
      cooldownMs: sp.cooldownMs ?? 0,
      description: sp.description,
      effects: (sp.effects || []).map((e: any) => ({
        kind: e.kind || (e.type === 'HEAL' ? 'HEAL'
          : e.type === 'HOT' ? 'APPLY_BUFF'
          : e.type === 'DOT' ? 'APPLY_DEBUFF'
          : e.type === 'BUFF' ? 'APPLY_BUFF'
          : e.type === 'DEBUFF' ? 'APPLY_DEBUFF'
          : e.type === 'PHYSICAL_DAMAGE' || e.type === 'SPELL_DAMAGE' ? 'DAMAGE'
          : e.type === 'GROUND_EFFECT' ? 'SUMMON_GROUND_EFFECT'
          : e.type === 'INTERRUPT' ? 'INTERRUPT'
          : e.type === 'TAUNT' ? 'TAUNT'
          : e.type === 'SHIELD' ? 'SHIELD'
          : e.type === 'RESOURCE_RESTORE' ? 'RESOURCE_RESTORE'
          : e.type === 'DISPEL' ? 'DISPEL'
          : e.type === 'RESURRECT' ? 'RESURRECT'
          : 'DAMAGE'),
        school: e.school || sp.school || 'PHYSICAL',
        baseValue: e.baseValue ?? 0,
        auraId: e.auraId,
        durationMs: e.durationMs,
        tickIntervalMs: e.tickIntervalMs,
        maxStacks: e.maxStacks,
        description: e.description,
        groundEffectKind: e.groundKind || e.groundEffectKind,
        resourceKind: e.resourceKind,
      })),
      runesRequired: sp.runesRequired,
      outOfCombatOnly: Boolean(sp.travelOnly),
      isRaidBuff: Boolean(sp.isRaidBuff),
    };
    // Keep legacy fields for CombatEngine.resolveSpell / getSpellResourceCost
    (engineSpell as any).resourceCostAmount = amount;
    if (typeof sp.resourceCost === 'string') (engineSpell as any).resourceCost = sp.resourceCost;
    if (sp.effects) (engineSpell as any).effects = sp.effects;
    engine.registerSpell(engineSpell);
    // Also register short id alias if present
    const short = sp.id.includes('_') ? sp.id.split('_').slice(1).join('_') : sp.id;
    if (short !== sp.id) {
      engine.registerSpell({ ...engineSpell, id: short } as Spell);
    }
  }
}

const LEGACY_CLASS_SPELLS: Partial<Record<ClassId, any[]>> = {
  SHAMAN: SHAMAN.spells,
  DRUID: DRUID.spells,
  DK: DEATH_KNIGHT.spells,
  MAGE: MAGE.spells,
  ROGUE: ROGUE.spells,
  WARRIOR: WARRIOR.spells,
  PALADIN: PALADIN.spells,
  HUNTER: HUNTER.spells,
  PRIEST: PRIEST.spells,
};

function collectModernClassSpells(classId: ClassId): any[] {
  if (classId !== 'WARLOCK') return [];
  const out: any[] = [];
  for (const spec of WARLOCK.specs || []) {
    for (const sp of spec.spells || []) out.push(sp);
  }
  return out;
}

export function registerClassSpells(engine: CombatEngine, classId: ClassId): void {
  const legacy = LEGACY_CLASS_SPELLS[classId];
  if (legacy?.length) {
    registerRawSpells(engine, legacy, classId);
    return;
  }
  const modern = collectModernClassSpells(classId);
  if (modern.length) {
    registerRawSpells(engine, modern, classId);
    return;
  }
  // Fallback: synthesize minimal castable shells from NormalizedSpell metrics
  const cls = ALL_CLASSES_NORMALIZED[classId];
  if (!cls) return;
  for (const n of cls.allSpells) {
    const effects: any[] = [];
    if (n.directHeal > 0) effects.push({ type: 'HEAL', baseValue: n.directHeal });
    if (n.directDamage > 0) {
      effects.push({
        type: n.school === 'PHYSICAL' ? 'PHYSICAL_DAMAGE' : 'SPELL_DAMAGE',
        baseValue: n.directDamage,
        school: n.school,
      });
    }
    if (n.isHot && n.hotTotalHeal > 0) {
      effects.push({
        type: 'HOT',
        auraId: n.auraId || `${n.shortId}_hot`,
        baseValue: Math.round(n.hotTotalHeal / Math.max(1, Math.floor((n.durationMs || 15000) / Math.max(1, n.tickIntervalMs || 3000)))),
        durationMs: n.durationMs || 15_000,
        tickIntervalMs: n.tickIntervalMs || 3_000,
      });
    }
    if (n.isDot && n.dotTotalDamage > 0) {
      effects.push({
        type: 'DOT',
        auraId: n.auraId || `${n.shortId}_dot`,
        baseValue: Math.round(n.dotTotalDamage / Math.max(1, Math.floor((n.durationMs || 15000) / Math.max(1, n.tickIntervalMs || 3000)))),
        durationMs: n.durationMs || 15_000,
        tickIntervalMs: n.tickIntervalMs || 3_000,
      });
    }
    if (n.isBuff || n.isDefensive) {
      effects.push({
        type: 'BUFF',
        auraId: n.auraId || n.shortId,
        durationMs: n.durationMs || 15_000,
        maxStacks: n.maxStacks || 1,
        baseValue: n.shieldValue || 0,
      });
    }
    if (n.isInterrupt) effects.push({ type: 'INTERRUPT' });
    if (n.isTaunt) effects.push({ type: 'TAUNT' });
    if (n.groundKind) {
      effects.push({
        type: 'GROUND_EFFECT',
        groundKind: n.groundKind,
        groundColorHex: n.groundColorHex,
        groundRadius: n.groundRadius,
        durationMs: n.durationMs || 10_000,
        tickIntervalMs: n.tickIntervalMs,
        baseValue: n.directHeal || n.directDamage || 0,
      });
    }
    if (effects.length === 0) effects.push({ type: 'BUFF', auraId: n.shortId, durationMs: 1000 });
    registerRawSpells(engine, [{
      id: n.id,
      name: n.name,
      classId: n.classId,
      school: n.school,
      targetType: n.targetType,
      castTimeMs: n.channelDurationMs > 0 && n.castTimeMs === n.channelDurationMs ? -1 : n.castTimeMs,
      channelDurationMs: n.channelDurationMs,
      gcdCategory: n.gcdCategory,
      cooldownMs: n.cooldownMs,
      resourceCost: n.resourceKind === 'NONE' ? 'NONE' : n.resourceKind,
      resourceCostAmount: n.resourceCostAmount,
      runesRequired: n.runesRequired,
      travelOnly: n.isOutOfCombatOnly,
      effects,
    }], classId);
  }
}

export function pickCastTarget(
  spell: NormalizedSpell,
  caster: Unit,
  ally: Unit,
  enemy: Unit
): string {
  if (spell.targetType === 'SELF') return caster.id;
  if (
    spell.targetType === 'SINGLE_ALLY' ||
    spell.targetType === 'SMART_ALLY' ||
    spell.targetType === 'AOE_ALLY' ||
    spell.isHeal ||
    spell.isBuff ||
    spell.isResurrect ||
    spell.isDispel
  ) {
    return ally.id;
  }
  if (spell.targetType === 'GROUND') return caster.id;
  return enemy.id;
}

/** Cast a spell by canonical or short id; advance ticks to finish CASTED spells. */
export function castAndResolve(
  engine: CombatEngine,
  casterId: string,
  spellId: string,
  targetId: string
): boolean {
  const started = engine.castSpell(casterId, spellId, targetId);
  if (!started) {
    // try short id
    const short = spellId.includes('_') ? spellId.split('_').slice(1).join('_') : spellId;
    if (short !== spellId) {
      const alt = engine.castSpell(casterId, short, targetId);
      if (!alt) return false;
    } else {
      return false;
    }
  }
  // Finish any pending cast for this caster
  for (let i = 0; i < 40; i++) {
    const pending = engine.getPendingCasts().find(c => c.casterId === casterId);
    if (!pending) break;
    engine.tick(Math.max(50, Math.ceil(pending.remainingMs / 2) || 100));
  }
  engine.tick(1100); // clear GCD roughly
  return true;
}

export function spellsForSpec(classId: ClassId, specId: string): NormalizedSpell[] {
  const cls = ALL_CLASSES_NORMALIZED[classId];
  if (!cls) return [];
  return cls.allSpells.filter(s => s.specIds.length === 0 || s.specIds.includes(specId));
}

export { ALL_CLASSES_NORMALIZED, getSpellByAnyId, LEVEL_80_STATS };
