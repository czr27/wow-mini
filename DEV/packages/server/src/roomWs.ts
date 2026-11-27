import type { WebSocket } from 'ws';
import {
  ReliableChannel,
  RoomManager,
  decodeNetMessage,
  encodeNetMessage,
  getRoleBySpec,
  type AuthPayload,
  type CombatEffect,
  type LobbyRoom,
  type NetEnvelope,
  type NetworkCombatSnapshot,
  type NetworkVoteKind,
  type OwnerSnapshot,
  type PlayerInfo,
  type PlayerInputPayload,
  type PurgePayload,
  type ResendExpiredPayload,
  type ResendReqPayload,
  type RoomActionPayload,
  type RoomChatMessage,
  type RoomChatSendPayload,
  type RoomCreatePayload,
  type SummarySettlePayload,
  type VoteCastPayload,
  type VoteStartPayload,
} from '@cata-raid-sim/engine';
import { RoomCombatSession } from './RoomCombatSession.js';
import { RoomVoteTracker } from './roomVotes.js';

/** WebSocket 断开后短暂等待重连，再踢出/改 AI */
const DISCONNECT_AI_MS = 5000;
/** V2 阶梯心跳探测：15s+容忍度起每 3s 催促；30s+容忍度起每 1s 催促；45s 超时踢出 */
const HEARTBEAT_PROBE_SLOW_MS = 15_500;
const HEARTBEAT_PROBE_SLOW_INTERVAL_MS = 3_000;
const HEARTBEAT_PROBE_FAST_MS = 30_500;
const HEARTBEAT_PROBE_FAST_INTERVAL_MS = 1_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
/** 心跳扫描周期（1s 以支撑 30s~45s 的每秒催促探测） */
const HEARTBEAT_SWEEP_MS = 1_000;
/** 结算未应答最长重传时间（5s） */
const SUMMARY_SETTLE_RETRY_MS = 1_000;
const SUMMARY_SETTLE_MAX_MS = 5_000;

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
  /** 最近一次发出 PING_PROBE 催促的时间 */
  lastProbeMs?: number;
  /** V2 双向可靠序列号与 50 包缓存 */
  reliable: ReliableChannel;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

interface SummarySettleTracker {
  roomId: string;
  payload: SummarySettlePayload;
  pendingPlayerIds: Set<string>;
  startedAtMs: number;
  timer: ReturnType<typeof setInterval>;
}

export class RoomWsHub {
  readonly roomManager = new RoomManager();
  readonly votes = new RoomVoteTracker();
  private sessionsByPlayer = new Map<string, ClientSession>();
  private sessionsByWs = new Map<WebSocket, ClientSession>();
  private kickedSockets = new WeakSet<WebSocket>();
  private combatSessions = new Map<string, RoomCombatSession>();
  /** V2 同意热加入后等待新玩家上报初始快照的映射：playerId -> { roomId, replacedAiId } */
  private pendingHotJoins = new Map<string, { roomId: string; replacedAiId: string }>();
  /** V2 结算全员 ACK 跟踪：收齐即刻销毁，未答最多重传 5s */
  private summarySettleTrackers = new Map<string, SummarySettleTracker>();
  /** Per-room throttle for host combat → lobby list sync (rooms stay isolated). */
  private lastCombatMetaPush = new Map<string, { phase?: string; atMs: number }>();
  private summaryRetentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
    for (const t of this.summaryRetentionTimers.values()) {
      clearTimeout(t);
    }
    this.summaryRetentionTimers.clear();
    for (const st of this.summarySettleTrackers.values()) {
      clearInterval(st.timer);
    }
    this.summarySettleTrackers.clear();
    this.pendingHotJoins.clear();
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
        // V2 结算流：下发 SUMMARY_SETTLE，全员 SUMMARY_ACK 后即刻销毁房间；未应答最多重传 5s 后销毁
        if (this.summarySettleTrackers.has(rid)) return;
        const r = this.roomManager.getRoom(rid);
        const csRef = this.combatSessions.get(rid);
        if (!r || !csRef) return;
        const humans = this.humanIdsInRoom(rid);
        const payload: SummarySettlePayload = {
          roomId: rid,
          cleared: !!csRef.rsm.isCleared,
          totalDurationSec: Math.round(csRef.rsm.totalRunDurationSec),
          encounterReports: csRef.rsm.encounterReports || [],
        };
        const pendingPlayerIds = new Set(humans);
        const sendSettleToPending = () => {
          for (const pid of pendingPlayerIds) {
            const s = this.sessionsByPlayer.get(pid);
            if (s) {
              this.send(s.ws, {
                type: 'SUMMARY_SETTLE',
                roomId: rid,
                timeMs: Date.now(),
                payload,
              });
            }
          }
        };
        sendSettleToPending();
        if (pendingPlayerIds.size === 0) {
          const reason = r.status === 'CLEARED' ? 'cleared_summary' : 'wipe_finish';
          this.destroyRoomAndNotify(rid, reason, true);
          return;
        }
        const startedAtMs = Date.now();
        const timer = setInterval(() => {
          const tracker = this.summarySettleTrackers.get(rid);
          if (!tracker) return;
          if (
            tracker.pendingPlayerIds.size === 0 ||
            Date.now() - tracker.startedAtMs >= SUMMARY_SETTLE_MAX_MS
          ) {
            clearInterval(tracker.timer);
            this.summarySettleTrackers.delete(rid);
            const cur = this.roomManager.getRoom(rid);
            if (cur) {
              const reason = cur.status === 'CLEARED' ? 'cleared_summary' : 'wipe_finish';
              this.destroyRoomAndNotify(rid, reason, true);
            }
            return;
          }
          sendSettleToPending();
        }, SUMMARY_SETTLE_RETRY_MS);
        if (typeof (timer as any).unref === 'function') {
          (timer as any).unref();
        }
        this.summarySettleTrackers.set(rid, {
          roomId: rid,
          payload,
          pendingPlayerIds,
          startedAtMs,
          timer,
        });
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
    const sumTimer = this.summaryRetentionTimers.get(roomId);
    if (sumTimer) {
      clearTimeout(sumTimer);
      this.summaryRetentionTimers.delete(roomId);
    }
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

