/**
 * Maze (TRAVEL_RECOVERY) mana regen uses TRAVEL_MANA_REGEN_MULTIPLIER on ResourceManager.
 * Each net authority ticks its own seats; OWNER_SNAPSHOT carries mp — no separate wire field.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { TRAVEL_MANA_REGEN_MULTIPLIER } from '../engine/ResourceManager.js';
import { makeUnit } from './helpers/combatFixtures.js';

describe('TRAVEL_MANA_REGEN_MULTIPLIER', () => {
  it('exports 20× maze mana regen scale', () => {
    assert.equal(TRAVEL_MANA_REGEN_MULTIPLIER, 20);
  });

  it('manaRegenMultiplier scales passive MANA tick 20× vs baseline', () => {
    const engine = new CombatEngine();
    const unit = makeUnit({
      id: 'healer_1',
      role: 'HEALER',
      classId: 'PRIEST',
      mp: 10_000,
      maxMp: 100_000,
      resources: [{ kind: 'MANA', current: 10_000, max: 100_000 }],
    });
    engine.addUnit(unit);

    engine.resourceManager.manaRegenMultiplier = 1;
    engine.resourceManager.tickAll(engine.units, 1000);
    const gained1x = (engine.getUnit('healer_1')!.mp ?? 0) - 10_000;

    // Reset
    const u = engine.getUnit('healer_1')!;
    u.mp = 10_000;
    const res = u.resources.find((r) => r.kind === 'MANA')!;
    res.current = 10_000;

    engine.resourceManager.manaRegenMultiplier = TRAVEL_MANA_REGEN_MULTIPLIER;
    engine.resourceManager.tickAll(engine.units, 1000);
    const gained20x = (engine.getUnit('healer_1')!.mp ?? 0) - 10_000;

    assert.ok(gained1x > 0, 'baseline regen should add mana');
    assert.ok(
      Math.abs(gained20x / gained1x - TRAVEL_MANA_REGEN_MULTIPLIER) < 0.01,
      `expected ~20× regen, got ${gained20x / gained1x}× (${gained20x} vs ${gained1x})`
    );
  });
});
