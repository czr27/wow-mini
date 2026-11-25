/**
 * Guest caster trusts absolute stacks on foreign targets: local mirror 1→2→3
 * so relay always carries the intended layer (recipient authority applies it).
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

describe('guest caster buff stack mirror on foreign seat', () => {
  it('lifebloom stacks 1→2→3 locally and publishes absolute stacks', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest');
    const tank = ally('tank', {
      isPlayer: true,
      isHumanControlled: true,
      role: 'TANK',
      classId: 'WARRIOR',
    });
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

    withNetworkVitals(engine, () => {
      for (let expect = 1; expect <= 3; expect++) {
        const existing = tank.buffs.find(
          (b) => b.spellId === 'lifebloom' && b.sourceUnitId === 'guest'
        );
        const nextStacks = Math.min(3, (existing?.stacks || 0) + 1);
        assert.equal(nextStacks, expect);
        engine.applyBuff(tank, {
          id: `lb_${expect}`,
          spellId: 'lifebloom',
          name: `生命绽放 (${nextStacks}层)`,
          kind: 'BUFF',
          tags: ['HOT'],
          sourceUnitId: 'guest',
          targetUnitId: 'tank',
          stacks: nextStacks,
          maxStacks: 3,
          durationMs: 15000,
          remainingMs: 15000,
          school: 'NATURE',
          tickIntervalMs: 2000,
          tickValue: 2400,
        });
        const after = tank.buffs.find(
          (b) => b.spellId === 'lifebloom' && b.sourceUnitId === 'guest'
        );
        assert.equal(after?.stacks, expect, `caster mirror at ${expect}`);
      }
    });

    (netClient as unknown as { _connected?: boolean })._connected = false;
    resetCombatAuthority();
  });
});
