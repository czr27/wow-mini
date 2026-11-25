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

  it('5. 沃登绿/红魔药交替触发「保持移动」与「站立不动」并共用 replaceKey', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('walden', '沃登勋爵', 500_000);
    spawnCombatUnit(engine, {
      id: 'tank_1',
      name: '防战',
      classId: 'WARRIOR',
      role: 'TANK',
      unitKind: 'AI',
    });

    const ai = new BaseBossAI('walden', 'shadowfang_keep');
    const potion = ai.skills.find((s) => s.id === 'potion_catalyst')!;
    assert.ok(potion);

    // 第一次施放：绿药
    potion.execute(boss, engine);
    const greenAlerts = engine.drainDbmAlerts();
    assert.equal(greenAlerts.length, 1);
    assert.equal(greenAlerts[0].voiceText, '保持移动');
    assert.equal(greenAlerts[0].replaceKey, 'walden_potion');

    // 第二次施放：红药（不同 title，同 replaceKey）
    engine.elapsedMs += 2000;
    potion.execute(boss, engine);
    const redAlerts = engine.drainDbmAlerts();
    assert.equal(redAlerts.length, 1);
    assert.equal(redAlerts[0].voiceText, '站立不动');
    assert.equal(redAlerts[0].replaceKey, 'walden_potion');
  });

  it('6. 奥卓克希昂暮光时刻与凋零之光触发对应短语音', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('ultraxion', '奥卓克希昂', 2_000_000);
    spawnCombatUnit(engine, {
      id: 'tank_1',
      name: '防战',
      classId: 'WARRIOR',
      role: 'TANK',
      unitKind: 'AI',
    });

    const ai = new BaseBossAI('ultraxion', 'dragon_soul');
    const hour = ai.skills.find((s) => s.id === 'hour_of_twilight')!;
    assert.ok(hour.dbm);
    assert.equal(hour.dbm.voiceText, '暮光时刻');

    // 推进到 40s 触发凋零之光
    ai.tick(40_000, boss, engine);
    const alerts = engine.drainDbmAlerts();
    const fading = alerts.find((a) => a.spellId === 'fading_light');
    assert.ok(fading);
    assert.equal(fading.voiceText, '点离领域');
  });

  it('7. 格拉布托克 P2 转阶段、曲奇抛食物、赫洛德旋风斩均有短语音且常规技能不刷屏', () => {
    const engine = new CombatEngine();
    const glubtok = engine.spawnBoss('glubtok', '戈洛克托克', 500_000);
    spawnCombatUnit(engine, {
      id: 'dps_1',
      name: '法师',
      classId: 'MAGE',
      role: 'DPS',
      unitKind: 'AI',
    });

    const glubAi = new BaseBossAI('glubtok', 'deadmines');
    glubtok.hp = 200_000; // <= 50% 触发 P2
    glubAi.tick(100, glubtok, engine);
    const glubAlerts = engine.drainDbmAlerts();
    assert.equal(glubAlerts.length, 1);
    assert.equal(glubAlerts[0].voiceText, '躲避火墙');

    const cookieAi = new BaseBossAI('cookie', 'deadmines');
    assert.equal(cookieAi.skills.find((s) => s.id === 'cookie_cleave')?.dbm, undefined);
    assert.equal(cookieAi.skills.find((s) => s.id === 'throw_food')?.dbm?.voiceText, '吃好食物');

    const herodAi = new BaseBossAI('herod', 'scarlet_monastery');
    assert.equal(herodAi.skills.find((s) => s.id === 'herod_strike')?.dbm, undefined);
    assert.equal(herodAi.skills.find((s) => s.id === 'whirlwind')?.dbm?.voiceText, '注意远离');
  });
});
