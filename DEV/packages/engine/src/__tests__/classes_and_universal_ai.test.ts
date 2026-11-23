import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CLASSES_NORMALIZED,
  ALL_CLASS_IDS,
  getSpellsForClassSpec,
  getSpellByAnyId,
  getSpellGcdCategory,
  isOffGcdSpellId,
} from '../classes/ClassRegistry.js';
import {
  LEVEL_80_CAP,
  LEVEL_80_MAX_HASTE,
  LEVEL_80_STATS,
  getHastedCastTimeMs,
  getEffectiveGcdMs,
  createLevel80BaseStats,
} from '../engine/TierProfile.js';
import {
  buildUsableCandidatesForUnit,
  createAIPersonality,
  evaluateUniversalAIDecision,
} from '../ai/SkillMetricEvaluator.js';
import { HealerAI } from '../ai/HealerAI.js';
import { DpsAI } from '../ai/DpsAI.js';
import { TankAI } from '../ai/TankAI.js';
import type { ClassId, RoleId, Unit } from '../types.js';
import type { GameState } from '../ai/AIController.js';

function makeUnit(overrides: Partial<Unit> & { spec?: string }): Unit {
  const role: RoleId | 'ENEMY' = overrides.role ?? 'DPS';
  const classId = overrides.classId ?? 'WARRIOR';
  const maxHp = overrides.maxHp ?? (role === 'TANK' ? LEVEL_80_STATS.tankBaseHp : LEVEL_80_STATS.dpsHealerBaseHp);
  const maxMp = overrides.maxMp ?? (role === 'HEALER' ? LEVEL_80_STATS.healerBaseMp : LEVEL_80_STATS.casterBaseMp);
  const u: Unit = {
    id: overrides.id ?? `u_${classId}_${role}`,
    name: overrides.name ?? `${classId}_${role}`,
    classId,
    role,
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: overrides.hp ?? maxHp,
    maxHp,
    mp: overrides.mp ?? maxMp,
    maxMp,
    energy: overrides.energy ?? 100,
    rage: overrides.rage ?? 80,
    focus: overrides.focus ?? 100,
    runicPower: overrides.runicPower ?? 80,
    holyPower: overrides.holyPower ?? 3,
    comboPoints: overrides.comboPoints ?? 5,
    absorb: overrides.absorb ?? 0,
    buffs: overrides.buffs ?? [],
    threatTable: overrides.threatTable ?? [],
    resources: overrides.resources ?? [
      { kind: 'MANA', current: overrides.mp ?? maxMp, max: maxMp },
      { kind: 'ENERGY', current: overrides.energy ?? 100, max: 100 },
      { kind: 'RAGE', current: overrides.rage ?? 80, max: 100 },
      { kind: 'FOCUS', current: overrides.focus ?? 100, max: 100 },
      { kind: 'RUNIC_POWER', current: overrides.runicPower ?? 80, max: 100 },
      { kind: 'HOLY_POWER', current: overrides.holyPower ?? 3, max: 3 },
      { kind: 'COMBO_POINTS', current: overrides.comboPoints ?? 5, max: 5 },
    ],
    position: overrides.position ?? { x: 400, y: 260 },
    stats: overrides.stats ?? createLevel80BaseStats(role === 'ENEMY' ? 'DPS' : role, classId),
  };
  if (overrides.spec) {
    (u as unknown as { spec: string }).spec = overrides.spec;
  }
  return u;
}

