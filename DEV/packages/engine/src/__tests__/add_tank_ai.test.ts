import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatEngine,
  BossAI,
  TankAI,
  findLooseAddForTank,
  tickEnemyAdds,
  spawnCombatUnit,
  ZANZILI_ZOMBIE_SUMMON,
  GURUBASHI_BERSERKER_SUMMON,
  SKELETON_SUMMON,
  SCARLET_TRAINEE_SUMMON,
  BRITTLE_BARRIER_SUMMON,
} from '../index.js';
import type { Unit } from '../types.js';

function makeUnit(partial: Partial<Unit> & { id: string; role: Unit['role'] }): Unit {
  return {
    name: partial.name ?? partial.id,
    classId: partial.classId ?? (partial.role === 'ENEMY' ? 'NPC' : 'DK'),
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: partial.hp ?? 100_000,
    maxHp: partial.maxHp ?? 100_000,
    absorb: 0,
    buffs: [],
    threatTable: [],
    resources: [],
    stats: {
      attackPower: 2000,
      spellPower: 0,
      critChance: 0.1,
      haste: 0,
      armor: 1000,
    },
    position: partial.position ?? { x: 200, y: 200 },
    ...partial,
  };
}

describe('小怪 AI 与坦克拉怪 (AddAI + TankAI)', () => {
  it('1. findLooseAddForTank 识别未接仇或仇恨在治疗/DPS 上的小怪，忽略固定机关', () => {
    const tank = makeUnit({ id: 'tank1', role: 'TANK', classId: 'DK', position: { x: 200, y: 200 } });
    const healer = makeUnit({ id: 'heal1', role: 'HEALER', classId: 'PRIEST', position: { x: 100, y: 200 } });
    const boss = makeUnit({
      id: 'boss',
      role: 'ENEMY',
      classId: 'BOSS',
      unitKind: 'BOSS',
      threatTable: [{ sourceUnitId: 'tank1', amount: 5000 }],
    });
    const barrier = makeUnit({
      id: 'barrier1',
      role: 'ENEMY',
      unitKind: 'ADD',
      summonSpellId: BRITTLE_BARRIER_SUMMON,
      position: { x: 250, y: 200 },
    });
    const looseAdd = makeUnit({
      id: 'add1',
      role: 'ENEMY',
      unitKind: 'ADD',
      position: { x: 300, y: 200 },
      threatTable: [{ sourceUnitId: healer.id, amount: 500 }],
    });

    // Stationary construct ignored when it's the only add
    assert.equal(findLooseAddForTank(tank, [boss, barrier], boss, [tank]), null);

    // Loose add detected
    const found = findLooseAddForTank(tank, [boss, barrier, looseAdd], boss, [tank]);
    assert.equal(found?.id, 'add1');

    // Once tank holds threat on add, no longer loose
    looseAdd.threatTable = [{ sourceUnitId: tank.id, amount: 6000 }];
    assert.equal(findLooseAddForTank(tank, [boss, barrier, looseAdd], boss, [tank]), null);
  });

  it('2. TankAI.decide 持稳 Boss 仇恨时仍主动嘲讽并锁定散落小怪', () => {
    const tank = makeUnit({
      id: 'tank1',
      role: 'TANK',
      classId: 'DK',
      spec: 'BLOOD',
      runicPower: 80,
      runes: [
        { kind: 'BLOOD', available: true, cooldownRemainingMs: 0 },
        { kind: 'BLOOD', available: true, cooldownRemainingMs: 0 },
        { kind: 'FROST', available: true, cooldownRemainingMs: 0 },
        { kind: 'UNHOLY', available: true, cooldownRemainingMs: 0 },
      ],
      position: { x: 200, y: 200 },
    });
    const healer = makeUnit({ id: 'heal1', role: 'HEALER', classId: 'PRIEST', position: { x: 100, y: 200 } });
    const boss = makeUnit({
      id: 'boss',
      role: 'ENEMY',
      classId: 'BOSS',
      unitKind: 'BOSS',
      threatTable: [{ sourceUnitId: tank.id, amount: 9000 }],
      position: { x: 240, y: 200 },
    });
    const looseAdd = makeUnit({
      id: 'add1',
      role: 'ENEMY',
      unitKind: 'ADD',
      threatTable: [{ sourceUnitId: healer.id, amount: 1000 }],
      position: { x: 250, y: 240 },
    });

    const ai = new TankAI();
    const actions = ai.decide(tank, {
      units: [tank, healer, boss, looseAdd],
      bossId: boss.id,
      elapsedMs: 10_000,
    });

    const tauntAction = actions.find((a) => a.action.spellId === 'dk_dark_command');
    assert.ok(tauntAction, '坦克应触发嘲讽动作');
    assert.equal(tauntAction!.action.targetId, 'add1', '嘲讽目标应为散落小怪');
  });

  it('3. tickEnemyAdds 驱动小怪向仇恨目标移动并近战普攻，且不移动固定机关', () => {
    const engine = new CombatEngine();
    const tank = makeUnit({ id: 'tank1', role: 'TANK', classId: 'DK', position: { x: 200, y: 200 }, hp: 100_000, maxHp: 100_000 });
    const boss = makeUnit({ id: 'boss', role: 'ENEMY', classId: 'BOSS', unitKind: 'BOSS', position: { x: 400, y: 200 } });
    engine.addUnit(tank);
    engine.addUnit(boss);

    const add = spawnCombatUnit(engine, {
      id: 'add_wolf',
      name: '狼人之灵',
      unitKind: 'ADD',
      role: 'ENEMY',
      classId: 'NPC',
      hp: 50_000,
      position: { x: 400, y: 200 },
    });
    const barrier = spawnCombatUnit(engine, {
      id: 'barrier_1',
      name: '脆弱屏障',
      unitKind: 'ADD',
      role: 'ENEMY',
      classId: 'NPC',
      hp: 50_000,
      position: { x: 420, y: 200 },
      summonSpellId: BRITTLE_BARRIER_SUMMON,
    });

    engine.threatManager.addThreat(add.id, tank.id, 1000);
    const timers = new Map<string, number>();

    // Simulate 2.5 seconds in 50ms ticks so add walks into melee and attacks
    for (let i = 0; i < 50; i++) {
      engine.tick(50);
      tickEnemyAdds(engine, boss, 50, timers);
    }

    assert.ok(add.position.x < 350, '小怪应向坦克移动');
    assert.equal(barrier.position.x, 420, '固定机关不得移动');
    assert.ok(tank.hp < 100_000, '小怪进入近战后应造成普攻伤害');
  });

  it('4. 赞吉尔冰霜/火焰药剂召唤赞吉利僵尸与古拉巴什狂战士；瑞文戴尔死亡契约献祭骷髅；赫洛德 25% 召学徒', () => {
    // Zanzil
    {
      const engine = new CombatEngine();
      engine.addUnit(makeUnit({ id: 't1', role: 'TANK', classId: 'DK' }));
      const boss = makeUnit({ id: 'zanzil', role: 'ENEMY', classId: 'BOSS', unitKind: 'BOSS' });
      engine.addUnit(boss);
      const ai = new BossAI('zanzil', 'zulgurub');
      const elixir = ai.skills.find((s) => s.id === 'cast_elixir')!;
      (ai as any).zanzilNextElixir = 'frost';
      elixir.execute(boss, engine);
      assert.equal(
        engine.enemyUnits.filter((e) => e.summonSpellId === ZANZILI_ZOMBIE_SUMMON).length,
        3,
        '冰霜药剂应召唤 3 只赞吉利僵尸'
      );
      (ai as any).zanzilNextElixir = 'fire';
      elixir.execute(boss, engine);
      assert.equal(
        engine.enemyUnits.filter((e) => e.summonSpellId === GURUBASHI_BERSERKER_SUMMON).length,
        1,
        '火焰药剂应召唤 1 只古拉巴什狂战士'
      );
    }

    // Rivendare Death Pact
    {
      const engine = new CombatEngine();
      engine.addUnit(makeUnit({ id: 't1', role: 'TANK', classId: 'DK' }));
      const boss = makeUnit({ id: 'rivendare', role: 'ENEMY', classId: 'BOSS', unitKind: 'BOSS', hp: 50_000, maxHp: 100_000 });
      engine.addUnit(boss);
      const ai = new BossAI('rivendare', 'stratholme');
      ai.skills.find((s) => s.id === 'summon_skeletons')!.execute(boss, engine);
      const pact = ai.skills.find((s) => s.id === 'death_pact')!;
      pact.execute(boss, engine);
      assert.ok(boss.hp > 50_000, '死亡契约应献祭骷髅为男爵回血');
      const aliveSkels = engine.enemyUnits.filter(
        (e) => e.summonSpellId === SKELETON_SUMMON && (e.alive ?? e.isAlive)
      );
      assert.equal(aliveSkels.length, 3, '死亡契约应消耗 1 只骷髅');
    }

    // Herod 25% trainees
    {
      const engine = new CombatEngine();
      engine.addUnit(makeUnit({ id: 't1', role: 'TANK', classId: 'DK' }));
      const boss = makeUnit({ id: 'herod', role: 'ENEMY', classId: 'BOSS', unitKind: 'BOSS', hp: 20_000, maxHp: 100_000 });
      engine.addUnit(boss);
      const ai = new BossAI('herod', 'scarlet_monastery');
      ai.tick(50, boss, engine);
      assert.equal(
        engine.enemyUnits.filter((e) => e.summonSpellId === SCARLET_TRAINEE_SUMMON).length,
        8,
        '赫洛德 25% 血量时应召唤血色学徒'
      );
    }
  });
});
