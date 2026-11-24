/**
 * Lifebloom: shared timer — stacks amplify; all stacks expire together → one bloom.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { createLevel80BaseStats } from '../engine/TierProfile.js';
import type { Unit } from '../types.js';

function makeAlly(id: string): Unit {
  return {
    id,
    name: id,
    classId: 'DRUID',
    role: 'HEALER',
    isAlive: true,
    alive: true,
    hp: 30_000,
    maxHp: 30_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('HEALER', 'DRUID'),
  } as Unit;
}

describe('lifebloom shared timer', () => {
  it('3 stacks share one timer; no stackRemainingMs peel', () => {
    const engine = new CombatEngine();
    const druid = makeAlly('druid');
    const tank = makeAlly('tank');
    tank.hp = 10_000;
    engine.addUnit(druid);
    engine.addUnit(tank);

    for (let i = 0; i < 3; i++) {
      engine.applyBuff(tank, {
        id: `lb_${i}`,
        spellId: 'lifebloom',
        name: '生命绽放',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: druid.id,
        targetUnitId: tank.id,
        stacks: 1,
        maxStacks: 3,
        durationMs: 15_000,
        remainingMs: 15_000,
        school: 'NATURE',
        tickIntervalMs: 2000,
        tickValue: 2400,
      });
    }
    const lb = tank.buffs.find((b) => b.spellId === 'lifebloom')!;
    assert.equal(lb.stacks, 3);
    assert.equal(lb.stackRemainingMs, undefined);
    assert.ok((lb.remainingMs || 0) >= 14_000);

    // Advance just under full duration — still 3 stacks
    for (let i = 0; i < 14; i++) engine.tick(1000);
    const mid = tank.buffs.find((b) => b.spellId === 'lifebloom');
    assert.ok(mid);
    assert.equal(mid!.stacks, 3, '不应逐层剥落');

    // Finish duration → removed + bloom heal
    for (let i = 0; i < 3; i++) engine.tick(1000);
    const after = tank.buffs.find((b) => b.spellId === 'lifebloom');
    assert.equal(after, undefined, '全部层数应一起消失');
    assert.ok(tank.hp > 10_000, '应触发绽放治疗');
  });
});
