import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  makeHostAuthorityPredicate,
  resetCombatAuthority,
} from '../networkCombatAuthority.js';
import {
  filterHostAuthorityGround,
  filterHostAuthorityUnits,
} from '../hostWorldSnapFilter.js';

function unit(id: string, opts: Partial<Unit> = {}): Unit {
  return {
    id,
    name: id,
    classId: 'MAGE',
    role: 'DPS',
    isAlive: true,
    alive: true,
    isPlayer: id === 'host',
    isHumanControlled: id === 'host' || id === 'guest',
    hp: 20_000,
    maxHp: 20_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 0, y: 0 },
    stats: createLevel80BaseStats('DPS', 'MAGE'),
    ...opts,
  } as Unit;
}

describe('hostWorldSnapFilter', () => {
  it('omits human guests and their pets from full snap units', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    engine.addUnit(unit('host'));
    engine.addUnit(unit('guest', { isPlayer: true, isHumanControlled: true }));
    engine.addUnit(
      unit('guest_pet', {
        isPlayer: false,
        isHumanControlled: false,
        isPet: true,
        ownerId: 'guest',
      })
    );
    engine.addUnit(
      unit('ai1', { isPlayer: false, isHumanControlled: false, role: 'HEALER', classId: 'PRIEST' })
    );
    configureCombatAuthority({
      localPlayerId: 'host',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeHostAuthorityPredicate(engine, 'host'),
    });

    const filtered = filterHostAuthorityUnits(engine.buildNetworkUnitSnapshots(), engine);
    const ids = filtered.map((u) => u.id).sort();
    assert.deepEqual(ids, ['ai1', 'host']);
    resetCombatAuthority();
  });

  it('full snap ground keeps AI/boss/summon rings, drops guest totems', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    engine.addUnit(unit('host'));
    engine.addUnit(unit('guest', { isPlayer: true, isHumanControlled: true }));
    engine.addUnit(
      unit('ai1', { isPlayer: false, isHumanControlled: false, role: 'HEALER', classId: 'PRIEST' })
    );
    engine.addUnit(
      unit('ai_pet', {
        isPlayer: false,
        isHumanControlled: false,
        isPet: true,
        ownerId: 'ai1',
      })
    );
    engine.addUnit(
      unit('boss', {
        isPlayer: false,
        isHumanControlled: false,
        role: 'ENEMY',
        classId: 'BOSS',
      })
    );
    configureCombatAuthority({
      localPlayerId: 'host',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeHostAuthorityPredicate(engine, 'host'),
    });

    const ground = filterHostAuthorityGround(
      [
        { id: 'g_guest', ownerId: 'guest', kind: 'TOTEM', spellId: 'healing_stream', x: 0, y: 0, radius: 10, colorHex: '#fff', remainingMs: 1000 },
        { id: 'g_ai', ownerId: 'ai1', kind: 'TOTEM', spellId: 'healing_tide', x: 1, y: 1, radius: 20, colorHex: '#0f0', remainingMs: 1000 },
        { id: 'g_pet', ownerId: 'ai_pet', kind: 'DAMAGE_ZONE', spellId: 'pet_puddle', x: 2, y: 2, radius: 30, colorHex: '#f00', remainingMs: 1000 },
        { id: 'g_boss', ownerId: 'boss', kind: 'DAMAGE_ZONE', spellId: 'boss_ring', x: 3, y: 3, radius: 80, colorHex: '#f80', remainingMs: 1000 },
      ] as any,
      engine
    );
    const ids = ground.map((g) => g.id).sort();
    assert.deepEqual(ids, ['g_ai', 'g_boss', 'g_pet']);
    resetCombatAuthority();
  });
});
