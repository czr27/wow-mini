import type { WebSocket } from 'ws';
import {
  RoomManager,
  decodeNetMessage,
  encodeNetMessage,
  type AuthPayload,
  type CombatEffect,
  type LobbyRoom,
  type NetEnvelope,
  type NetworkCombatSnapshot,
  type NetworkVoteKind,
  type OwnerSnapshot,
  type PlayerInfo,
  type PlayerInputPayload,
  type RoomActionPayload,
  type RoomChatMessage,
  type RoomChatSendPayload,
  type RoomCreatePayload,
  type VoteCastPayload,
  type VoteStartPayload,
} from '@cata-raid-sim/engine';
import { RoomCombatSession } from './RoomCombatSession.js';
import { RoomVoteTracker } from './roomVotes.js';

/** WebSocket 断开后短暂等待重连，再踢出/改 AI */
const DISCONNECT_AI_MS = 5000;
/** 客户端约每 15s 发 PING；超过该时长无 PING 视为心跳超时 */
const HEARTBEAT_TIMEOUT_MS = 45_000;
/** 心跳扫描周期 */
const HEARTBEAT_SWEEP_MS = 5_000;

interface ClientSession {
  ws: WebSocket;
  playerId: string;
  username: string;
  playerName: string;
  classId: string;
  spec: string;
  role?: string;
  roomId: string | null;
  /** 最近一次收到客户端 PING（或 AUTH）的时间 */
  lastPongMs: number;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

export class RoomWsHub {
  readonly roomManager = new RoomManager();
  readonly votes = new RoomVoteTracker();
  private sessionsByPlayer = new Map<string, ClientSession>();
  private sessionsByWs = new Map<WebSocket, ClientSession>();
  private combatSessions = new Map<string, RoomCombatSession>();
  /** Per-room throttle for host combat → lobby list sync (rooms stay isolated). */
  private lastCombatMetaPush = new Map<string, { phase?: string; atMs: number }>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.heartbeatTimer = setInterval(() => this.sweepHeartbeatsAndOrphanRooms(), HEARTBEAT_SWEEP_MS);
    // 避免单测进程被 interval 挂住
    if (typeof (this.heartbeatTimer as any).unref === 'function') {
      (this.heartbeatTimer as any).unref();
    }
  }

