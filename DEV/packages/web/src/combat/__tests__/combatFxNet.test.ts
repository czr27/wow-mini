/**
 * Remote FX: GROUND_PLACE creates ground rings; AOE_PULSE / CAST_LAND log actions.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '@cata-raid-sim/engine';
import type { CombatEffect } from '@cata-raid-sim/engine';
import { applyCombatEffectToEngine } from '../applyCombatEffect.js';

function makeEngine() {
  const engine = new CombatEngine();
  engine.addUnit({
    id: 'p1',
    name: 'P1',
    role: 'HEALER',
    classId: 'DRUID',
    hp: 50000,
    maxHp: 50000,
    x: 100,
    y: 100,
    isAlive: true,
    alive: true,
    buffs: [],
  } as any);
  return engine;
}

describe('combat FX net apply', () => {
  it('GROUND_PLACE adds ground effect + action for remotes', () => {
    const engine = makeEngine();
    const effect: CombatEffect = {
      effectId: 'e_ground_1',
      sourceId: 'p1',
      targetId: 'p1',
      spellId: 'healing_rain',
      spellName: '治疗之雨',
      kind: 'GROUND_PLACE',
      x: 220,
      y: 180,
      radius: 60,
      groundEffectId: 'hrain_test',
      groundKind: 'HEAL_ZONE',
      colorHex: '#10B981',
      remainingMs: 10000,
      tickIntervalMs: 1000,
      tickValue: 3400,
    };
    applyCombatEffectToEngine(engine, effect);
    const g = engine.effectsManager?.groundEffects?.find((x) => x.id === 'hrain_test');
    assert.ok(g, 'ground effect placed');
    assert.equal(g!.x, 220);
    assert.equal(g!.radius, 60);
    const actions = engine.drainRecentActions();
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'GROUND_PLACE');
    assert.equal(actions[0].groundEffectId, 'hrain_test');
  });

  it('AOE_PULSE logs aoePulse INSTANT for class disc FX', () => {
    const engine = makeEngine();
    applyCombatEffectToEngine(engine, {
      effectId: 'e_aoe_1',
      sourceId: 'p1',
      targetId: 'p1',
      spellId: 'wild_growth',
      kind: 'AOE_PULSE',
      x: 100,
      y: 100,
      radius: 80,
      visualTone: 'HEAL',
    });
    const actions = engine.drainRecentActions();
    assert.equal(actions[0]?.aoePulse, true);
    assert.equal(actions[0]?.kind, 'INSTANT');
    assert.equal(actions[0]?.radius, 80);
  });

  it('CAST_LAND logs for hit FX ingest', () => {
    const engine = makeEngine();
    applyCombatEffectToEngine(engine, {
      effectId: 'e_land_1',
      sourceId: 'p1',
      targetId: 'boss',
      spellId: 'moonfire',
      spellName: '月火术',
      kind: 'CAST_LAND',
      visualTone: 'ENEMY',
    });
    const actions = engine.drainRecentActions();
    assert.equal(actions[0]?.kind, 'CAST_LAND');
    assert.equal(actions[0]?.targetId, 'boss');
  });
});
