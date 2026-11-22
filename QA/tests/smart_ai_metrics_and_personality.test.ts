import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeSkillMetrics,
  scoreSkillCandidate,
  createAIPersonality,
  evaluateUniversalAIDecision,
  COMPUTED_SKILL_METRICS,
  type SkillEvaluationInput,
  type AIPersonality,
  type SkillScoreContext,
} from '../../DEV/packages/engine/src/ai/SkillMetricEvaluator.js';
import { CombatEngine } from '../../DEV/packages/engine/src/engine/CombatEngine.js';
import { BossAI } from '../../DEV/packages/engine/src/ai/BossAI.js';
import type { Unit } from '../../DEV/packages/engine/src/types.js';

describe('Smart AI Metric Evaluator, Jitter & Decision Scoring', () => {

  it('1. 技能指标计算 (DPS, HPS, DPM, HPM, DPS/CD, HPS/CD, isAOE, Cycle) 严谨性测试', () => {
    // 测试单体直接治疗技能 (如滋养: 耗蓝少，读条长，性价比高)
    const nourishInput: SkillEvaluationInput = {
      id: 'test_nourish',
      name: '测试滋养',
      roleType: 'HEAL',
      resourceCost: 1100,
      castTimeMs: 2500,
      cooldownMs: 0,
      rawHeal: 4000,
      isAOE: false,
    };
    const nourishMetrics = computeSkillMetrics(nourishInput);

    assert.strictEqual(nourishMetrics.isAOE, false);
    assert.strictEqual(nourishMetrics.cycle, 'SUSTAINED'); // 无CD属于持续循环
    assert.strictEqual(nourishMetrics.hps, Math.round(4000 / 2.5)); // 1600
    assert.strictEqual(nourishMetrics.hpsPerCost, Number((4000 / 1100).toFixed(2))); // 3.64
    assert.strictEqual(nourishMetrics.hpsPerCd, Math.round(4000 / 2.5)); // 1600

    // 测试急救高耗治疗技能 (如愈合: 耗蓝高，读条快，吞吐量高但性价比低)
    const regrowthInput: SkillEvaluationInput = {
      id: 'test_regrowth',
      name: '测试愈合',
      roleType: 'HEAL',
      resourceCost: 3200,
      castTimeMs: 1500,
      cooldownMs: 0,
      rawHeal: 5000,
      isAOE: false,
    };
    const regrowthMetrics = computeSkillMetrics(regrowthInput);

    assert.ok(regrowthMetrics.hps > nourishMetrics.hps, '愈合 HPS 应显著高于滋养');
    assert.ok(nourishMetrics.hpsPerCost > regrowthMetrics.hpsPerCost, '滋养 HPM (治疗/消耗) 应显著高于愈合');

    // 测试长CD大周期群体爆发 (如宁静: 3分钟CD，群体大爆发)
    const tranqInput: SkillEvaluationInput = {
      id: 'test_tranquility',
      name: '测试宁静',
      roleType: 'HEAL',
      resourceCost: 5000,
      castTimeMs: 8000,
      cooldownMs: 180000,
      rawHeal: 40000,
      isAOE: true,
    };
    const tranqMetrics = computeSkillMetrics(tranqInput);

    assert.strictEqual(tranqMetrics.isAOE, true);
    assert.strictEqual(tranqMetrics.cycle, 'MAJOR'); // CD >= 45s 为大周期
    assert.strictEqual(tranqMetrics.hps, Math.round(40000 / 8.0)); // 5000
    assert.strictEqual(tranqMetrics.hpsPerCd, Math.round(40000 / 180)); // 222
  });

  it('2. AI 个性与抖动机制 (以名称/ID生成确定性随机数，不同AI具象化差异)', () => {
    const druidPersonalityA = createAIPersonality('暗夜治疗德鲁伊', 'healer_01');
    const druidPersonalityA2 = createAIPersonality('暗夜治疗德鲁伊', 'healer_01');
    const shamanPersonalityB = createAIPersonality('萨满治疗者', 'healer_02');
    const bossPersonality = createAIPersonality('高弗雷勋爵', 'boss_godfrey');

    // 验证相同标识下的确定性重现
    assert.strictEqual(
      druidPersonalityA.resourceHealthyThreshold,
      druidPersonalityA2.resourceHealthyThreshold,
      '相同名称与ID应生成完全一致的确定性个性阈值'
    );
    assert.strictEqual(
      druidPersonalityA.throughputVsEfficiencyBias,
      druidPersonalityA2.throughputVsEfficiencyBias
    );

    // 验证不同AI之间的抖动离散性
    assert.notStrictEqual(
      druidPersonalityA.resourceHealthyThreshold,
      shamanPersonalityB.resourceHealthyThreshold,
      '不同AI队友之间蓝量健康线必须产生抖动'
    );
    assert.notStrictEqual(
      druidPersonalityA.throughputVsEfficiencyBias,
      shamanPersonalityB.throughputVsEfficiencyBias,
      '不同AI队友之间吞吐量 vs 成本偏好必须产生抖动'
    );

    // 验证浮动范围约束
    assert.ok(
      druidPersonalityA.resourceHealthyThreshold >= 0.20 && druidPersonalityA.resourceHealthyThreshold <= 0.40,
      '蓝量健康线浮动应在 20%~40% 范围内'
    );
    assert.ok(
      druidPersonalityA.energyReserveThreshold >= 20 && druidPersonalityA.energyReserveThreshold <= 45,
      '能量储备线浮动应在 20~45 范围内'
    );
    assert.ok(
      druidPersonalityA.throughputVsEfficiencyBias >= 0.30 && druidPersonalityA.throughputVsEfficiencyBias <= 0.70,
      '输出与性价比平衡权重应在 0.3~0.7 范围内'
    );
  });

  it('3. 智能决策打分: 低资源时严格优先低耗/高性价比技能，资源充沛急救时优先高吞吐量技能', () => {
    const personality: AIPersonality = {
      seed: 12345,
      name: '测试治疗',
      id: 'test_healer',
      resourceHealthyThreshold: 0.35, // 35% 蓝量线
      energyReserveThreshold: 30,
      throughputVsEfficiencyBias: 0.50,
      cycleAggression: 1.0,
      aoeThresholdCount: 2,
      tickOffset: 0,
    };

    const nourishMetrics = COMPUTED_SKILL_METRICS['druid_nourish'];
    const regrowthMetrics = COMPUTED_SKILL_METRICS['druid_regrowth'];
    assert.ok(nourishMetrics && regrowthMetrics, '必须包含预计算的滋养与愈合指标');

    const ally1: Unit = {
      id: 'tank_1',
      name: '受创坦克',
      classId: 'DK',
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 50000,
      maxHp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 200 },
      stats: { attackPower: 2000, spellPower: 1000, critChance: 0.05, haste: 0, armor: 15000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    const enemy1: Unit = {
      id: 'boss_1',
      name: '首领怪',
      classId: 'BOSS',
      role: 'ENEMY',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 500000,
      maxHp: 500000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 150 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.05, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    // 场景 A: 蓝量处于健康线之下 (15000 / 100000 = 15% < 35%)
    const lowManaCaster: Unit = {
      id: 'healer_1',
      name: '治疗德鲁伊',
      classId: 'DRUID',
      role: 'HEALER',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 60000,
      maxHp: 60000,
      mp: 15000,
      maxMp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 480, y: 300 },
      stats: { attackPower: 500, spellPower: 6000, critChance: 0.15, haste: 0.1, armor: 3000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    const lowManaContext: SkillScoreContext = {
      caster: lowManaCaster,
      personality,
      allies: [ally1, lowManaCaster],
      enemies: [enemy1],
      tickCount: 0,
      isEmergency: false,
    };

    const nourishScoreLowMana = scoreSkillCandidate(nourishMetrics, lowManaContext);
    const regrowthScoreLowMana = scoreSkillCandidate(regrowthMetrics, lowManaContext);

    assert.ok(
      nourishScoreLowMana > regrowthScoreLowMana,
      `缺蓝低资源时，高性价比的滋养得分(${nourishScoreLowMana.toFixed(1)})应高于高消耗的愈合(${regrowthScoreLowMana.toFixed(1)})`
    );

    // 场景 B: 蓝量充沛 (90000 / 100000 = 90% >= 35%)
    const highManaCaster: Unit = {
      ...lowManaCaster,
      mp: 90000,
    };

    const highManaContext: SkillScoreContext = {
      caster: highManaCaster,
      personality,
      allies: [ally1, highManaCaster],
      enemies: [enemy1],
      tickCount: 0,
      isEmergency: false,
    };

    const nourishScoreHighMana = scoreSkillCandidate(nourishMetrics, highManaContext);
    const regrowthScoreHighMana = scoreSkillCandidate(regrowthMetrics, highManaContext);

    assert.ok(
      regrowthScoreHighMana > nourishScoreHighMana,
      `满蓝正常输出时，高吞吐量愈合得分(${regrowthScoreHighMana.toFixed(1)})应反超滋养(${nourishScoreHighMana.toFixed(1)})`
    );
  });

  it('4. 群体技能 (isAOE) 与大周期救急 (MAJOR) 智能自适应测试', () => {
    const personality: AIPersonality = {
      seed: 999,
      name: '测试萨满',
      id: 'test_shaman',
      resourceHealthyThreshold: 0.30,
      energyReserveThreshold: 30,
      throughputVsEfficiencyBias: 0.50,
      cycleAggression: 1.0,
      aoeThresholdCount: 2, // 达到2个伤员才值得AOE
      tickOffset: 0,
    };

    const healingRainMetrics = COMPUTED_SKILL_METRICS['shaman_healing_rain'];
    assert.ok(healingRainMetrics, '必须包含治疗之雨指标');
    assert.strictEqual(healingRainMetrics.isAOE, true);

    const caster: Unit = {
      id: 'shaman_1',
      name: '萨满治疗',
      classId: 'SHAMAN',
      role: 'HEALER',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 60000,
      maxHp: 60000,
      mp: 80000,
      maxMp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 480, y: 300 },
      stats: { attackPower: 500, spellPower: 6000, critChance: 0.15, haste: 0.1, armor: 3000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    const fullHealthAlly: Unit = {
      ...caster,
      id: 'ally_healthy',
      hp: 60000,
      maxHp: 60000,
    };

    const injuredAlly1: Unit = {
      ...caster,
      id: 'ally_inj1',
      hp: 30000,
      maxHp: 60000,
    };

    const injuredAlly2: Unit = {
      ...caster,
      id: 'ally_inj2',
      hp: 25000,
      maxHp: 60000,
    };

    const injuredAlly3: Unit = {
      ...caster,
      id: 'ally_inj3',
      hp: 20000,
      maxHp: 60000,
    };

    const enemy: Unit = {
      id: 'boss_1',
      name: '首领怪',
      classId: 'BOSS',
      role: 'ENEMY',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 500000,
      maxHp: 500000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 150 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.05, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    // 场景 A: 仅有 1 人受伤，群体技能应被降权抑制
    const singleInjuredContext: SkillScoreContext = {
      caster,
      personality,
      allies: [caster, fullHealthAlly, injuredAlly1],
      enemies: [enemy],
      tickCount: 0,
    };
    const scoreSingleInjured = scoreSkillCandidate(healingRainMetrics, singleInjuredContext);

    // 场景 B: 3 人受伤，群体技能达到门槛，获得大幅群体收益
    const multiInjuredContext: SkillScoreContext = {
      caster,
      personality,
      allies: [caster, injuredAlly1, injuredAlly2, injuredAlly3],
      enemies: [enemy],
      tickCount: 0,
    };
    const scoreMultiInjured = scoreSkillCandidate(healingRainMetrics, multiInjuredContext);

    assert.ok(
      scoreMultiInjured > scoreSingleInjured * 2,
      `群体受伤时治疗之雨得分(${scoreMultiInjured.toFixed(1)})应显著高于单体受伤(${scoreSingleInjured.toFixed(1)})`
    );
  });

  it('5. 首领 BaseBossAI 整合技能综合评分决策机制测试', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('godfrey', '高弗雷勋爵', 1500000);
    const tank: Unit = {
      id: 'tank_1',
      name: '主坦克',
      classId: 'DK',
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 100000,
      maxHp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 200 },
      stats: { attackPower: 2000, spellPower: 1000, critChance: 0.05, haste: 0, armor: 15000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };
    engine.addUnit(tank);

    const bossAi = new BossAI('godfrey');
    // tick执行驱动首领
    bossAi.tick(100, boss, engine);

    assert.ok((bossAi as any).bossPersonality, 'BossAI 必须初始化自身专属 bossPersonality');
    assert.ok((bossAi as any).skillMetricsMap instanceof Map, 'BossAI 必须预设技能指标映射字典');
    assert.strictEqual(boss.alive, true);
  });

  it('6. 通用决策引擎: 治疗判断 Tank 在危险线上且多名队友在健康线下，优先释放 AOE 治疗 (萨满治疗链/大雨)', () => {
    const personality = createAIPersonality('萨满治疗者', 'sham_1');
    personality.aoeThresholdCount = 2; // 2人达到群体门槛

    const caster: Unit = {
      id: 'shaman_healer',
      name: '萨满治疗',
      classId: 'SHAMAN',
      role: 'HEALER',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 60000,
      maxHp: 60000,
      mp: 80000,
      maxMp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 450, y: 300 },
      stats: { attackPower: 500, spellPower: 6000, critChance: 0.15, haste: 0.1, armor: 3000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    // Tank 在危险线上 (65% HP >= 40% 危险线)
    const tank: Unit = {
      id: 'tank_safe',
      name: '安全坦克',
      classId: 'DK',
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 65000,
      maxHp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 200 },
      stats: { attackPower: 2000, spellPower: 1000, critChance: 0.05, haste: 0, armor: 15000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    // 2名其他队友在健康线下 (< 85% 健康线，如 50% 与 60%)
    const injuredDps1: Unit = {
      ...caster,
      id: 'dps_inj1',
      name: '受伤输出1',
      role: 'DPS',
      hp: 30000,
      maxHp: 60000, // 50%
    };
    const injuredDps2: Unit = {
      ...caster,
      id: 'dps_inj2',
      name: '受伤输出2',
      role: 'DPS',
      hp: 36000,
      maxHp: 60000, // 60%
    };

    const boss: Unit = {
      id: 'boss_1',
      name: '首领怪',
      classId: 'BOSS',
      role: 'ENEMY',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 500000,
      maxHp: 500000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 150 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.05, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    const usableSkills = [
      {
        spellId: 'chain_heal',
        spellName: '治疗链',
        metrics: COMPUTED_SKILL_METRICS['shaman_chain_heal'],
        baseAmt: 28000,
        castMs: 2500,
        cost: 3400,
        resourceType: 'MANA' as const,
        isAOE: true,
        maxTargets: 4,
        isOnCooldown: false,
      },
      {
        spellId: 'healing_surge',
        spellName: '治疗之涌',
        metrics: COMPUTED_SKILL_METRICS['shaman_healing_surge'],
        baseAmt: 16000,
        castMs: 1500,
        cost: 3800,
        resourceType: 'MANA' as const,
        isAOE: false,
        isOnCooldown: false,
      },
      {
        spellId: 'healing_wave',
        spellName: '治疗波',
        metrics: COMPUTED_SKILL_METRICS['shaman_healing_wave'],
        baseAmt: 9500,
        castMs: 2500,
        cost: 1800,
        resourceType: 'MANA' as const,
        isAOE: false,
        isOnCooldown: false,
      },
    ];

    const decision = evaluateUniversalAIDecision({
      caster,
      personality,
      allies: [caster, tank, injuredDps1, injuredDps2],
      enemies: [boss],
      usableSkills,
      tickCount: 0,
    });

    assert.strictEqual(decision.decisionType, 'AOE', 'Tank安全且多名队友在健康线下，必须优先返回 AOE 决策');
    assert.strictEqual(decision.chosenCandidate?.spellId, 'chain_heal', '必须选择群体技能治疗链');
  });

  it('7. 通用决策引擎: 目标在危险线下时绝对优先高吞吐量救急 (严禁在快死时只用治疗波)；DPS 目标大于等于3个时优先 AOE', () => {
    const personality = createAIPersonality('萨满治疗者', 'sham_1');

    const caster: Unit = {
      id: 'shaman_healer',
      name: '萨满治疗',
      classId: 'SHAMAN',
      role: 'HEALER',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 60000,
      maxHp: 60000,
      mp: 20000, // 较低蓝量 (20%)
      maxMp: 100000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 450, y: 300 },
      stats: { attackPower: 500, spellPower: 6000, critChance: 0.15, haste: 0.1, armor: 3000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    // 队友濒临死亡 (20% HP，处于严重危险线下)
    const dyingAlly: Unit = {
      id: 'tank_dying',
      name: '濒死坦克',
      classId: 'DK',
      role: 'TANK',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 20000,
      maxHp: 100000, // 20%
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 200 },
      stats: { attackPower: 2000, spellPower: 1000, critChance: 0.05, haste: 0, armor: 15000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    const boss: Unit = {
      id: 'boss_1',
      name: '首领怪',
      classId: 'BOSS',
      role: 'ENEMY',
      isPlayer: false,
      isAlive: true,
      alive: true,
      hp: 500000,
      maxHp: 500000,
      absorb: 0,
      buffs: [],
      threatTable: [],
      resources: [],
      position: { x: 500, y: 150 },
      stats: { attackPower: 5000, spellPower: 5000, critChance: 0.05, haste: 0, armor: 10000, spellResist: 0, block: 0, parry: 0, dodge: 0, mastery: 0, versatility: 0, speed: 1 },
    };

    const usableSkills = [
      {
        spellId: 'healing_surge',
        spellName: '治疗之涌',
        metrics: COMPUTED_SKILL_METRICS['shaman_healing_surge'],
        baseAmt: 16000,
        castMs: 1500,
        cost: 3800,
        resourceType: 'MANA' as const,
        isAOE: false,
        isOnCooldown: false,
      },
      {
        spellId: 'greater_healing_wave',
        spellName: '强效治疗波',
        metrics: COMPUTED_SKILL_METRICS['shaman_greater_healing_wave'],
        baseAmt: 32000,
        castMs: 2500,
        cost: 4200,
        resourceType: 'MANA' as const,
        isAOE: false,
        isOnCooldown: false,
      },
      {
        spellId: 'healing_wave',
        spellName: '治疗波',
        metrics: COMPUTED_SKILL_METRICS['shaman_healing_wave'],
        baseAmt: 9500,
        castMs: 2500,
        cost: 1800,
        resourceType: 'MANA' as const,
        isAOE: false,
        isOnCooldown: false,
      },
    ];

    const decision = evaluateUniversalAIDecision({
      caster,
      personality,
      allies: [caster, dyingAlly],
      enemies: [boss],
      usableSkills,
      tickCount: 0,
    });

    assert.strictEqual(decision.decisionType, 'EMERGENCY_ST', '濒死救急必须返回 EMERGENCY_ST 决策');
    assert.notStrictEqual(decision.chosenCandidate?.spellId, 'healing_wave', '濒死救急时绝对严禁使用低吞吐量慢速治疗波');
    assert.ok(
      decision.chosenCandidate?.spellId === 'healing_surge' || decision.chosenCandidate?.spellId === 'greater_healing_wave',
      '濒死救急必须选择高吞吐量救急技能 (治疗之涌或强效治疗波)'
    );

    // 验证 DPS 在可用目标 >= 3 时优先选择 AOE 伤害技能
    const dpsCaster: Unit = {
      ...caster,
      id: 'dps_shaman',
      role: 'DPS',
    };
    const enemy1 = { ...boss, id: 'e1' };
    const enemy2 = { ...boss, id: 'e2' };
    const enemy3 = { ...boss, id: 'e3' };

    const dpsSkills = [
      {
        spellId: 'chain_lightning',
        spellName: '闪电链',
        metrics: COMPUTED_SKILL_METRICS['shaman_chain_lightning'],
        baseAmt: 25500,
        castMs: 2000,
        cost: 3000,
        resourceType: 'MANA' as const,
        isAOE: true,
        maxTargets: 3,
        isOnCooldown: false,
      },
      {
        spellId: 'lightning_bolt',
        spellName: '闪电箭',
        metrics: COMPUTED_SKILL_METRICS['shaman_lightning_bolt'],
        baseAmt: 9000,
        castMs: 2000,
        cost: 1600,
        resourceType: 'MANA' as const,
        isAOE: false,
        isOnCooldown: false,
      },
    ];

    const dpsDecision = evaluateUniversalAIDecision({
      caster: dpsCaster,
      personality,
      allies: [dpsCaster],
      enemies: [enemy1, enemy2, enemy3], // 3 个敌方目标
      usableSkills: dpsSkills,
      tickCount: 0,
    });

    assert.strictEqual(dpsDecision.decisionType, 'AOE', '敌方目标大于等于3个时，DPS必须优先返回 AOE 伤害决策');
    assert.strictEqual(dpsDecision.chosenCandidate?.spellId, 'chain_lightning', '必须优先选择闪电链');
  });

});