describe('Cataclysm Full 10-Class Roster, Level 80 Max-Haste, GCD & Universal AI', () => {
  it('1. 全 10 职业 & 30 专精注册表完整性与机制校验', () => {
    assert.equal(ALL_CLASS_IDS.length, 10, '必须包含大灾变全部 10 个可选职业');
    const expectedClasses: ClassId[] = [
      'DK', 'DRUID', 'SHAMAN', 'MAGE', 'ROGUE',
      'WARRIOR', 'PALADIN', 'HUNTER', 'PRIEST', 'WARLOCK',
    ];
    for (const cid of expectedClasses) {
      assert.ok(ALL_CLASSES_NORMALIZED[cid], `缺少职业定义: ${cid}`);
    }

    let totalSpecs = 0;
    for (const cid of expectedClasses) {
      const cls = ALL_CLASSES_NORMALIZED[cid];
      assert.equal(cls.specs.length, 3, `${cid} 必须拥有 3 个大灾变专精`);
      totalSpecs += cls.specs.length;

      for (const spec of cls.specs) {
        assert.ok(spec.spells.length >= 4, `${cid}/${spec.id} 至少应有 4 个可用技能`);
        if (spec.role === 'DPS') {
          const hasAoeDamage = spec.spells.some(s => s.isDamage && s.isAOE);
          assert.ok(hasAoeDamage, `DPS 专精 ${cid}/${spec.id} 必须拥有至少 1 个群体伤害技能`);
        }
        if (spec.role === 'HEALER') {
          const hasAoeHeal = spec.spells.some(s => s.isHeal && s.isAOE);
          const hasStHeal = spec.spells.some(s => s.isHeal && !s.isAOE);
          assert.ok(hasAoeHeal, `治疗专精 ${cid}/${spec.id} 必须拥有至少 1 个群体治疗技能`);
          assert.ok(hasStHeal, `治疗专精 ${cid}/${spec.id} 必须拥有至少 1 个单体治疗技能`);
        }
        if (spec.role === 'TANK') {
          const hasTaunt = spec.spells.some(s => s.isTaunt);
          const hasDef = spec.spells.some(s => s.isDefensive);
          const hasAoe = spec.spells.some(s => s.isDamage && s.isAOE);
          assert.ok(hasTaunt, `坦克专精 ${cid}/${spec.id} 必须拥有嘲讽技能`);
          assert.ok(hasDef, `坦克专精 ${cid}/${spec.id} 必须拥有减伤技能`);
          assert.ok(hasAoe, `坦克专精 ${cid}/${spec.id} 必须拥有群体拉怪技能`);
        }
      }
    }
    assert.equal(totalSpecs, 30, '10 个职业总计必须拥有 30 个专精');
  });

  it('2. 80 级满级满急速 (50% Haste) 数值标定与三档 GCD 分组校验', () => {
    assert.equal(LEVEL_80_CAP, 80);
    assert.equal(LEVEL_80_MAX_HASTE, 0.5);

    // GCD 分组校验（严禁出现 750ms）
    assert.equal(getEffectiveGcdMs('NORMAL', 0), 1500);
    assert.equal(getEffectiveGcdMs('NORMAL', 0.5), 1000, '50% 满急速下常规法术 GCD 必须精确封顶为 1000ms');
    assert.equal(getEffectiveGcdMs('NORMAL', 0.8), 1000, '超高急速下常规法术 GCD 不得低于 1000ms 下限');
    assert.equal(getEffectiveGcdMs('ROGUE', 0), 1000, '盗贼/能量/集中值 GCD 固定 1000ms');
    assert.equal(getEffectiveGcdMs('ROGUE', 0.5), 1000);
    assert.equal(getEffectiveGcdMs('OFF_GCD', 0.5), 0, 'OFF_GCD 技能公共冷却必须为 0ms');

    // 奶萨核心设定核查：治疗链 2.5s 基础读条 -> 满急速 1.67s (1667ms)、无 CD、isAOE
    const chainHeal = getSpellByAnyId('shaman_chain_heal');
    assert.ok(chainHeal, '必须存在 shaman_chain_heal');
    assert.equal(chainHeal.castTimeMs, 2500, '治疗链基础读条应为 2500ms');
    assert.equal(getHastedCastTimeMs(chainHeal.castTimeMs, LEVEL_80_MAX_HASTE), 1667, '80级满急速治疗链读条应为 1667ms');
    assert.equal(chainHeal.cooldownMs, 0, '治疗链必须无冷却 (0ms)');
    assert.equal(chainHeal.isAOE, true, '治疗链必须标记为群体治疗');

    // 奶萨先祖之魂无冷却
    const ancestralSpirit = getSpellByAnyId('shaman_ancestral_spirit');
    assert.ok(ancestralSpirit);
    assert.equal(ancestralSpirit.cooldownMs, 0, '先祖之魂作为常规战外复活技能应无冷却');

    // 打断、嘲讽与 DK 减伤必须在 OFF_GCD 组
    const mustBeOffGcd = [
      'shaman_wind_shear',
      'rogue_kick',
      'warrior_pummel',
      'paladin_rebuke',
      'dk_mind_freeze',
      'mage_counterspell',
      'hunter_silencing_shot',
      'warrior_taunt',
      'paladin_hand_of_reckoning',
      'dk_dark_command',
      'druid_growl',
      'dk_bone_shield',
      'dk_vampiric_blood',
      'dk_anti_magic_shell',
      'dk_icebound_fortitude',
    ];
    for (const id of mustBeOffGcd) {
      assert.equal(
        getSpellGcdCategory(id),
        'OFF_GCD',
        `技能 ${id} 必须归入 OFF_GCD 分组`
      );
      assert.equal(isOffGcdSpellId(id), true, `isOffGcdSpellId(${id}) 必须返回 true`);
    }

    // 打断技能：标记 isInterrupt；近战踢 / 责难 / 心灵冰冻 = 80px，远程打断 = 200px
    const meleeInterrupts = ['rogue_kick', 'warrior_pummel', 'paladin_rebuke', 'dk_mind_freeze'];
    const rangedInterrupts = ['shaman_wind_shear', 'mage_counterspell', 'hunter_silencing_shot'];
    for (const id of meleeInterrupts) {
      const sp = getSpellByAnyId(id);
      assert.ok(sp, id);
      assert.equal(sp!.isInterrupt, true, `${id} 须标记 isInterrupt`);
      assert.equal(sp!.rangePx, 80, `${id} 近战打断射程应为 80`);
    }
    for (const id of rangedInterrupts) {
      const sp = getSpellByAnyId(id);
      assert.ok(sp, id);
      assert.equal(sp!.isInterrupt, true, `${id} 须标记 isInterrupt`);
      assert.equal(sp!.rangePx, 200, `${id} 短距打断射程应为 200`);
    }
  });

  it('3. 通用治疗 AI 规则验证（奶萨/奶德/神牧/戒律牧/奶骑 零专精硬编码）', () => {
    const healerSpecs: Array<{ classId: ClassId; spec: string }> = [
      { classId: 'SHAMAN', spec: 'RESTORATION' },
      { classId: 'DRUID', spec: 'RESTORATION' },
      { classId: 'PRIEST', spec: 'HOLY' },
      { classId: 'PRIEST', spec: 'DISCIPLINE' },
      { classId: 'PALADIN', spec: 'HOLY' },
    ];

    const boss = makeUnit({ id: 'boss_1', name: '首领', classId: 'BOSS', role: 'ENEMY', hp: 500000, maxHp: 500000 });

    for (const { classId, spec } of healerSpecs) {
      const healer = makeUnit({ id: `h_${classId}_${spec}`, name: `${classId}_${spec}`, classId, role: 'HEALER', spec });
      const personality = createAIPersonality(healer.name, healer.id);
      const candidates = buildUsableCandidatesForUnit(healer, spec, () => true, { roleFilter: 'HEAL' });
      assert.ok(candidates.length >= 3, `${classId}/${spec} 应生成至少 3 个可用治疗候选`);

      // 场景 A：坦克血线安全 (80% >= 45%)，且 3 名队友低于健康线 (<85%) -> 必须优先释放 AOE 治疗
      const safeTank = makeUnit({ id: 'tank_safe', role: 'TANK', classId: 'WARRIOR', hp: 52000, maxHp: 65000 });
      const inj1 = makeUnit({ id: 'dps1', role: 'DPS', classId: 'MAGE', hp: 23000, maxHp: 36000 });
      const inj2 = makeUnit({ id: 'dps2', role: 'DPS', classId: 'HUNTER', hp: 22000, maxHp: 36000 });
      const inj3 = makeUnit({ id: 'dps3', role: 'DPS', classId: 'WARLOCK', hp: 24000, maxHp: 36000 });

      const aoeDecision = evaluateUniversalAIDecision({
        caster: healer,
        personality,
        allies: [healer, safeTank, inj1, inj2, inj3],
        enemies: [boss],
        usableSkills: candidates,
        tickCount: 10,
      });

      assert.equal(aoeDecision.decisionType, 'AOE', `${classId}/${spec} 在坦克安全+多人受伤时必须优先 AOE`);
      assert.equal(aoeDecision.chosenCandidate?.isAOE, true, `${classId}/${spec} 选中的必须是 AOE 治疗技能`);

      // 场景 B：坦克濒死 (25% < 45%) -> 单体紧急救急
      const dyingTank = makeUnit({ id: 'tank_dying', role: 'TANK', classId: 'WARRIOR', hp: 16250, maxHp: 65000 });
      const healthy1 = makeUnit({ id: 'h1', role: 'DPS', classId: 'MAGE', hp: 36000, maxHp: 36000 });
      const emergDecision = evaluateUniversalAIDecision({
        caster: healer,
        personality,
        allies: [healer, dyingTank, healthy1],
        enemies: [boss],
        usableSkills: candidates,
        tickCount: 12,
      });
      assert.equal(emergDecision.decisionType, 'EMERGENCY_ST', `${classId}/${spec} 坦克濒死时必须进入 EMERGENCY_ST`);
      assert.equal(emergDecision.targetUnit?.id, dyingTank.id);
      if (classId === 'SHAMAN') {
        assert.notEqual(
          emergDecision.chosenCandidate?.spellId,
          'shaman_healing_wave',
          '奶萨在坦克濒死时绝不可释放慢速低吞吐量的治疗波'
        );
      }

      // 场景 C：全团濒危 (4人 < 45%) -> 奶萨绝不能只读治疗波，必须释放群体急救/大招
      const crit1 = makeUnit({ id: 'c1', role: 'TANK', classId: 'PALADIN', hp: 20000, maxHp: 65000 });
      const crit2 = makeUnit({ id: 'c2', role: 'DPS', classId: 'MAGE', hp: 10000, maxHp: 36000 });
      const crit3 = makeUnit({ id: 'c3', role: 'DPS', classId: 'ROGUE', hp: 11000, maxHp: 36000 });
      const crit4 = makeUnit({ id: 'c4', role: 'DPS', classId: 'HUNTER', hp: 12000, maxHp: 36000 });
      const crisisDecision = evaluateUniversalAIDecision({
        caster: healer,
        personality,
        allies: [healer, crit1, crit2, crit3, crit4],
        enemies: [boss],
        usableSkills: candidates,
        tickCount: 15,
      });
      assert.equal(crisisDecision.decisionType, 'AOE', `${classId}/${spec} 全团濒危必须触发群体急救/大招`);
      assert.notEqual(crisisDecision.chosenCandidate?.spellId, 'shaman_healing_wave');
    }

    // 场景 D：奶萨低蓝 (20%) 且仅单人轻伤 (82%) -> 高性价比治疗波胜出
    const lowManaShaman = makeUnit({
      id: 'low_mp_sham',
      name: '低蓝奶萨',
      classId: 'SHAMAN',
      role: 'HEALER',
      spec: 'RESTORATION',
      mp: 9000,
      maxMp: 45000,
    });
    const shamPers = createAIPersonality(lowManaShaman.name, lowManaShaman.id);
    shamPers.resourceHealthyThreshold = 0.35;
    const shamCandidates = buildUsableCandidatesForUnit(lowManaShaman, 'RESTORATION', () => true, { roleFilter: 'HEAL' });
    const lightTank = makeUnit({ id: 't_light', role: 'TANK', classId: 'DK', hp: 54000, maxHp: 65000 });
    const fullAlly = makeUnit({ id: 'a_full', role: 'DPS', classId: 'MAGE', hp: 36000, maxHp: 36000 });
    const sustainDecision = evaluateUniversalAIDecision({
      caster: lowManaShaman,
      personality: shamPers,
      allies: [lowManaShaman, lightTank, fullAlly],
      enemies: [boss],
      usableSkills: shamCandidates,
      tickCount: 5,
    });
    assert.equal(sustainDecision.decisionType, 'SUSTAINED_ST');
    assert.ok(
      sustainDecision.chosenCandidate?.spellId === 'shaman_healing_wave' ||
      sustainDecision.chosenCandidate?.spellId === 'shaman_riptide',
      `低蓝轻伤时应选择高性价比技能(实际: ${sustainDecision.chosenCandidate?.spellId})`
    );
  });

  it('4. 全 10 职业 DPS 专精通用规则校验：多目标(>=3)必放 AOE，单目标按性价比/输出选优', () => {
    const enemy1 = makeUnit({ id: 'e1', name: '目标1', classId: 'BOSS', role: 'ENEMY', hp: 200000, maxHp: 200000 });
    const enemy2 = makeUnit({ id: 'e2', name: '目标2', classId: 'BOSS', role: 'ENEMY', hp: 100000, maxHp: 100000 });
    const enemy3 = makeUnit({ id: 'e3', name: '目标3', classId: 'BOSS', role: 'ENEMY', hp: 100000, maxHp: 100000 });
    const enemy4 = makeUnit({ id: 'e4', name: '目标4', classId: 'BOSS', role: 'ENEMY', hp: 100000, maxHp: 100000 });

    const dpsAi = new DpsAI(0);

    for (const cid of ALL_CLASS_IDS) {
      const cls = ALL_CLASSES_NORMALIZED[cid];
      for (const spec of cls.specs) {
        if (spec.role !== 'DPS') continue;
        const unit = makeUnit({
          id: `dps_${cid}_${spec.id}`,
          name: `${cid}_${spec.id}`,
          classId: cid,
          role: 'DPS',
          spec: spec.id,
        });
        const gsAoe: GameState = {
          units: [unit, enemy1, enemy2, enemy3, enemy4],
          bossId: 'e1',
          bossChannelSpellId: null,
          bossChannelRemainingMs: 0,
          elapsedMs: 1000,
          phase: 'BOSS_COMBAT',
        };
        const aoeActions = dpsAi.decide(unit, gsAoe);
        assert.ok(aoeActions.length > 0, `${cid}/${spec.id} 在 4 目标下必须产出动作`);
        const pickedSpell = getSpellByAnyId(aoeActions[0].action.spellId, cid);
        assert.ok(
          pickedSpell?.isAOE,
          `${cid}/${spec.id} 在 4 目标下必须优先释放 AOE 技能 (实际选中: ${aoeActions[0].action.spellId})`
        );

        const gsSt: GameState = {
          units: [unit, enemy1],
          bossId: 'e1',
          bossChannelSpellId: null,
          bossChannelRemainingMs: 0,
          elapsedMs: 1000,
          phase: 'BOSS_COMBAT',
        };
        const stActions = dpsAi.decide(unit, gsSt);
        assert.ok(stActions.length > 0, `${cid}/${spec.id} 在单目标下必须产出动作`);
      }
    }
  });

  it('5. 全 4 大坦克职业 (战士/骑士/DK/德鲁伊) 通用 TankAI 与 HealerAI 集成校验', () => {
    const tankSpecs: Array<{ classId: ClassId; spec: string }> = [
      { classId: 'WARRIOR', spec: 'PROTECTION' },
      { classId: 'PALADIN', spec: 'PROTECTION' },
      { classId: 'DK', spec: 'BLOOD' },
      { classId: 'DRUID', spec: 'FERAL' },
    ];
    const tankAi = new TankAI();
    const healerAi = new HealerAI();

    for (const { classId, spec } of tankSpecs) {
      const tank = makeUnit({
        id: `tank_${classId}`,
        name: `${classId}_TANK`,
        classId,
        role: 'TANK',
        spec,
        hp: 45000,
        maxHp: 65000,
      });
      const dps = makeUnit({ id: 'dps_ot', classId: 'MAGE', role: 'DPS', spec: 'FIRE' });
      const boss = makeUnit({
        id: 'boss_1',
        classId: 'BOSS',
        role: 'ENEMY',
        hp: 500000,
        maxHp: 500000,
        threatTable: [{ sourceUnitId: dps.id, amount: 99999 }],
      });
      const add1 = makeUnit({ id: 'add_1', classId: 'BOSS', role: 'ENEMY', hp: 50000, maxHp: 50000 });
      const add2 = makeUnit({ id: 'add_2', classId: 'BOSS', role: 'ENEMY', hp: 50000, maxHp: 50000 });

      const gs: GameState = {
        units: [tank, dps, boss, add1, add2],
        bossId: 'boss_1',
        bossChannelSpellId: null,
        bossChannelRemainingMs: 0,
        elapsedMs: 2000,
        phase: 'BOSS_COMBAT',
      };
      const actions = tankAi.decide(tank, gs);
      assert.ok(actions.some(a => getSpellByAnyId(a.action.spellId, classId)?.isTaunt), `${classId} 坦克 OT 时必须嘲讽`);
      assert.ok(actions.some(a => getSpellByAnyId(a.action.spellId, classId)?.isAOE), `${classId} 坦克 3 目标时必须群拉 AOE`);

      // 低血量测试减伤触发
      const lowTank = makeUnit({
        id: `tank_low_${classId}`,
        name: `${classId}_LOW`,
        classId,
        role: 'TANK',
        spec,
        hp: 18000,
        maxHp: 65000,
      });
      const lowGs: GameState = {
        units: [lowTank, boss],
        bossId: 'boss_1',
        bossChannelSpellId: null,
        bossChannelRemainingMs: 0,
        elapsedMs: 3000,
        phase: 'BOSS_COMBAT',
      };
      const lowActions = tankAi.decide(lowTank, lowGs);
      assert.ok(
        lowActions.some(a => getSpellByAnyId(a.action.spellId, classId)?.isDefensive),
        `${classId} 坦克低血量 (<35%) 必须开启减伤`
      );
    }

    // 验证 HealerAI 能够驱动新增职业牧师与圣骑士
    const holyPriest = makeUnit({ id: 'priest_h', classId: 'PRIEST', role: 'HEALER', spec: 'HOLY' });
    const tank = makeUnit({ id: 't1', classId: 'PALADIN', role: 'TANK', hp: 55000, maxHp: 65000 });
    const dps1 = makeUnit({ id: 'd1', classId: 'HUNTER', role: 'DPS', hp: 20000, maxHp: 36000 });
    const dps2 = makeUnit({ id: 'd2', classId: 'WARLOCK', role: 'DPS', hp: 21000, maxHp: 36000 });
    const boss = makeUnit({ id: 'boss_1', classId: 'BOSS', role: 'ENEMY', hp: 500000, maxHp: 500000 });

    const priestActions = healerAi.decide(holyPriest, {
      units: [holyPriest, tank, dps1, dps2, boss],
      bossId: 'boss_1',
      bossChannelSpellId: null,
      bossChannelRemainingMs: 0,
      elapsedMs: 2500,
      phase: 'BOSS_COMBAT',
    });
    assert.ok(priestActions.length > 0, '神圣牧师 HealerAI 必须正常产出治疗指令');
    assert.ok(
      getSpellByAnyId(priestActions[0].action.spellId, 'PRIEST')?.isAOE,
      '神圣牧师在坦克安全+多名队友低于健康线时必须优先释放群体治疗'
    );
  });
});
