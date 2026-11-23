/**
 * Timed summons (feral spirit / gargoyle): spawn sprites, expire, host→guest sync.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import {
  spawnTimedSummons,
  tickTimedSummons,
  syncPetFollowPositions,
  resolveTimedSummonDef,
} from '../engine/UnitSpawn.js';
import type { Unit } from '../types.js';

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 10000,
    maxHp: 10000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: {
      attackPower: 5000,
      spellPower: 500,
      critChance: 0.1,
      haste: 0.1,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0.1,
      versatility: 0,
      speed: 0,
    },
    ...partial,
  };
}

describe('临时召唤生成 / 到期 / 房主快照同步', () => {
  it('野性狼魂生成两只 PET 精灵，并写入 SUMMON 动作', () => {
    const engine = new CombatEngine();
    const sham = makeUnit({
      id: 'sham_1',
      name: '萨满',
      classId: 'SHAMAN',
      role: 'DPS',
      isPlayer: true,
      position: { x: 200, y: 200 },
    });
    engine.addUnit(sham);

    const pets = spawnTimedSummons(engine, sham, 'feral_spirit');
    assert.equal(pets.length, 2);
    assert.ok(pets.every((p) => p.isPet && p.unitKind === 'PET' && p.ownerId === sham.id));
    assert.ok(pets.every((p) => p.summonSpellId === 'feral_spirit'));
    assert.ok(pets.every((p) => (p.despawnAtElapsedMs ?? 0) > engine.elapsed));

    for (const pet of pets) {
      engine.logCombatAction({
        actorId: sham.id,
        spellId: 'feral_spirit',
        spellName: '野性狼魂',
        kind: 'SUMMON',
        spawnedUnitId: pet.id,
        x: pet.position.x,
        y: pet.position.y,
      });
    }
    const actions = engine.drainRecentActions();
    assert.equal(actions.length, 2);
    assert.ok(actions.every((a) => a.kind === 'SUMMON' && a.spawnedUnitId));
  });

  it('到期后 tick 移除召唤物，客机快照同步消失', () => {
    const host = new CombatEngine();
    const dk = makeUnit({
      id: 'dk_1',
      name: 'DK',
      classId: 'DK',
      role: 'DPS',
      isPlayer: true,
      position: { x: 150, y: 150 },
    });
    host.addUnit(dk);
    const pets = spawnTimedSummons(host, dk, 'summon_gargoyle');
    assert.equal(pets.length, 1);

    const guest = new CombatEngine();
    guest.applyNetworkUnitSnapshots(host.buildNetworkUnitSnapshots());
    assert.ok(guest.getUnit(pets[0].id)?.isPet);

    // Advance past duration
    const def = resolveTimedSummonDef('summon_gargoyle')!;
    host.tick(def.durationMs + 100);
    tickTimedSummons(host); // processTick already calls this; ensure gone
    assert.equal(
      host.getAllUnits().filter((u) => u.summonSpellId === 'summon_gargoyle').length,
      0
    );

    guest.applyNetworkUnitSnapshots(host.buildNetworkUnitSnapshots());
    assert.equal(guest.getUnit(pets[0].id), undefined, '客机应随快照移除石像鬼');
  });

  it('宝宝跟随主人位置写入快照（移动同步）', () => {
    const engine = new CombatEngine();
    const owner = makeUnit({
      id: 'own_1',
      name: '主人',
      classId: 'HUNTER',
      role: 'DPS',
      isPlayer: true,
      position: { x: 100, y: 100 },
    });
    engine.addUnit(owner);
    const pets = spawnTimedSummons(engine, owner, 'feral_spirit');
    owner.position = { x: 400, y: 300 };
    syncPetFollowPositions(engine);
    syncPetFollowPositions(engine);
    syncPetFollowPositions(engine);
    for (const pet of pets) {
      const live = engine.getUnit(pet.id)!;
      assert.ok(Math.abs(live.position.x - 400) < 80, `pet x=${live.position.x}`);
      assert.ok(Math.abs(live.position.y - 300) < 80, `pet y=${live.position.y}`);
    }
    const snap = engine.buildNetworkUnitSnapshots().find((u) => u.id === pets[0].id);
    assert.ok(snap);
    assert.ok(Math.abs(snap!.position.x - 400) < 80);
  });
});
