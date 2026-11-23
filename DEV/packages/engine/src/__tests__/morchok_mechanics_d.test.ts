/**
 * Iteration D: Morchok stomp soak, crystal, black blood pillars, crush armor.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI } from '../bosses/index.js';
import {
  resolveStompDamage,
  crystalExplosionDamage,
  CRUSH_ARMOR_SPELL_ID,
  type MorchokAiState,
} from '../bosses/dragonsoul/morchok.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setup(n = 5) {
  const engine = new CombatEngine();
  engine.difficulty = 'HEROIC';
  const boss = makeBoss('morchok', {
    id: 'morchok',
    name: '莫卓克',
    maxHp: 40_000_000,
    hp: 40_000_000,
    position: { x: 500, y: 200 },
  });
  boss.unitKind = 'BOSS';
  boss.classId = 'BOSS';
  engine.addUnit(boss);

  const tank = makeTank('WARRIOR', {
    id: 'tank',
    hp: 65_000,
    maxHp: 65_000,
    position: { x: 480, y: 200 }, // near boss for stomp
  });
  engine.addUnit(tank);

  const others = [];
  for (let i = 1; i < n; i++) {
    const near = i <= 2;
    const u = makeUnit({
      id: `raid_${i}`,
      role: i === 1 ? 'HEALER' : 'DPS',
      classId: i === 1 ? 'SHAMAN' : 'MAGE',
      hp: 36_000,
      maxHp: 36_000,
      position: near
        ? { x: 470 + i * 10, y: 205 }
        : { x: 200 + i * 15, y: 280 },
    });
    engine.addUnit(u);
    others.push(u);
  }
  const ai = createBossAI('morchok', 'dragon_soul');
  return { engine, boss, tank, others, ai };
}

describe('巨龙之魂：莫卓克迭代 D', () => {
  it('1. 践踏近距分摊且最近目标双份', () => {
    const near = [
      makeUnit({ id: 'a', position: { x: 500, y: 200 } }),
      makeUnit({ id: 'b', position: { x: 520, y: 200 } }),
      makeUnit({ id: 'c', position: { x: 100, y: 100 } }), // far — excluded
    ];
    const boss = makeBoss('morchok', { position: { x: 500, y: 200 } });
    const map = resolveStompDamage(boss, near, 30_000);
    assert.ok(map.has('a'));
    assert.ok(map.has('b'));
    assert.equal(map.has('c'), false, '远距不应吃践踏分摊');
    // a 最近 → 双份；份额 2+1=3 → a=20000 b=10000
    assert.equal(map.get('a'), 20_000);
    assert.equal(map.get('b'), 10_000);

    const { engine, boss: b2, tank, others, ai } = setup(5);
    const stomp = ai.skills.find(s => s.id === 'stomp')!;
    const far = others.find(u => (u.position?.x || 0) < 300)!;
    const farHp = far.hp;
    const tankHp = tank.hp;
    stomp.execute(b2, engine);
    assert.ok(tank.hp < tankHp, '近距坦克应受伤');
    assert.equal(far.hp, farHp, '远距不应吃践踏');
  });

  it('2. 共鸣水晶：近距爆炸伤低于远距', () => {
    assert.ok(crystalExplosionDamage(10) < crystalExplosionDamage(120));
    assert.ok(crystalExplosionDamage(0) < crystalExplosionDamage(60));

    const { engine, boss, ai } = setup(5);
    const crystal = ai.skills.find(s => s.id === 'resonating_crystal')!;
    crystal.execute(boss, engine);
    const state = ai as MorchokAiState;
    assert.ok((state.morchokCrystals?.length || 0) >= 1);
    const c = state.morchokCrystals![0];
    assert.ok(c.linkedIds.length >= 1 && c.linkedIds.length <= 3);

    // 把第一个连线目标贴到水晶上，第二个拉远
    const u0 = engine.friendlyUnits.find(u => u.id === c.linkedIds[0])!;
    const u1 = engine.friendlyUnits.find(u => u.id === c.linkedIds[1]);
    u0.position = { x: c.x, y: c.y };
    if (u1) u1.position = { x: c.x + 200, y: c.y };
    const hp0 = u0.hp;
    const hp1 = u1?.hp ?? 0;

    state.morchokFightMs = c.explodeAtFightMs;
    ai.tick(50, boss, engine);

    assert.ok(u0.hp < hp0);
    if (u1) {
      assert.ok(u1.hp < hp1);
      const dmg0 = hp0 - u0.hp;
      const dmg1 = hp1 - u1.hp;
      assert.ok(dmg0 < dmg1, '贴水晶伤害应更低');
    }
  });

  it('3. 击碎护甲叠层', () => {
    const { engine, boss, tank, ai } = setup(5);
    const crush = ai.skills.find(s => s.id === 'crush_armor')!;
    for (let i = 0; i < 3; i++) {
      tank.hp = tank.maxHp;
      tank.alive = true;
      tank.isAlive = true;
      crush.execute(boss, engine);
    }
    const buff = tank.buffs?.find(b => b.spellId === CRUSH_ARMOR_SPELL_ID);
    assert.ok(buff);
    assert.equal(buff!.stacks, 3);
  });

  it('4. 黑血：躲柱安全，未躲柱掉血', () => {
    const { engine, boss, tank, others, ai } = setup(5);
    const blood = ai.skills.find(s => s.id === 'black_blood')!;
    blood.execute(boss, engine);
    const state = ai as MorchokAiState;
    assert.equal(state.morchokPhase, 'black_blood');
    assert.ok((state.morchokPillars?.length || 0) >= 2);

    const pillar = state.morchokPillars![0];
    tank.position = { x: pillar.x, y: pillar.y };
    const exposed = others[others.length - 1];
    exposed.position = { x: 50, y: 50 };
    const tankHp = tank.hp;
    const expHp = exposed.hp;

    for (let i = 0; i < 12; i++) ai.tick(100, boss, engine);

    assert.equal(tank.hp, tankHp, '柱后应不受黑血');
    assert.ok(exposed.hp < expHp, '未躲柱应掉血');
  });

  it('5. ≤20% 进入 Furious', () => {
    const { engine, boss, ai } = setup(5);
    boss.hp = Math.round(boss.maxHp * 0.15);
    ai.tick(50, boss, engine);
    assert.equal((ai as MorchokAiState).morchokFurious, true);
  });
});
