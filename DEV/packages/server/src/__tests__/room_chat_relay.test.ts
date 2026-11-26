import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LobbyRoom, NetEnvelope, RoomChatMessage } from '@cata-raid-sim/engine';
import { RoomWsHub } from '../roomWs.js';

class MockSocket {
  public readyState = 1;
  public OPEN = 1;
  public sent: NetEnvelope[] = [];
  private listeners: Record<string, Array<(arg?: any) => void>> = {};

  on(ev: string, fn: (arg?: any) => void) {
    if (!this.listeners[ev]) this.listeners[ev] = [];
    this.listeners[ev].push(fn);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as NetEnvelope);
  }
  inject(msg: NetEnvelope) {
    const buf = Buffer.from(JSON.stringify(msg), 'utf8');
    for (const fn of this.listeners.message || []) fn(buf);
  }
  close() {
    this.readyState = 3;
    for (const fn of this.listeners.close || []) fn();
  }
}

describe('ROOM_CHAT 服务端转发', () => {
  it('玩家发送聊天经服务器转发给同房间所有玩家（含重连后 session.roomId 丢失的自愈）', () => {
    const hub = new RoomWsHub();

    const host = new MockSocket();
    const guest = new MockSocket();
    hub.handleConnection(host as any);
    hub.handleConnection(guest as any);

    host.inject({
      type: 'AUTH',
      timeMs: Date.now(),
      payload: {
        playerId: 'p_host',
        username: 'host',
        playerName: '房主',
        classId: 'WARRIOR',
        spec: 'PROTECTION',
        role: 'TANK',
      },
    });
    guest.inject({
      type: 'AUTH',
      timeMs: Date.now(),
      payload: {
        playerId: 'p_guest',
        username: 'guest',
        playerName: '队友',
        classId: 'PRIEST',
        spec: 'HOLY',
        role: 'HEALER',
      },
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: { name: '聊天测试房', dungeonId: 'shadowfang_keep', difficulty: 'HEROIC' },
    });
    const created = host.sent.find((m) => m.type === 'ROOM_UPDATE')?.payload as LobbyRoom | undefined;
    assert.ok(created?.id, '应创建房间');
    const roomId = created!.id;

    guest.inject({
      type: 'ROOM_JOIN',
      roomId,
      timeMs: Date.now(),
      payload: {},
    });

    // Simulate reconnect where guest's session.roomId was cleared before next message
    const guestSess = (hub as any).sessionsByPlayer.get('p_guest');
    assert.ok(guestSess);
    guestSess.roomId = null;

    host.sent.length = 0;
    guest.sent.length = 0;

    guest.inject({
      type: 'ROOM_CHAT',
      roomId,
      timeMs: Date.now(),
      payload: { text: '大家好，准备开怪' },
    });

    const hostChats = host.sent.filter((m) => m.type === 'ROOM_CHAT');
    const guestChats = guest.sent.filter((m) => m.type === 'ROOM_CHAT');
    assert.equal(hostChats.length, 1, '房主应收到服务器转发的聊天');
    assert.equal(guestChats.length, 1, '发送者也应收到服务器转发的聊天');

    const chat = hostChats[0].payload as RoomChatMessage;
    assert.equal(chat.senderId, 'p_guest');
    assert.equal(chat.senderName, '队友');
    assert.equal(chat.text, '大家好，准备开怪');
    assert.equal(guestSess.roomId, roomId, 'session.roomId 应已自愈');
  });
});
