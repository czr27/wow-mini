import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { TRAVEL_MANA_REGEN_MULTIPLIER } from '../engine/ResourceManager.js';
import { RunStateMachine, DRAGON_SOUL_CONFIG } from '../engine/RunStateMachine.js';
import { HealerAI } from '../ai/HealerAI.js';
import { DpsAI } from '../ai/DpsAI.js';
import { Priority } from '../ai/AIController.js';
import { makeUnit } from './helpers/combatFixtures.js';

describe('20人团本全AI蓝量续航与接续治疗输出验证', () => {
  it('1. 20人团本友方 > 5 人时自动享受团本精神与回蓝光环 (1.4%/s 基准)', () => {
    const engine = new CombatEngine();
    // 模拟 20 人团队
    for (let i = 0; i < 20; i++) {
      engine.addUnit(
        makeUnit({
          id: `player_${i}`,
          role: i < 2 ? 'TANK' : i < 6 ? 'HEALER' : 'DPS',
          classId: i < 6 ? 'PRIEST' : 'MAGE',
          mp: 50_000,
          maxMp: 100_000,
          resources: [{ kind: 'MANA', current: 50_000, max: 100_000 }],
        })
      );
    }
    const healer = engine.getUnit('player_2')!;
    engine.resourceManager.tickAll(engine.units, 1000); // 1秒

    // 100,000 * 0.014 = 1400 蓝/秒
    const gained = (healer.mp ?? 0) - 50_000;
    assert.ok(gained >= 1300 && gained <= 1500, `20人本治疗回蓝应在 1300~1500 左右，实际 ${gained}`);

    // 法系 DPS 应有额外专注暴击回蓝 (+0.4%/s -> 1.8%/s = 1800 蓝/秒)
    const dps = engine.getUnit('player_10')!;
    const dpsGained = (dps.mp ?? 0) - 50_000;
    assert.ok(dpsGained >= 1700 && dpsGained <= 1900, `法系DPS回蓝应在 1700~1900 左右，实际 ${dpsGained}`);
  });

  it('2. 行军恢复 (TRAVEL_RECOVERY) 正确设置 20 倍回蓝，开怪时重置为 1', () => {
    const engine = new CombatEngine();
    const rsm = new RunStateMachine(DRAGON_SOUL_CONFIG, engine);

    rsm.beginTravelRecovery();
    assert.equal(rsm.phase, 'TRAVEL_RECOVERY');
    assert.equal(engine.resourceManager.manaRegenMultiplier, TRAVEL_MANA_REGEN_MULTIPLIER);

    rsm.enterBossCombat();
    assert.equal(rsm.phase, 'BOSS_COMBAT');
    assert.equal(engine.resourceManager.manaRegenMultiplier, 1);
  });

  it('3. performTravelRecovery 完整同步 unit.resources 底层资源至满', () => {
    const engine = new CombatEngine();
    const healer = makeUnit({
      id: 'healer_1',
      role: 'HEALER',
      classId: 'PRIEST',
      hp: 1000,
      maxHp: 100_000,
      mp: 2000,
      maxMp: 95_000,
      resources: [{ kind: 'MANA', current: 2000, max: 95_000 }],
    });
    engine.addUnit(healer);
    const rsm = new RunStateMachine(DRAGON_SOUL_CONFIG, engine);

    rsm.performTravelRecovery(true, true);
    assert.equal(healer.mp, 95_000);
    const manaRes = healer.resources.find(r => r.kind === 'MANA')!;
    assert.equal(manaRes.current, 95_000, '底层 resources 中的 MANA 必须被刷新至 maxMp');
  });

  it('4. 治疗 AI 蓝量低于 35% 时主动交出回蓝大招（激活/法力之潮）', () => {
    const healerAi = new HealerAI();
    const druidHealer = makeUnit({
      id: 'druid_1',
      role: 'HEALER',
      classId: 'DRUID',
      spec: 'RESTO_HEAL',
      mp: 20_000,
      maxMp: 95_000, // < 35%
      resources: [{ kind: 'MANA', current: 20_000, max: 95_000 }],
    });
    const tank = makeUnit({
      id: 'tank_1',
      role: 'TANK',
      classId: 'WARRIOR',
      hp: 80_000,
      maxHp: 100_000,
    });
    const actions = healerAi.decide(druidHealer, {
      units: [druidHealer, tank],
      bossId: undefined,
      bossChannelSpellId: undefined,
      bossChannelRemainingMs: 0,
      elapsedMs: 5000,
    });

    const hasInnervate = actions.some(
      a => a.action.spellId === 'druid_innervate' && a.priority === Priority.DEFENSIVE
    );
    assert.ok(hasInnervate, '低蓝量时奶德应交出激活 (druid_innervate)');
  });

  it('5. 法系 DPS 蓝量低于 35% 时交出唤醒，且 restore 正确按百分比恢复 60% 法力', () => {
    const dpsAi = new DpsAI();
    const mage = makeUnit({
      id: 'mage_1',
      role: 'DPS',
      classId: 'MAGE',
      spec: 'FIRE_DPS',
      mp: 20_000,
      maxMp: 100_000, // < 35%
      resources: [{ kind: 'MANA', current: 20_000, max: 100_000 }],
    });
    const boss = makeUnit({
      id: 'boss_1',
      role: 'ENEMY',
      classId: 'BOSS',
      hp: 1_000_000,
      maxHp: 1_000_000,
    });
    const actions = dpsAi.decide(mage, {
      units: [mage, boss],
      bossId: 'boss_1',
      bossChannelSpellId: undefined,
      bossChannelRemainingMs: 0,
      elapsedMs: 10000,
    });

    const hasEvocation = actions.some(
      a => a.action.spellId === 'mage_evocation' && a.priority === Priority.DEFENSIVE
    );
    assert.ok(hasEvocation, '低蓝量时法师应使用唤醒 (mage_evocation)');

    // 验证 restore 0.6 为百分比 60%
    const engine = new CombatEngine();
    engine.addUnit(mage);
    engine.resourceManager.restore(mage.id, 'MANA', 0.6);
    assert.equal(mage.mp, 20_000 + 60_000, '0.6 应被识别为恢复 60% 最大蓝 (60,000)');
  });
});
