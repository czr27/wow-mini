/**
 * Regression: foreign removeBuff must not return true without peeling —
 * `while (removeBuff)` (lifebloom unique target) freezes the guest UI.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import { netClient } from '../../net/NetClient.js';
import {
  configureCombatAuthority,
  makeGuestAuthorityPredicate,
  resetCombatAuthority,
} from '../networkCombatAuthority.js';
import { withNetworkVitals } from '../withNetworkVitals.js';

function ally(id: string, extra?: Partial<Unit>): Unit {
  return {
    id,
    name: id,
    classId: 'DRUID',
    role: 'HEALER',
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
    stats: createLevel80BaseStats('HEALER', 'DRUID'),
    ...extra,
  } as Unit;
}

describe('removeBuff while-loop under withNetworkVitals', () => {
  it('lifebloom unique-target clear on foreign seats terminates', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest');
    const tank = ally('tank', {
      isPlayer: true,
      isHumanControlled: true,
      role: 'TANK',
      classId: 'WARRIOR',
    });
    const ai = ally('ai1', {
      isPlayer: false,
      isHumanControlled: false,
      role: 'DPS',
    });
    engine.addUnit(guest);
    engine.addUnit(tank);
    engine.addUnit(ai);
    tank.buffs.push({
      id: 'lb_tank',
      spellId: 'lifebloom',
      name: '生命绽放 (1层)',
      kind: 'BUFF',
      tags: ['HOT'],
      sourceUnitId: 'guest',
      targetUnitId: 'tank',
      stacks: 1,
      maxStacks: 3,
      durationMs: 15000,
      remainingMs: 12000,
    } as any);

    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });
    (netClient as unknown as { _connected?: boolean })._connected = true;

    const started = Date.now();
    withNetworkVitals(engine, () => {
      for (const u of engine.getAllUnits()) {
        if (u.id === 'guest') continue;
        while (engine.auraManager.removeBuff(u, 'lifebloom', 'guest')) {
          assert.ok(Date.now() - started < 500, 'removeBuff while must not hang');
        }
      }
      engine.applyBuff(guest, {
        id: 'lb_self',
        spellId: 'lifebloom',
        name: '生命绽放 (1层)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: 'guest',
        targetUnitId: 'guest',
        stacks: 1,
        maxStacks: 3,
        durationMs: 15000,
        remainingMs: 15000,
      });
    });

    assert.equal(
      tank.buffs.some((b) => b.spellId === 'lifebloom'),
      false,
      'foreign LB peeled so while terminates'
    );
    assert.ok(guest.buffs.some((b) => b.spellId === 'lifebloom'));

    (netClient as unknown as { _connected?: boolean })._connected = false;
    resetCombatAuthority();
  });

  it('foreign removeBuff with no matching buff returns false', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest');
    const tank = ally('tank', { isPlayer: true, isHumanControlled: true });
    engine.addUnit(guest);
    engine.addUnit(tank);
    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });
    (netClient as unknown as { _connected?: boolean })._connected = true;

    const ok = withNetworkVitals(engine, () =>
      engine.auraManager.removeBuff(tank, 'lifebloom', 'guest')
    );
    assert.equal(ok, false);

    (netClient as unknown as { _connected?: boolean })._connected = false;
    resetCombatAuthority();
  });
});