  private isHighFreqMsg(msg: NetEnvelope): boolean {
    if (msg.type === 'PING' || msg.type === 'PONG' || msg.type === 'PING_PROBE') return true;
    if (msg.type === 'PLAYER_INPUT') {
      const p = msg.payload as PlayerInputPayload | undefined;
      if (p?.kind === 'MOVE') return true;
    }
    return false;
  }

  private send(ws: WebSocket, msg: NetEnvelope) {
    if (ws.readyState !== ws.OPEN) return;
    const session = this.sessionsByWs.get(ws);
    if (session && msg.type !== 'RESEND_REQ' && msg.type !== 'RESEND_EXPIRED') {
      const out = this.isHighFreqMsg(msg)
        ? session.reliable.attachPiggybackAck(msg)
        : session.reliable.stampOutgoing(msg);
      ws.send(encodeNetMessage(out));
      return;
    }
    ws.send(encodeNetMessage(msg));
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
        // V2 离场独立可靠 PURGE 包：向所有剩余在线成员发送，防丢包导致残留
        const purgePayload: PurgePayload = { roomId, ownerId: playerId, reason };
        this.broadcastRoom(roomId, {
          type: 'PURGE',
          roomId,
          timeMs: Date.now(),
          payload: purgePayload,
        });
        if (replaced.newHostId) {
          this.broadcastRoom(roomId, {
            type: 'HOST_TRANSFER',
            roomId,
            timeMs: Date.now(),
            payload: { newHostId: replaced.newHostId, room: replaced.room },
          });
        }
        // V2 投票鲁棒性：未投票且有资格者掉线时动态重算分母
        for (const vu of this.votes.onPlayerDropped(roomId, playerId)) {
          this.broadcastRoom(roomId, {
            type: 'VOTE_STATE',
            roomId,
            timeMs: Date.now(),
            payload: vu.state,
          });
          if (vu.earlyResult) {
            this.broadcastRoom(roomId, {
              type: 'VOTE_RESULT',
              roomId,
              timeMs: Date.now(),
              payload: { kind: vu.kind, result: vu.earlyResult, vote: vu.state },
            });
            this.handleVoteResolved(roomId, vu.kind, vu.earlyResult);
          }
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

  /** V2 阶梯心跳扫描：15s+每3s催促、30s+每1s催促、45s超时踢出，并清掉房主已不在线的幽灵房间 */
  private sweepHeartbeatsAndOrphanRooms() {
    const now = Date.now();

    for (const session of [...this.sessionsByPlayer.values()]) {
      if (session.disconnectTimer) continue; // 已在断线宽限期内
      const elapsed = now - session.lastPongMs;

      if (elapsed <= HEARTBEAT_PROBE_SLOW_MS) continue;

      if (elapsed <= HEARTBEAT_TIMEOUT_MS) {
        // 阶梯催促探测：15.5s~30.5s 每 3s 催一次；30.5s~45s 每 1s 催一次
        const interval =
          elapsed > HEARTBEAT_PROBE_FAST_MS
            ? HEARTBEAT_PROBE_FAST_INTERVAL_MS
            : HEARTBEAT_PROBE_SLOW_INTERVAL_MS;
        if (!session.lastProbeMs || now - session.lastProbeMs >= interval) {
          session.lastProbeMs = now;
          this.send(session.ws, {
            type: 'PING_PROBE',
            roomId: session.roomId || undefined,
            timeMs: now,
            payload: { elapsedMs: elapsed },
          });
        }
        continue;
      }

      this.kickedSockets.add(session.ws);
      try {
        if (session.roomId) {
          this.send(session.ws, {
            type: 'ROOM_KICKED',
            roomId: session.roomId,
            timeMs: now,
            payload: { reason: '心跳超时，已被移出房间', playerId: session.playerId },
          });
        }
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
      // 先收尾房间；短暂延迟再 close，确保踢出提示能弹出
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
    if (msg.type === 'PING') {
      // V2 幽灵重连防护：已被踢出房间的连接若直接发 PING，拒绝并再次踢出，须重新握手
      if (this.kickedSockets.has(ws) || !activeSession) {
        this.send(ws, {
          type: 'ROOM_KICKED',
          timeMs: Date.now(),
          payload: { reason: '连接已超时失效，请重新握手进入房间' },
        });
        try {
          ws.close();
        } catch {}
        return;
      }
      activeSession.lastPongMs = Date.now();
      activeSession.lastProbeMs = undefined;
      this.send(ws, { type: 'PONG', timeMs: Date.now() });
      return;
    }

    if (activeSession) {
      activeSession.lastPongMs = Date.now();
      activeSession.lastProbeMs = undefined;
      // V2 双向可靠通道处理
      if (msg.type === 'RESEND_REQ') {
        const body = msg.payload as ResendReqPayload | undefined;
        if (Array.isArray(body?.missingSeqs) && body.missingSeqs.length > 0) {
          const { found, expired } = activeSession.reliable.handleResendRequest(body.missingSeqs);
          for (const cached of found) {
            if (ws.readyState === ws.OPEN) ws.send(encodeNetMessage(cached));
          }
          if (expired.length > 0) {
            this.send(ws, {
              type: 'RESEND_EXPIRED',
              roomId: activeSession.roomId || undefined,
              timeMs: Date.now(),
              payload: { expiredSeqs: expired } satisfies ResendExpiredPayload,
            });
          }
        }
        return;
      }
      if (msg.type === 'RESEND_EXPIRED') {
        const body = msg.payload as ResendExpiredPayload | undefined;
        if (Array.isArray(body?.expiredSeqs)) {
          activeSession.reliable.onResendExpired(body.expiredSeqs);
        }
        return;
      }
      const incoming = activeSession.reliable.onIncoming(msg);
      if (incoming.missingSeqs.length > 0) {
        this.send(ws, {
          type: 'RESEND_REQ',
          roomId: activeSession.roomId || undefined,
          timeMs: Date.now(),
          payload: { missingSeqs: incoming.missingSeqs } satisfies ResendReqPayload,
        });
      }
      if (incoming.isDuplicate) return;
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
        // 同 socket 刷新 AUTH（如建房前 syncAuthSpec）必须复用原可靠通道，防止 reliableSeq 回退导致客户端误判重复丢包
        reliable: prevOnThisWs?.reliable ?? new ReliableChannel(),
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

      case 'HOT_JOIN_REQ': {
        // V2 热加入完整流：先校验有无同职责 AI 可替，无则直接拒绝不打扰战局
        const roomId = msg.roomId || (msg.payload as any)?.roomId;
        const room = roomId ? this.roomManager.getRoom(roomId) : undefined;
        if (!room || (room.status !== 'IN_COMBAT' && room.status !== 'OUT_OF_COMBAT')) {
          this.send(ws, {
            type: 'HOT_JOIN_DENY',
            roomId,
            timeMs: Date.now(),
            payload: { reason: '房间不存在或未在副本中' },
          });
          break;
        }
        const reqRole =
          (msg.payload as any)?.role ||
          session.role ||
          getRoleBySpec(session.classId as any, session.spec);
        const replaceableAi = room.members.find((m) => m.isAi && m.role === reqRole);
        if (!replaceableAi) {
          this.send(ws, {
            type: 'HOT_JOIN_DENY',
            roomId,
            timeMs: Date.now(),
            payload: { reason: `房间内没有可替代的 ${reqRole} AI 席位` },
          });
          break;
        }
        this.pendingHotJoins.set(session.playerId, { roomId, replacedAiId: replaceableAi.id });
        this.send(ws, {
          type: 'HOT_JOIN_ACCEPT',
          roomId,
          timeMs: Date.now(),
          payload: { roomId, replacedAiId: replaceableAi.id },
        });
        break;
      }

      case 'SUMMARY_ACK': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const tracker = this.summarySettleTrackers.get(roomId);
        if (!tracker) break;
        tracker.pendingPlayerIds.delete(session.playerId);
        if (tracker.pendingPlayerIds.size === 0) {
          clearInterval(tracker.timer);
          this.summarySettleTrackers.delete(roomId);
          const cur = this.roomManager.getRoom(roomId);
          if (cur) {
            const reason = cur.status === 'CLEARED' ? 'cleared_summary' : 'wipe_finish';
            this.destroyRoomAndNotify(roomId, reason, true);
          }
        }
        break;
      }

      case 'OWNER_SNAPSHOT': {
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        const pendingHj = this.pendingHotJoins.get(session.playerId);
        if (pendingHj && (!msg.roomId || msg.roomId === pendingHj.roomId)) {
          // V2 热加入者上报初始快照 → Server 融合并广播给全员与热加入者
          this.pendingHotJoins.delete(session.playerId);
          const hjRoom = this.roomManager.getRoom(pendingHj.roomId);
          const snap = msg.payload as OwnerSnapshot;
          if (hjRoom) {
            const pInfo: PlayerInfo = {
              id: session.playerId,
              name: session.playerName,
              classId: session.classId as any,
              spec: session.spec,
              role: (session.role || getRoleBySpec(session.classId as any, session.spec)) as any,
            };
            const joinRes = this.roomManager.joinOrHotSwapPlayer(pendingHj.roomId, pInfo);
            if (joinRes.ok && joinRes.room) {
              session.roomId = pendingHj.roomId;
              const member = joinRes.room.members.find((m) => m.id === session.playerId);
              const cs = this.combatSessions.get(pendingHj.roomId);
              let unitSnapshot = snap?.units?.find((u) => u.id === session.playerId);
              if (cs && member) {
                const inherited = cs.hotSwapHuman(pendingHj.replacedAiId, member);
                if (snap?.units?.length) cs.handleOwnerSnapshot(snap);
                unitSnapshot = unitSnapshot || inherited;
              }
              this.broadcastRoom(pendingHj.roomId, {
                type: 'MEMBER_HOT_SWAP',
                roomId: pendingHj.roomId,
                timeMs: Date.now(),
                payload: {
                  roomId: pendingHj.roomId,
                  room: joinRes.room,
                  playerId: session.playerId,
                  replacedAiId: pendingHj.replacedAiId,
                  playerName: session.playerName,
                  classId: session.classId,
                  spec: session.spec,
                  role: pInfo.role,
                  unitSnapshot,
                },
              });
              this.pushRoomUpdate(joinRes.room);
            }
          }
          break;
        }
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
        const now = Date.now();
        const rawGm = (msg.payload || {}) as any;
        // V2: 补齐唯一 id（防重传）与 senderId（防发出方回收自己广播重复消费）
        const gmPayload = {
          ...rawGm,
          id: rawGm.id || `gm_${session.playerId}_${now}_${Math.random().toString(36).slice(2, 6)}`,
          senderId: rawGm.senderId || session.playerId,
        };
        const combatSession = this.combatSessions.get(msg.roomId);
        if (combatSession) {
          combatSession.handleGmCommand(gmPayload);
        }
        this.broadcastRoom(msg.roomId, {
          type: 'GM_COMMAND',
          roomId: msg.roomId,
          timeMs: now,
          payload: gmPayload,
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
