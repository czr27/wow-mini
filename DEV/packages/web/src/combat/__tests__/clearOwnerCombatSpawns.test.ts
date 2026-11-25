/**
 * Leaving seat must drop owned pets + ground FX; seat unit itself stays for remap.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import { clearOwnerCombatSpawns } from '../clearOwnerCombatSpawns.js';

function ally(id: string, extra?: Partial<Unit>): Unit {
  return {
    id,
    name: id,
    classId: 'WARLOCK',
    role: 'DPS',
    isAlive: true,
    alive: true,
    isPlayer: id === 'leaver',
    isHumanControlled: id === 'leaver',
    hp: 20_000,
    maxHp: 20_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('DPS', 'WARLOCK'),
    ...extra,
  } as Unit;
}

describe('clearOwnerCombatSpawns', () => {
  it('removes pets and ground owned by leaver, keeps the seat unit', () => {
    const engine = new CombatEngine();
    const leaver = ally('leaver');
    const pet = ally('pet_1', {
      isPet: true,
      ownerId: 'leaver',
      isPlayer: false,
      isHumanControlled: false,
    });
    const otherPet = ally('pet_other', {
      isPet: true,
      ownerId: 'host',
      isPlayer: false,
      isHumanControlled: false,
    });
    engine.addUnit(leaver);
    engine.addUnit(pet);
    engine.addUnit(otherPet);
    engine.effectsManager.addGroundEffect({
      id: 'totem_leaver',
      ownerId: 'leaver',
      kind: 'TOTEM',
      x: 120,
      y: 120,
      radius: 20,
      remainingMs: 5000,
    } as any);
    engine.effectsManager.addGroundEffect({
      id: 'zone_host',
      ownerId: 'host',
      kind: 'DAMAGE_ZONE',
      x: 200,
      y: 200,
      radius: 40,
      remainingMs: 5000,
    } as any);

    const result = clearOwnerCombatSpawns(engine, 'leaver');

    assert.deepEqual(result.removedUnitIds, ['pet_1']);
    assert.deepEqual(result.removedGroundIds, ['totem_leaver']);
    assert.ok(engine.getUnit('leaver'), 'seat unit remains for AI remap');
    assert.equal(engine.getUnit('pet_1'), undefined);
    assert.ok(engine.getUnit('pet_other'), 'other owners untouched');
    assert.equal(engine.effectsManager.groundEffects.length, 1);
    assert.equal(engine.effectsManager.groundEffects[0].id, 'zone_host');
  });
});
