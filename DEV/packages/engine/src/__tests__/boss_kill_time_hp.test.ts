/**
 * Boss HP budgeting: AI 单人 5000、坦克 0.8、治疗不计；英雄血量 ×1.5、输出 ×1.2。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOSS_KILL_TIME_SEC,
  AI_BOSS_BUDGET_SINGLE_DPS,
  AI_BOSS_BUDGET_TANK_FRAC,
  HEROIC_DIFFICULTY_MULT,
  HEROIC_ENEMY_DAMAGE_MULT,
  estimateAiRaidDps,
  computeBossHpForKillTime,
  buildDungeonBossHpList,
  getDifficultyNumericMult,
} from '../engine/TierProfile.js';
import {
  SHADOWFANG_KEEP_CONFIG,
  DRAGON_SOUL_CONFIG,
} from '../engine/RunStateMachine.js';
import { CombatEngine } from '../engine/CombatEngine.js';

describe('Boss 击杀时长血量预算（AI 队伍 DPS）', () => {
  it('1. 单人 5000；5 人 = T0.8+3DPS = 19000；20 人显著更高', () => {
    assert.equal(AI_BOSS_BUDGET_SINGLE_DPS, 5000);
    assert.equal(AI_BOSS_BUDGET_TANK_FRAC, 0.8);
    assert.equal(HEROIC_DIFFICULTY_MULT, 1.5);
    assert.equal(HEROIC_ENEMY_DAMAGE_MULT, 1.2);

    const d5 = estimateAiRaidDps('5man');
    const d20 = estimateAiRaidDps('20man');
    assert.equal(d5, 5000 * 0.8 + 3 * 5000, '5 人预算 DPS = 19000');
    assert.equal(d20, 5000 * 0.8 * 2 + 13 * 5000, '20 人预算 DPS = 73000');
    assert.ok(d20 > d5 * 3);
  });

  it('2. 目标时长：5 人 2/3 分钟，20 人 3/5 分钟；英雄血量 1.5 / 输出 1.2', () => {
    assert.equal(BOSS_KILL_TIME_SEC['5man'].normal, 120);
    assert.equal(BOSS_KILL_TIME_SEC['5man'].final, 180);
    assert.equal(BOSS_KILL_TIME_SEC['20man'].normal, 180);
    assert.equal(BOSS_KILL_TIME_SEC['20man'].final, 300);
    assert.equal(getDifficultyNumericMult('HEROIC'), 1.2);
    assert.equal(getDifficultyNumericMult('NORMAL'), 1);
  });

  it('3. 英雄血量 / (DPS×1.5) ≈ 目标秒数（±5%）', () => {
    for (const tier of ['5man', '20man'] as const) {
      const dps = estimateAiRaidDps(tier);
      for (const isFinal of [false, true]) {
        const hp = computeBossHpForKillTime(tier, isFinal, 'HEROIC');
        const sec = hp / (dps * HEROIC_DIFFICULTY_MULT);
        const target = isFinal
          ? BOSS_KILL_TIME_SEC[tier].final
          : BOSS_KILL_TIME_SEC[tier].normal;
        assert.ok(
          Math.abs(sec - target) / target <= 0.05,
          `${tier} final=${isFinal}: ${sec.toFixed(1)}s vs 目标 ${target}s (hp=${hp}, dps=${dps})`,
        );
      }
    }
  });

  it('4. 影牙配置（英雄）：非尾王 ≈2 分钟，尾王 ≈3 分钟', () => {
    const dps = estimateAiRaidDps('5man') * HEROIC_DIFFICULTY_MULT;
    const bosses = SHADOWFANG_KEEP_CONFIG.bosses;
    assert.equal(bosses.length, 5);
    for (let i = 0; i < bosses.length - 1; i++) {
      const sec = bosses[i].hp / dps;
      assert.ok(sec >= 110 && sec <= 130, `${bosses[i].id} 应约 2 分钟，实际 ${sec.toFixed(0)}s`);
    }
    const finalSec = bosses[bosses.length - 1].hp / dps;
    assert.ok(finalSec >= 170 && finalSec <= 190, `尾王应约 3 分钟，实际 ${finalSec.toFixed(0)}s`);
  });

  it('5. 巨龙之魂配置（英雄）：非尾王 ≈3 分钟，尾王 ≈5 分钟', () => {
    const dps = estimateAiRaidDps('20man') * HEROIC_DIFFICULTY_MULT;
    const bosses = DRAGON_SOUL_CONFIG.bosses;
    assert.equal(bosses.length, 8);
    for (let i = 0; i < bosses.length - 1; i++) {
      const sec = bosses[i].hp / dps;
      assert.ok(sec >= 165 && sec <= 195, `${bosses[i].id} 应约 3 分钟，实际 ${sec.toFixed(0)}s`);
    }
    const finalSec = bosses[bosses.length - 1].hp / dps;
    assert.ok(finalSec >= 285 && finalSec <= 315, `尾王应约 5 分钟，实际 ${finalSec.toFixed(0)}s`);
  });

  it('6. spawnBoss：英雄用配置血量，普通除以 1.5', () => {
    const cfgHp = SHADOWFANG_KEEP_CONFIG.bosses[0].hp;
    const heroic = new CombatEngine();
    heroic.difficulty = 'HEROIC';
    const hb = heroic.spawnBoss('ashbury', '亚什布里男爵', cfgHp);
    assert.equal(hb.maxHp, cfgHp);

    const normal = new CombatEngine();
    normal.difficulty = 'NORMAL';
    const nb = normal.spawnBoss('ashbury', '亚什布里男爵', cfgHp);
    assert.equal(nb.maxHp, Math.round(cfgHp / HEROIC_DIFFICULTY_MULT));
  });

  it('7. buildDungeonBossHpList 与副本配置一致', () => {
    assert.deepEqual(
      SHADOWFANG_KEEP_CONFIG.bosses.map(b => b.hp),
      buildDungeonBossHpList('5man', 5, 'HEROIC'),
    );
    assert.deepEqual(
      DRAGON_SOUL_CONFIG.bosses.map(b => b.hp),
      buildDungeonBossHpList('20man', 8, 'HEROIC'),
    );
  });
});