  /** 测试 / 关服时停掉心跳扫描与所有房间战斗会话 */
  dispose() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const cs of this.combatSessions.values()) {
      cs.dispose();
    }
    this.combatSessions.clear();
  }

  getCombatSession(roomId: string): RoomCombatSession | undefined {
    return this.combatSessions.get(roomId);
  }

  private createCombatSession(room: LobbyRoom): RoomCombatSession {
    this.combatSessions.get(room.id)?.dispose();
    const cs = new RoomCombatSession(room, {
      broadcastCombatState: (rid, snap) => {
        this.broadcastRoom(rid, {
          type: 'COMBAT_STATE',
          roomId: rid,
          seq: snap.seq,
          timeMs: snap.timeMs,
          payload: snap,
        });
      },
      broadcastCombatBatch: (rid, batch) => {
        this.broadcastRoom(rid, {
          type: 'COMBAT_BATCH',
          roomId: rid,
          seq: batch.seq,
          timeMs: batch.timeMs,
          payload: batch,
        });
      },
      onEnterWipeVote: (rid) => {
        if (!this.votes.get(rid, 'WIPE')) {
          this.startVote(rid, 'WIPE');
        }
      },
      onEnterSummary: (rid) => {
        // 团灭并不重试 / 通关结算：销毁房间战斗会话并在无重试时销毁房间
        this.destroyRoomAndNotify(rid, 'wipe_finish', true);
      },
      onRoomMetaUpdate: (rid, snap) => {
        this.applyCombatSnapMeta(rid, snap);
      },
    });
    this.combatSessions.set(room.id, cs);
    return cs;
  }

  private applyCombatSnapMeta(roomId: string, snap: NetworkCombatSnapshot) {
    const rm = this.roomManager as RoomManager & {
      applyHostCombatSnapshot?: RoomManager['applyHostCombatSnapshot'];
      getRoom?: RoomManager['getRoom'];
    };
    const updated = rm.applyHostCombatSnapshot?.(roomId, {
      runPhase: snap.runPhase,
      travelRemainingMs: snap.travelRemainingMs,
      currentBossIndex: snap.currentBossIndex,
      isCleared: snap.isCleared,
      units: snap.units,
    });
    if (updated) {
      const prev = this.lastCombatMetaPush.get(roomId);
      const now = Date.now();
      const phaseChanged = !!snap.runPhase && snap.runPhase !== prev?.phase;
      const dueHp = !prev || now - prev.atMs >= 1000;
      if (phaseChanged || dueHp || snap.runPhase === 'SUMMARY') {
        this.lastCombatMetaPush.set(roomId, { phase: snap.runPhase, atMs: now });
        this.pushRoomUpdate(updated);
      }
    }
  }

  private humanIdsInRoom(roomId: string): string[] {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return [];
    return room.members.filter((m) => m.isPlayer && !m.isAi).map((m) => m.id);
  }

  private normalizeUsername(username: string): string {
    return (username || '').trim().toLowerCase();
  }

  /** Kick every live socket for this account except `exceptWs` (if provided). */
  private kickOtherAccountSessions(username: string, exceptWs: WebSocket | null, reason: string) {
    const key = this.normalizeUsername(username);
    if (!key) return;
    for (const [playerId, sess] of [...this.sessionsByPlayer.entries()]) {
      if (exceptWs && sess.ws === exceptWs) continue;
      if (this.normalizeUsername(sess.username) !== key) continue;
      if (sess.disconnectTimer) {
        clearTimeout(sess.disconnectTimer);
        sess.disconnectTimer = undefined;
      }
      try {
        this.send(sess.ws, {
          type: 'SESSION_KICKED',
          timeMs: Date.now(),
          payload: {
            reason,
            username: sess.username,
            playerId: sess.playerId,
          },
        });
      } catch {}
      // 先发踢下线通知再关连接，给客户端一点时间弹出提示（勿与 send 同步 close）
      const doomed = sess.ws;
      const doomedPlayerId = playerId;
      this.sessionsByWs.delete(doomed);
      this.sessionsByPlayer.delete(doomedPlayerId);
      setTimeout(() => {
        try {
          doomed.close();
        } catch {}
      }, 120);
    }
  }

  /** HTTP login / register: force-disconnect any existing WS session for this account. */
  kickAccountSessions(username: string, reason = '账号已在其他地方登录') {
    this.kickOtherAccountSessions(username, null, reason);
    this.broadcastAll({ type: 'PRESENCE', timeMs: Date.now(), payload: this.presencePayload() });
  }

  /** Destroy room and notify all clients. Mid-run host leave sets forceSummary for guests. */
  private destroyRoomAndNotify(roomId: string, reason: string, forceSummary: boolean) {
    this.combatSessions.get(roomId)?.dispose();
    this.combatSessions.delete(roomId);
    this.votes.clearRoom(roomId);
    this.lastCombatMetaPush.delete(roomId);
    this.roomManager.destroyRoom(roomId);
    for (const s of this.sessionsByPlayer.values()) {
      if (s.roomId === roomId) s.roomId = null;
    }
    this.broadcastAll({
      type: 'ROOM_CLOSED',
      roomId,
      timeMs: Date.now(),
      payload: { roomId, reason, forceSummary },
    });
    this.pushRoomList();
  }

  private handleVoteResolved(roomId: string, kind: NetworkVoteKind, result: string) {
    const cs = this.combatSessions.get(roomId);
    if (!cs) return;
    if (kind === 'WIPE' && (result === 'RETRY' || result === 'FINISH')) {
      cs.applyWipeVoteResult(result);
    } else if (kind === 'SKIP_TRAVEL' && result === 'YES') {
      cs.fastForwardTravel();
    }
  }

  private startVote(
    roomId: string,
    kind: NetworkVoteKind,
    opts?: { initiatorId?: string; initiatorChoice?: string }
  ) {
    let eligible = this.humanIdsInRoom(roomId);
    // 发起者点「跳过」即视为同意：若因席位同步短暂不在名单，仍并入可投票人
    if (
      opts?.initiatorId &&
      opts?.initiatorChoice &&
      !eligible.includes(opts.initiatorId)
    ) {
      const sess = this.sessionsByPlayer.get(opts.initiatorId);
      if (sess?.roomId === roomId) {
        eligible = [...eligible, opts.initiatorId];
      }
    }
    if (eligible.length === 0) return null;
    const existing = this.votes.get(roomId, kind);
    if (existing && !existing.resolved) {
      // 已有进行中的投票：点跳过/再发起者尚未投票则补记同意
      if (
        opts?.initiatorId &&
        opts?.initiatorChoice &&
        existing.eligiblePlayerIds.includes(opts.initiatorId) &&
        !existing.votes[opts.initiatorId]
      ) {
        this.applyVoteCast(roomId, kind, opts.initiatorId, opts.initiatorChoice);
        return this.votes.get(roomId, kind) || existing;
      }
      return existing;
    }

    const state = this.votes.start(roomId, kind, eligible, (result, finalState) => {
      this.broadcastRoom(roomId, {
        type: 'VOTE_RESULT',
        roomId,
        timeMs: Date.now(),
        payload: { kind, result, vote: finalState },
      });
      this.handleVoteResolved(roomId, kind, result);
    });

    // 迷宫过场等：发起者默认先投一票，写进首包 VOTE_STATE，避免票数先闪 0
    let broadcastState = state;
    if (opts?.initiatorId && opts?.initiatorChoice) {
      const outcome = this.votes.cast(roomId, kind, opts.initiatorId, opts.initiatorChoice);
      if (outcome) {
        broadcastState = {
          ...outcome.state,
          votes: { ...outcome.state.votes },
          eligiblePlayerIds: [...outcome.state.eligiblePlayerIds],
        };
        this.broadcastRoom(roomId, {
          type: 'VOTE_START',
          roomId,
          timeMs: Date.now(),
          payload: { vote: broadcastState } satisfies VoteStartPayload,
        });
        this.broadcastRoom(roomId, {
          type: 'VOTE_STATE',
          roomId,
          timeMs: Date.now(),
          payload: broadcastState,
        });
        if (outcome.earlyResult) {
          this.broadcastRoom(roomId, {
            type: 'VOTE_RESULT',
            roomId,
            timeMs: Date.now(),
            payload: { kind, result: outcome.earlyResult, vote: broadcastState },
          });
          this.handleVoteResolved(roomId, kind, outcome.earlyResult);
        }
        return broadcastState;
      }
    }

    this.broadcastRoom(roomId, {
      type: 'VOTE_START',
      roomId,
      timeMs: Date.now(),
      payload: { vote: state } satisfies VoteStartPayload,
    });
    this.broadcastRoom(roomId, {
      type: 'VOTE_STATE',
      roomId,
      timeMs: Date.now(),
      payload: state,
    });
    return state;
  }

  private applyVoteCast(roomId: string, kind: NetworkVoteKind, playerId: string, choice: string) {
    // Keep tally roster in sync with seated humans so guest casts are never dropped
    const humans = this.humanIdsInRoom(roomId);
    this.votes.ensureEligible(roomId, kind, [...humans, playerId]);
    const outcome = this.votes.cast(roomId, kind, playerId, choice);
    if (!outcome) {
      // Voter still not eligible (not seated) — tell the client instead of silent drop
      const sess = this.sessionsByPlayer.get(playerId);
      if (sess) {
        this.send(sess.ws, {
          type: 'ERROR',
          error: '投票失败：你不在本局可投票名单中',
          roomId,
          timeMs: Date.now(),
        });
      }
      return;
    }
    this.broadcastRoom(roomId, {
      type: 'VOTE_STATE',
      roomId,
      timeMs: Date.now(),
      payload: outcome.state,
    });
    if (outcome.earlyResult) {
      this.broadcastRoom(roomId, {
        type: 'VOTE_RESULT',
        roomId,
        timeMs: Date.now(),
        payload: { kind, result: outcome.earlyResult, vote: outcome.state },
      });
      this.handleVoteResolved(roomId, kind, outcome.earlyResult);
    }
  }

  handleConnection(ws: WebSocket) {
    ws.send(
      encodeNetMessage({
        type: 'CONNECTED',
        timeMs: Date.now(),
        payload: { message: 'Cata Raid Sim Server Online' },
      })
    );

    ws.on('message', (raw) => {
      const msg = decodeNetMessage(raw.toString());
      if (!msg) return;
      this.onMessage(ws, msg);
    });

    ws.on('close', () => {
      this.onDisconnect(ws);
    });
  }

  private send(ws: WebSocket, msg: NetEnvelope) {
    if (ws.readyState === ws.OPEN) {
      ws.send(encodeNetMessage(msg));
    }
  }

  private broadcastRoom(roomId: string, msg: NetEnvelope, exceptPlayerId?: string) {
    const room = this.roomManager.getRoom(roomId);
    for (const session of this.sessionsByPlayer.values()) {
      if (session.playerId === exceptPlayerId) continue;
      const seated =
        !!room &&
        room.members.some((m) => m.id === session.playerId && m.isPlayer && !m.isAi);
      const inSession = session.roomId === roomId;
      if (!inSession && !seated) continue;
      // Heal dropped session.roomId so later casts/broadcasts keep working
      if (!session.roomId && seated) session.roomId = roomId;
      this.send(session.ws, msg);
    }
  }

  private broadcastAll(msg: NetEnvelope) {
    for (const session of this.sessionsByPlayer.values()) {
      this.send(session.ws, msg);
    }
  }

  private roomListPayload(): LobbyRoom[] {
    return this.roomManager.listRooms();
  }

  /**
   * 统一处理玩家离房 / 断线 / 心跳超时：
   * - 战斗中：AI 接管其席位；若为房主，移交给最早入房的剩余玩家；无人则销毁房间与战斗会话
   * - 大厅中：退座（可选自动补 AI）；若为房主，移交给最早入房的剩余玩家；无人则销毁房间
   */
  private removeOrReplacePlayerFromRoom(
    roomId: string,
    playerId: string,
    reason: string,
    opts?: { autoFillInLobby?: boolean }
  ) {
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      this.votes.clearRoom(roomId);
      return;
    }
    const inRun = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';

    if (inRun) {
      const replaced = this.roomManager.replaceHumanWithAi(roomId, playerId);
      if (replaced.roomDeleted) {
        this.destroyRoomAndNotify(roomId, reason || 'empty', true);
        return;
      }
      if (replaced.ok && replaced.room) {
        if (replaced.aiMemberId) {
          this.combatSessions
            .get(roomId)
            ?.replaceHumanWithAi(playerId, replaced.aiMemberId, replaced.room);
        }
        this.broadcastRoom(roomId, {
          type: 'MEMBER_REPLACE_AI',
          roomId,
          timeMs: Date.now(),
          payload: {
            roomId,
            playerId,
            aiMemberId: replaced.aiMemberId,
            room: replaced.room,
          },
        });
        if (replaced.newHostId) {
          this.broadcastRoom(roomId, {
            type: 'HOST_TRANSFER',
            roomId,
            timeMs: Date.now(),
            payload: { newHostId: replaced.newHostId, room: replaced.room },
          });
        }
        this.pushRoomUpdate(replaced.room);
      }
      return;
    }

    const result = this.roomManager.leaveRoom(roomId, playerId);
    if (result.roomDeleted) {
      this.destroyRoomAndNotify(roomId, reason || 'empty', false);
      return;
    }
    if (opts?.autoFillInLobby) {
      const cur = this.roomManager.getRoom(roomId);
      if (cur && cur.difficulty !== 'CUSTOM') {
        this.roomManager.autoFillAi(roomId);
      }
    }
    const updated = this.roomManager.getRoom(roomId);
    if (updated) {
      if (result.newHostId) {
        this.broadcastRoom(roomId, {
          type: 'HOST_TRANSFER',
          roomId,
          timeMs: Date.now(),
          payload: { newHostId: result.newHostId, room: updated },
        });
      }
      this.pushRoomUpdate(updated);
    } else {
      this.pushRoomList();
    }
  }

  /**
   * 进新房 / 建房前清掉旧房席位，避免残留「未准备」真人幽灵。
   * 房主离开若仍有其他真人玩家则移交房主，无人则销毁房间。
   */
  private detachSessionFromCurrentRoom(session: ClientSession) {
    const leftRoomId = session.roomId;
    if (!leftRoomId) return;
    session.roomId = null;
    this.removeOrReplacePlayerFromRoom(leftRoomId, session.playerId, 'empty');
  }

  private pushRoomList() {
    this.broadcastAll({
      type: 'ROOM_LIST_SYNC',
      timeMs: Date.now(),
      payload: this.roomListPayload(),
    });
  }

  private pushRoomUpdate(room: LobbyRoom) {
    this.broadcastRoom(room.id, {
      type: 'ROOM_UPDATE',
      roomId: room.id,
      timeMs: Date.now(),
      payload: room,
    });
    this.pushRoomList();
  }

  private presencePayload() {
    return {
      onlinePlayerIds: Array.from(this.sessionsByPlayer.keys()),
    };
  }

  /**
   * 心跳超时 / 断线宽限期结束：从会话表移除，并按规则移交房主或 AI 接管；无人则销毁房间。
   */
  private finalizeGoneSession(session: ClientSession, reason: string) {
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }

    const stillMapped = this.sessionsByPlayer.get(session.playerId);
    if (stillMapped === session) {
      this.sessionsByPlayer.delete(session.playerId);
    }
    this.sessionsByWs.delete(session.ws);

    this.broadcastAll({ type: 'PRESENCE', timeMs: Date.now(), payload: this.presencePayload() });

    const roomId = session.roomId;
    if (!roomId) return;
    session.roomId = null;
    this.removeOrReplacePlayerFromRoom(roomId, session.playerId, reason);
  }

  /** 扫无 PING 的僵死连接，并清掉房主已不在线的幽灵房间 */
  private sweepHeartbeatsAndOrphanRooms() {
    const now = Date.now();

    for (const session of [...this.sessionsByPlayer.values()]) {
      if (session.disconnectTimer) continue; // 已在断线宽限期内
      if (now - session.lastPongMs <= HEARTBEAT_TIMEOUT_MS) continue;

      try {
        this.send(session.ws, {
          type: 'SESSION_KICKED',
          timeMs: now,
          payload: {
            reason: '心跳超时，连接已断开',
            username: session.username,
            playerId: session.playerId,
          },
        });
      } catch {}
      // 先收尾房间；短暂延迟再 close，确保 SESSION_KICKED 能弹出
      this.finalizeGoneSession(session, 'heartbeat_timeout');
      const doomed = session.ws;
      setTimeout(() => {
        try {
          doomed.close();
        } catch {}
      }, 120);
    }

    // 房主会话已不存在或不属于该房 → 优先移交在线玩家，无人可继承才销毁
    // （断线 5s 宽限期内 session 仍在且 roomId 未清，不会误删，方便重连）
    for (const room of [...this.roomManager.listRooms()]) {
      const hostSession = this.sessionsByPlayer.get(room.hostId);
      if (hostSession && hostSession.roomId === room.id) continue;

      const hasOnlineSuccessor = room.members.some(
        (m) =>
          m.id !== room.hostId &&
          m.isPlayer &&
          !m.isAi &&
          this.sessionsByPlayer.get(m.id)?.roomId === room.id
      );
      if (hasOnlineSuccessor) {
        this.removeOrReplacePlayerFromRoom(room.id, room.hostId, 'host_timeout', {
          autoFillInLobby: true,
        });
        continue;
      }

      const inRun = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
      this.destroyRoomAndNotify(room.id, 'host_timeout', inRun);
    }
  }

  /** @internal 单测用：立即跑一轮心跳/幽灵房扫描 */
  forceHeartbeatSweepForTests() {
    this.sweepHeartbeatsAndOrphanRooms();
  }

  private onMessage(ws: WebSocket, msg: NetEnvelope) {
    const activeSession = this.sessionsByWs.get(ws);
    if (activeSession) activeSession.lastPongMs = Date.now();
    if (msg.type === 'PING') {
      this.send(ws, { type: 'PONG', timeMs: Date.now() });
      return;
    }

    if (msg.type === 'AUTH') {
      const auth = msg.payload as AuthPayload;
      if (!auth?.playerId || !auth?.username) {
        this.send(ws, { type: 'AUTH_FAIL', error: 'Missing playerId/username' });
        return;
      }

      // One account = one live session. Same username on another socket is kicked
      // back to login; other accounts on the same PC are untouched.
      // Character switch on the *same* socket is allowed (not a kick).
      const prevOnThisWs = this.sessionsByWs.get(ws);
      this.kickOtherAccountSessions(auth.username, ws, '账号已在其他地方登录');

      // Drop stale playerId map entries if this socket re-AUTH'd under a new char id
      for (const [pid, sess] of [...this.sessionsByPlayer.entries()]) {
        if (sess.ws === ws && pid !== auth.playerId) {
          this.sessionsByPlayer.delete(pid);
        }
      }

      const existing = this.sessionsByPlayer.get(auth.playerId);
      if (existing?.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = undefined;
      }

      // 断线宽限期内用新 WebSocket 重连：保留原房间归属（若仍在该房席位中），避免房主被幽灵房扫描误杀
      const existingRoom = existing?.roomId ? this.roomManager.getRoom(existing.roomId) : undefined;
      const stillSeated = !!existingRoom?.members.some(
        (m) => m.id === auth.playerId && !m.isAi
      );
      const preservedRoomId =
        prevOnThisWs?.roomId ?? (stillSeated && existing?.roomId ? existing.roomId : null);

      const session: ClientSession = {
        ws,
        playerId: auth.playerId,
        username: auth.username,
        playerName: auth.playerName || auth.username,
        classId: auth.classId,
        spec: auth.spec,
        role: auth.role,
        roomId: preservedRoomId,
        lastPongMs: Date.now(),
      };
      this.sessionsByPlayer.set(auth.playerId, session);
      this.sessionsByWs.set(ws, session);

      this.send(ws, {
        type: 'AUTH_OK',
        timeMs: Date.now(),
        payload: { playerId: auth.playerId, roomId: session.roomId },
      });
      this.broadcastAll({ type: 'PRESENCE', timeMs: Date.now(), payload: this.presencePayload() });
      this.send(ws, {
        type: 'ROOM_LIST_SYNC',
        timeMs: Date.now(),
        payload: this.roomListPayload(),
      });
      if (session.roomId) {
        const room = this.roomManager.getRoom(session.roomId);
        if (room) {
          this.send(ws, { type: 'ROOM_UPDATE', roomId: room.id, payload: room });
        }
      }
      return;
    }

    const session = this.sessionsByWs.get(ws);
    if (!session) {
      this.send(ws, { type: 'ERROR', error: 'Not authenticated' });
      return;
    }

    switch (msg.type) {
      case 'ROOM_LIST':
        this.send(ws, {
          type: 'ROOM_LIST_SYNC',
          timeMs: Date.now(),
          payload: this.roomListPayload(),
        });
        break;

      case 'ROOM_CREATE': {
        // 建房前先退出旧房，防止旧席位残留未准备状态污染列表/校验
        this.detachSessionFromCurrentRoom(session);
        const body = msg.payload as RoomCreatePayload;
        const host: PlayerInfo = body.host || {
          id: session.playerId,
          name: session.playerName,
          classId: session.classId as any,
          spec: session.spec,
          role: session.role as any,
        };
        host.id = session.playerId;
        // 创建房时同步最新专精/职责到 session，避免沿用旧 AUTH
        if (host.spec) session.spec = host.spec;
        if (host.classId) session.classId = String(host.classId);
        if (host.role) session.role = host.role;
        if (host.name) session.playerName = host.name;
        const room = this.roomManager.createRoom({
          name: body.name || `${session.playerName}的队伍`,
          dungeonId: body.dungeonId,
          difficulty: body.difficulty,
          customDifficulty: body.customDifficulty,
          host,
        });
        session.roomId = room.id;
        if (body.quickStart) {
          this.roomManager.autoFillAi(room.id);
          const start = this.roomManager.startGame(room.id, session.playerId);
          const started = this.roomManager.getRoom(room.id)!;
          // Always push final lobby/combat snapshot first
          this.send(ws, { type: 'ROOM_UPDATE', roomId: room.id, payload: started });
          this.pushRoomList();
          if (start.success) {
            this.createCombatSession(started);
            this.broadcastRoom(room.id, {
              type: 'ROOM_START',
              roomId: room.id,
              timeMs: Date.now(),
              payload: started,
            });
          } else {
            this.send(ws, {
              type: 'ERROR',
              error: start.reason || '快速游戏开局失败',
              payload: start,
            });
          }
        } else {
          this.send(ws, { type: 'ROOM_UPDATE', roomId: room.id, payload: room });
          this.pushRoomList();
        }
        break;
      }

      case 'ROOM_JOIN': {
        const joinPayload = (msg.payload || {}) as {
          roomId?: string;
          player?: PlayerInfo;
        };
        const roomId = msg.roomId || joinPayload.roomId;
        if (!roomId) {
          this.send(ws, { type: 'ERROR', error: 'Room not found' });
          break;
        }
        const room = this.roomManager.getRoom(roomId);
        if (!room) {
          this.send(ws, { type: 'ERROR', error: 'Room not found' });
          break;
        }
        // 加入其他房间前先脱离旧房，避免幽灵未准备席位
        if (session.roomId && session.roomId !== roomId) {
          this.detachSessionFromCurrentRoom(session);
        }
        // 进房携带的最新专精优先写入 session（用户可能刚切专精）
        const incoming = joinPayload.player;
        if (incoming && (!incoming.id || incoming.id === session.playerId)) {
          if (incoming.spec) session.spec = incoming.spec;
          if (incoming.classId) session.classId = String(incoming.classId);
          if (incoming.role) session.role = incoming.role;
          if (incoming.name) session.playerName = incoming.name;
        }
        if (room.members.some((m) => m.id === session.playerId)) {
          session.roomId = room.id;
          // 已在房内：仅刷新专精/职业展示（席位职责不随切专精改动）
          const member = room.members.find((m) => m.id === session.playerId);
          if (member && !member.isAi) {
            member.spec = session.spec;
            member.classId = session.classId as any;
            this.pushRoomUpdate(room);
          } else {
            this.send(ws, { type: 'ROOM_UPDATE', roomId: room.id, payload: room });
          }
          break;
        }

        const join = this.roomManager.joinOrHotSwapPlayer(roomId, {
          id: session.playerId,
          name: session.playerName,
          classId: session.classId as any,
          spec: session.spec,
          role: session.role as any,
        });
        if (!join.ok || !join.room) {
          // Role mismatch / no same-role seat: reject — do not auto-switch role or force queue entry
          this.send(ws, {
            type: 'ERROR',
            error: join.reason || '无法加入房间',
          });
          break;
        }

        session.roomId = room.id;
        this.roomManager.normalizeAiReady(room.id);
        this.pushRoomUpdate(this.roomManager.getRoom(room.id) || join.room);
        if (join.replacedAiId) {
          const member = join.room.members.find((m) => m.id === session.playerId);
          const unitSnapshot = member
            ? this.combatSessions.get(room.id)?.hotSwapHuman(join.replacedAiId, member)
            : undefined;
          // Mid-combat / AI-filled: server swaps combat unit & broadcasts snapshot
          this.broadcastRoom(room.id, {
            type: 'MEMBER_HOT_SWAP',
            roomId: room.id,
            timeMs: Date.now(),
            payload: {
              roomId: room.id,
              room: join.room,
              playerId: session.playerId,
              replacedAiId: join.replacedAiId,
              playerName: session.playerName,
              classId: session.classId,
              spec: session.spec,
              role: session.role,
              ...(unitSnapshot ? { unitSnapshot } : {}),
            },
          });
        }
        break;
      }

      case 'ROOM_LEAVE': {
        if (!session.roomId) break;
        const leftRoomId = session.roomId;
        session.roomId = null;
        this.removeOrReplacePlayerFromRoom(leftRoomId, session.playerId, 'empty', {
          autoFillInLobby: true,
        });
        break;
      }

      case 'ROOM_CLOSED': {
        // Host requests leave/destroy: transfer to next human player when possible unless wipe_finish/explicit destroy
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const room = this.roomManager.getRoom(roomId);
        if (!room) break;
        if (room.hostId !== session.playerId) {
          this.send(ws, { type: 'ERROR', error: 'Host only' });
          break;
        }
        const reason = (msg.payload as any)?.reason || 'destroyed';
        const hasOtherHuman = room.members.some(
          (m) => m.id !== session.playerId && m.isPlayer && !m.isAi
        );
        session.roomId = null;
        if (reason === 'host_left' && hasOtherHuman) {
          this.removeOrReplacePlayerFromRoom(roomId, session.playerId, reason, {
            autoFillInLobby: true,
          });
          break;
        }
        const inRun = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
        const forceSummary = inRun || reason === 'host_left';
        this.destroyRoomAndNotify(roomId, reason, forceSummary);
        break;
      }

      case 'ROOM_ACTION': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const room = this.roomManager.getRoom(roomId);
        if (!room) break;
        const action = msg.payload as RoomActionPayload;
        if (room.hostId !== session.playerId && action.action !== 'SET_READY') {
          this.send(ws, { type: 'ERROR', error: 'Host only' });
          break;
        }
        switch (action.action) {
          case 'AUTO_FILL_AI':
            this.roomManager.autoFillAi(roomId, {
              replaceExistingAi: !!action.replaceExistingAi,
            });
            break;
          case 'ADD_AI':
            if (action.role) this.roomManager.addAiMember(roomId, action.role);
            break;
          case 'KICK':
            if (action.memberId) {
              const targetId = action.memberId;
              const isTargetInRoom = room.members.some((m) => m.id === targetId);
              if (!isTargetInRoom || targetId === room.hostId) break;
              const rawSess = this.sessionsByPlayer.get(targetId);
              const targetSess = rawSess?.roomId === roomId ? rawSess : undefined;
              const inRun =
                room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
              if (targetSess) {
                targetSess.roomId = null;
                this.send(targetSess.ws, {
                  type: 'ROOM_CLOSED',
                  roomId,
                  timeMs: Date.now(),
                  payload: {
                    roomId,
                    reason: 'kicked',
                    forceSummary: false,
                  },
                });
              }
              if (inRun) {
                // Mid-run: AI takeover instead of empty seat (keep WS logged in)
                const replaced = this.roomManager.replaceHumanWithAi(roomId, targetId);
                if (replaced.ok && replaced.room) {
                  this.broadcastRoom(roomId, {
                    type: 'MEMBER_REPLACE_AI',
                    roomId,
                    timeMs: Date.now(),
                    payload: {
                      roomId,
                      playerId: targetId,
                      aiMemberId: replaced.aiMemberId,
                      room: replaced.room,
                    },
                  });
                  this.pushRoomUpdate(replaced.room);
                }
                break;
              }
              this.roomManager.kickMember(roomId, targetId);
            }
            break;
          case 'SET_READY':
            this.roomManager.setPlayerReady(roomId, session.playerId, !!action.ready);
            break;
          case 'SET_DIFFICULTY':
            if (action.difficulty) {
              this.roomManager.setRoomDifficulty(roomId, action.difficulty, action.customDifficulty);
            }
            break;
          case 'CHANGE_SPEC':
            if (action.memberId && action.spec && action.classId) {
              // Lobby allows free rearrange; start-game validation enforces quotas
              this.roomManager.changeMemberSpec(roomId, action.memberId, action.classId, action.spec, {
                allowOverQuota: true,
              });
            }
            break;
          case 'SWITCH_MAP':
            if (action.dungeonId) this.roomManager.switchMap(roomId, action.dungeonId);
            break;
        }
        const updated = this.roomManager.getRoom(roomId);
        if (updated) this.pushRoomUpdate(updated);
        break;
      }

      case 'ROOM_START': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const start = this.roomManager.startGame(roomId, session.playerId);
        const room = this.roomManager.getRoom(roomId);
        if (!start.success) {
          this.send(ws, {
            type: 'ERROR',
            error: start.reason || 'Cannot start',
            payload: start,
          });
          break;
        }
        if (room) {
          this.createCombatSession(room);
          this.pushRoomUpdate(room);
        }
        this.broadcastRoom(roomId, {
          type: 'ROOM_START',
          roomId,
          timeMs: Date.now(),
          payload: room,
        });
        break;
      }

      case 'ROOM_CHAT': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const room = this.roomManager.getRoom(roomId);
        if (!room) break;
        const member = room.members.find((m) => m.id === session.playerId && !m.isAi);
        if (!member && session.roomId !== roomId) break;
        if (!session.roomId && member) session.roomId = roomId;
        const payload = msg.payload as RoomChatSendPayload | undefined;
        const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, 200) : '';
        if (!text) break;

        const now = Date.now();
        const isBoss = payload?.senderKind === 'BOSS';
        if (isBoss) {
          // Only authoritative host can broadcast Boss yells
          if (room.hostId !== session.playerId) break;
          const bossMsg: RoomChatMessage = {
            id: `chat_${now}_${Math.random().toString(36).slice(2, 7)}`,
            roomId,
            senderId: payload?.senderId || 'boss',
            senderName: payload?.senderName || '首领',
            senderKind: 'BOSS',
            text,
            atMs: now,
          };
          this.broadcastRoom(roomId, {
            type: 'ROOM_CHAT',
            roomId,
            timeMs: now,
            payload: bossMsg,
          });
          break;
        }

        const chatMsg: RoomChatMessage = {
          id: `chat_${now}_${Math.random().toString(36).slice(2, 7)}`,
          roomId,
          senderId: session.playerId,
          senderName: member?.name || session.playerName || session.username,
          senderKind: 'PLAYER',
          classId: (member?.classId || session.classId) as RoomChatMessage['classId'],
          text,
          atMs: now,
        };
        this.broadcastRoom(roomId, {
          type: 'ROOM_CHAT',
          roomId,
          timeMs: now,
          payload: chatMsg,
        });
        break;
      }

      case 'VOTE_START': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const body = msg.payload as VoteStartPayload | { kind?: NetworkVoteKind };
        const kind = (body as VoteStartPayload)?.vote?.kind || (body as any)?.kind;
        if (kind === 'SKIP_TRAVEL') {
          // 与 REQUEST_SKIP_TRAVEL 一致：发起者默认 YES
          this.startVote(roomId, kind, {
            initiatorId: session.playerId,
            initiatorChoice: 'YES',
          });
        } else if (kind === 'WIPE') {
          this.startVote(roomId, kind);
        }
        break;
      }

      case 'VOTE_CAST': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        // Drop unjoined / cross-room spoofing
        if (session.roomId !== roomId) break;
        const body = msg.payload as VoteCastPayload;
        if (!body?.kind || !body.choice) break;
        const humans = this.humanIdsInRoom(roomId);
        const fromPayload =
          typeof body.playerId === 'string' && body.playerId ? body.playerId : '';
        // Prefer session; allow payload id when it matches a seated human (AUTH character id)
        const voterId =
          (humans.includes(session.playerId) ? session.playerId : '') ||
          (fromPayload && humans.includes(fromPayload) ? fromPayload : '') ||
          session.playerId;
        // Guest wipe UI can open from COMBAT_STATE phase before VOTE_START arrives —
        // ensure a tally exists so the first click is not silently dropped.
        if (body.kind === 'WIPE' && !this.votes.get(roomId, 'WIPE')) {
          this.startVote(roomId, 'WIPE');
        }
        if (body.kind === 'SKIP_TRAVEL' && !this.votes.get(roomId, 'SKIP_TRAVEL')) {
          this.startVote(roomId, 'SKIP_TRAVEL', {
            initiatorId: voterId,
            initiatorChoice: body.choice === 'YES' || body.choice === 'NO' ? body.choice : undefined,
          });
          // startVote already recorded initiatorChoice when provided
          if (body.choice === 'YES' || body.choice === 'NO') break;
        }
        this.applyVoteCast(roomId, body.kind, voterId, body.choice);
        break;
      }

      case 'PLAYER_INPUT': {
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        if (session.roomId !== msg.roomId) break;
        const input = msg.payload as PlayerInputPayload;
        if (input?.kind === 'REQUEST_SKIP_TRAVEL') {
          // 发起跳过行军：点跳过的人直接算同意（优先 payload.playerId，回退 session）
          const fromPayload =
            typeof input.playerId === 'string' && input.playerId ? input.playerId : '';
          const humans = this.humanIdsInRoom(msg.roomId);
          const initiatorId =
            (fromPayload && humans.includes(fromPayload) ? fromPayload : '') ||
            (humans.includes(session.playerId) ? session.playerId : '') ||
            fromPayload ||
            session.playerId;
          this.startVote(msg.roomId, 'SKIP_TRAVEL', {
            initiatorId,
            initiatorChoice: 'YES',
          });
          break;
        }
        if (input?.kind === 'SKIP_TRAVEL_VOTE' && input.skipTravelVote) {
          this.applyVoteCast(msg.roomId, 'SKIP_TRAVEL', session.playerId, input.skipTravelVote);
          break;
        }
        if (input?.kind === 'WIPE_VOTE' && input.wipeVote) {
          if (!this.votes.get(msg.roomId, 'WIPE')) {
            this.startVote(msg.roomId, 'WIPE');
          }
          this.applyVoteCast(msg.roomId, 'WIPE', session.playerId, input.wipeVote);
          break;
        }
        // Server idempotent input dedupe + immediate INPUT_ACK (RTT/RTO between player & server)
        const cs = this.combatSessions.get(msg.roomId);
        if (cs && input) {
          const { shouldApply, ack } = cs.handlePlayerInput(session.playerId, input);
          if (ack) {
            this.send(ws, {
              type: 'INPUT_ACK',
              roomId: msg.roomId,
              timeMs: Date.now(),
              payload: { acks: [ack], ackedInputIds: [ack.clientInputId] },
            });
          }
          if (!shouldApply) break;
        }
        // Relay cast/move/etc to peers
        this.broadcastRoom(msg.roomId, msg, session.playerId);
        break;
      }

      case 'COMBAT_EFFECT': {
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        if (session.roomId !== msg.roomId) break;
        const effect = msg.payload as CombatEffect;
        const cs = this.combatSessions.get(msg.roomId);
        if (cs && effect) {
          const { ack } = cs.handleCombatEffect(effect);
          if (ack) {
            this.send(ws, {
              type: 'INPUT_ACK',
              roomId: msg.roomId,
              timeMs: Date.now(),
              payload: { acks: [ack], ackedInputIds: [ack.clientInputId] },
            });
          }
        }
        this.broadcastRoom(msg.roomId, msg, session.playerId);
        break;
      }

      case 'OWNER_SNAPSHOT': {
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        if (session.roomId !== msg.roomId) break;
        const snap = msg.payload as OwnerSnapshot;
        if (snap) {
          this.combatSessions.get(msg.roomId)?.handleOwnerSnapshot(snap);
        }
        this.broadcastRoom(msg.roomId, msg, session.playerId);
        break;
      }

      case 'COMBAT_BATCH': {
        // Host → all: fan-out gathered effects (original effectIds preserved)
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        if (session.roomId !== msg.roomId) break;
        const room = this.roomManager.getRoom(msg.roomId);
        if (!room || room.hostId !== session.playerId) break;
        this.broadcastRoom(msg.roomId, msg, session.playerId);
        break;
      }

      case 'GM_COMMAND': {
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId || session.roomId !== msg.roomId) break;
        const gmRoom = this.roomManager.getRoom(msg.roomId);
        if (!gmRoom) break;
        const combatSession = this.combatSessions.get(msg.roomId);
        if (combatSession && msg.payload) {
          combatSession.handleGmCommand(msg.payload as any);
        }
        this.broadcastRoom(msg.roomId, {
          type: 'GM_COMMAND',
          roomId: msg.roomId,
          timeMs: Date.now(),
          payload: msg.payload,
        });
        break;
      }

      case 'COMBAT_STATE':
      case 'MEMBER_HOT_SWAP':
      case 'CAST_INTERRUPT':
      case 'INPUT_ACK': {
        // Relay only within room; combat tick stays on host client
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        // Drop unjoined / cross-room spoofing (session must belong to this room)
        if (session.roomId !== msg.roomId) break;
        const hostCheckRoom = this.roomManager.getRoom(msg.roomId);
        if (
          msg.type !== 'CAST_INTERRUPT' &&
          (!hostCheckRoom || hostCheckRoom.hostId !== session.playerId)
        ) {
          break;
        }

        if (msg.type === 'COMBAT_STATE') {
          const snap = msg.payload as any;
          // Prefer applyHostCombatSnapshot (engine dist must be rebuilt). Fallback keeps
          // broadcast alive even if an old RoomManager build is loaded.
          let updated: LobbyRoom | undefined;
          const rm = this.roomManager as RoomManager & {
            applyHostCombatSnapshot?: RoomManager['applyHostCombatSnapshot'];
            updateCombatBossState?: RoomManager['updateCombatBossState'];
            getRoom?: RoomManager['getRoom'];
          };
          if (typeof rm.applyHostCombatSnapshot === 'function') {
            updated = rm.applyHostCombatSnapshot(msg.roomId, {
              runPhase: snap?.runPhase,
              travelRemainingMs: snap?.travelRemainingMs,
              currentBossIndex: snap?.currentBossIndex,
              isCleared: snap?.isCleared,
              units: snap?.units,
            });
          } else {
            const boss =
              (snap?.units || []).find((u: any) => u?.isBoss) ||
              (snap?.units || []).find((u: any) => u?.role === 'ENEMY' || u?.role === 'BOSS');
            if (boss && typeof boss.hp === 'number' && typeof boss.maxHp === 'number') {
              rm.updateCombatBossState?.(
                msg.roomId,
                boss.name || 'Boss',
                boss.hp,
                boss.maxHp,
                boss.id
              );
            }
            updated = rm.getRoom?.(msg.roomId);
            console.warn(
              '[RoomWs] applyHostCombatSnapshot missing — rebuild packages/engine (npm run build --workspace=packages/engine)'
            );
          }
          // Auto-start wipe vote when host first reports WIPE_VOTE phase
          if (snap?.runPhase === 'WIPE_VOTE' && !this.votes.get(msg.roomId, 'WIPE')) {
            this.startVote(msg.roomId, 'WIPE');
          }
          // Clear votes by phase — never wipe SKIP_TRAVEL during TRAVEL_RECOVERY:
          // host COMBAT_STATE ticks every frame while marching; clearing here
          // dropped in-flight skip votes so guest YES never reached majority.
          if (snap?.runPhase === 'SUMMARY') {
            this.votes.clearRoom(msg.roomId);
          } else if (snap?.runPhase === 'TRAVEL_RECOVERY') {
            this.votes.clear(msg.roomId, 'WIPE');
          } else if (snap?.runPhase === 'BOSS_COMBAT' || snap?.runPhase === 'WIPE_VOTE') {
            this.votes.clear(msg.roomId, 'SKIP_TRAVEL');
          }
          // Push room meta for queue/list: always on phase change; throttle HP otherwise (~1Hz)
          if (updated) {
            const prev = this.lastCombatMetaPush.get(msg.roomId);
            const now = Date.now();
            const phaseChanged = !!snap?.runPhase && snap.runPhase !== prev?.phase;
            const dueHp = !prev || now - prev.atMs >= 1000;
            if (phaseChanged || dueHp || snap?.runPhase === 'SUMMARY') {
              this.lastCombatMetaPush.set(msg.roomId, { phase: snap?.runPhase, atMs: now });
              this.pushRoomUpdate(updated);
            }
          }
        }

        this.broadcastRoom(msg.roomId, msg, session.playerId);
        break;
      }

      default:
        break;
    }
  }

  private onDisconnect(ws: WebSocket) {
    const session = this.sessionsByWs.get(ws);
    if (!session) return; // 可能已被心跳超时收尾
    this.sessionsByWs.delete(ws);

    // 短暂等待重连；超时后与心跳超时同一套房间清理
    if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
    session.disconnectTimer = setTimeout(() => {
      const current = this.sessionsByPlayer.get(session.playerId);
      if (!current || current.ws !== ws) return; // 已用新 socket 重连
      this.finalizeGoneSession(current, 'disconnect');
    }, DISCONNECT_AI_MS);
  }
}
