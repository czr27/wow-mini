/**
 * Iteration A: heal-reduction debuffs, Walden move/stop toxins, Ashbury Stay tick heals.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createBossAI } from '../bosses/index.js';
import { makeUnit, makeBoss, makeTank } from './helpers/combatFixtures.js';

function setupParty() {
  const engine = new CombatEngine();
  const boss = makeBoss('ashbury', {
    id: 'ashbury',
    name: '亚什布里男爵',
    maxHp: 1_000_000,
    hp: 1_000_000,
  });
  const tank = makeTank('WARRIOR', { id: 'tank', hp: 50_000, maxHp: 100_000, position: { x: 200, y: 200 } });
  const dps = makeUnit({
    id: 'dps',
    role: 'DPS',
    classId: 'MAGE',
    hp: 20_000,
    maxHp: 40_000,
    position: { x: 220, y: 200 },
  });
  engine.addUnit(boss);
  engine.addUnit(tank);
  engine.addUnit(dps);
  return { engine, boss, tank, dps };
}

describe('影牙迭代 A：受疗减免 / 沃登绿红 / 暂缓处决跳字', () => {
  it('1. cursed_veins 使受疗变为 25%', () => {
    const { engine, tank } = setupParty();
    tank.hp = 10_000;
    tank.buffs = [
      {
        id: 'cv',
        spellId: 'cursed_veins',
        name: '降受疗诅咒',
        kind: 'DEBUFF',
        tags: ['CC'],
        sourceUnitId: 'ashbury',
        targetUnitId: tank.id,
        durationMs: 15000,
        remainingMs: 15000,
        stacks: 1,
        maxStacks: 1,
        healingReceivedMod: 0.25,
      },
    ];
    assert.equal(engine.getHealingReceivedMultiplier(tank), 0.25);
    engine.applyHeal('tank', tank.id, 10000, false, 0, 'test_heal');
    // 10k * 0.25 = 2500 effective into hp
    assert.equal(tank.hp, 12_500);
  });

  it('2. mortal_wound 每层约 -10% 受疗', () => {
    const { engine, tank } = setupParty();
    tank.buffs = [
      {
        id: 'mw',
        spellId: 'mortal_wound',
        name: '重伤',
        kind: 'DEBUFF',
        tags: ['CC'],
        sourceUnitId: 'ashbury',
        targetUnitId: tank.id,
        durationMs: 20000,
        remainingMs: 20000,
        stacks: 3,
        maxStacks: 6,
      },
    ];
    assert.ok(Math.abs(engine.getHealingReceivedMultiplier(tank) - 0.7) < 1e-9);
  });

  it('3. 暂缓处决引导期间按秒跳字，打断后停止', () => {
    const { engine, boss, tank } = setupParty();
    tank.hp = 1;
    boss.hp = Math.round(boss.maxHp * 0.5);
    const ai = createBossAI('ashbury', 'shadowfang_keep');
    const stay = ai.skills.find(s => s.id === 'stay_of_execution')!;
    ai.currentCasting = { skill: stay, elapsedMs: 0 };
    ai.asphyxiatePostDelay = 0;

    const bossHpBefore = boss.hp;
    // 2.1s → 应跳 2 次（每跳 Boss +10% max）
    for (let i = 0; i < 21; i++) {
      ai.tick(100, boss, engine);
    }
    const after2 = boss.hp;
    assert.ok(after2 > bossHpBefore, '应产生跳字治疗');
    assert.ok(after2 - bossHpBefore >= Math.round(boss.maxHp * 0.1), '至少 1 跳');
    assert.ok(after2 - bossHpBefore <= Math.round(boss.maxHp * 0.25) + 5, '约 2 跳量级');

    // 打断后不应继续跳
    assert.equal(ai.interruptCurrentCast(), true);
    const hpAtInterrupt = boss.hp;
    for (let i = 0; i < 30; i++) {
      ai.tick(100, boss, engine);
    }
    assert.equal(boss.hp, hpAtInterrupt, '打断后不应再跳暂缓处决');
  });

  it('4. 沃登绿药：停步叠毒，走动消层', () => {
    const { engine, boss, tank } = setupParty();
    const ai = createBossAI('walden', 'shadowfang_keep');
    tank.position = { x: 200, y: 200 };
    tank.buffs = [
      {
        id: 'g',
        spellId: 'walden_green_toxin',
        name: '剧毒催化剂(绿药-必须走动)',
        kind: 'DEBUFF',
        tags: ['DEBUFF'],
        sourceUnitId: boss.id,
        targetUnitId: tank.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 2,
        maxStacks: 5,
        school: 'NATURE',
      },
    ];
    // 站立 1.6s → 叠层
    for (let i = 0; i < 16; i++) {
      ai.tick(100, boss, engine);
    }
    const green = tank.buffs.find(b => b.spellId === 'walden_green_toxin');
    assert.ok(green, '绿药仍在');
    assert.ok((green!.stacks || 0) >= 3, '停步应叠层');
    const stacksBeforeMove = green!.stacks || 0;

    // 移动 → 消层
    tank.position = { x: 230, y: 200 };
    ai.tick(100, boss, engine);
    const afterMove = tank.buffs.find(b => b.spellId === 'walden_green_toxin');
    assert.ok(afterMove);
    assert.ok((afterMove!.stacks || 0) < stacksBeforeMove, '走动应消层');
  });

  it('5. 沃登红药：移动触发引爆伤害', () => {
    const { engine, boss, tank } = setupParty();
    const ai = createBossAI('walden', 'shadowfang_keep');
    tank.hp = 80_000;
    tank.maxHp = 100_000;
    tank.position = { x: 200, y: 200 };
    tank.buffs = [
      {
        id: 'r',
        spellId: 'walden_red_toxin',
        name: '凝固毒素(红药-必须静止)',
        kind: 'DEBUFF',
        tags: ['DEBUFF'],
        sourceUnitId: boss.id,
        targetUnitId: tank.id,
        durationMs: 10000,
        remainingMs: 10000,
        stacks: 1,
        maxStacks: 1,
        school: 'FIRE',
      },
    ];
    // seed last pos
    ai.tick(50, boss, engine);
    const hpBefore = tank.hp;
    tank.position = { x: 260, y: 200 };
    for (let i = 0; i < 5; i++) {
      ai.tick(100, boss, engine);
    }
    assert.ok(tank.hp < hpBefore, '红药移动应引爆掉血');
  });
});
