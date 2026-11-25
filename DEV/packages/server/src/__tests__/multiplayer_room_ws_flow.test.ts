/**
 * End-to-end-ish multiplayer room flow with 2–3 simulated WS clients + AI fill.
 * Covers: create/join consistency, skip-travel vote, hot-join, host/guest leave,
 * boss clear advance, and resurrection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  CombatEngine,
  ReportManager,
  RunStateMachine,
  SHADOWFANG_KEEP_CONFIG,
  decodeNetMessage,
  encodeNetMessage,
  type LobbyRoom,
  type NetEnvelope,
  type Unit,
} from '@cata-raid-sim/engine';
import { RoomWsHub } from '../roomWs.js';

const WS_OPEN = 1;

/** Minimal WebSocket stand-in for RoomWsHub (send / message / close). */
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

  /** Client → server */
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

function makeFriendlyUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'classId' | 'role'>): Unit {
  return {
    isPlayer: false,
    isAlive: true,
    alive: true,
    hp: 36000,
    maxHp: 36000,
    mp: 20000,
    maxMp: 20000,
    absorb: 0,
    resources: [],
    buffs: [],
    threatTable: [],
    position: { x: 200, y: 160 },
    stats: {
      attackPower: 1000,
      spellPower: 1000,
      critChance: 0.2,
      haste: 0.3,
      armor: 100,
      spellResist: 0,
      block: 0,
      parry: 0,
      dodge: 0.05,
      mastery: 0,
      versatility: 0,
      speed: 1,
    },
    ...partial,
  };
}

