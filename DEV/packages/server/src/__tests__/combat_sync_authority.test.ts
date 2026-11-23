/**
 * WS relay: host COMBAT_STATE (casts / FX / move / floatingTexts) → guests;
 * guest PLAYER_INPUT is relayed only (no server-side double resolve).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  decodeNetMessage,
  encodeNetMessage,
  type NetworkCombatSnapshot,
  type NetEnvelope,
  type LobbyRoom,
} from '@cata-raid-sim/engine';
import { RoomWsHub } from '../roomWs.js';

const WS_OPEN = 1;

class FakeWs extends EventEmitter {
  readyState = WS_OPEN;
  readonly OPEN = WS_OPEN;
  readonly inbox: NetEnvelope[] = [];

  send(data: string) {
    const msg = decodeNetMessage(String(data));
    if (msg) this.inbox.push(msg);
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  inject(msg: NetEnvelope) {
    this.emit('message', Buffer.from(encodeNetMessage(msg)));
  }

  drain(): NetEnvelope[] {
    const copy = [...this.inbox];
    this.inbox.length = 0;
    return copy;
  }

  lastOfType(type: string): NetEnvelope | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      if (this.inbox[i].type === type) return this.inbox[i];
    }
    return undefined;
  }

  allOfType(type: string): NetEnvelope[] {
    return this.inbox.filter((m) => m.type === type);
  }
}

function authClient(
  hub: RoomWsHub,
  opts: {
    playerId: string;
    username: string;
    playerName: string;
    classId: string;
    spec: string;
    role: string;
  }
): FakeWs {
  const ws = new FakeWs();
  hub.handleConnection(ws as any);
  ws.inject({
    type: 'AUTH',
    timeMs: Date.now(),
    payload: {
      playerId: opts.playerId,
      username: opts.username,
      playerName: opts.playerName,
      classId: opts.classId,
      spec: opts.spec,
      role: opts.role,
    },
  });
  assert.ok(ws.lastOfType('AUTH_OK'), `${opts.username} should AUTH_OK`);
  return ws;
}

function latestRoomUpdate(ws: FakeWs): LobbyRoom | undefined {
  const msg = ws.lastOfType('ROOM_UPDATE');
  return msg?.payload as LobbyRoom | undefined;
}

function setupHostGuest(): { hub: RoomWsHub; host: FakeWs; guest: FakeWs; roomId: string } {
  const hub = new RoomWsHub();
  const host = authClient(hub, {
    playerId: 'char_host',
    username: 'u_host',
    playerName: 'Host',
    classId: 'MAGE',
    spec: 'FIRE',
    role: 'DPS',
  });
  const guest = authClient(hub, {
    playerId: 'char_guest',
    username: 'u_guest',
    playerName: 'Guest',
    classId: 'SHAMAN',
    spec: 'RESTORATION',
    role: 'HEALER',
  });

  host.inject({
    type: 'ROOM_CREATE',
    timeMs: Date.now(),
    payload: {
      name: '同步房',
      dungeonId: 'shadowfang_keep',
      host: { id: 'char_host', name: 'Host', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
    },
  });
  const roomId = latestRoomUpdate(host)!.id;
  host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
  guest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
  host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });
  host.drain();
  guest.drain();
  return { hub, host, guest, roomId };
}

describe('联机战斗权威同步（WS）', () => {
  it('1. 房主广播首领读条与位移 → 客人收到相同 casts / units.position', () => {
    const { host, guest, roomId } = setupHostGuest();
    const now = Date.now();
    const snap: NetworkCombatSnapshot = {
      roomId,
      seq: 1,
      timeMs: now,
      runPhase: 'BOSS_COMBAT',
      bossTargetId: 'char_host',
      units: [
        {
          id: 'boss_ashbury',
          name: '亚什布里男爵',
          classId: 'WARRIOR',
          role: 'TANK',
          isPlayer: false,
          isAlive: true,
          hp: 90000,
          maxHp: 100000,
          absorb: 0,
          position: { x: 340, y: 210 },
          buffs: [],
        },
        {
          id: 'char_host',
          name: 'Host',
          classId: 'MAGE',
          role: 'DPS',
          isPlayer: true,
          isHumanControlled: true,
          isAlive: true,
          hp: 36000,
          maxHp: 36000,
          absorb: 0,
          position: { x: 200, y: 160 },
          buffs: [],
        },
      ],
      casts: [
        {
          unitId: 'boss_ashbury',
          spellId: 'asphyxiate',
          spellName: '窒息',
          startedAtMs: now - 600,
          totalMs: 2000,
          interruptible: true,
        },
      ],
    };

    host.inject({ type: 'COMBAT_STATE', roomId, timeMs: now, payload: snap });
    const relayed = guest.lastOfType('COMBAT_STATE');
    assert.ok(relayed, '客人应收到 COMBAT_STATE');
    const body = relayed!.payload as NetworkCombatSnapshot;
    assert.equal(body.casts?.[0].spellName, '窒息');
    assert.equal(body.casts?.[0].unitId, 'boss_ashbury');
    const boss = body.units.find((u) => u.id === 'boss_ashbury');
    assert.deepEqual(boss?.position, { x: 340, y: 210 });
  });

  it('2. 房主广播自己的读条、地面特效与位移 → 客人原样收到', () => {
    const { host, guest, roomId } = setupHostGuest();
    const now = Date.now();
    const snap: NetworkCombatSnapshot = {
      roomId,
      seq: 2,
      timeMs: now,
      runPhase: 'BOSS_COMBAT',
      units: [
        {
          id: 'char_host',
          name: 'Host',
          classId: 'MAGE',
          role: 'DPS',
          isPlayer: true,
          isHumanControlled: true,
          isAlive: true,
          hp: 36000,
          maxHp: 36000,
          absorb: 0,
          position: { x: 255, y: 188 },
          buffs: [],
        },
      ],
      casts: [
        {
          unitId: 'char_host',
          spellId: 'fireball',
          spellName: '火球术',
          startedAtMs: now - 300,
          totalMs: 2000,
        },
      ],
      groundEffects: [
        {
          id: 'fx_1',
          kind: 'DAMAGE_ZONE',
          spellId: 'flamestrike',
          ownerId: 'char_host',
          x: 260,
          y: 190,
          radius: 35,
          colorHex: '#ff6600',
          remainingMs: 4000,
        },
      ],
    };

    host.inject({ type: 'COMBAT_STATE', roomId, timeMs: now, payload: snap });
    const body = guest.lastOfType('COMBAT_STATE')!.payload as NetworkCombatSnapshot;
    assert.equal(body.casts?.[0].spellId, 'fireball');
    assert.deepEqual(body.units[0].position, { x: 255, y: 188 });
    assert.equal(body.groundEffects?.[0].spellId, 'flamestrike');
    assert.equal(body.groundEffects?.[0].x, 260);
  });

  it('3. 客人 CAST/MOVE 仅中继为 PLAYER_INPUT；服务端不结算伤害（无双端结算）', () => {
    const { hub, host, guest, roomId } = setupHostGuest();
    host.drain();
    guest.drain();

    const hpBefore = hub.roomManager.getRoom(roomId)?.inCombatBossHp;

    guest.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: {
        playerId: 'char_guest',
        kind: 'CAST',
        spellId: 'healing_wave',
        targetId: 'char_host',
        slotIndex: 1,
      },
    });

    const castRelay = host.lastOfType('PLAYER_INPUT');
    assert.ok(castRelay, '房主应收到客人 CAST 意图');
    assert.equal((castRelay!.payload as any).kind, 'CAST');
    assert.equal((castRelay!.payload as any).spellId, 'healing_wave');
    // Guest should not receive their own input echoed as combat resolve
    assert.equal(
      guest.allOfType('COMBAT_STATE').length,
      0,
      '客人 CAST 不得由服务端直接产出 COMBAT_STATE'
    );

    guest.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: { playerId: 'char_guest', kind: 'MOVE', x: 301, y: 222 },
    });
    const moveRelay = host.lastOfType('PLAYER_INPUT');
    assert.ok(moveRelay);
    assert.equal((moveRelay!.payload as any).kind, 'MOVE');
    assert.equal((moveRelay!.payload as any).x, 301);

    // Server combat boss HP unchanged — only host COMBAT_STATE updates it
    assert.equal(hub.roomManager.getRoom(roomId)?.inCombatBossHp, hpBefore);

    // Host applies once → guests see result; duplicate guest CAST without new host snap does nothing
    const now = Date.now();
    host.inject({
      type: 'COMBAT_STATE',
      roomId,
      timeMs: now,
      payload: {
        roomId,
        seq: 9,
        timeMs: now,
        runPhase: 'BOSS_COMBAT',
        units: [
          {
            id: 'boss_ashbury',
            name: 'Boss',
            classId: 'WARRIOR',
            role: 'TANK',
            isPlayer: false,
            isAlive: true,
            hp: 70000,
            maxHp: 100000,
            absorb: 0,
            position: { x: 300, y: 200 },
            buffs: [],
          },
          {
            id: 'char_guest',
            name: 'Guest',
            classId: 'SHAMAN',
            role: 'HEALER',
            isPlayer: true,
            isHumanControlled: true,
            isAlive: true,
            hp: 36000,
            maxHp: 36000,
            absorb: 0,
            position: { x: 301, y: 222 },
            buffs: [],
          },
        ],
      } satisfies NetworkCombatSnapshot,
    });
    const afterHost = guest.lastOfType('COMBAT_STATE')!.payload as NetworkCombatSnapshot;
    assert.equal(afterHost.units.find((u) => u.id === 'boss_ashbury')?.hp, 70000);
    assert.deepEqual(afterHost.units.find((u) => u.id === 'char_guest')?.position, {
      x: 301,
      y: 222,
    });
  });

  it('4. 房主飘字随 COMBAT_STATE 下发，客人收到 floatingTexts', () => {
    const { host, guest, roomId } = setupHostGuest();
    const now = Date.now();
    host.inject({
      type: 'COMBAT_STATE',
      roomId,
      timeMs: now,
      payload: {
        roomId,
        seq: 4,
        timeMs: now,
        runPhase: 'BOSS_COMBAT',
        units: [],
        floatingTexts: [
          {
            id: 'fct_1',
            targetId: 'boss_ashbury',
            sourceId: 'char_host',
            text: '15200',
            category: 'DAMAGE_SKILL',
            isCrit: true,
            isFromPlayerOrPet: true,
            createdAtMs: now - 50,
          },
          {
            id: 'fct_2',
            targetId: 'char_guest',
            sourceId: 'char_guest',
            text: '8400',
            category: 'HEAL',
            isCrit: false,
            isToPlayer: true,
            createdAtMs: now - 30,
          },
        ],
      } satisfies NetworkCombatSnapshot,
    });

    const body = guest.lastOfType('COMBAT_STATE')!.payload as NetworkCombatSnapshot;
    assert.equal(body.floatingTexts?.length, 2);
    assert.equal(body.floatingTexts![0].text, '15200');
    assert.equal(body.floatingTexts![0].category, 'DAMAGE_SKILL');
    assert.equal(body.floatingTexts![1].text, '8400');
    assert.equal(body.floatingTexts![1].category, 'HEAL');
  });
});
