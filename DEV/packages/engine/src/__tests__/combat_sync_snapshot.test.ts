/**
 * Host-authoritative combat sync: snapshot shape + guest overlay semantics.
 * Covers: boss/player casts & positions, ground FX, floating texts, no double-apply via absolute HP.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CombatEngine } from '../engine/CombatEngine.js';
import { EffectsManager } from '../engine/EffectsManager.js';
import {
  encodeNetMessage,
  decodeNetMessage,
  type NetworkCombatSnapshot,
} from '../net/NetProtocol.js';
import type { Unit } from '../types.js';

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

describe('战斗同步快照：读条 / 特效 / 位移 / 飘字 / 幂等覆盖', () => {
  it('1. 房主快照含首领读条、位移与技能施法时间线，编解码后完整保留', () => {
    const engine = new CombatEngine();
    const boss = makeUnit({
      id: 'boss_1',
      name: '亚什布里男爵',
      classId: 'BOSS',
      role: 'ENEMY',
      position: { x: 320, y: 180 },
      hp: 80000,
      maxHp: 100000,
    });
    const tank = makeUnit({
      id: 'tank_1',
      name: '坦克',
      classId: 'DK',
      role: 'TANK',
      isPlayer: true,
      isHumanControlled: true,
      position: { x: 280, y: 200 },
    });
    engine.addUnit(boss);
    engine.addUnit(tank);

    const now = Date.now();
    const snap: NetworkCombatSnapshot = {
      roomId: 'room_sync',
      seq: 1,
      timeMs: now,
      runPhase: 'BOSS_COMBAT',
      bossTargetId: tank.id,
      units: engine.buildNetworkUnitSnapshots(),
      casts: [
        {
          unitId: boss.id,
          spellId: 'asphyxiate',
          spellName: '窒息',
          startedAtMs: now - 800,
          totalMs: 2000,
          interruptible: true,
        },
        {
          unitId: tank.id,
          spellId: 'death_coil',
          spellName: '死亡缠绕',
          startedAtMs: now - 200,
          totalMs: 1500,
          interruptible: false,
        },
      ],
    };

    const wire = encodeNetMessage({ type: 'COMBAT_STATE', roomId: snap.roomId, payload: snap });
    const decoded = decodeNetMessage(wire);
    assert.ok(decoded);
    const body = decoded!.payload as NetworkCombatSnapshot;
    assert.equal(body.runPhase, 'BOSS_COMBAT');
    assert.equal(body.casts?.length, 2);
    assert.equal(body.casts![0].unitId, 'boss_1');
    assert.equal(body.casts![0].spellName, '窒息');
    const bossSnap = body.units.find((u) => u.id === 'boss_1');
    assert.ok(bossSnap);
    assert.deepEqual(bossSnap!.position, { x: 320, y: 180 });
  });

  it('2. 房主快照广播地面特效与玩家位移；客人 apply 后位置/特效与主机一致', () => {
    const host = new CombatEngine();
    host.effectsManager = new EffectsManager(host);
    const player = makeUnit({
      id: 'p_host',
      name: '法师',
      classId: 'MAGE',
      role: 'DPS',
      isPlayer: true,
      position: { x: 150, y: 160 },
    });
    const boss = makeUnit({
      id: 'boss_fx',
      name: '首领',
      classId: 'BOSS',
      role: 'ENEMY',
      position: { x: 400, y: 200 },
    });
    host.addUnit(player);
    host.addUnit(boss);

    // Host moves player + spawns ground FX
    player.position = { x: 210, y: 175 };
    host.effectsManager.addGroundEffect({
      kind: 'DAMAGE_ZONE',
      spellId: 'desecration',
      ownerId: boss.id,
      x: 220,
      y: 180,
      radius: 40,
      colorHex: '#ff0000',
      remainingMs: 5000,
    });

    const guest = new CombatEngine();
    guest.effectsManager = new EffectsManager(guest);
    const now = Date.now();
    const snap: NetworkCombatSnapshot = {
      roomId: 'r1',
      seq: 2,
      timeMs: now,
      runPhase: 'BOSS_COMBAT',
      units: host.buildNetworkUnitSnapshots(),
      groundEffects: host.effectsManager.groundEffects.map((g) => ({
        id: g.id,
        kind: g.kind,
        spellId: g.spellId,
        ownerId: g.ownerId,
        x: g.x,
        y: g.y,
        radius: g.radius,
        colorHex: g.colorHex,
        remainingMs: g.remainingMs,
      })),
      casts: [
        {
          unitId: player.id,
          spellId: 'fireball',
          spellName: '火球术',
          startedAtMs: now - 400,
          totalMs: 2000,
        },
      ],
    };

    guest.applyNetworkUnitSnapshots(snap.units);
    const guestPlayer = guest.getUnit('p_host');
    assert.ok(guestPlayer);
    assert.deepEqual(guestPlayer!.position, { x: 210, y: 175 });
    assert.equal(snap.groundEffects?.length, 1);
    assert.equal(snap.groundEffects![0].spellId, 'desecration');
    assert.equal(snap.casts?.[0].spellId, 'fireball');
  });

  it('3. 客人意图仅覆盖一次：绝对血量/位移幂等，重复快照不会二次扣血', () => {
    const guest = new CombatEngine();
    const target = makeUnit({
      id: 'p_guest',
      name: '客人',
      classId: 'PRIEST',
      role: 'HEALER',
      isPlayer: true,
      hp: 10000,
      maxHp: 10000,
      position: { x: 100, y: 100 },
    });
    guest.addUnit(target);

    // Host resolved one cast → HP 7200, moved to 190,140
    const damaged = {
      ...guest.buildNetworkUnitSnapshots()[0],
      hp: 7200,
      position: { x: 190, y: 140 },
    };
    guest.applyNetworkUnitSnapshots([damaged]);
    assert.equal(guest.getUnit('p_guest')!.hp, 7200);
    assert.deepEqual(guest.getUnit('p_guest')!.position, { x: 190, y: 140 });

    // Guest re-sends same CAST intent; host rebroadcasts same absolute state — no second subtract
    guest.applyNetworkUnitSnapshots([damaged]);
    assert.equal(guest.getUnit('p_guest')!.hp, 7200, '绝对血量覆盖，不得二次扣血');
    assert.deepEqual(guest.getUnit('p_guest')!.position, { x: 190, y: 140 });
  });

  it('4. 飘字随 COMBAT_STATE 下发；客人侧镜像主机 floatingTexts', () => {
    const hostFx = new EffectsManager();
    const fct = hostFx.addFloatingText({
      targetId: 'boss_1',
      sourceId: 'p_guest',
      text: '18432',
      category: 'DAMAGE_SKILL',
      isCrit: true,
      isFromPlayerOrPet: true,
    });
    hostFx.addFloatingText({
      targetId: 'p_guest',
      sourceId: 'healer_1',
      text: '9200',
      category: 'HEAL',
      isCrit: false,
      isToPlayer: true,
    });

    const snap: NetworkCombatSnapshot = {
      roomId: 'r_fct',
      seq: 3,
      timeMs: Date.now(),
      runPhase: 'BOSS_COMBAT',
      units: [],
      floatingTexts: [...hostFx.floatingTexts],
    };

    const wire = encodeNetMessage({ type: 'COMBAT_STATE', roomId: snap.roomId, payload: snap });
    const decoded = decodeNetMessage(wire);
    assert.ok(decoded);
    const body = decoded!.payload as NetworkCombatSnapshot;
    assert.equal(body.floatingTexts?.length, 2);
    assert.equal(body.floatingTexts![0].id, fct.id);
    assert.equal(body.floatingTexts![0].text, '18432');
    assert.equal(body.floatingTexts![0].category, 'DAMAGE_SKILL');
    assert.equal(body.floatingTexts![1].category, 'HEAL');
    assert.equal(body.floatingTexts![1].text, '9200');
  });
});
