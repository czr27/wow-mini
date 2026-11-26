import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOSS_TRASH_TALK_LINES,
  BossTrashTalkDeck,
} from '../bosses/core/BossTrashTalk.js';
import {
  SHADOWFANG_ENCOUNTERS,
  DRAGON_SOUL_ENCOUNTERS,
  DEADMINES_ENCOUNTERS,
  SCARLET_MONASTERY_ENCOUNTERS,
  STRATHOLME_ENCOUNTERS,
  ZULGURUB_ENCOUNTERS,
} from '../bosses/index.js';
import { BaseBossAI } from '../bosses/core/BaseBossAI.js';
import { CombatEngine } from '../engine/CombatEngine.js';

describe('Boss 高威胁大招狠话系统', () => {
  it('1. 每个已注册 Boss 均有至少 4 句专属狠话，且不同 Boss 间不雷同', () => {
    const allBosses = [
      ...SHADOWFANG_ENCOUNTERS,
      ...DEADMINES_ENCOUNTERS,
      ...SCARLET_MONASTERY_ENCOUNTERS,
      ...STRATHOLME_ENCOUNTERS,
      ...ZULGURUB_ENCOUNTERS,
      ...DRAGON_SOUL_ENCOUNTERS,
    ];
    assert.ok(allBosses.length >= 30, `应覆盖全部副本 Boss（当前 ${allBosses.length}）`);
    const seen = new Map<string, string>();
    for (const b of allBosses) {
      const lines = BOSS_TRASH_TALK_LINES[b.id];
      assert.ok(Array.isArray(lines) && lines.length >= 4, `${b.id} 至少应有 4 句狠话`);
      assert.equal(new Set(lines).size, lines.length, `${b.id} 狠话池内部不可重复`);
      for (const l of lines) {
        const owner = seen.get(l);
        // mograine 与 mograine_whitemane 属同组别名外，其余必须全局唯一
        if (owner && !(owner.startsWith('mograine') && b.id.startsWith('mograine'))) {
          assert.fail(`Boss ${b.id} 与 ${owner} 存在重复台词: ${l}`);
        }
        seen.set(l, b.id);
      }
    }
  });

  it('2. 洗牌袋一轮内绝不重复，跨轮衔接不连续撞句', () => {
    const deck = new BossTrashTalkDeck('walden');
    const n = deck.getPoolSize();
    const round1: string[] = [];
    for (let i = 0; i < n; i++) round1.push(deck.nextLine());
    assert.equal(new Set(round1).size, n, '一轮内 N 句应全部出现且不重复');
    const firstOfRound2 = deck.nextLine();
    assert.notEqual(firstOfRound2, round1[round1.length - 1], '跨轮衔接不应连续重复');
  });

  it('3. BaseBossAI 释放高威胁技能时输出 Boss 狠话飘字', () => {
    const engine = new CombatEngine();
    const boss = engine.spawnBoss('walden', '勋爵沃尔登', 500_000);
    engine.addUnit({
      id: 'player_1',
      name: '测试坦克',
      classId: 'WARRIOR',
      role: 'TANK',
      isPlayer: true,
      hp: 100_000,
      maxHp: 100_000,
      mp: 0,
      maxMp: 0,
      resources: [],
      isAlive: true,
      alive: true,
      position: { x: 500, y: 190 },
      stats: {
        attackPower: 1000,
        spellPower: 0,
        critChance: 0.1,
        haste: 0,
        armor: 20000,
        spellResist: 0,
        block: 0.2,
        parry: 0.1,
        dodge: 0.1,
        mastery: 0.1,
        versatility: 0,
        speed: 1,
      },
      buffs: [],
    });

    const ai = new BaseBossAI('walden', 'shadowfang_keep');
    // 推进至首个高威胁技能释放
    for (let t = 0; t < 20_000; t += 100) {
      engine.tick(100);
      ai.tick(100, boss, engine);
      if (engine.effectsManager.floatingTexts.some((f) => f.text.startsWith('🗣️「'))) {
        break;
      }
    }
    const talk = engine.effectsManager.floatingTexts.find((f) => f.text.startsWith('🗣️「'));
    assert.ok(talk, '释放高威胁技能后应生成 Boss 狠话飘字');
    const rawLine = talk!.text.replace(/^🗣️「|」$/g, '');
    assert.ok(BOSS_TRASH_TALK_LINES.walden.includes(rawLine), '狠话应来自沃尔登专属台词池');
  });
});
