/**
 * Host heartbeat timeout / orphan room cleanup.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import { decodeNetMessage, encodeNetMessage, type NetEnvelope } from '@cata-raid-sim/engine';
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

  lastOfType(type: string): NetEnvelope | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      if (this.inbox[i].type === type) return this.inbox[i];
    }
    return undefined;
  }
}

function authClient(
  hub: RoomWsHub,
  opts: { playerId: string; username: string; playerName: string }
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
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    },
  });
  assert.ok(ws.lastOfType('AUTH_OK'));
  return ws;
}

describe('心跳超时清理掉线房主房间', () => {
  it('1. 房主超过心跳窗口无 PING → 房间销毁并广播 host_timeout', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, { playerId: 'host_hb', username: 'u_hb', playerName: 'Host' });
    const guest = authClient(hub, { playerId: 'guest_hb', username: 'u_g_hb', playerName: 'Guest' });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '心跳房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_hb', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as any).id as string;
    guest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    assert.ok(hub.roomManager.getRoom(roomId));

    // 模拟僵死连接：很久没 PING，但 ws 未 close
    const hostSession = (hub as any).sessionsByPlayer.get('host_hb');
    assert.ok(hostSession);
    hostSession.lastPongMs = Date.now() - 60_000;

    guest.inbox.length = 0;
    hub.forceHeartbeatSweepForTests();

    assert.equal(hub.roomManager.getRoom(roomId), undefined, '心跳超时后房间应被剔除');
    const closed = guest.lastOfType('ROOM_CLOSED');
    assert.ok(closed, '客人应收到 ROOM_CLOSED');
    assert.equal((closed!.payload as any).reason, 'host_timeout');

    hub.dispose();
  });

  it('2. 房主会话已不在但房间残留 → 幽灵房扫描清理', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, { playerId: 'host_orph', username: 'u_orph', playerName: 'Host' });
    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '幽灵房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_orph', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as any).id as string;
    assert.ok(hub.roomManager.getRoom(roomId));

    // 人为拆掉会话映射，模拟半开泄漏
    (hub as any).sessionsByPlayer.delete('host_orph');
    (hub as any).sessionsByWs.clear();

    hub.forceHeartbeatSweepForTests();
    assert.equal(hub.roomManager.getRoom(roomId), undefined, '无房主会话的幽灵房应被清理');
    hub.dispose();
  });
});
