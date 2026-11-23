/**
 * 治疗 AI 技能优先级优化回归：triage / 外置减伤 / 迅捷治愈 / HoT 感知
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClassId, Unit } from '../types.js';
import {
  buildUsableCandidatesForUnit,
  canCastSwiftmendOn,
  createAIPersonality,
  evaluateUniversalAIDecision,
  getSpellByAnyId,
  isExternalSaveSpell,
  triageHealUrgency,
} from '../index.js';

function makeUnit(
  partial: Partial<Unit> & Pick<Unit, 'id' | 'role'> & { classId?: ClassId },
): Unit {
  const maxHp = partial.maxHp ?? 40_000;
  return {
    name: partial.name || partial.id,
    classId: (partial.classId || 'PRIEST') as ClassId,
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: partial.hp ?? maxHp,
    maxHp,
    absorb: partial.absorb ?? 0,
    resources: [{ kind: 'MANA', current: 40_000, max: 45_000 }],
    mp: 40_000,
    maxMp: 45_000,
    buffs: partial.buffs || [],
    threatTable: [],
    position: { x: 200, y: 200 },
    stats: {
      attackPower: 500,
      spellPower: 500,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
  };
}

describe('治疗 AI 技能优先级优化', () => {
  it('1. 迅捷治愈不再因 HEAL_ZONE 副效果被标成决策 AOE', () => {
    const sm = getSpellByAnyId('swiftmend') || getSpellByAnyId('druid_swiftmend');
    assert.ok(sm, '应能解析迅捷治愈');
    assert.equal(sm!.targetType, 'SINGLE_ALLY');
    assert.equal(sm!.isAOE, false, '单体急救不应进群疗池');
  });

  it('2. 戒律外置减伤进入治疗候选；坦克极危优先痛苦压制', () => {
    const healer = makeUnit({
      id: 'disc',
      classId: 'PRIEST',
      role: 'HEALER',
      spec: 'DISCIPLINE',
      name: '戒律牧',
    });
    const cands = buildUsableCandidatesForUnit(healer, 'DISCIPLINE', () => true, {
      roleFilter: 'HEAL',
    });
    const pain = cands.find(
      c => c.normalizedSpell && isExternalSaveSpell(c.normalizedSpell),
    );
    assert.ok(pain, '痛苦压制/守护之魂类外置减伤应出现在治疗候选中');

    const dyingTank = makeUnit({
      id: 'tank',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 12_000,
      maxHp: 65_000,
    });
    const okDps = makeUnit({ id: 'd1', role: 'DPS', classId: 'MAGE', hp: 36_000, maxHp: 36_000 });
    const decision = evaluateUniversalAIDecision({
      caster: healer,
      personality: createAIPersonality(healer.name, healer.id),
      allies: [healer, dyingTank, okDps],
      enemies: [makeUnit({ id: 'boss', role: 'ENEMY', classId: 'BOSS', hp: 1e6, maxHp: 1e6 })],
      usableSkills: cands,
      tickCount: 3,
    });
    assert.equal(decision.decisionType, 'EMERGENCY_ST');
    assert.equal(decision.targetUnit?.id, dyingTank.id);
    assert.ok(
      decision.chosenCandidate?.normalizedSpell &&
        isExternalSaveSpell(decision.chosenCandidate.normalizedSpell),
      `极危坦克应先外置减伤，实际=${decision.chosenCandidate?.spellId}`,
    );
  });

  it('3. 无回春/愈合时不选迅捷治愈；有 HoT 时可进急救', () => {
    const druid = makeUnit({
      id: 'resto',
      classId: 'DRUID',
      role: 'HEALER',
      spec: 'RESTORATION',
      name: '奶德',
    });
    const cands = buildUsableCandidatesForUnit(druid, 'RESTORATION', () => true, {
      roleFilter: 'HEAL',
    });
    const bare = makeUnit({
      id: 't_bare',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 15_000,
      maxHp: 65_000,
      buffs: [],
    });
    assert.equal(canCastSwiftmendOn(bare), false);

    const withHot = makeUnit({
      id: 't_hot',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 15_000,
      maxHp: 65_000,
      buffs: [
        {
          id: 'rejuv',
          spellId: 'rejuvenation',
          name: '回春术',
          kind: 'HOT',
          tags: ['HOT'],
          sourceUnitId: druid.id,
          targetUnitId: 't_hot',
          durationMs: 12_000,
          remainingMs: 10_000,
          stacks: 1,
          maxStacks: 1,
        },
      ],
    });
    assert.equal(canCastSwiftmendOn(withHot), true);

    const decisionBare = evaluateUniversalAIDecision({
      caster: druid,
      personality: createAIPersonality(druid.name, druid.id),
      allies: [
        druid,
        bare,
        makeUnit({ id: 'd_ok', role: 'DPS', classId: 'MAGE', hp: 36_000, maxHp: 36_000 }),
      ],
      enemies: [makeUnit({ id: 'boss', role: 'ENEMY', classId: 'BOSS', hp: 1e6, maxHp: 1e6 })],
      usableSkills: cands,
      tickCount: 4,
    });
    assert.equal(decisionBare.decisionType, 'EMERGENCY_ST');
    assert.notEqual(
      decisionBare.chosenCandidate?.spellId?.includes('swiftmend'),
      true,
      '无 HoT 时不可选迅捷治愈',
    );

    const decisionHot = evaluateUniversalAIDecision({
      caster: druid,
      personality: createAIPersonality(druid.name, druid.id),
      allies: [
        druid,
        withHot,
        makeUnit({ id: 'd_ok2', role: 'DPS', classId: 'MAGE', hp: 36_000, maxHp: 36_000 }),
      ],
      enemies: [makeUnit({ id: 'boss', role: 'ENEMY', classId: 'BOSS', hp: 1e6, maxHp: 1e6 })],
      usableSkills: cands,
      tickCount: 5,
    });
    assert.equal(decisionHot.decisionType, 'EMERGENCY_ST');
    // 有 HoT 时允许选迅捷治愈（不强制，因可能有更高分瞬抬）
    assert.ok(decisionHot.chosenCandidate);
  });

  it('4. triage：同血量%时坦克优先于 DPS', () => {
    const tank = makeUnit({
      id: 'tank',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 32_500,
      maxHp: 65_000,
    });
    const dps = makeUnit({
      id: 'dps',
      role: 'DPS',
      classId: 'MAGE',
      hp: 18_000,
      maxHp: 36_000,
    });
    assert.ok(triageHealUrgency(tank) > triageHealUrgency(dps));
  });

  it('5. 目标已有护盾时，常规阶段不再优先重复上盾', () => {
    const healer = makeUnit({
      id: 'disc2',
      classId: 'PRIEST',
      role: 'HEALER',
      spec: 'DISCIPLINE',
    });
    const cands = buildUsableCandidatesForUnit(healer, 'DISCIPLINE', () => true, {
      roleFilter: 'HEAL',
    });
    const shielded = makeUnit({
      id: 't_shield',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 55_000,
      maxHp: 65_000,
      absorb: 10_000,
      buffs: [
        {
          id: 'pws',
          spellId: 'power_word_shield',
          name: '真言术：盾',
          kind: 'BUFF',
          tags: ['ABSORB'],
          sourceUnitId: healer.id,
          targetUnitId: 't_shield',
          durationMs: 15_000,
          remainingMs: 12_000,
          stacks: 1,
          maxStacks: 1,
        },
      ],
    });
    const full = makeUnit({ id: 'full', role: 'DPS', classId: 'MAGE', hp: 36_000, maxHp: 36_000 });
    const decision = evaluateUniversalAIDecision({
      caster: healer,
      personality: createAIPersonality(healer.name, healer.id),
      allies: [healer, shielded, full],
      enemies: [makeUnit({ id: 'boss', role: 'ENEMY', classId: 'BOSS', hp: 1e6, maxHp: 1e6 })],
      usableSkills: cands,
      tickCount: 8,
    });
    assert.equal(decision.decisionType, 'SUSTAINED_ST');
    const sid = decision.chosenCandidate?.spellId || '';
    assert.equal(
      sid.includes('power_word_shield') || sid.includes('pw_shield'),
      false,
      `已有盾不应重复上盾，实际=${sid}`,
    );
  });
});
