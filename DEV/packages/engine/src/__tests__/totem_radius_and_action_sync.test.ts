/**
 * Totem radius gating + pet/add snapshot identity + host action echo for FX sync.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { EffectsManager } from '../engine/EffectsManager.js';
import { spawnCombatUnit } from '../engine/UnitSpawn.js';
import { getEffectiveUnitStats } from '../engine/BuffEffects.js';
import {
  encodeNetMessage,
  decodeNetMessage,
  type NetworkCombatSnapshot,
} from '../net/NetProtocol.js';
import type { Unit } from '../types.js';
import { RANGE_10YD_PX } from '../classes/ClassRegistry.js';

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 10000,
    maxHp: 10000,
    mp: 5000,
    maxMp: 5000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 100, y: 100 },
    stats: {
      attackPower: 500,
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

describe('图腾半径 / 小怪快照 / 动作同步', () => {
  it('1. 灵魂链接/法力之潮仅对图腾半径内友方生效', () => {
    const engine = new CombatEngine();
    engine.effectsManager = new EffectsManager(engine);

    const shaman = makeUnit({
      id: 'sham_1',
      name: '萨满',
      classId: 'SHAMAN',
      role: 'HEALER',
      isPlayer: true,
      position: { x: 0, y: 0 },
      hp: 5000,
      maxHp: 10000,
    });
    const inRange = makeUnit({
      id: 'ally_in',
      name: '近',
      classId: 'MAGE',
      role: 'DPS',
      position: { x: RANGE_10YD_PX - 10, y: 0 },
      hp: 3000,
      maxHp: 10000,
      mp: 1000,
      maxMp: 5000,
    });
    const outRange = makeUnit({
      id: 'ally_out',
      name: '远',
      classId: 'MAGE',
      role: 'DPS',
      position: { x: RANGE_10YD_PX + 40, y: 0 },
      hp: 3000,
      maxHp: 10000,
      mp: 1000,
      maxMp: 5000,
    });
    engine.addUnit(shaman);
    engine.addUnit(inRange);
    engine.addUnit(outRange);

    engine.effectsManager.addGroundEffect({
      id: 'slt_test',
      kind: 'TOTEM',
      spellId: 'spirit_link',
      ownerId: shaman.id,
      x: 0,
      y: 0,
      radius: RANGE_10YD_PX,
      colorHex: '#00CED1',
      remainingMs: 6000,
      tickIntervalMs: 1000,
      tickElapsedMs: 999,
      tickValue: 0,
    });
    engine.effectsManager.addGroundEffect({
      id: 'mtt_test',
      kind: 'TOTEM',
      spellId: 'mana_tide',
      ownerId: shaman.id,
      x: 0,
      y: 0,
      radius: RANGE_10YD_PX,
      colorHex: '#56CCF2',
      remainingMs: 12000,
      tickIntervalMs: 1000,
      tickElapsedMs: 999,
      tickValue: 0,
    });

    engine.effectsManager.tick(50);

    assert.ok(
      inRange.buffs.some((b) => b.spellId === 'spirit_link'),
      '半径内应有灵魂链接 buff'
    );
    assert.ok(
      !outRange.buffs.some((b) => b.spellId === 'spirit_link'),
      '半径外不应有灵魂链接 buff'
    );
    assert.ok(
      inRange.buffs.some((b) => b.spellId === 'mana_tide'),
      '半径内应有法力之潮 buff'
    );
    assert.ok(
      !outRange.buffs.some((b) => b.spellId === 'mana_tide'),
      '半径外不应有法力之潮 buff'
    );
  });

  it('2. 风怒图腾半径内通过 getEffectiveUnitStats 获得急速', () => {
    const engine = new CombatEngine();
    engine.effectsManager = new EffectsManager(engine);
    const melee = makeUnit({
      id: 'melee_1',
      name: '近战',
      classId: 'WARRIOR',
      role: 'DPS',
      position: { x: 10, y: 0 },
      stats: {
        attackPower: 500,
        spellPower: 0,
        critChance: 0.1,
        haste: 0.2,
        armor: 100,
        spellResist: 0,
        block: 0,
        parry: 0,
        dodge: 0.05,
        mastery: 0.1,
        versatility: 0,
        speed: 0,
      },
    });
    engine.addUnit(melee);
    engine.effectsManager.addGroundEffect({
      id: 'wf_test',
      kind: 'TOTEM',
      spellId: 'windfury_totem',
      ownerId: 'sham_1',
      x: 0,
      y: 0,
      radius: RANGE_10YD_PX,
      colorHex: '#E0E0E0',
      remainingMs: 5000,
      tickIntervalMs: 1000,
      tickElapsedMs: 999,
      tickValue: 0,
    });
    engine.effectsManager.tick(50);
    assert.ok(melee.buffs.some((b) => b.spellId === 'windfury_totem'));
    const eff = getEffectiveUnitStats(melee);
    assert.ok(eff.haste >= 0.35, `期望 haste≈0.36，实际 ${eff.haste}`);
  });

  it('3. 网络快照保留 isPet/ownerId/unitKind（宝宝+小怪预备）', () => {
    const host = new CombatEngine();
    const owner = makeUnit({
      id: 'hunter_1',
      name: '猎人',
      classId: 'HUNTER',
      role: 'DPS',
      isPlayer: true,
      isHumanControlled: true,
    });
    host.addUnit(owner);
    const pet = spawnCombatUnit(host, {
      id: 'pet_1',
      name: '宠物',
      unitKind: 'PET',
      ownerId: owner.id,
      classId: 'HUNTER',
      role: 'DPS',
      position: { x: 120, y: 120 },
    });
    const add = spawnCombatUnit(host, {
      id: 'add_1',
      name: '小怪',
      unitKind: 'ADD',
      classId: 'NPC',
      role: 'ENEMY',
      hp: 20000,
      position: { x: 300, y: 200 },
    });

    const snaps = host.buildNetworkUnitSnapshots();
    const petSnap = snaps.find((u) => u.id === pet.id);
    const addSnap = snaps.find((u) => u.id === add.id);
    assert.ok(petSnap);
    assert.equal(petSnap!.isPet, true);
    assert.equal(petSnap!.ownerId, owner.id);
    assert.equal(petSnap!.unitKind, 'PET');
    assert.ok(addSnap);
    assert.equal(addSnap!.unitKind, 'ADD');
    assert.equal(addSnap!.role, 'ENEMY');

    const guest = new CombatEngine();
    guest.applyNetworkUnitSnapshots(snaps);
    const gPet = guest.getUnit('pet_1');
    const gAdd = guest.getUnit('add_1');
    assert.ok(gPet?.isPet);
    assert.equal(gPet?.ownerId, 'hunter_1');
    assert.equal(gPet?.unitKind, 'PET');
    assert.equal(gAdd?.unitKind, 'ADD');
  });

  it('4. 房主 logCombatAction → COMBAT_STATE.recentActions 编解码完整（特效同步通道）', () => {
    const engine = new CombatEngine();
    const player = makeUnit({
      id: 'p1',
      name: '玩家',
      classId: 'SHAMAN',
      role: 'HEALER',
      isPlayer: true,
    });
    const boss = makeUnit({
      id: 'boss_1',
      name: '首领',
      classId: 'BOSS',
      role: 'ENEMY',
    });
    engine.addUnit(player);
    engine.addUnit(boss);

    engine.logCombatAction({
      actorId: player.id,
      spellId: 'riptide',
      spellName: '激流',
      kind: 'INSTANT',
      targetId: boss.id,
    });
    engine.logCombatAction({
      actorId: player.id,
      spellId: 'spirit_link',
      spellName: '灵魂链接图腾',
      kind: 'GROUND_PLACE',
      x: 200,
      y: 180,
      groundEffectId: 'slt_1',
      targetId: null,
    });

    const recentActions = engine.drainRecentActions();
    assert.equal(recentActions.length, 2);
    assert.equal(engine.drainRecentActions().length, 0, 'drain 后应清空');

    const snap: NetworkCombatSnapshot = {
      roomId: 'room_act',
      seq: 9,
      timeMs: Date.now(),
      runPhase: 'BOSS_COMBAT',
      units: engine.buildNetworkUnitSnapshots(),
      recentActions,
    };
    const wire = encodeNetMessage({ type: 'COMBAT_STATE', roomId: snap.roomId, payload: snap });
    const decoded = decodeNetMessage(wire);
    assert.ok(decoded);
    const body = decoded!.payload as NetworkCombatSnapshot;
    assert.equal(body.recentActions?.length, 2);
    assert.equal(body.recentActions![0].actorId, 'p1');
    assert.equal(body.recentActions![0].targetId, 'boss_1');
    assert.equal(body.recentActions![0].kind, 'INSTANT');
    assert.equal(body.recentActions![1].kind, 'GROUND_PLACE');
    assert.equal(body.recentActions![1].x, 200);
    assert.equal(body.recentActions![1].groundEffectId, 'slt_1');
  });
});
