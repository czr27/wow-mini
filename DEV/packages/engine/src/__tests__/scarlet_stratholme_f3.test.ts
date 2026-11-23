/**
 * F3: Scarlet Monastery + Stratholme mechanics.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI, BossRegistry } from '../bosses/index.js';
import {
  HUNTING_HOUND_SUMMON,
  SCARLET_TRAINEE_SUMMON,
  WHITEMANE_SUMMON,
  type DoanAiState,
  type HerodAiState,
  type MograineWhitemaneAiState,
} from '../bosses/scarlet_monastery/index.js';
import {
  RIFLEMAN_SUMMON,
  fireWilleyCannon,
  type WilleyAiState,
  type BalnazzarAiState,
  SKELETON_SUMMON,
} from '../bosses/stratholme/index.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup(bossId: string, bossName: string, dungeonId: string) {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss(bossId, {
    id: bossId,
    name: bossName,
    maxHp: 2_000_000,
    hp: 2_000_000,
    position: { x: 500, y: 200 },
  });
  boss.unitKind = 'BOSS';
  boss.classId = 'BOSS';
  engine.addUnit(boss);
  engine.addUnit(
    makeTank('WARRIOR', { id: 'tank', hp: 65_000, maxHp: 65_000, position: { x: 480, y: 200 } }),
  );
  engine.addUnit(
    makeUnit({
      id: 'dps',
      role: 'DPS',
      classId: 'MAGE',
      hp: 36_000,
      maxHp: 36_000,
      position: { x: 450, y: 210 },
      isPlayer: true,
    }),
  );
  engine.addUnit(
    makeUnit({
      id: 'healer',
      role: 'HEALER',
      classId: 'SHAMAN',
      hp: 36_000,
      maxHp: 36_000,
      position: { x: 430, y: 220 },
    }),
  );
  const ai = createBossAI(bossId, dungeonId);
  return { engine, boss, ai };
}

describe('血色 + 斯坦索姆：迭代 F3', () => {
  it('0. 两本 Boss 均已专属注册', () => {
    for (const id of ['vishas', 'thalnoren', 'loksey', 'doan', 'herod', 'mograine_whitemane']) {
      assert.ok(BossRegistry.get(id, 'scarlet_monastery'), id);
    }
    for (const id of ['willey', 'balnazzar', 'ramstein', 'rivendare']) {
      assert.ok(BossRegistry.get(id, 'stratholme'), id);
    }
  });

  it('1. 洛克希开战刷猎犬', () => {
    const { engine, boss, ai } = setup('loksey', '驯犬者洛克希', 'scarlet_monastery');
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.filter(e => e.summonSpellId === HUNTING_HOUND_SUMMON).length >= 4);
  });

  it('2. 杜安半血奥术气泡后自爆近战', () => {
    const { engine, boss, ai } = setup('doan', '奥法师杜安', 'scarlet_monastery');
    const tank = engine.friendlyUnits.find(u => u.role === 'TANK')!;
    tank.position = { x: 500, y: 200 }; // in melee
    boss.hp = Math.round(boss.maxHp * 0.45);
    ai.tick(50, boss, engine);
    assert.ok((ai as DoanAiState).doanBubbleDone);
    assert.ok(((ai as DoanAiState).doanBubbleMs || 0) > 0);
    const bubble = engine.effectsManager?.groundEffects.find(e => e.spellId === 'arcane_bubble');
    assert.ok(bubble && bubble.kind === 'DAMAGE_ZONE' && bubble.radius === 100, '气泡应有撤离光圈');
    (ai as DoanAiState).doanBubbleMs = 50;
    const hp = tank.hp;
    ai.tick(100, boss, engine);
    assert.ok(tank.hp < hp, '近战应吃到自爆');
  });

  it('3. 赫洛德旋风；死后学徒潮', () => {
    const { engine, boss, ai } = setup('herod', '赫洛德', 'scarlet_monastery');
    ai.skills.find(s => s.id === 'whirlwind')!.execute(boss, engine);
    assert.ok(((ai as HerodAiState).herodWhirlwindMs || 0) > 0);
    const ww = engine.effectsManager?.groundEffects.find(e => e.spellId === 'whirlwind');
    assert.ok(ww && ww.kind === 'DAMAGE_ZONE' && ww.radius === 70, '旋风应有圆形地面光圈');
    boss.hp = Math.round(boss.maxHp * 0.005);
    boss.alive = true;
    boss.isAlive = true;
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === SCARLET_TRAINEE_SUMMON));
  });

  it('4. 莫格莱尼假死 → 怀特迈恩进场', () => {
    const { engine, boss, ai } = setup('mograine_whitemane', '莫格莱尼与怀特迈恩', 'scarlet_monastery');
    boss.hp = Math.round(boss.maxHp * 0.04);
    ai.tick(50, boss, engine);
    assert.equal((ai as MograineWhitemaneAiState).mwPhase, 'whitemane_cast');
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === WHITEMANE_SUMMON));
    assert.ok(ai.currentCasting?.skill.id === 'whitemane_resurrection');
  });

  it('5. 威利增援 + 开炮清理', () => {
    const { engine, boss, ai } = setup('willey', '炮手威利', 'stratholme');
    (ai as WilleyAiState).willeyAddAcc = 15_000;
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === RIFLEMAN_SUMMON));
    const killed = fireWilleyCannon(engine, ai as WilleyAiState);
    assert.ok(killed >= 1);
    assert.equal(
      engine.enemyUnits.filter(e => e.summonSpellId === RIFLEMAN_SUMMON && (e.hp ?? 0) > 0).length,
      0,
    );
  });

  it('6. 巴纳扎尔半血变身恶魔', () => {
    const { engine, boss, ai } = setup('balnazzar', '巴纳扎尔', 'stratholme');
    ai.tick(50, boss, engine);
    boss.hp = Math.round(boss.maxHp * 0.4);
    ai.tick(50, boss, engine);
    assert.equal((ai as BalnazzarAiState).balPhase, 'demon');
  });

  it('7. 瑞文戴尔召唤骷髅', () => {
    const { engine, boss, ai } = setup('rivendare', '瑞文戴尔男爵', 'stratholme');
    ai.skills.find(s => s.id === 'summon_skeletons')!.execute(boss, engine);
    assert.ok(engine.enemyUnits.filter(e => e.summonSpellId === SKELETON_SUMMON).length >= 4);
  });
});
