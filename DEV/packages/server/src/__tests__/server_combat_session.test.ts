/**
 * 服务端房间独立战斗会话测试：
 * 1. 开局自动创建 RoomCombatSession，房主与客人同权上报 PLAYER_INPUT / COMBAT_EFFECT / OWNER_SNAPSHOT
 * 2. 服务端直接回传 INPUT_ACK（支撑玩家↔服务端 RTT 计算与退避重传）
 * 3. 服务端收集并周期广播 COMBAT_STATE 与 COMBAT_BATCH
 * 4. 团灭投票 FINISH 或全员离开时销毁战斗会话与房间
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  decodeNetMessage,
  encodeNetMessage,
  type CombatBatch,
  type LobbyRoom,
  type NetEnvelope,
  type NetworkCombatSnapshot,
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
  opts: { playerId: string; username: string; playerName: string; classId: string; spec: string; role: string }
): FakeWs {
  const ws = new FakeWs();
  hub.handleConnection(ws as any);
  ws.inject({
    type: 'AUTH',
    timeMs: Date.now(),
    payload: opts,
  });
  return ws;
}

describe('服务端房间独立战斗会话（Server-Authoritative Room Session）', () => {
  it('1. 房主与客人同权上报 PLAYER_INPUT / COMBAT_EFFECT / OWNER_SNAPSHOT，服务端直接回传 INPUT_ACK 并周期广播', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_host',
      username: 'u_host',
      playerName: 'HostMage',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    const guest = authClient(hub, {
      playerId: 'p_guest',
      username: 'u_guest',
      playerName: 'GuestPriest',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '服务端权威测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_host', name: 'HostMage', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    guest.inject({ type: 'ROOM_JOIN', roomId, payload: { roomId } });
    guest.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'SET_READY', ready: true } });
    host.inject({ type: 'ROOM_START', roomId });

    const cs = hub.getCombatSession(roomId);
    assert.ok(cs, 'ROOM_START 后服务端应创建独立 RoomCombatSession');

    // 房主与客人均发送带 clientInputId 的 PLAYER_INPUT
    host.inbox.length = 0;
    guest.inbox.length = 0;

    host.inject({
      type: 'PLAYER_INPUT',
      roomId,
      payload: {
        playerId: 'p_host',
        kind: 'CAST',
        spellId: 'fireball',
        clientInputId: 'ci_host_1',
        clientInputAttempt: 1,
      },
    });
    guest.inject({
      type: 'PLAYER_INPUT',
      roomId,
      payload: {
        playerId: 'p_guest',
        kind: 'CAST',
        spellId: 'flash_heal',
        clientInputId: 'ci_guest_1',
        clientInputAttempt: 2,
      },
    });

    const hostAck = host.lastOfType('INPUT_ACK')?.payload as any;
    const guestAck = guest.lastOfType('INPUT_ACK')?.payload as any;
    assert.equal(hostAck?.acks?.[0]?.clientInputId, 'ci_host_1');
    assert.equal(hostAck?.acks?.[0]?.attempt, 1);
    assert.equal(guestAck?.acks?.[0]?.clientInputId, 'ci_guest_1');
    assert.equal(guestAck?.acks?.[0]?.attempt, 2);

    // 上报 COMBAT_EFFECT 与 OWNER_SNAPSHOT，服务端在 4 ticks (200ms) 后广播 COMBAT_STATE 与 COMBAT_BATCH
    host.inject({
      type: 'COMBAT_EFFECT',
      roomId,
      payload: {
        effectId: 'eff_host_1',
        sourceId: 'p_host',
        targetId: 'p_guest',
        spellId: 'arcane_intellect',
        kind: 'APPLY_BUFF',
      },
    });
    guest.inject({
      type: 'OWNER_SNAPSHOT',
      roomId,
      payload: {
        ownerId: 'p_guest',
        timeMs: Date.now(),
        units: [
          {
            id: 'p_guest',
            name: 'GuestPriest',
            classId: 'PRIEST',
            spec: 'HOLY',
            role: 'HEALER',
            isPlayer: true,
            isHumanControlled: true,
            isAlive: true,
            hp: 45000,
            maxHp: 50000,
            absorb: 0,
            position: { x: 140, y: 240 },
            buffs: [],
          },
        ],
      },
    });

    // 推进 4 个服务端 tick
    for (let i = 0; i < 4; i++) cs!.tick(50);

    const stateMsg = guest.lastOfType('COMBAT_STATE')?.payload as NetworkCombatSnapshot;
    const batchMsg = host.lastOfType('COMBAT_BATCH')?.payload as CombatBatch;
    assert.ok(stateMsg, '服务端应向房间广播 COMBAT_STATE');
    assert.ok(batchMsg, '服务端应向房间广播 COMBAT_BATCH');
    assert.ok(batchMsg.effects.some((e) => e.effectId === 'eff_host_1'));
    assert.ok(batchMsg.snapshots.some((s) => s.ownerId === 'p_guest'));
    assert.equal(
      stateMsg.units.some((u) => u.id === 'p_host' || u.id === 'p_guest'),
      false,
      'COMBAT_STATE 仅同步服务端权威单位（AI/Boss），不覆盖人类自身权威'
    );

    hub.dispose();
  });

  it('2. 团灭投票选择 FINISH（不重试）时服务端销毁房间与战斗会话', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_w1',
      username: 'u_w1',
      playerName: 'Tank1',
      classId: 'WARRIOR',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    const guest = authClient(hub, {
      playerId: 'p_w2',
      username: 'u_w2',
      playerName: 'Heal2',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '团灭销毁房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_w1', name: 'Tank1', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    guest.inject({ type: 'ROOM_JOIN', roomId, payload: { roomId } });
    guest.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'SET_READY', ready: true } });
    host.inject({ type: 'ROOM_START', roomId });

    assert.ok(hub.getCombatSession(roomId));

    // 发起 WIPE 投票并全员投 FINISH
    host.inject({ type: 'VOTE_START', roomId, payload: { kind: 'WIPE' } });
    host.inject({ type: 'VOTE_CAST', roomId, payload: { kind: 'WIPE', playerId: 'p_w1', choice: 'FINISH' } });
    guest.inject({ type: 'VOTE_CAST', roomId, payload: { kind: 'WIPE', playerId: 'p_w2', choice: 'FINISH' } });

    assert.equal(hub.getCombatSession(roomId), undefined, '团灭不重试后应销毁战斗会话');
    assert.equal(hub.roomManager.getRoom(roomId), undefined, '团灭不重试后应销毁房间');
    const closed = guest.lastOfType('ROOM_CLOSED')?.payload as any;
    assert.equal(closed?.reason, 'wipe_finish');
    assert.equal(closed?.forceSummary, true);

    hub.dispose();
  });
});
