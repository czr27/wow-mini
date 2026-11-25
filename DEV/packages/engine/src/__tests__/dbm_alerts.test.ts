import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BaseBossAI,
  CombatEngine,
  DEFAULT_COMBAT_DISPLAY_PREFS,
  deriveBossSkillDbmRule,
  resolveCombatDisplayPrefs,
  spawnCombatUnit,
} from '../index.js';

describe('DBM 播报与自动推导规则', () => {
  it('1. 首页显示偏好默认开启 enableDbm，支持显式关闭', () => {
    assert.equal(DEFAULT_COMBAT_DISPLAY_PREFS.enableDbm, true);
    assert.equal(resolveCombatDisplayPrefs({}).enableDbm, true);
    assert.equal(resolveCombatDisplayPrefs({ enableDbm: false }).enableDbm, false);
  });

  it('2. deriveBossSkillDbmRule 自动推导可打断 / AOE 与显式覆盖', () => {
    const interruptRule = deriveBossSkillDbmRule({
      id: 'shadow_mend',
      name: '暗影愈合',
      castTimeMs: 2000,
      cooldownMs: 15000,
      lastCastMs: 0,
      interruptible: true,
      school: 'SHADOW',
      description: '治疗自身',
      execute: () => {},
    });
    assert.equal(interruptRule.severity, 'CRITICAL');
    assert.equal(interruptRule.source, 'AUTO');
    assert.ok(interruptRule.advice.includes('打断'));

    const aoeRule = deriveBossSkillDbmRule({
      id: 'stomp',
      name: '大地践踏',
      castTimeMs: 2500,
      cooldownMs: 12000,
      lastCastMs: 0,
      interruptible: false,
      school: 'PHYSICAL',
      targetKind: 'AOE',
      description: '践踏',
      dbm: {
        advice: '近距分摊，注意治疗',
        severity: 'WARN',
        preWarnMs: 3000,
      },
      execute: () => {},
    });
    assert.equal(aoeRule.source, 'ENCOUNTER');
    assert.equal(aoeRule.advice, '近距分摊，注意治疗');
    assert.equal(aoeRule.preWarnMs, 3000);
  });

  it('3. BaseBossAI 初始化自动编译 dbmRulesMap，tick 自动发出高威胁预告与读条提醒', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('morchok', '莫卓克', 1_000_000);
    spawnCombatUnit(engine, {
      id: 'tank_1',
      name: '防战',
      classId: 'WARRIOR',
      role: 'TANK',
      unitKind: 'AI',
      position: { x: 520, y: 190 },
    });

    const ai = new BaseBossAI('morchok', 'dragon_soul');
    assert.ok(ai.dbmRulesMap.size > 0);
    assert.equal(ai.dbmRulesMap.get('stomp')?.advice, '近距分摊，最近目标双倍伤害，注意治疗');

    // 将 stomp 的冷却推进到即将就绪（剩余 2s < preWarnMs 3s）
    const stomp = ai.skills.find((s) => s.id === 'stomp')!;
    stomp.lastCastMs = engine.nowMs - (stomp.cooldownMs - 2000);
    // 压制其他技能避免抢先触发
    for (const s of ai.skills) {
      if (s.id !== 'stomp') s.lastCastMs = engine.nowMs;
    }

    ai.tick(50, boss, engine);
    const alerts = engine.drainDbmAlerts();
    assert.ok(alerts.some((a) => a.spellId === 'stomp' && a.title.includes('即将施放')));
  });

  it('4. 召唤增援小怪与敌方地面危险区自动触发运行时 DBM 提示，reset 清空队列', () => {
    const engine = new CombatEngine();
    spawnCombatUnit(engine, {
      id: 'add_1',
      name: '熔火残渣',
      classId: 'NPC',
      role: 'ENEMY',
      unitKind: 'ADD',
      hp: 50000,
      maxHp: 50000,
    });
    engine.effectsManager.addGroundEffect({
      kind: 'DAMAGE_ZONE',
      spellId: 'fire_patch',
      ownerId: 'boss',
      x: 300,
      y: 200,
      radius: 60,
      colorHex: '#ef4444',
      remainingMs: 5000,
    });

    const alerts = engine.drainDbmAlerts();
    assert.ok(alerts.some((a) => a.advice.includes('先杀小怪')));
    assert.ok(alerts.some((a) => a.advice.includes('躲避')));
    assert.equal(engine.drainDbmAlerts().length, 0);

    engine.emitDbmAlert({
      title: '测试',
      advice: '测试建议',
      severity: 'INFO',
    });
    engine.reset();
    assert.equal(engine.drainDbmAlerts().length, 0);
  });
});
