/**
 * APPLY_BUFF / REMOVE_BUFF must SET absolute stacks and peel multiple layers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '@cata-raid-sim/engine';
import type { CombatEffect } from '@cata-raid-sim/engine';
import {
  applyBuffFromEffect,
  removeBuffFromEffect,
} from '../applyCombatEffect.js';

function makeEngine() {
  const engine = new CombatEngine();
  engine.addUnit({
    id: 'tank',
    name: 'Tank',
    role: 'TANK',
    hp: 100000,
    maxHp: 100000,
    x: 0,
    y: 0,
    isAlive: true,
    alive: true,
    buffs: [],
  } as any);
  return engine;
}

function applyFx(
  engine: CombatEngine,
  partial: Partial<CombatEffect> & { kind: CombatEffect['kind']; spellId: string }
): void {
  const effect = {
    effectId: `e_${Math.random().toString(36).slice(2)}`,
    sourceId: 'healer',
    targetId: 'tank',
    ...partial,
  } as CombatEffect;
  if (partial.kind === 'APPLY_BUFF') applyBuffFromEffect(engine, engine.getUnit('tank')!, effect);
  else removeBuffFromEffect(engine, engine.getUnit('tank')!, effect);
}

describe('buff stack APPLY/REMOVE', () => {
  it('APPLY_BUFF sets absolute stacks (not +1 each echo)', () => {
    const engine = makeEngine();
    const tank = engine.getUnit('tank')!;
    applyFx(engine, {
      kind: 'APPLY_BUFF',
      spellId: 'lifebloom',
      buff: {
        spellId: 'lifebloom',
        name: '生命绽放',
        stacks: 1,
        maxStacks: 3,
        durationMs: 15000,
        sharedTimer: true,
        tickIntervalMs: 2000,
        tickValue: 2400,
      },
    });
    assert.equal(tank.buffs.find((b) => b.spellId === 'lifebloom')?.stacks, 1);

    applyFx(engine, {
      kind: 'APPLY_BUFF',
      spellId: 'lifebloom',
      buff: {
        spellId: 'lifebloom',
        name: '生命绽放',
        stacks: 3,
        maxStacks: 3,
        durationMs: 15000,
        sharedTimer: true,
      },
    });
    const lb = tank.buffs.find((b) => b.spellId === 'lifebloom');
    assert.equal(lb?.stacks, 3, 'absolute SET to 3');
    assert.equal(lb?.stackRemainingMs, undefined, 'shared timer');
  });

  it('REMOVE_BUFF peels multiple layers via stackDelta', () => {
    const engine = makeEngine();
    const tank = engine.getUnit('tank')!;
    applyFx(engine, {
      kind: 'APPLY_BUFF',
      spellId: 'bone_shield',
      buff: {
        spellId: 'bone_shield',
        name: '白骨之盾',
        stacks: 6,
        maxStacks: 6,
        durationMs: 300000,
      },
    });
    assert.equal(tank.buffs.find((b) => b.spellId === 'bone_shield')?.stacks, 6);

    applyFx(engine, {
      kind: 'REMOVE_BUFF',
      spellId: 'bone_shield',
      removeSpellId: 'bone_shield',
      buff: { spellId: 'bone_shield', name: '白骨之盾', stackDelta: -3 },
    });
    assert.equal(tank.buffs.find((b) => b.spellId === 'bone_shield')?.stacks, 3);

    applyFx(engine, {
      kind: 'REMOVE_BUFF',
      spellId: 'bone_shield',
      removeSpellId: 'bone_shield',
      buff: { spellId: 'bone_shield', name: '白骨之盾', stacks: 0, stackDelta: -3 },
    });
    assert.equal(
      tank.buffs.some((b) => b.spellId === 'bone_shield'),
      false,
      'peel to 0 removes aura'
    );
  });

  it('APPLY with stackDelta +2 adds layers', () => {
    const engine = makeEngine();
    const tank = engine.getUnit('tank')!;
    applyFx(engine, {
      kind: 'APPLY_BUFF',
      spellId: 'bone_shield',
      buff: {
        spellId: 'bone_shield',
        name: '白骨之盾',
        stacks: 2,
        maxStacks: 6,
        durationMs: 300000,
      },
    });
    applyFx(engine, {
      kind: 'APPLY_BUFF',
      spellId: 'bone_shield',
      buff: {
        spellId: 'bone_shield',
        name: '白骨之盾',
        stackDelta: 2,
        maxStacks: 6,
        durationMs: 300000,
      },
    });
    assert.equal(tank.buffs.find((b) => b.spellId === 'bone_shield')?.stacks, 4);
  });
});