describe('Multiplayer room WS flow (2–3 humans + AI)', () => {
  it('开房→三人加入→AI 补齐后全员看到一致 5 人名单', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'char_host',
      username: 'host_user',
      playerName: '提里奥',
      classId: 'PALADIN',
      spec: 'PROTECTION',
      role: 'TANK',
    });
    const guestH = authClient(hub, {
      playerId: 'char_healer',
      username: 'healer_user',
      playerName: '吉安娜',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    const guestD = authClient(hub, {
      playerId: 'char_dps',
      username: 'dps_user',
      playerName: '瓦里安',
      classId: 'WARRIOR',
      spec: 'ARMS',
      role: 'DPS',
    });

    host.drain();
    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '联机测试房',
        dungeonId: 'shadowfang_keep',
        difficulty: 'HEROIC',
        host: {
          id: 'char_host',
          name: '提里奥',
          classId: 'PALADIN',
          spec: 'PROTECTION',
          role: 'TANK',
        },
      },
    });
    const created = latestRoomUpdate(host);
    assert.ok(created);
    const roomId = created!.id;
    assert.equal(created!.members.length, 1);

    host.inject({
      type: 'ROOM_ACTION',
      roomId,
      timeMs: Date.now(),
      payload: { action: 'AUTO_FILL_AI' },
    });
    const filled = latestRoomUpdate(host);
    assert.ok(filled);
    assert.equal(filled!.members.length, 5, '一键 AI 后应为 5 人');

    guestH.drain();
    guestH.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    guestD.drain();
    guestD.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });

    const room = hub.roomManager.getRoom(roomId)!;
    assert.equal(room.members.length, 5, '两人顶替 AI 后仍保持 5 人');
    const humans = room.members.filter((m) => m.isPlayer && !m.isAi);
    const ais = room.members.filter((m) => m.isAi);
    assert.equal(humans.length, 3);
    assert.equal(ais.length, 2);
    assert.ok(humans.some((m) => m.id === 'char_host'));
    assert.ok(humans.some((m) => m.id === 'char_healer'));
    assert.ok(humans.some((m) => m.id === 'char_dps'));

    // Unique member ids (regression for p1_player collapse)
    const ids = room.members.map((m) => m.id);
    assert.equal(new Set(ids).size, 5);

    const hostView = latestRoomUpdate(host);
    const healerView = latestRoomUpdate(guestH);
    const dpsView = latestRoomUpdate(guestD);
    assert.ok(hostView && healerView && dpsView);
    assert.equal(hostView!.members.length, healerView!.members.length);
    assert.equal(healerView!.members.length, dpsView!.members.length);
    assert.deepEqual(
      [...hostView!.members.map((m) => m.id)].sort(),
      [...healerView!.members.map((m) => m.id)].sort()
    );
  });

  it('房主同意后客人再同意：同意数 1→2 且过半数通过；客人反对时同意仍为 1', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'h_cnt',
      username: 'u_h_cnt',
      playerName: 'HostCnt',
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    });
    const guest = authClient(hub, {
      playerId: 'g_cnt',
      username: 'u_g_cnt',
      playerName: 'GuestCnt',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '计票房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h_cnt', name: 'HostCnt', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = latestRoomUpdate(host)!.id;
    host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    guest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });
    host.drain();
    guest.drain();

    host.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: { playerId: 'h_cnt', kind: 'REQUEST_SKIP_TRAVEL' },
    });
    // March ticks must not reset tally
    host.inject({
      type: 'COMBAT_STATE',
      roomId,
      timeMs: Date.now(),
      payload: { roomId, runPhase: 'TRAVEL_RECOVERY', units: [] },
    });
    let vote = hub.votes.get(roomId, 'SKIP_TRAVEL')!;
    assert.ok(vote);
    assert.equal(
      vote.eligiblePlayerIds.filter((id) => vote.votes[id] === 'YES').length,
      1,
      '房主发起后同意应为 1'
    );

    host.drain();
    guest.drain();
    guest.inject({
      type: 'VOTE_CAST',
      roomId,
      timeMs: Date.now(),
      payload: { kind: 'SKIP_TRAVEL', playerId: 'g_cnt', choice: 'YES' },
    });
    const yesResult = host.lastOfType('VOTE_RESULT') || guest.lastOfType('VOTE_RESULT');
    assert.ok(yesResult, '第二票同意后应通过');
    assert.equal((yesResult!.payload as any).result, 'YES');
    const yesVote = (yesResult!.payload as any).vote;
    assert.equal(
      yesVote.eligiblePlayerIds.filter((id: string) => yesVote.votes[id] === 'YES').length,
      2,
      '两人同意后同意数应为 2'
    );

    // Fresh vote: host YES, guest NO → yes stays 1, not wiped to 0
    const hub2 = new RoomWsHub();
    const host2 = authClient(hub2, {
      playerId: 'h_cnt2',
      username: 'u_h_cnt2',
      playerName: 'HostCnt2',
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    });
    const guest2 = authClient(hub2, {
      playerId: 'g_cnt2',
      username: 'u_g_cnt2',
      playerName: 'GuestCnt2',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    host2.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '计票反对房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h_cnt2', name: 'HostCnt2', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId2 = latestRoomUpdate(host2)!.id;
    host2.inject({ type: 'ROOM_ACTION', roomId: roomId2, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    guest2.inject({ type: 'ROOM_JOIN', roomId: roomId2, timeMs: Date.now(), payload: { roomId: roomId2 } });
    host2.inject({ type: 'ROOM_START', roomId: roomId2, timeMs: Date.now() });
    host2.drain();
    guest2.drain();
    host2.inject({
      type: 'PLAYER_INPUT',
      roomId: roomId2,
      timeMs: Date.now(),
      payload: { playerId: 'h_cnt2', kind: 'REQUEST_SKIP_TRAVEL' },
    });
    host2.inject({
      type: 'COMBAT_STATE',
      roomId: roomId2,
      timeMs: Date.now(),
      payload: { roomId: roomId2, runPhase: 'TRAVEL_RECOVERY', units: [] },
    });
    host2.drain();
    guest2.drain();
    guest2.inject({
      type: 'VOTE_CAST',
      roomId: roomId2,
      timeMs: Date.now(),
      payload: { kind: 'SKIP_TRAVEL', playerId: 'g_cnt2', choice: 'NO' },
    });
    const noState = host2.lastOfType('VOTE_STATE') || guest2.lastOfType('VOTE_STATE');
    assert.ok(noState, '客人反对后应广播 VOTE_STATE');
    const noSnap = (noState!.payload as any)?.vote || noState!.payload;
    assert.equal(noSnap.votes['h_cnt2'], 'YES', '房主同意票必须保留');
    assert.equal(noSnap.votes['g_cnt2'], 'NO');
    assert.equal(
      noSnap.eligiblePlayerIds.filter((id: string) => noSnap.votes[id] === 'YES').length,
      1,
      '客人反对后同意数仍应为 1（不是 0）'
    );
  });

  it('房主发起跳过：行军中 COMBAT_STATE 不得清票；客人同意后应立刻通过', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'h_skip_host',
      username: 'u_h_skip_host',
      playerName: 'HostSkip',
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    });
    const guest = authClient(hub, {
      playerId: 'g_skip_guest',
      username: 'u_g_skip_guest',
      playerName: 'GuestSkip',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '房主跳过房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h_skip_host', name: 'HostSkip', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = latestRoomUpdate(host)!.id;
    host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    guest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });
    host.drain();
    guest.drain();

    // Host clicks skip (same as client: REQUEST + cast YES)
    host.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: { playerId: 'h_skip_host', kind: 'REQUEST_SKIP_TRAVEL' },
    });
    host.inject({
      type: 'VOTE_CAST',
      roomId,
      timeMs: Date.now(),
      payload: { kind: 'SKIP_TRAVEL', playerId: 'h_skip_host', choice: 'YES' },
    });
    assert.ok(hub.votes.get(roomId, 'SKIP_TRAVEL'), '跳过投票应存在');
    assert.equal(hub.votes.get(roomId, 'SKIP_TRAVEL')!.votes['h_skip_host'], 'YES');

    // Host combat tick while still marching — previously cleared the skip tally
    host.inject({
      type: 'COMBAT_STATE',
      roomId,
      timeMs: Date.now(),
      payload: {
        roomId,
        runPhase: 'TRAVEL_RECOVERY',
        travelRemainingMs: 8000,
        units: [],
      },
    });
    assert.ok(
      hub.votes.get(roomId, 'SKIP_TRAVEL'),
      'TRAVEL_RECOVERY 的 COMBAT_STATE 不得清掉跳过投票'
    );
    assert.equal(hub.votes.get(roomId, 'SKIP_TRAVEL')!.votes['h_skip_host'], 'YES');

    guest.drain();
    host.drain();
    guest.inject({
      type: 'VOTE_CAST',
      roomId,
      timeMs: Date.now(),
      payload: { kind: 'SKIP_TRAVEL', playerId: 'g_skip_guest', choice: 'YES' },
    });

    const result =
      host.lastOfType('VOTE_RESULT') || guest.lastOfType('VOTE_RESULT');
    assert.ok(result, '客人同意后房主应收到 VOTE_RESULT');
    assert.equal((result!.payload as any).result, 'YES');
  });

  it('跳过赶路：2 人局发起者点跳过即记 YES，另一人同意后应立刻通过（2/2）', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'h2',
      username: 'u_h2',
      playerName: 'Host2',
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    });
    const g1 = authClient(hub, {
      playerId: 'g_skip',
      username: 'u_g_skip',
      playerName: 'Skipper',
      classId: 'PRIEST',
      spec: 'DISCIPLINE',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '双人跳过房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h2', name: 'Host2', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = latestRoomUpdate(host)!.id;
    host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    g1.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });
    assert.equal(hub.roomManager.countHumanPlayers(roomId), 2);

    host.drain();
    g1.drain();

    // 发起者点跳过 → 必须已是 1/2 YES
    g1.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: { playerId: 'g_skip', kind: 'REQUEST_SKIP_TRAVEL' },
    });
    const started =
      g1.lastOfType('VOTE_STATE') ||
      g1.lastOfType('VOTE_START') ||
      host.lastOfType('VOTE_STATE') ||
      host.lastOfType('VOTE_START');
    assert.ok(started, '应广播跳过投票');
    const snap = (started!.payload as any)?.vote || started!.payload;
    assert.equal(snap?.votes?.g_skip, 'YES', '点跳过的人必须直接记为同意');
    assert.equal(
      snap.eligiblePlayerIds.filter((id: string) => snap.votes[id] === 'YES').length,
      1,
      '发起后同意数应为 1/2'
    );

    // 另一人点同意 → 2/2 立刻通过
    host.inject({
      type: 'VOTE_CAST',
      roomId,
      timeMs: Date.now(),
      payload: { kind: 'SKIP_TRAVEL', playerId: 'h2', choice: 'YES' },
    });
    const result =
      host.lastOfType('VOTE_RESULT') ||
      g1.lastOfType('VOTE_RESULT');
    assert.ok(result, '两人同意后应立即出结果');
    assert.equal((result!.payload as any).result, 'YES');
    const finalVote = (result!.payload as any).vote;
    assert.equal(
      finalVote.eligiblePlayerIds.filter((id: string) => finalVote.votes[id] === 'YES').length,
      2,
      '通过时应为 2/2 同意'
    );
  });

  it('跳过赶路投票：两票 YES 即通过；非房主退出房间保留并由房主退出销毁', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'h1',
      username: 'u_host',
      playerName: 'Host',
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    });
    const g1 = authClient(hub, {
      playerId: 'g1',
      username: 'u_g1',
      playerName: 'Guest1',
      classId: 'PRIEST',
      spec: 'DISCIPLINE',
      role: 'HEALER',
    });
    const g2 = authClient(hub, {
      playerId: 'g2',
      username: 'u_g2',
      playerName: 'Guest2',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '投票房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'h1', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = latestRoomUpdate(host)!.id;
    host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    g1.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    g2.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    assert.equal(hub.roomManager.countHumanPlayers(roomId), 3);

    // Start dungeon so skip-travel is meaningful; vote works in lobby too via PLAYER_INPUT
    host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });
    assert.equal(hub.roomManager.getRoom(roomId)!.status, 'IN_COMBAT');

    g1.drain();
    g2.drain();
    host.drain();

    g1.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: { playerId: 'g1', kind: 'REQUEST_SKIP_TRAVEL' },
    });
    assert.ok(g1.lastOfType('VOTE_START') || host.lastOfType('VOTE_START') || g2.lastOfType('VOTE_START'));

    // 发起者必须已自动记上一票 YES（首包 VOTE_STATE / VOTE_START 即可见）
    const voteSnap =
      g1.lastOfType('VOTE_STATE') ||
      g1.lastOfType('VOTE_START') ||
      host.lastOfType('VOTE_STATE') ||
      host.lastOfType('VOTE_START');
    assert.ok(voteSnap, '发起后应广播投票状态');
    const votePayload = (voteSnap!.payload as any)?.vote || voteSnap!.payload;
    assert.equal(
      votePayload?.votes?.g1,
      'YES',
      '迷宫过场投票发起者 g1 必须已自动投 YES'
    );

    // Requester already counted YES; one more YES from host → majority of 3
    host.inject({
      type: 'PLAYER_INPUT',
      roomId,
      timeMs: Date.now(),
      payload: { playerId: 'h1', kind: 'SKIP_TRAVEL_VOTE', skipTravelVote: 'YES' },
    });

    const result =
      host.lastOfType('VOTE_RESULT') ||
      g1.lastOfType('VOTE_RESULT') ||
      g2.lastOfType('VOTE_RESULT');
    assert.ok(result, '应收到跳过赶路投票结果');
    assert.equal((result!.payload as any).result, 'YES');

    // Non-host leave mid-run → AI takeover, room survives
    g2.drain();
    host.drain();
    g2.inject({ type: 'ROOM_LEAVE', roomId, timeMs: Date.now() });
    assert.ok(hub.roomManager.getRoom(roomId), '非房主离开后房间应仍存在');
    assert.equal(hub.roomManager.countHumanPlayers(roomId), 2);
    assert.equal(hub.roomManager.getRoom(roomId)!.members.length, 5, 'AI 接续席位后总人数不变');
    assert.ok(
      !hub.roomManager.getRoom(roomId)!.members.some((m) => m.id === 'g2'),
      '离开的玩家 id 应从名单移除（由 AI 接续）'
    );
    assert.ok(host.lastOfType('MEMBER_REPLACE_AI'), '房主应收到 MEMBER_REPLACE_AI');

    // Host leave transfers host to remaining player g1; once g1 also leaves, room is destroyed
    g1.drain();
    host.inject({ type: 'ROOM_LEAVE', roomId, timeMs: Date.now() });
    const afterHostLeave = hub.roomManager.getRoom(roomId);
    assert.ok(afterHostLeave, '仍有真人时房间应保留');
    assert.equal(afterHostLeave!.hostId, 'g1', '房主应移交给 g1');
    assert.ok(g1.lastOfType('HOST_TRANSFER'));
    g1.inject({ type: 'ROOM_LEAVE', roomId, timeMs: Date.now() });
    assert.equal(hub.roomManager.getRoom(roomId), undefined);
    hub.dispose();
  });

  it('奶妈开房加满AI踢坦克：DPS客人顶替DPS；第二奶妈拒绝', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'host_heal',
      username: 'host_heal_u',
      playerName: 'HostHealer',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '奶妈踢坦房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_heal', name: 'HostHealer', classId: 'PRIEST', spec: 'HOLY', role: 'HEALER' },
      },
    });
    const roomId = latestRoomUpdate(host)!.id;
    host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });

    let room = hub.roomManager.getRoom(roomId)!;
    assert.equal(room.members.length, 5);
    const tankAi = room.members.find((m) => m.isAi && m.role === 'TANK');
    assert.ok(tankAi);
    const dpsAiIds = room.members.filter((m) => m.isAi && m.role === 'DPS').map((m) => m.id);
    assert.equal(dpsAiIds.length, 3);

    host.inject({
      type: 'ROOM_ACTION',
      roomId,
      timeMs: Date.now(),
      payload: { action: 'KICK', memberId: tankAi!.id },
    });
    room = hub.roomManager.getRoom(roomId)!;
    assert.equal(room.members.length, 4);
    assert.ok(room.slots.some((s) => !s.occupied && s.role === 'TANK'));

    const dpsGuest = authClient(hub, {
      playerId: 'guest_dps',
      username: 'guest_dps_u',
      playerName: 'GuestDps',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    dpsGuest.drain();
    dpsGuest.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });

    room = hub.roomManager.getRoom(roomId)!;
    const dpsMember = room.members.find((m) => m.id === 'guest_dps');
    assert.ok(dpsMember, 'DPS 客人应进入房间');
    assert.equal(dpsMember!.role, 'DPS');
    assert.ok(dpsAiIds.includes(dpsMember!.id) === false);
    // One of the original DPS AIs should be gone
    assert.ok(
      dpsAiIds.some((id) => !room.members.some((m) => m.id === id)),
      '应顶替掉一名 DPS AI'
    );
    assert.ok(
      room.slots.some((s) => !s.occupied && s.role === 'TANK'),
      '空坦克席不得被 DPS 占用'
    );
    assert.ok(!dpsGuest.lastOfType('ERROR'), 'DPS 加入不应报错');

    // Fresh room for healer-guest reject (previous guest already took a DPS seat)
    const hub2 = new RoomWsHub();
    const host2 = authClient(hub2, {
      playerId: 'host_heal2',
      username: 'host_heal2_u',
      playerName: 'HostHealer2',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });
    host2.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '奶妈踢坦拒奶',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_heal2', name: 'HostHealer2', classId: 'PRIEST', spec: 'HOLY', role: 'HEALER' },
      },
    });
    const roomId2 = latestRoomUpdate(host2)!.id;
    host2.inject({ type: 'ROOM_ACTION', roomId: roomId2, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    const tank2 = hub2.roomManager.getRoom(roomId2)!.members.find((m) => m.isAi && m.role === 'TANK')!;
    host2.inject({
      type: 'ROOM_ACTION',
      roomId: roomId2,
      timeMs: Date.now(),
      payload: { action: 'KICK', memberId: tank2.id },
    });

    const healGuest = authClient(hub2, {
      playerId: 'guest_heal',
      username: 'guest_heal_u',
      playerName: 'GuestHealer',
      classId: 'SHAMAN',
      spec: 'RESTORATION',
      role: 'HEALER',
    });
    healGuest.drain();
    healGuest.inject({ type: 'ROOM_JOIN', roomId: roomId2, timeMs: Date.now(), payload: { roomId: roomId2 } });

    const err = healGuest.lastOfType('ERROR');
    assert.ok(err, '第二名治疗应收到 ERROR');
    assert.match(String(err!.error || ''), /治疗|同职责/);
    const room2 = hub2.roomManager.getRoom(roomId2)!;
    assert.ok(!room2.members.some((m) => m.id === 'guest_heal'), '治疗客人不得进入名单');
    assert.ok(room2.slots.some((s) => !s.occupied && s.role === 'TANK'));
  });

  it('热加入：战斗中第三人顶替同职责 AI，单位数仍为 5 且继承战斗状态', () => {
    const hub = new RoomWsHub();
    const host = authClient(hub, {
      playerId: 'host_hot',
      username: 'hot_host',
      playerName: 'Host',
      classId: 'DK',
      spec: 'BLOOD',
      role: 'TANK',
    });
    const g1 = authClient(hub, {
      playerId: 'hot_heal',
      username: 'hot_heal_u',
      playerName: 'Healer',
      classId: 'PRIEST',
      spec: 'HOLY',
      role: 'HEALER',
    });

    host.inject({
      type: 'ROOM_CREATE',
      timeMs: Date.now(),
      payload: {
        name: '热加入房',
        dungeonId: 'shadowfang_keep',
        host: { id: 'host_hot', name: 'Host', classId: 'DK', spec: 'BLOOD', role: 'TANK' },
      },
    });
    const roomId = latestRoomUpdate(host)!.id;
    host.inject({ type: 'ROOM_ACTION', roomId, timeMs: Date.now(), payload: { action: 'AUTO_FILL_AI' } });
    g1.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });
    host.inject({ type: 'ROOM_START', roomId, timeMs: Date.now() });

    const roomBefore = hub.roomManager.getRoom(roomId)!;
    assert.equal(roomBefore.status, 'IN_COMBAT');
    const dpsAi = roomBefore.members.find((m) => m.isAi && m.role === 'DPS');
    assert.ok(dpsAi);

    // Simulate host combat unit for that AI (HP mid-fight)
    const engine = new CombatEngine();
    for (const m of roomBefore.members) {
      engine.addUnit(
        makeFriendlyUnit({
          id: m.id,
          name: m.name,
          classId: m.classId,
          spec: m.spec,
          role: m.role,
          isPlayer: m.id === 'host_hot',
          isHumanControlled: !m.isAi,
          hp: m.id === dpsAi!.id ? 22222 : 36000,
        })
      );
    }
    assert.equal(engine.friendlyUnits.length, 5);

    const joiner = authClient(hub, {
      playerId: 'hot_dps',
      username: 'hot_dps_u',
      playerName: 'FireMage',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    joiner.drain();
    joiner.inject({ type: 'ROOM_JOIN', roomId, timeMs: Date.now(), payload: { roomId } });

    const roomAfter = hub.roomManager.getRoom(roomId)!;
    assert.equal(roomAfter.members.length, 5, '热加入后仍 5 人');
    assert.ok(roomAfter.members.some((m) => m.id === 'hot_dps' && !m.isAi));
    assert.ok(!roomAfter.members.some((m) => m.id === dpsAi!.id), '被顶替的 AI 应离开名单');

    // Engine-side inherit (host would do this on MEMBER_HOT_SWAP)
    const inherited = hub.roomManager.inheritCombatUnitFromAi(engine, dpsAi!.id, {
      id: 'hot_dps',
      name: 'FireMage',
      classId: 'MAGE',
      spec: 'FIRE',
      role: 'DPS',
    });
    assert.ok(inherited);
    assert.equal(inherited!.hp, 22222);
    assert.equal(inherited!.isPlayer, false);
    assert.equal(inherited!.isHumanControlled, true);
    assert.equal(engine.friendlyUnits.length, 5);
    assert.equal(new Set(engine.friendlyUnits.map((u) => u.id)).size, 5);
  });
});

