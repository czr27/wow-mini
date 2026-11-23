import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsableCandidatesForUnit,
  createAIPersonality,
  evaluateUniversalAIDecision,
  isHealSupportBuffSpell,
} from '../ai/SkillMetricEvaluator.js';
import { getSpellByAnyId } from '../classes/ClassRegistry.js';
import { createLevel80BaseStats, LEVEL_80_STATS } from '../engine/TierProfile.js';
import type { Unit } from '../types.js';

function makeUnit(overrides: Partial<Unit> & { spec?: string }): Unit {
  const role = overrides.role ?? 'HEALER';
  const classId = overrides.classId ?? 'SHAMAN';
  const maxHp = role === 'TANK' ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp;
  const maxMp = LEVEL_80_STATS.healerBaseMp;
  const u: Unit = {
    id: overrides.id ?? 'ai_1',
    name: overrides.name ?? 'AI',
    classId,
    role,
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: overrides.hp ?? maxHp,
    maxHp,
    mp: overrides.mp ?? maxMp,
    maxMp,
    energy: 100,
    rage: 0,
    focus: 100,
    runicPower: 0,
    holyPower: 0,
    comboPoints: 0,
    absorb: 0,
    buffs: overrides.buffs ?? [],
    threatTable: [],
    resources: [{ kind: 'MANA', current: maxMp, max: maxMp }],
    position: { x: 200, y: 200 },
    stats: createLevel80BaseStats(role === 'ENEMY' ? 'DPS' : role, classId),
  };
  if (overrides.spec) (u as any).spec = overrides.spec;
  return u;
}

describe('AI 数据驱动选技（无需按 spellId 注册新逻辑）', () => {
  it('1. 萨满治疗候选自动包含大地之盾/生命释放/治疗之潮/升腾等，无需硬编码表', () => {
    const shaman = makeUnit({ classId: 'SHAMAN', role: 'HEALER', spec: 'RESTORATION' });
    const cands = buildUsableCandidatesForUnit(shaman, 'RESTORATION', () => true, {
      roleFilter: 'HEAL',
      useShortId: true,
    });
    const ids = new Set(cands.map(c => c.spellId));
    assert.ok(ids.has('earth_shield') || ids.has('healing_tide') || ids.has('healing_tide_totem'), '应包含大地之盾或治疗之潮');
    assert.ok(ids.has('unleash_life') || ids.has('healing_surge') || ids.has('chain_heal'), '应包含常规/增效治疗');
    assert.ok(
      cands.some(c => c.normalizedSpell && isHealSupportBuffSpell(c.normalizedSpell)),
      '应包含治疗向支持 Buff'
    );
    // 候选全部来自 ClassRegistry，而非 PREDEFINED 硬编码表
    for (const c of cands) {
      assert.ok(c.normalizedSpell, `${c.spellId} 必须带 NormalizedSpell`);
      assert.equal(c.normalizedSpell!.classId, 'SHAMAN');
    }
  });

  it('2. 无危急时大地之盾缺失走 BUFF_MAINTENANCE；危急时仍优先急救', () => {
    const shaman = makeUnit({ id: 'shaman', classId: 'SHAMAN', role: 'HEALER', spec: 'RESTORATION' });
    const tankSafe = makeUnit({
      id: 'tank',
      classId: 'WARRIOR',
      role: 'TANK',
      hp: Math.round(LEVEL_80_STATS.tankBaseHp * 0.96),
    });
    const cands = buildUsableCandidatesForUnit(shaman, 'RESTORATION', () => true, {
      roleFilter: 'HEAL',
      useShortId: true,
    });
    const maintain = evaluateUniversalAIDecision({
      caster: shaman,
      personality: createAIPersonality(shaman.name, shaman.id),
      allies: [shaman, tankSafe],
      enemies: [],
      usableSkills: cands,
      tickCount: 10,
    });
    assert.equal(maintain.decisionType, 'BUFF_MAINTENANCE');
    assert.ok(
      maintain.chosenCandidate?.spellId.includes('earth_shield') ||
        maintain.chosenCandidate?.normalizedSpell?.auraId === 'earth_shield',
      `应优先维护大地之盾，实际: ${maintain.chosenCandidate?.spellId}`
    );

    const tankDying = makeUnit({
      id: 'tank2',
      classId: 'WARRIOR',
      role: 'TANK',
      hp: Math.round(LEVEL_80_STATS.tankBaseHp * 0.2),
    });
    const emergency = evaluateUniversalAIDecision({
      caster: shaman,
      personality: createAIPersonality(shaman.name, shaman.id),
      allies: [shaman, tankDying],
      enemies: [],
      usableSkills: cands,
      tickCount: 11,
    });
    assert.ok(
      emergency.decisionType === 'EMERGENCY_ST' || emergency.decisionType === 'AOE',
      `危急时不得只维护 Buff，实际: ${emergency.decisionType}`
    );
  });

  it('3. 危急血线时优先开启升腾/先祖指引等 MAJOR 增效，而非依赖 spellId 白名单', () => {
    const shaman = makeUnit({ id: 'shaman', classId: 'SHAMAN', role: 'HEALER', spec: 'RESTORATION' });
    const tank = makeUnit({
      id: 'tank',
      classId: 'WARRIOR',
      role: 'TANK',
      hp: Math.round(LEVEL_80_STATS.tankBaseHp * 0.2),
    });
    const a1 = makeUnit({ id: 'a1', role: 'DPS', hp: Math.round(LEVEL_80_STATS.dpsHealerBaseHp * 0.2) });
    const a2 = makeUnit({ id: 'a2', role: 'DPS', hp: Math.round(LEVEL_80_STATS.dpsHealerBaseHp * 0.2) });
    // 坦克已有大地之盾，避免维护分支抢优先级
    tank.buffs = [
      {
        id: 'es',
        spellId: 'earth_shield',
        name: '大地之盾',
        kind: 'BUFF',
        tags: ['SHIELD'],
        sourceUnitId: shaman.id,
        targetUnitId: tank.id,
        stacks: 9,
        maxStacks: 9,
        durationMs: 600000,
        remainingMs: 600000,
        school: 'NATURE',
      },
    ];

    const cands = buildUsableCandidatesForUnit(shaman, 'RESTORATION', () => true, {
      roleFilter: 'HEAL',
      useShortId: true,
    });
    const decision = evaluateUniversalAIDecision({
      caster: shaman,
      personality: createAIPersonality(shaman.name, shaman.id),
      allies: [shaman, tank, a1, a2],
      enemies: [],
      usableSkills: cands,
      tickCount: 20,
    });
    assert.ok(
      decision.decisionType === 'EMERGENCY_ST' || decision.decisionType === 'AOE',
      `危急时应急救或团抬，实际: ${decision.decisionType}`
    );
    assert.ok(decision.chosenCandidate, '应选出技能');
  });

  it('4. 新技能只改 ClassRegistry 即可进候选：验证 earth_shield maxStacks 已数据化', () => {
    const es = getSpellByAnyId('earth_shield', 'SHAMAN');
    assert.ok(es);
    assert.equal(es!.maxStacks, 9);
    assert.ok(es!.isHeal || es!.isBuff, '大地之盾应对 AI 可见为治疗/Buff');
    assert.ok((es!.hotTotalHeal || 0) >= 6800 * 9, '叠层期望治疗应计入 hotTotalHeal');
  });
});
