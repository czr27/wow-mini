/**
 * Resurrect is target-authority: caster publishes RESURRECT; owner applies.
 * Foreign seats must not optimistic-mutate (world snap would kill them).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { Unit } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  ingestCombatEffect,
  makeGuestAuthorityPredicate,
  makeHostAuthorityPredicate,
  resetCombatAuthority,
} from '../networkCombatAuthority.js';
import { applyCombatEffectToEngine } from '../applyCombatEffect.js';
import { withNetworkVitals } from '../withNetworkVitals.js';
import { netClient } from '../../net/NetClient.js';

function ally(id: string, hp: number, opts?: Partial<Unit>): Unit {
  return {
    id,
    name: id,
    classId: 'PRIEST',
    role: 'HEALER',
    isAlive: hp > 0,
    alive: hp > 0,
    isPlayer: id === 'guest' || id === 'host',
    isHumanControlled: id === 'guest' || id === 'host',
    hp,
    maxHp: 30_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('HEALER', 'PRIEST'),
    ...opts,
  } as Unit;
}

describe('resurrect target authority', () => {
  it('applyCombatEffect RESURRECT raises dead unit', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const dead = ally('guest', 0);
    engine.addUnit(dead);
    applyCombatEffectToEngine(engine, {
      effectId: 'rez1',
      sourceId: 'host',
      targetId: 'guest',
      spellId: 'resurrect',
      spellName: '复活',
      kind: 'RESURRECT',
      amount: 40,
    });
    const u = engine.getUnit('guest')!;
    assert.ok(u.isAlive && u.alive);
    assert.equal(u.hp, Math.round(u.maxHp * 0.4));
  });

  it('guest stacks relayed RESURRECT deltas for self and foreign AI', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 0);
    const ai = ally('ai1', 0, { isPlayer: false, isHumanControlled: false, role: 'DPS' });
    engine.addUnit(guest);
    engine.addUnit(ai);
    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });

    ingestCombatEffect(engine, {
      effectId: 'rez_self',
      sourceId: 'host',
      targetId: 'guest',
      spellId: 'resurrect',
      kind: 'RESURRECT',
      amount: 35,
    });
    assert.ok((guest.isAlive ?? guest.alive) && guest.hp > 0, '自己座位应用 RESURRECT');

    // Steady-state: remotes stack host-relayed vital deltas (no full world mirror)
    ingestCombatEffect(engine, {
      effectId: 'rez_ai',
      sourceId: 'host',
      targetId: 'ai1',
      spellId: 'resurrect',
      kind: 'RESURRECT',
      amount: 50,
    });
    assert.ok((ai.isAlive ?? ai.alive) && ai.hp > 0, '转达后的 AI 复活增量本地叠加');
    assert.equal(ai.hp, Math.round(ai.maxHp * 0.5));
  });

  it('withNetworkVitals foreign rez does not mutate target', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 20_000);
    const ai = ally('ai1', 0, { isPlayer: false, isHumanControlled: false, role: 'DPS' });
    engine.addUnit(guest);
    engine.addUnit(ai);
    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });
    // Force networkingActive so vitals patch installs
    (netClient as unknown as { _connected?: boolean })._connected = true;

    const ok = withNetworkVitals(engine, () => engine.resurrectUnit('ai1', 0.5, 0.5));
    assert.equal(ok, true, 'caster still gets success for FX/publish');
    assert.ok(!(ai.isAlive ?? ai.alive) || ai.hp <= 0, '非权威目标不乐观复活');

    (netClient as unknown as { _connected?: boolean })._connected = false;
    resetCombatAuthority();
  });

  it('host ingest applies RESURRECT for AI seat only', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const host = ally('host', 20_000);
    const guest = ally('guest', 0);
    guest.isPlayer = true;
    guest.isHumanControlled = true;
    const ai = ally('ai1', 0, { isPlayer: false, isHumanControlled: false, role: 'DPS' });
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

    ingestCombatEffect(engine, {
      effectId: 'rez_ai_host',
      sourceId: 'guest',
      targetId: 'ai1',
      spellId: 'resurrect',
      kind: 'RESURRECT',
      amount: 60,
    });
    assert.ok((ai.isAlive ?? ai.alive) && ai.hp > 0, '房主权威 AI 应用客人 RESURRECT 增量');
    assert.equal(ai.hp, Math.round(ai.maxHp * 0.6));

    // Others’ seats: host only relays — no local HP math; splice comes from OWNER_SNAPSHOT
    ingestCombatEffect(engine, {
      effectId: 'rez_guest_relay',
      sourceId: 'host',
      targetId: 'guest',
      spellId: 'resurrect',
      kind: 'RESURRECT',
      amount: 50,
    });
    assert.ok(!(guest.isAlive ?? guest.alive) || guest.hp <= 0, '房主不算他人血量/复活');
    resetCombatAuthority();
  });

  it('caster applies foreign RESURRECT only after relay ingest (no optimistic)', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 20_000);
    const ai = ally('ai1', 0, { isPlayer: false, isHumanControlled: false, role: 'DPS' });
    engine.addUnit(guest);
    engine.addUnit(ai);
    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });
    (netClient as unknown as { _connected?: boolean })._connected = true;

    withNetworkVitals(engine, () => engine.resurrectUnit('ai1', 0.5, 0.5));
    assert.ok(!(ai.isAlive ?? ai.alive) || ai.hp <= 0, '施法当下不改 AI');

    // Simulate host relay / batch echo with same logical effect
    ingestCombatEffect(engine, {
      effectId: 'relay_rez_ai',
      sourceId: 'guest',
      targetId: 'ai1',
      spellId: 'resurrect',
      kind: 'RESURRECT',
      amount: 50,
      atMs: Date.now(),
    });
    assert.ok((ai.isAlive ?? ai.alive) && ai.hp > 0, '房主转达后施法者叠增量');

    (netClient as unknown as { _connected?: boolean })._connected = false;
    resetCombatAuthority();
  });
});
