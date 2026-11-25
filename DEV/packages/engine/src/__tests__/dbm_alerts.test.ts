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

describe('DBM 精简播报、短语音与顶替规则', () => {
  it('1. 首页显示偏好默认同时开启 DBM 文字与语音，支持独立关闭', () => {
    assert.equal(DEFAULT_COMBAT_DISPLAY_PREFS.enableDbm, true);
    assert.equal(DEFAULT_COMBAT_DISPLAY_PREFS.enableDbmVoice, true);
    assert.equal(resolveCombatDisplayPrefs({ enableDbm: false }).enableDbm, false);
    assert.equal(resolveCombatDisplayPrefs({ enableDbm: false }).enableDbmVoice, true);
    assert.equal(resolveCombatDisplayPrefs({ enableDbmVoice: false }).enableDbmVoice, false);
  });

  it('2. 常规 AOE/单体技能不自动刷屏，仅可打断与显式 dbm 生成规则', () => {
    const normalAoe = deriveBossSkillDbmRule({
      id: 'shadow_nova',
      name: '暗影新星',
      castTimeMs: 1500,
      cooldownMs: 12000,
      lastCastMs: 0,
      interruptible: false,
      school: 'SHADOW',
      targetKind: 'AOE',
      description: '全团暗影伤害',
      execute: () => {},
    });
    assert.equal(normalAoe, null);

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
    assert.ok(interruptRule);
    assert.equal(interruptRule.severity, 'CRITICAL');
    assert.equal(interruptRule.voiceText, '注意打断');

    const explicitRule = deriveBossSkillDbmRule({
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
        advice: '近距分摊，最近目标双倍伤害',
        voiceText: '近距分摊',
        severity: 'WARN',
        preWarnMs: 3000,
      },
      execute: () => {},
    });
    assert.ok(explicitRule);
    assert.equal(explicitRule.source, 'ENCOUNTER');
    assert.equal(explicitRule.voiceText, '近距分摊');
  });

  it('3. 即将施放会被正在施放通过相同 replaceKey 直接顶替，不新起一条', () => {
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
    const stomp = ai.skills.find((s) => s.id === 'stomp')!;
    for (const s of ai.skills) {
      if (s.id !== 'stomp') s.lastCastMs = engine.nowMs;
    }

    // 1) 即将就绪（剩余 2s < preWarnMs 3s）发出即将施放
    stomp.lastCastMs = engine.nowMs - (stomp.cooldownMs - 2000);
    ai.tick(50, boss, engine);
    // 2) 同一帧缓冲内进入冷却就绪并开始读条，发出正在施放并直接顶替
    engine.elapsedMs += 2050;
    ai.tick(50, boss, engine);

    const alerts = engine.drainDbmAlerts();
    const stompAlerts = alerts.filter((a) => a.spellId === 'stomp');
    assert.equal(stompAlerts.length, 1);
    assert.ok(stompAlerts[0].title.includes('正在施放'));
    assert.equal(stompAlerts[0].replaceKey, 'skill_morchok_stomp');
    assert.equal(stompAlerts[0].voiceText, '近距分摊');
  });

  it('4. 召唤增援小怪触发「先杀小怪」，地面普通红圈不再自动刷屏', () => {
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
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].advice, '先杀小怪');
    assert.equal(alerts[0].voiceText, '先杀小怪');
  });
});
