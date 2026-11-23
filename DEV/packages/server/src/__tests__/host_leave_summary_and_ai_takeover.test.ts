/**
 * 联机退局规则：
 * 1. 房主中途离开 / 返回大厅 → ROOM_CLOSED.forceSummary，其余玩家进结算
 * 2. 非房主中途离开 → MEMBER_REPLACE_AI，AI 接续席位，副本继续
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  decodeNetMessage,
  encodeNetMessage,
  type LobbyRoom,
  type NetEnvelope,
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

function latestRoom(ws: FakeWs): LobbyRoom | undefined {
  return ws.lastOfType('ROOM_UPDATE')?.payload as LobbyRoom | undefined;
}

function startCombatRoom(hub: RoomWsHub): {
  host: FakeWs;
  guest: FakeWs;
  guest2: FakeWs;
  roomId: string;
} {
  const host = authClient(hub, {
    playerId: 'h_leave',
    username: 'u_host',
    playerName: 'Host',
    classId: 'DK',
    spec: 'BLOOD',
    role: 'TANK',
  });
  const guest = authClient(hub, {
    playerId: 'g_leave',
    username: 'u_guest',
    playerName: 'Guest',
    classId: 'PRIEST',
    spec: 'HOLY',
    role: 'HEALER',
  });
  const guest2 = authClient(hub, {
    playerId: 'g2_leave',
    username: 'u_guest2',
    playerName: 'Guest2',
    classId: 'MAGE',
    spec: 'FIRE',
    role: 'DPS',
  });

  host.inject({
    type: 'ROOM_CREATE',
    timeMs: Date.now(),
    payload: {
      name: '退局房',
      dungeonId: 'shadowfang_keep',
      host: { id: 'h_leave', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
    },
  });
  const roomId = latestRoom(host)!.id;
  host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
  guest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
  guest2.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
  host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });
  assert.equal(hub.roomManager.getRoom(roomId)!.status, 'IN_COMBAT');
  host.drain();
  guest.drain();
  guest2.drain();
  return { host, guest, guest2, roomId };
}

describe('联机退局：房主结算 / 非房主 AI 接续', () => {
  it('1. 房主战斗中 ROOM_LEAVE → 房间销毁，客人收到 forceSummary=true', () => {
    const hub = new RoomWsHub();
    const { host, guest, guest2, roomId } = startCombatRoom(hub);

    host.inject({ type: 'ROOM_LEAVE', roomId, timeMs: Date.now() });

    assert.equal(hub.roomManager.getRoom(roomId), undefined, '房主离开后房间应销毁');
    const closed =
      guest.lastOfType('ROOM_CLOSED') || guest2.lastOfType('ROOM_CLOSED');
    assert.ok(closed, '客人应收到 ROOM_CLOSED');
    const payload = closed!.payload as { reason?: string; forceSummary?: boolean };
    assert.equal(payload.reason, 'host_left');
    assert.equal(payload.forceSummary, true, '战斗中房主离开应强制客人进结算');
  });

  it('2. 房主返回大厅（ROOM_CLOSED host_left）→ forceSummary，客人进结算', () => {
    const hub = new RoomWsHub();
    const { host, guest, roomId } = startCombatRoom(hub);

    host.inject({
      type: 'ROOM_CLOSED',
      roomId,
      timeMs: Date.now(),
      payload: { roomId, reason: 'host_left' },
    });

    assert.equal(hub.roomManager.getRoom(roomId), undefined);
    const closed = guest.lastOfType('ROOM_CLOSED');
    assert.ok(closed);
    const payload = closed!.payload as { reason?: string; forceSummary?: boolean };
    assert.equal(payload.reason, 'host_left');
    assert.equal(payload.forceSummary, true);
  });

  it('3. 非房主战斗中离开 → MEMBER_REPLACE_AI，人数不变，人类减 1，AI 接续', () => {
    const hub = new RoomWsHub();
    const { host, guest2, roomId } = startCombatRoom(hub);
    const before = hub.roomManager.getRoom(roomId)!;
    const memberCountBefore = before.members.length;
    const humansBefore = hub.roomManager.countHumanPlayers(roomId);
    assert.equal(humansBefore, 3);
    assert.equal(memberCountBefore, 5);

    host.drain();
    guest2.inject({ type: 'ROOM_LEAVE', roomId, timeMs: Date.now() });

    const room = hub.roomManager.getRoom(roomId);
    assert.ok(room, '非房主离开后房间应保留');
    assert.equal(room!.members.length, 5, '席位由 AI 接续，总人数不变');
    assert.equal(hub.roomManager.countHumanPlayers(roomId), 2);
    assert.ok(!room!.members.some((m) => m.id === 'g2_leave'));
    assert.ok(room!.members.filter((m) => m.isAi).length >= 3);

    const replace = host.lastOfType('MEMBER_REPLACE_AI');
    assert.ok(replace, '房主应收到 MEMBER_REPLACE_AI');
    const body = replace!.payload as {
      playerId: string;
      aiMemberId: string;
      room: LobbyRoom;
    };
    assert.equal(body.playerId, 'g2_leave');
    assert.ok(body.aiMemberId?.startsWith('ai_'));
    assert.ok(body.room.members.some((m) => m.id === body.aiMemberId && m.isAi));
  });

  it('4. 大厅非房主离开仅退座，不广播 MEMBER_REPLACE_AI', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'h_lobby',
      username: 'u_h',
      playerName: 'Host',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    const guest = authClient(hub, {
      playerId: 'g_lobby',
      username: 'u_g',
      playerName: 'Guest',
      classId: 'SHAMAN',
      spec: 'RESTORATION',
      role: 'HEALER',
    });
    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '大厅房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h_lobby', name: 'Host', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
      },
    });
    const roomId = latestRoom(host)!.id;
    guest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    assert.equal(hub.roomManager.getRoom(roomId)!.status, 'LOBBY');
    host.drain();

    guest.inject({ type: 'ROOM_LEAVE', roomId, timeMs: Date.now() });
    assert.ok(hub.roomManager.getRoom(roomId));
    assert.equal(hub.roomManager.countHumanPlayers(roomId), 1);
    assert.equal(host.lastOfType('MEMBER_REPLACE_AI'), undefined);
    assert.ok(!hub.roomManager.getRoom(roomId)!.members.some((m) => m.id === 'g_lobby'));
  });
});
