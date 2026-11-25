/**
 * World snapshots must not overwrite local-authority HP/buffs (deltas via EFFECT only).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine, createLevel80BaseStats } from '@cata-raid-sim/engine';
import type { NetworkUnitSnapshot, Unit } from '@cata-raid-sim/engine';
import {
  configureCombatAuthority,
  makeGuestAuthorityPredicate,
  mergeOwnerSnapshotUnits,
  resetCombatAuthority,
} from '../networkCombatAuthority.js';
import {
  applyWorldSnapshotsPreservingAuthority,
  mergeGroundEffectsPreservingAuthority,
} from '../applyWorldSnapshotPreserveAuth.js';

function ally(id: string, hp: number): Unit {
  return {
    id,
    name: id,
    classId: 'DRUID',
    role: 'HEALER',
    isAlive: true,
    alive: true,
    isPlayer: id === 'guest',
    isHumanControlled: id === 'guest',
    hp,
    maxHp: 30_000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: createLevel80BaseStats('HEALER', 'DRUID'),
  } as Unit;
}

function snapOf(u: Unit, hpOverride?: number): NetworkUnitSnapshot {
  return {
    id: u.id,
    name: u.name,
    classId: u.classId,
    role: u.role,
    isPlayer: !!u.isPlayer,
    isHumanControlled: !!u.isHumanControlled,
    isAlive: true,
    hp: hpOverride ?? u.hp,
    maxHp: u.maxHp,
    absorb: 0,
    position: { ...(u.position || { x: 0, y: 0 }) },
    buffs: (u.buffs || []).map((b) => ({ ...b })),
  };
}

describe('applyWorldSnapshotsPreservingAuthority', () => {
  it('keeps guest HP/buffs when host snap has stale lower HP', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 25_000);
    guest.buffs = [
      {
        id: 'lb1',
        spellId: 'lifebloom',
        name: '生命绽放 (3层)',
        kind: 'BUFF',
        tags: ['HOT'],
        sourceUnitId: 'guest',
        targetUnitId: 'guest',
        stacks: 3,
        maxStacks: 3,
        durationMs: 15000,
        remainingMs: 12000,
        school: 'NATURE',
      },
    ];
    const boss = ally('boss', 100_000);
    boss.role = 'ENEMY';
    boss.classId = 'BOSS';
    engine.addUnit(guest);
    engine.addUnit(boss);

    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });

    // Host snap: guest still at old HP, no lifebloom; boss damaged
    applyWorldSnapshotsPreservingAuthority(engine, [
      snapOf(guest, 20_000),
      { ...snapOf(boss), hp: 80_000 },
    ]);

    const g = engine.getUnit('guest')!;
    assert.equal(g.hp, 25_000, '本地权威血量不可被快照覆盖');
    assert.ok(g.buffs.some((b) => b.spellId === 'lifebloom' && b.stacks === 3), '本地 buff 保留');
    assert.equal(engine.getUnit('boss')!.hp, 80_000, '非权威单位可被世界快照更新');
  });

  it('keeps local resurrect alive when host world snap still says dead', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 0);
    guest.isAlive = false;
    guest.alive = false;
    const ai = ally('ai_dps', 0);
    ai.isAlive = false;
    ai.alive = false;
    ai.isPlayer = false;
    ai.isHumanControlled = false;
    engine.addUnit(guest);
    engine.addUnit(ai);

    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });

    // Local authority applied RESURRECT delta
    assert.equal(engine.resurrectUnit('guest', 0.35, 0.35), true);
    assert.ok((guest.isAlive ?? guest.alive) && guest.hp > 0);

    // Stale host snap: guest still corpse; AI still dead
    applyWorldSnapshotsPreservingAuthority(engine, [
      {
        ...snapOf(guest, 0),
        isAlive: false,
      },
      {
        ...snapOf(ai, 0),
        isAlive: false,
        isPlayer: false,
        isHumanControlled: false,
      },
    ]);

    const g = engine.getUnit('guest')!;
    assert.ok((g.isAlive ?? g.alive) && g.hp > 0, '自己复活状态不可被房主死尸快照盖掉');
    assert.ok(g.hp >= Math.round(g.maxHp * 0.3), '复活后血量保留');
    const a = engine.getUnit('ai_dps')!;
    assert.ok(!(a.isAlive ?? a.alive) || a.hp <= 0, '非权威 AI 仍跟房主快照');
  });

  it('host full snap does not delete peer human seats', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 20_000);
    const peer = ally('peer', 18_000);
    peer.isPlayer = false;
    peer.isHumanControlled = true;
    const ai = ally('ai1', 15_000);
    ai.isPlayer = false;
    ai.isHumanControlled = false;
    engine.addUnit(guest);
    engine.addUnit(peer);
    engine.addUnit(ai);

    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });

    // Host snap only has AI (filtered) — must not wipe peer or self
    applyWorldSnapshotsPreservingAuthority(engine, [
      { ...snapOf(ai, 12_000), isPlayer: false, isHumanControlled: false },
    ]);

    assert.ok(engine.getUnit('guest'), '本人保留');
    assert.ok(engine.getUnit('peer'), '其他客人不可被全量剪掉');
    assert.equal(engine.getUnit('ai1')!.hp, 12_000, '房主权威 AI 可更新');
  });

  it('mergeOwnerSnapshotUnits never overwrites local hp/pos/alive/buffs', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 22_000);
    guest.position = { x: 333, y: 222 };
    guest.buffs = [
      {
        id: 'b1',
        spellId: 'power_word_shield',
        name: '真言术：盾',
        kind: 'BUFF',
        tags: [],
        sourceUnitId: 'guest',
        targetUnitId: 'guest',
        stacks: 1,
        maxStacks: 1,
        durationMs: 15000,
        remainingMs: 8000,
        school: 'HOLY',
      },
    ];
    const ai = ally('ai1', 10_000);
    ai.isPlayer = false;
    ai.isHumanControlled = false;
    engine.addUnit(guest);
    engine.addUnit(ai);

    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });

    // Hostile/host snap wrongly includes guest seat + updates AI
    mergeOwnerSnapshotUnits(engine, {
      ownerId: 'host',
      timeMs: Date.now(),
      units: [
        {
          ...snapOf(guest, 1),
          isAlive: false,
          position: { x: 1, y: 1 },
          buffs: [],
        },
        {
          ...snapOf(ai, 5_000),
          isPlayer: false,
          isHumanControlled: false,
        },
      ],
    });

    const g = engine.getUnit('guest')!;
    assert.equal(g.hp, 22_000, '本人血量不被 owner 快照盖');
    assert.equal(g.position.x, 333, '本人位置不被快照盖');
    assert.equal(g.position.y, 222);
    assert.ok((g.isAlive ?? g.alive) && g.hp > 0, '本人活性不被快照盖');
    assert.ok(g.buffs.some((b) => b.spellId === 'power_word_shield'), '本人状态不被快照盖');
    assert.equal(engine.getUnit('ai1')!.hp, 5_000, '非权威单位仍可被权威快照更新');
  });

  it('mergeOwnerSnapshotUnits does not delete human when snap omits owner body', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const host = ally('host', 20_000);
    host.isPlayer = true;
    host.isHumanControlled = true;
    const guest = ally('guest', 18_000);
    guest.isPlayer = false;
    guest.isHumanControlled = true;
    guest.role = 'HEALER';
    const pet = ally('guest_pet', 5_000);
    pet.isPlayer = false;
    pet.isHumanControlled = false;
    pet.isPet = true;
    pet.ownerId = 'guest';
    engine.addUnit(host);
    engine.addUnit(guest);
    engine.addUnit(pet);

    configureCombatAuthority({
      localPlayerId: 'host',
      isNetworkHost: true,
      isNetworkGuest: false,
      activeRoomId: 'r1',
      isUnitLocalAuthority: (id) => id === 'host',
    });

    // Malformed / partial owner snap: pets only, human body missing
    mergeOwnerSnapshotUnits(engine, {
      ownerId: 'guest',
      timeMs: Date.now(),
      units: [
        {
          ...snapOf(pet, 4_000),
          isPet: true,
          ownerId: 'guest',
          isPlayer: false,
          isHumanControlled: false,
        },
      ],
    });

    assert.ok(engine.getUnit('guest'), '客人席位不可因 owner 快照缺本体被删');
    assert.equal(engine.getUnit('guest')!.hp, 18_000);
    assert.equal(engine.getUnit('guest_pet')!.hp, 4_000, '快照内宠物仍更新');
    assert.equal(!!engine.getUnit('guest')!.isHumanControlled, true);
    resetCombatAuthority();
  });

  it('host ground mirror replaces AI/boss rings but keeps peer totems', () => {
    resetCombatAuthority();
    const engine = new CombatEngine();
    const guest = ally('guest', 20_000);
    const peer = ally('peer', 20_000);
    peer.isPlayer = true;
    peer.isHumanControlled = true;
    const ai = ally('ai1', 10_000);
    ai.isPlayer = false;
    ai.isHumanControlled = false;
    engine.addUnit(guest);
    engine.addUnit(peer);
    engine.addUnit(ai);
    engine.effectsManager.groundEffects = [
      {
        id: 'mine',
        ownerId: 'guest',
        kind: 'TOTEM',
        spellId: 'healing_stream',
        x: 0,
        y: 0,
        radius: 10,
        colorHex: '#0f0',
        remainingMs: 5000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      },
      {
        id: 'peer_totem',
        ownerId: 'peer',
        kind: 'TOTEM',
        spellId: 'healing_tide',
        x: 1,
        y: 1,
        radius: 15,
        colorHex: '#0ff',
        remainingMs: 5000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      },
      {
        id: 'boss_old',
        ownerId: 'ai1',
        kind: 'DAMAGE_ZONE',
        spellId: 'old_ring',
        x: 2,
        y: 2,
        radius: 40,
        colorHex: '#f00',
        remainingMs: 1000,
        tickIntervalMs: 1000,
        tickElapsedMs: 0,
        tickValue: 0,
      },
    ] as any;

    configureCombatAuthority({
      localPlayerId: 'guest',
      isNetworkHost: false,
      isNetworkGuest: true,
      activeRoomId: 'r1',
      isUnitLocalAuthority: makeGuestAuthorityPredicate(engine, 'guest'),
    });

    let ui: any[] = [];
    mergeGroundEffectsPreservingAuthority(
      engine,
      [
        {
          id: 'boss_new',
          ownerId: 'ai1',
          kind: 'DAMAGE_ZONE',
          spellId: 'new_ring',
          x: 9,
          y: 9,
          radius: 80,
          colorHex: '#f80',
          remainingMs: 8000,
        },
      ],
      (fx) => {
        ui = fx;
      }
    );

    const ids = (engine.effectsManager.groundEffects || []).map((g) => g.id).sort();
    assert.deepEqual(ids, ['boss_new', 'mine', 'peer_totem']);
    assert.equal(ui.length, 3);
    assert.ok(!ids.includes('boss_old'), '房主权威光圈消失由全镜像清空');
    resetCombatAuthority();
  });
});