describe('Dungeon run: boss clear + resurrection', () => {
  it('击杀首领后进入赶路下一关；复活术拉起队友', () => {
    const engine = new CombatEngine();
    const report = new ReportManager();
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, report);

    const tank = makeFriendlyUnit({
      id: 'char_host',
      name: 'Tank',
      classId: 'DK',
      role: 'TANK',
      isPlayer: true,
      isHumanControlled: true,
      hp: 50000,
      maxHp: 50000,
    });
    const healer = makeFriendlyUnit({
      id: 'char_healer',
      name: 'Priest',
      classId: 'PRIEST',
      role: 'HEALER',
      isHumanControlled: true,
      hp: 36000,
      maxHp: 36000,
      mp: 30000,
      maxMp: 30000,
    });
    const dps = makeFriendlyUnit({
      id: 'char_dps',
      name: 'Mage',
      classId: 'MAGE',
      role: 'DPS',
      isHumanControlled: true,
    });
    const ai1 = makeFriendlyUnit({ id: 'ai_1', name: 'AI1', classId: 'WARLOCK', role: 'DPS' });
    const ai2 = makeFriendlyUnit({ id: 'ai_2', name: 'AI2', classId: 'HUNTER', role: 'DPS' });
    for (const u of [tank, healer, dps, ai1, ai2]) engine.addUnit(u);
    assert.equal(engine.friendlyUnits.length, 5);
    assert.equal(new Set(engine.friendlyUnits.map((u) => u.id)).size, 5);

    rsm.startRun();
    assert.equal(rsm.phase, 'TRAVEL_RECOVERY');
    rsm.fastForwardTravel();
    assert.equal(rsm.phase, 'BOSS_COMBAT');
    assert.equal(rsm.currentBossIndex, 0);
    assert.ok(engine.bossUnit);
    assert.equal(engine.bossUnit!.name, '亚什布里男爵');

    // Kill a DPS then resurrect
    dps.isAlive = false;
    dps.alive = false;
    dps.hp = 0;
    assert.equal(engine.resurrectUnit(dps.id, 0.35, 0.35), true);
    assert.equal(dps.isAlive, true);
    assert.equal(dps.alive, true);
    assert.equal(dps.hp, Math.round(36000 * 0.35));

    // Boss clear → next travel segment
    engine.bossUnit!.hp = 0;
    engine.bossUnit!.isAlive = false;
    engine.bossUnit!.alive = false;
    rsm.tick(50);
    assert.equal(rsm.phase, 'TRAVEL_RECOVERY');
    assert.equal(rsm.currentBossIndex, 1);
    assert.ok(rsm.encounterReports.some((e) => e.result === 'KILL'));

    // Advance to last boss and clear dungeon
    while (!rsm.isLastBoss()) {
      rsm.fastForwardTravel();
      assert.equal(rsm.phase, 'BOSS_COMBAT');
      const boss = engine.bossUnit!;
      boss.hp = 0;
      boss.isAlive = false;
      boss.alive = false;
      rsm.tick(50);
      if (rsm.phase === 'SUMMARY') break;
      assert.equal(rsm.phase, 'TRAVEL_RECOVERY');
    }
    if (rsm.phase !== 'SUMMARY') {
      rsm.fastForwardTravel();
      const boss = engine.bossUnit!;
      boss.hp = 0;
      boss.isAlive = false;
      boss.alive = false;
      rsm.tick(50);
    }
    assert.equal(rsm.phase, 'SUMMARY');
    assert.equal(rsm.isCleared, true);
  });

  it('灭团投票 FINISH 进结算；RETRY 回赶路并全体复活', () => {
    const engine = new CombatEngine();
    const rsm = new RunStateMachine(SHADOWFANG_KEEP_CONFIG, engine, new ReportManager());
    engine.addUnit(
      makeFriendlyUnit({
        id: 'p1',
        name: 'P1',
        classId: 'WARRIOR',
        role: 'TANK',
        isPlayer: true,
        isHumanControlled: true,
      })
    );
    engine.addUnit(
      makeFriendlyUnit({
        id: 'p2',
        name: 'P2',
        classId: 'PRIEST',
        role: 'HEALER',
        isHumanControlled: true,
      })
    );

    rsm.startRun();
    rsm.fastForwardTravel();
    for (const u of engine.friendlyUnits) {
      u.hp = 0;
      u.isAlive = false;
      u.alive = false;
    }
    rsm.tick(50);
    assert.equal(rsm.phase, 'WIPE_VOTE');

    rsm.handleWipeVoteChoice('RETRY');
    assert.equal(rsm.phase, 'TRAVEL_RECOVERY');
    assert.ok(engine.friendlyUnits.every((u) => u.isAlive && u.hp === u.maxHp));

    rsm.fastForwardTravel();
    for (const u of engine.friendlyUnits) {
      u.hp = 0;
      u.isAlive = false;
      u.alive = false;
    }
    rsm.tick(50);
    rsm.handleWipeVoteChoice('FINISH');
    assert.equal(rsm.phase, 'SUMMARY');
    assert.equal(rsm.isCleared, false);
  });
});
