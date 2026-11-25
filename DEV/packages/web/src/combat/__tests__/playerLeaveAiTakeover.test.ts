/**
 * Player leave → host remaps/spawns AI and can purge leaver traces.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { LobbyRoom, Unit } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  mergeOwnerSnapshotUnits,
  resetCombatAuthority,
} from '../networkCombatAuthority.js';
import { applyPlayerLeaveAiTakeover } from '../playerLeaveAiTakeover.js';

function ally(id: string, extra?: Partial<Unit>): Unit {
  return {
    id,
    name: id,
    classId: 'MAGE',
    role: 'DPS',
    isAlive: true,
    alive: true,
    isPlayer: id === 'guest',
    isHumanControlled: id === 'guest',
    hp: 20_000,
    maxHp: 20_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('DPS', 'MAGE'),
    ...extra,
  } as Unit;
}

describe('playerLeaveAiTakeover', () => {
  it('remaps leaver to AI and drops pets; missing seat still spawns AI', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    engine.addUnit(ally('host', { isPlayer: true, isHumanControlled: true, role: 'TANK', classId: 'DK' }));
    engine.addUnit(ally('guest', { isPlayer: true, isHumanControlled: true }));
    engine.addUnit(
      ally('guest_pet', {
        isPet: true,
        ownerId: 'guest',
        isPlayer: false,
        isHumanControlled: false,
      })
    );
    configureCombatAuthority({
      localPlayerId: 'host',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r1',
      isUnitLocalAuthority: (id) => id === 'host' || id.startsWith('ai_'),
    });

    const room = {
      members: [
        { id: 'host', isAi: false, isPlayer: true, role: 'TANK', classId: 'DK', name: 'H', spec: 'BLOOD', isHost: true, isReady: true, slotIndex: 0 },
        { id: 'ai_new', isAi: true, isPlayer: false, role: 'DPS', classId: 'MAGE', name: 'AI法', spec: 'FIRE', isHost: false, isReady: true, slotIndex: 1 },
      ],
    } as LobbyRoom;

    const ai = applyPlayerLeaveAiTakeover(engine, {
      playerId: 'guest',
      aiMemberId: 'ai_new',
      room,
      isHost: true,
    });

    assert.ok(ai);
    assert.equal(ai!.id, 'ai_new');
    assert.equal(ai!.isHumanControlled, false);
    assert.equal(engine.getUnit('guest'), undefined);
    assert.equal(engine.getUnit('guest_pet'), undefined);
    assert.ok(engine.getUnit('ai_new'));

    // Purge snap erases leftover seat
    mergeOwnerSnapshotUnits(engine, {
      ownerId: 'ghost',
      timeMs: Date.now(),
      units: [],
      purge: true,
    });
    engine.addUnit(ally('ghost', { isHumanControlled: true }));
    mergeOwnerSnapshotUnits(engine, {
      ownerId: 'ghost',
      timeMs: Date.now(),
      units: [],
      purge: true,
    });
    assert.equal(engine.getUnit('ghost'), undefined);

    resetCombatAuthority();
  });
});
