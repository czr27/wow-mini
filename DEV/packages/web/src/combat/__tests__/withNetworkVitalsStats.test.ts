import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  mergeOwnerSnapshotUnits,
} from '../networkCombatAuthority.js';
import { withNetworkVitals } from '../withNetworkVitals.js';

function makeUnit(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    name: id,
    classId: 'PRIEST',
    role: 'HEALER',
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 20000,
    maxHp: 40000,
    position: { x: 200, y: 200 },
    stats: {
      attackPower: 100,
      spellPower: 1000,
      critChance: 0.2,
      haste: 0,
      armor: 1000,
      dodge: 0,
      parry: 0,
      block: 0,
      spellResist: 0,
    },
    buffs: [],
    resources: [],
    ...overrides,
  };
}

function resetAuthority() {
  configureCombatAuthority({
    activeRoomId: null,
    isNetworkHost: false,
    isNetworkGuest: false,
    localPlayerId: null,
    isUnitLocalAuthority: () => true,
  });
}

describe('withNetworkVitals healing stats', () => {
  it('客机治疗远端目标时保留目标血量由远端结算，同时本地立即计入自身治疗统计', () => {
    resetAuthority();
    const engine = new CombatEngine();
    const guestHealer = makeUnit('guest_1', { isPlayer: true, isHumanControlled: true, hp: 40000 });
    const hostTank = makeUnit('host_tank', { role: 'TANK', hp: 20000, maxHp: 40000 });
    engine.addUnit(guestHealer);
    engine.addUnit(hostTank);

    configureCombatAuthority({
      activeRoomId: 'room_test',
      isNetworkHost: false,
      isNetworkGuest: true,
      localPlayerId: 'guest_1',
      isUnitLocalAuthority: (id) => id === 'guest_1',
    });

    withNetworkVitals(engine, () => {
      engine.healUnit(guestHealer, hostTank, 8000, false, '强效治疗术');
    });

    assert.equal(hostTank.hp, 20000, '远端目标血量不由客机直接改写');
    assert.equal(guestHealer.combatStats?.healingDone, 8000, '自身治疗统计必须记账');
    assert.equal(guestHealer.combatStats?.skillHealing?.['强效治疗术'], 8000);
    resetAuthority();
  });

  it('mergeOwnerSnapshotUnits 单调合并 combatStats，不被陈旧快照的 0 覆盖', () => {
    resetAuthority();
    const engine = new CombatEngine();
    const host = makeUnit('host_1', { isPlayer: true, isHumanControlled: true });
    const guest = makeUnit('guest_1', {
      isHumanControlled: true,
      combatStats: {
        damageDealt: 0,
        healingDone: 12000,
        overhealDone: 1000,
        damageTaken: 0,
        interruptCount: 0,
        skillHealing: { '快速治疗': 12000 },
      },
    });
    engine.addUnit(host);
    engine.addUnit(guest);

    configureCombatAuthority({
      activeRoomId: 'room_test',
      isNetworkHost: true,
      isNetworkGuest: false,
      localPlayerId: 'host_1',
      isUnitLocalAuthority: (id) => id === 'host_1',
    });

    const staleSnap = {
      ...engine.buildNetworkUnitSnapshots().find((u) => u.id === 'guest_1')!,
      combatStats: {
        damageDealt: 0,
        healingDone: 0,
        overhealDone: 0,
        damageTaken: 0,
        interruptCount: 0,
        skillHealing: {},
      },
    };

    mergeOwnerSnapshotUnits(engine, {
      ownerId: 'guest_1',
      timeMs: Date.now(),
      units: [staleSnap],
    });

    const after = engine.getUnit('guest_1');
    assert.equal(after?.combatStats?.healingDone, 12000, '已累计的治疗统计不应被 0 覆盖');
    assert.equal(after?.combatStats?.skillHealing?.['快速治疗'], 12000);
    resetAuthority();
  });
});
