import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Unit } from '@cata-raid-sim/engine';
import { pickNearestHostileExcluding } from '../tabTargetHostile.js';

function enemy(partial: Partial<Unit> & { id: string; x: number; y: number }): Unit {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    classId: 'BOSS',
    role: 'ENEMY',
    hp: partial.hp ?? 1000,
    maxHp: 1000,
    alive: partial.alive ?? true,
    isAlive: partial.isAlive ?? true,
    position: { x: partial.x, y: partial.y },
    buffs: [],
    debuffs: [],
  } as Unit;
}

describe('pickNearestHostileExcluding', () => {
  const from = { x: 0, y: 0 };

  it('picks nearest living hostile', () => {
    const near = enemy({ id: 'near', x: 50, y: 0 });
    const far = enemy({ id: 'far', x: 400, y: 0 });
    assert.equal(pickNearestHostileExcluding({ enemies: [far, near], from })?.id, 'near');
  });

  it('skips the currently selected hostile', () => {
    const near = enemy({ id: 'near', x: 50, y: 0 });
    const far = enemy({ id: 'far', x: 200, y: 0 });
    assert.equal(
      pickNearestHostileExcluding({ enemies: [near, far], from, excludeId: 'near' })?.id,
      'far'
    );
  });

  it('returns null when only the excluded enemy is alive', () => {
    const only = enemy({ id: 'only', x: 10, y: 0 });
    assert.equal(
      pickNearestHostileExcluding({ enemies: [only], from, excludeId: 'only' }),
      null
    );
  });

  it('ignores dead hostiles', () => {
    const deadNear = enemy({ id: 'dead', x: 10, y: 0, hp: 0, alive: false, isAlive: false });
    const far = enemy({ id: 'far', x: 300, y: 0 });
    assert.equal(
      pickNearestHostileExcluding({ enemies: [deadNear, far], from })?.id,
      'far'
    );
  });
});
