/**
 * 跑尸归来权威链：
 * 房主 massResurrect → 对客人发 RESURRECT（不乐观改客人血）→
 * 客人权威满血 → OWNER_SNAPSHOT → 房主拼接。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CombatEngine,
  RunStateMachine,
  ReportManager,
  createLevel80BaseStats,
  SHADOWFANG_KEEP_CONFIG,
} from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  ingestCombatEffect,
  makeGuestAuthorityPredicate,
  makeHostAuthorityPredicate,
  mergeOwnerSnapshotUnits,
  buildLocalOwnerSnapshot,
  resetCombatAuthority,
  hostForceFlushCombatBatch,
} from '../networkCombatAuthority.js';
import { withNetworkVitals } from '../withNetworkVitals.js';
import { netClient } from '../../net/NetClient.js';

function ally(id: string, hp: number, opts?: Partial<Unit>): Unit {
  return {
    id,
    name: id,
    classId: 'WARRIOR',
    role: 'TANK',
    isAlive: hp > 0,
    alive: hp > 0,
    isPlayer: id === 'guest' || id === 'host',
    isHumanControlled: id === 'guest' || id === 'host',
    hp,
    maxHp: 40_000,
    mp: 0,
    maxMp: 0,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('TANK', 'WARRIOR'),
    ...opts,
  } as Unit;
}

describe('corpse-run revive authority chain', () => {
  it('offline massResurrect 仍本地满血拉起全员', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const a = ally('a', 0, { isPlayer: false, isHumanControlled: false });
    const b = ally('b', 0, { isPlayer: false, isHumanControlled: false, role: 'HEALER', classId: 'PRIEST' });
    engine.addUnit(a);
    engine.addUnit(b);
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, new ReportManager());
    rsm.massResurrect();
    assert.equal(a.hp, a.maxHp);
    assert.equal(b.hp, b.maxHp);
    assert.ok(a.isAlive && b.isAlive);
  });

  it('房主跑尸：对客人座位只发 RESURRECT，本地不改客人血', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const host = ally('host', 0, { role: 'HEALER', classId: 'PRIEST' });
    const guest = ally('guest', 0, { role: 'DPS', classId: 'MAGE' });
    const ai = ally('ai1', 0, {
      isPlayer: false,
      isHumanControlled: false,
      role: 'DPS',
      classId: 'ROGUE',
    });
    engine.addUnit(host);
    engine.addUnit(guest);
    engine.addUnit(ai);
    configureCombatAuthority({
      localPlayerId: 'host',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeHostAuthorityPredicate(engine, 'host'),
    });
    (netClient as unknown as { _connected?: boolean })._connected = true;

    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, new ReportManager());
    withNetworkVitals(engine, () => rsm.massResurrect());

    assert.ok((host.isAlive ?? host.alive) && host.hp === host.maxHp, '房主自己满血');
    assert.ok((ai.isAlive ?? ai.alive) && ai.hp === ai.maxHp, '房主权威 AI 满血');
    assert.ok(!(guest.isAlive ?? guest.alive) || guest.hp <= 0, '客人座位不乐观复活');

    const batch = hostForceFlushCombatBatch('r1');
    assert.ok(batch, '应刷出 COMBAT_BATCH');
    const rezGuest = (batch!.effects || []).find(
      (e) => e.kind === 'RESURRECT' && e.targetId === 'guest'
    );
    assert.ok(rezGuest, '应对客人广播 RESURRECT');
    assert.equal(rezGuest!.amount, 100);
    assert.equal(rezGuest!.spellId, 'corpse_run_rez');

    (netClient as unknown as { _connected?: boolean })._connected = false;
    resetCombatAuthority();
  });

  it('客人收到跑尸 RESURRECT → 满血 → OWNER_SNAPSHOT；房主拼接后可见', () => {
    resetCombatAuthority();

    // Guest side
    const guestEngine = new CombatEngine();
    const guestSelf = ally('guest', 0, { role: 'DPS', classId: 'MAGE' });
    guestEngine.addUnit(guestSelf);
    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(guestEngine, 'guest'),
    });

    ingestCombatEffect(guestEngine, {
      effectId: 'corpse_rez_guest',
      sourceId: 'host',
      targetId: 'guest',
      spellId: 'corpse_run_rez',
      spellName: '跑尸归来',
      kind: 'RESURRECT',
      amount: 100,
    });
    assert.ok((guestSelf.isAlive ?? guestSelf.alive) && guestSelf.hp === guestSelf.maxHp);
    const snap = buildLocalOwnerSnapshot(guestEngine, 'guest');
    assert.equal(snap.units.find((u) => u.id === 'guest')?.hp, guestSelf.maxHp);

    // Host side merges owner snap
    resetCombatAuthority();
    const hostEngine = new CombatEngine();
    const host = ally('host', 40_000, { role: 'HEALER', classId: 'PRIEST' });
    const guestOnHost = ally('guest', 0, { role: 'DPS', classId: 'MAGE' });
    hostEngine.addUnit(host);
    hostEngine.addUnit(guestOnHost);
    configureCombatAuthority({
      localPlayerId: 'host',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeHostAuthorityPredicate(hostEngine, 'host'),
    });
    mergeOwnerSnapshotUnits(hostEngine, snap);
    const merged = hostEngine.getUnit('guest')!;
    assert.ok((merged.isAlive ?? merged.alive) && merged.hp === merged.maxHp, '房主拼接客人满血');

    resetCombatAuthority();
  });
});
