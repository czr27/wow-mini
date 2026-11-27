import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LobbyRoom, NetEnvelope } from '@cata-raid-sim/engine';
import { encodeNetMessage } from '@cata-raid-sim/engine';
import { RoomWsHub } from '../roomWs.js';

class MockWs {
  readyState = 1;
  OPEN = 1;
  sent: NetEnvelope[] = [];
  closed = false;
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  on(ev: string, fn: (...args: any[]) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, []);
    this.handlers.get(ev)!.push(fn);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    for (const fn of this.handlers.get('close') || []) fn();
  }
  inject(msg: NetEnvelope) {
    const raw = encodeNetMessage(msg);
    for (const fn of this.handlers.get('message') || []) fn(raw);
  }
  allOfType(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
  lastOfType(type: string) {
    const list = this.allOfType(type);
    return list[list.length - 1];
  }
}

function authClient(
  hub: RoomWsHub,
  opts: { playerId: string; username: string; playerName: string; classId: string; spec: string; role: string }
) {
  const ws = new MockWs();
  hub.handleConnection(ws as any);
  ws.inject({ type: 'AUTH', timeMs: Date.now(), payload: opts });
  return ws;
}

describe('Network V2 Server Lifecycle: Heartbeat Probe, Vote Drop, HotJoin, Purge & SummaryAck', () => {
  it('1. 阶梯心跳探测（15.5s→PING_PROBE；45s→ROOM_KICKED）与幽灵 PING 踢出', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_hb1',
      username: 'u_hb1',
      playerName: 'Host1',
      classId: 'WARRIOR',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    host.inject({
      type: 'ROOM_CREATE',
      payload: {
        name: '心跳测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_hb1', name: 'Host1', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
      },
    });
    const session = (hub as any).sessionsByPlayer.get('p_hb1');
    // 模拟 20s 未收到 PING -> 触发 PING_PROBE
    session.lastPongMs = Date.now() - 20_000;
    hub.forceHeartbeatSweepForTests();
    assert.ok(host.lastOfType('PING_PROBE'), '超过 15.5s 应发出 PING_PROBE 催促');

    // 模拟 46s 未收到 PING -> 发出 ROOM_KICKED 并踢出
    session.lastPongMs = Date.now() - 46_000;
    hub.forceHeartbeatSweepForTests();
    assert.ok(host.lastOfType('ROOM_KICKED'), '超过 45s 应发出 ROOM_KICKED');

    // 幽灵重连：被踢出后的 socket 再直接丢 PING -> 立即再发 ROOM_KICKED 并拒绝
    const prevKicks = host.allOfType('ROOM_KICKED').length;
    host.readyState = 1;
    host.inject({ type: 'PING' });
    assert.equal(host.allOfType('ROOM_KICKED').length, prevKicks + 1, '被踢后幽灵 PING 应直接被踢走');
    hub.dispose();
  });

  it('2. 投票鲁棒性：未投票且有资格者掉线动态重算分母并立即达标结算', () => {
    const hub = new RoomWsHub();
    const p1 = authClient(hub, {
      playerId: 'p_v1',
      username: 'u_v1',
      playerName: 'V1',
      classId: 'WARRIOR',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    const p2 = authClient(hub, {
      playerId: 'p_v2',
      username: 'u_v2',
      playerName: 'V2',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    p1.inject({
      type: 'ROOM_CREATE',
      payload: {
        name: '投票掉线测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_v1', name: 'V1', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
      },
    });
    const roomId = (p1.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    p1.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    p2.inject({ type: 'ROOM_JOIN', roomId, payload: { roomId } });
    p2.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'SET_READY', ready: true } });
    p1.inject({ type: 'ROOM_START', roomId });

    // 发起跳过赶路投票（2人局：p1 投 YES，还差 p2 没投）
    p1.inject({ type: 'PLAYER_INPUT', roomId, payload: { playerId: 'p_v1', kind: 'REQUEST_SKIP_TRAVEL' } });
    assert.equal(p1.lastOfType('VOTE_RESULT'), undefined, '2 人局仅 1 票 YES 尚未过半');

    // p2 未投票直接超时掉线 -> 分母动态变为 1，p1 的 1 票 YES 立即过半通过，且收到可靠 PURGE
    const s2 = (hub as any).sessionsByPlayer.get('p_v2');
    s2.lastPongMs = Date.now() - 50_000;
    hub.forceHeartbeatSweepForTests();

    const voteRes = p1.lastOfType('VOTE_RESULT')?.payload as any;
    assert.equal(voteRes?.result, 'YES', '未投者掉线后分母重算为 1，应立即通过');
    const purge = p1.lastOfType('PURGE')?.payload as any;
    assert.equal(purge?.ownerId, 'p_v2', '离场应向剩余在线成员发送独立可靠 PURGE 包');
    hub.dispose();
  });

  it('3. 热加入前置校验：无可替 AI 直接 HOT_JOIN_DENY；有可替 AI 同意→快照→融合广播', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_hj1',
      username: 'u_hj1',
      playerName: 'HostT',
      classId: 'WARRIOR',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    const tankJoiner = authClient(hub, {
      playerId: 'p_hj_t',
      username: 'u_hj_t',
      playerName: 'Tank2',
      classId: 'PALADIN',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    const dpsJoiner = authClient(hub, {
      playerId: 'p_hj_d',
      username: 'u_hj_d',
      playerName: 'Dps2',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });

    host.inject({
      type: 'ROOM_CREATE',
      payload: {
        name: '热加入测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_hj1', name: 'HostT', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    host.inject({ type: 'ROOM_START', roomId });

    // 5 人本坦克已是真人，无 TANK AI 可替 -> 直接拒绝
    tankJoiner.inject({ type: 'HOT_JOIN_REQ', roomId, payload: { roomId, role: 'TANK' } });
    assert.ok(tankJoiner.lastOfType('HOT_JOIN_DENY'), '无同职责 AI 可替时应直接 HOT_JOIN_DENY');

    // DPS 有 AI 可替 -> 同意，收到快照后广播 MEMBER_HOT_SWAP
    dpsJoiner.inject({ type: 'HOT_JOIN_REQ', roomId, payload: { roomId, role: 'DPS' } });
    assert.ok(dpsJoiner.lastOfType('HOT_JOIN_ACCEPT'), '有 DPS AI 可替时应 HOT_JOIN_ACCEPT');
    dpsJoiner.inject({
      type: 'OWNER_SNAPSHOT',
      roomId,
      payload: { ownerId: 'p_hj_d', timeMs: Date.now(), units: [] },
    });
    assert.ok(host.lastOfType('MEMBER_HOT_SWAP'), '房主应收到融合后的 MEMBER_HOT_SWAP');
    assert.ok(dpsJoiner.lastOfType('MEMBER_HOT_SWAP'), '热加入者应收到融合后的 MEMBER_HOT_SWAP');
    hub.dispose();
  });

  it('4. 结算流 SUMMARY_SETTLE 全员 SUMMARY_ACK 即刻销毁房间 & GM_COMMAND 自动补 id/senderId', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_s1',
      username: 'u_s1',
      playerName: 'S1',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    host.inject({
      type: 'ROOM_CREATE',
      payload: {
        name: '结算测试房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_s1', name: 'S1', classId: 'MAGE', spec: 'FIRE', role: 'DPS' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    host.inject({ type: 'ROOM_START', roomId });

    // GM_COMMAND 应自动补齐 id 与 senderId
    host.inject({
      type: 'GM_COMMAND',
      roomId,
      payload: { playerId: 'p_s1', kind: 'TOGGLE_FRIENDLY_INVINCIBLE', enabled: true },
    });
    const gmEcho = host.lastOfType('GM_COMMAND')?.payload as any;
    assert.ok(gmEcho?.id, 'GM_COMMAND 应带唯一 id');
    assert.equal(gmEcho?.senderId, 'p_s1', 'GM_COMMAND 应带 senderId 供发出方防重入');

    // 触发进入 SUMMARY -> 收到 SUMMARY_SETTLE -> 回复 SUMMARY_ACK -> 即刻销毁房间
    const cs = hub.getCombatSession(roomId)!;
    (cs as any).callbacks.onEnterSummary(roomId);
    assert.ok(host.lastOfType('SUMMARY_SETTLE'), '进入结算应下发 SUMMARY_SETTLE');
    assert.ok(hub.roomManager.getRoom(roomId), '收到 ACK 前房间尚未销毁');

    host.inject({ type: 'SUMMARY_ACK', roomId });
    assert.equal(hub.roomManager.getRoom(roomId), undefined, '全员 SUMMARY_ACK 后应即刻销毁房间');
    hub.dispose();
  });

  it('5. 同 socket 二次 AUTH (syncAuthSpec) 后立即 ROOM_CREATE：reliableSeq 持续递增不回退，客户端不丢 ROOM_UPDATE', async () => {
    const { ReliableChannel } = await import('@cata-raid-sim/engine');
    const hub = new RoomWsHub();
    const clientChannel = new ReliableChannel();
    const host = authClient(hub, {
      playerId: 'p_reauth',
      username: 'u_reauth',
      playerName: 'ReAuthHost',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    for (const m of host.sent) clientChannel.onIncoming(m);
    const seqAfterFirstAuth = clientChannel.lastRecvSeq;
    assert.ok(seqAfterFirstAuth > 0);
    const beforeCount = host.sent.length;

    // 模拟建房前 syncAuthSpec 发二次 AUTH，再发 ROOM_CREATE
    host.inject({
      type: 'AUTH',
      timeMs: Date.now(),
      payload: {
        playerId: 'p_reauth',
        username: 'u_reauth',
        playerName: 'ReAuthHost',
        classId: 'MAGE',
        spec: 'FROST',
        role: 'DPS',
      },
    });
    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '二次AUTH建房测试',
        dungeonId: 'shadowfang_keep',
        host: { id: 'p_reauth', name: 'ReAuthHost', classId: 'MAGE', spec: 'FROST', role: 'DPS' },
      },
    });

    const newMsgs = host.sent.slice(beforeCount);
    let receivedRoomUpdate = false;
    for (const m of newMsgs) {
      const res = clientChannel.onIncoming(m);
      assert.equal(res.isDuplicate, false, `二次 AUTH 后的包 ${m.type}(seq=${m.reliableSeq}) 不得被误判重复`);
      if (m.type === 'ROOM_UPDATE') receivedRoomUpdate = true;
    }
    assert.equal(receivedRoomUpdate, true, '客户端必须正常收到建房后的 ROOM_UPDATE');
    hub.dispose();
  });

  it('6. 奥卓克希昂暮光时刻读条期：服务端 COMBAT_STATE 正确下发 heroic_will extraAction', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'p_ult',
      username: 'u_ult',
      playerName: 'UltTank',
      classId: 'WARRIOR',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    host.inject({
      type: 'ROOM_CREATE',
      payload: {
        name: '奥卓克希昂暮光时刻测试',
        dungeonId: 'dragon_soul',
        host: { id: 'p_ult', name: 'UltTank', classId: 'WARRIOR', spec: 'PROTECTION', role: 'TANK' },
      },
    });
    const roomId = (host.lastOfType('ROOM_UPDATE')!.payload as LobbyRoom).id;
    host.inject({ type: 'ROOM_ACTION', roomId, payload: { action: 'AUTO_FILL_AI' } });
    host.inject({ type: 'ROOM_START', roomId });

    const cs = hub.getCombatSession(roomId)!;
    cs.rsm.currentBossIndex = 4; // ultraxion
    cs.fastForwardTravel();
    cs.tick(50);

    const bossAi = (cs as any).bossAi;
    const hourSkill = bossAi?.skills?.find((s: any) => s.id === 'hour_of_twilight');
    assert.ok(hourSkill, '应加载奥卓克希昂暮光时刻技能');
    bossAi.currentCasting = { skill: hourSkill, elapsedMs: 1000 };
    (cs as any).broadcastSnapshotAndBatch();

    const snap = host.lastOfType('COMBAT_STATE')?.payload as any;
    assert.equal(snap?.extraAction?.spellId, 'heroic_will', '暮光时刻读条期应下发 heroic_will extraAction');
    assert.equal(snap?.extraAction?.reason, '暮光时刻');
    hub.dispose();
  });
});
