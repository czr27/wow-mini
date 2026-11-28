/**
 * F2: Zul'Gurub five-boss mechanics.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI, BossRegistry } from '../bosses/index.js';
import {
  TOXIC_LINK_ID,
  type VenoxisAiState,
  OHGAN_SUMMON,
  SOUL_REVIVE_MAX,
  type MandokirAiState,
  PANTHER_SUMMON,
  type KilnaraAiState,
  drinkZanzilCauldron,
  CAULDRON_BUFF,
  type ZanzilAiState,
  BRITTLE_BARRIER_SUMMON,
  type JindoAiState,
} from '../bosses/zulgurub/index.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup(bossId: string, bossName: string) {
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
  const tank = makeTank('WARRIOR', {
    id: 'tank',
    hp: 65_000,
    maxHp: 65_000,
    position: { x: 480, y: 200 },
  });
  engine.addUnit(tank);
  const dps = makeUnit({
    id: 'dps',
    role: 'DPS',
    classId: 'MAGE',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 450, y: 210 },
    isPlayer: true,
  });
  engine.addUnit(dps);
  const healer = makeUnit({
    id: 'healer',
    role: 'HEALER',
    classId: 'SHAMAN',
    hp: 36_000,
    maxHp: 36_000,
    position: { x: 440, y: 220 },
  });
  engine.addUnit(healer);
  const ai = createBossAI(bossId, 'zulgurub');
  return { engine, boss, tank, dps, healer, ai };
}

describe('祖尔格拉布：迭代 F2', () => {
  it('0. 五王均已专属注册', () => {
    for (const id of ['venoxis', 'mandokir', 'kilnara', 'zanzil', 'jindo']) {
      const enc = BossRegistry.get(id, 'zulgurub');
      assert.ok(enc);
      assert.ok(!enc!.createSkills({}).some(s => s.id.endsWith('_pulse') && s.name.includes('威压')));
    }
  });

  it('1. 温诺希斯：毒链接拉开扯断；半血蛇神', () => {
    const { engine, boss, dps, healer, ai } = setup('venoxis', '高阶祭司温诺希斯');
    ai.skills.find(s => s.id === 'toxic_link')!.execute(boss, engine);
    assert.ok(dps.buffs?.some(b => b.spellId === TOXIC_LINK_ID) || healer.buffs?.some(b => b.spellId === TOXIC_LINK_ID));

    const linked = [dps, healer].filter(u => u.buffs?.some(b => b.spellId === TOXIC_LINK_ID));
    if (linked.length >= 2) {
      linked[0].position = { x: 100, y: 100 };
      linked[1].position = { x: 300, y: 100 };
      ai.tick(50, boss, engine);
      assert.equal(
        linked.every(u => !u.buffs?.some(b => b.spellId === TOXIC_LINK_ID)),
        true,
        '拉开应扯断',
      );
    }

    boss.hp = Math.round(boss.maxHp * 0.45);
    ai.tick(50, boss, engine);
    assert.equal((ai as VenoxisAiState).venoxisPhase, 'snake');
  });

  it('1b. 温诺希斯毒性链接：优先点名玩家，玩家不够才补 AI（即使 AI 彼此站位更近）', () => {
    const { engine, boss, dps, healer, ai } = setup('venoxis', '高阶祭司温诺希斯');
    // 新增一个与 healer 紧挨着的 AI DPS，让两个 AI 距离极近，而玩家 dps 站远
    const aiDps2 = makeUnit({
      id: 'ai_dps_2',
      role: 'DPS',
      classId: 'HUNTER',
      hp: 36_000,
      maxHp: 36_000,
      position: { x: 441, y: 221 },
    });
    engine.addUnit(aiDps2);
    dps.position = { x: 200, y: 200 };

    ai.skills.find(s => s.id === 'toxic_link')!.execute(boss, engine);
    assert.ok(
      dps.buffs?.some(b => b.spellId === TOXIC_LINK_ID),
      '单玩家场景下毒性链接必须优先点中玩家，而不是只点站得更近的两个 AI'
    );
    const totalLinked = engine.friendlyUnits.filter(u => u.buffs?.some(b => b.spellId === TOXIC_LINK_ID));
    assert.equal(totalLinked.length, 2, '玩家不足 2 人时应由 1 名 AI 补齐');
  });

  it('2. 曼多基尔：奥根 + 斩首灵魂复活', () => {
    const { engine, boss, dps, ai } = setup('mandokir', '血领主曼多基尔');
    ai.tick(50, boss, engine);
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === OHGAN_SUMMON));
    assert.equal((ai as MandokirAiState).mandoSoulsLeft, SOUL_REVIVE_MAX);

    dps.hp = dps.maxHp;
    dps.alive = true;
    dps.isAlive = true;
    ai.skills.find(s => s.id === 'decapitate')!.execute(boss, engine);
    assert.ok((ai as MandokirAiState).mandoSoulsLeft! < SOUL_REVIVE_MAX);
    assert.ok(dps.hp > 0 && dps.isAlive !== false, '灵魂应复活');
  });

  it('3. 基尔娜拉：开战刷豹；半血未清则狂暴', () => {
    const { engine, boss, ai } = setup('kilnara', '高阶祭司基尔娜拉');
    ai.tick(50, boss, engine);
    const panthers = engine.enemyUnits.filter(e => e.summonSpellId === PANTHER_SUMMON);
    assert.ok(panthers.length >= 6);
    boss.hp = Math.round(boss.maxHp * 0.4);
    ai.tick(50, boss, engine);
    assert.equal((ai as KilnaraAiState).kilnaraPhase, 'beast');
    assert.equal((ai as KilnaraAiState).kilnaraEnraged, true);

    // 清豹后再半血不狂暴
    const s2 = setup('kilnara', '高阶祭司基尔娜拉');
    s2.ai.tick(50, s2.boss, s2.engine);
    for (const p of s2.engine.enemyUnits.filter(e => e.summonSpellId === PANTHER_SUMMON)) {
      p.hp = 0;
      p.alive = false;
      p.isAlive = false;
    }
    s2.boss.hp = Math.round(s2.boss.maxHp * 0.4);
    s2.ai.tick(50, s2.boss, s2.engine);
    assert.equal((s2.ai as KilnaraAiState).kilnaraEnraged, undefined);
  });

  it('4. 赞吉尔：错锅吃反噬；对锅安全', () => {
    const { engine, boss, dps, ai } = setup('zanzil', '赞吉尔');
    ai.tick(50, boss, engine);
    (ai as ZanzilAiState).zanzilNextElixir = 'frost';
    // 玩家不喝锅
    ai.skills.find(s => s.id === 'cast_elixir')!.execute(boss, engine);
    assert.equal((ai as ZanzilAiState).zanzilActiveElixir, 'frost');
    const hpBad = dps.hp;
    (ai as ZanzilAiState).zanzilFightMs = 1000;
    ai.tick(50, boss, engine); // cross second boundary from 1000
    // force a second tick across boundary
    (ai as ZanzilAiState).zanzilFightMs = 1990;
    ai.tick(20, boss, engine);
    assert.ok(dps.hp < hpBad, '未喝冰釜应反噬');

    drinkZanzilCauldron(engine, dps, 'frost');
    assert.ok(dps.buffs?.some(b => b.spellId === CAULDRON_BUFF.frost));
    const hpOk = dps.hp;
    (ai as ZanzilAiState).zanzilFightMs = 2990;
    ai.tick(20, boss, engine);
    assert.equal(dps.hp, hpOk, '喝对锅不受反噬');
  });

  it('5. 金度：三层屏障后暴露', () => {
    const { engine, boss, ai } = setup('jindo', '碎神者金度');
    ai.tick(50, boss, engine);
    assert.equal((ai as JindoAiState).jindoPhase, 'barrier');
    assert.ok(engine.enemyUnits.some(e => e.summonSpellId === BRITTLE_BARRIER_SUMMON));

    for (let i = 0; i < 3; i++) {
      const b = engine.enemyUnits.find(
        e => e.summonSpellId === BRITTLE_BARRIER_SUMMON && (e.alive ?? e.isAlive) && (e.hp ?? 0) > 0,
      );
      if (b) {
        b.hp = 0;
        b.alive = false;
        b.isAlive = false;
      }
      ai.tick(50, boss, engine);
    }
    assert.equal((ai as JindoAiState).jindoPhase, 'exposed');
    assert.equal((ai as JindoAiState).jindoBarriersBroken, 3);
  });
});
