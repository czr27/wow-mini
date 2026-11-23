import type { WebSocket } from 'ws';
import {
  RoomManager,
  decodeNetMessage,
  encodeNetMessage,
  type AuthPayload,
  type LobbyRoom,
  type NetEnvelope,
  type NetworkVoteKind,
  type PlayerInfo,
  type PlayerInputPayload,
  type RoomActionPayload,
  type RoomCreatePayload,
  type VoteCastPayload,
  type VoteStartPayload,
} from '@cata-raid-sim/engine';
import { RoomVoteTracker } from './roomVotes.js';

const DISCONNECT_AI_MS = 5000;

interface ClientSession {
  ws: WebSocket;
  playerId: string;
  username: string;
  playerName: string;
  classId: string;
  spec: string;
  role?: string;
  roomId: string | null;
  lastPongMs: number;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

export class RoomWsHub {
  readonly roomManager = new RoomManager();
  readonly votes = new RoomVoteTracker();
  private sessionsByPlayer = new Map<string, ClientSession>();
  private sessionsByWs = new Map<WebSocket, ClientSession>();
  /** Per-room throttle for host combat → lobby list sync (rooms stay isolated). */
  private lastCombatMetaPush = new Map<string, { phase?: string; atMs: number }>();

  private humanIdsInRoom(roomId: string): string[] {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return [];
    return room.members.filter((m) => m.isPlayer && !m.isAi).map((m) => m.id);
  }

  /** Destroy room and notify all clients. Mid-run host leave sets forceSummary for guests. */
  private destroyRoomAndNotify(roomId: string, reason: string, forceSummary: boolean) {
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

  private startVote(roomId: string, kind: NetworkVoteKind) {
    const eligible = this.humanIdsInRoom(roomId);
    if (eligible.length === 0) return null;
    const existing = this.votes.get(roomId, kind);
    if (existing && !existing.resolved) return existing;

    const state = this.votes.start(roomId, kind, eligible, (result, finalState) => {
      this.broadcastRoom(roomId, {
        type: 'VOTE_RESULT',
        roomId,
        timeMs: Date.now(),
        payload: { kind, result, vote: finalState },
      });
    });
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
    const outcome = this.votes.cast(roomId, kind, playerId, choice);
    if (!outcome) return;
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
    for (const session of this.sessionsByPlayer.values()) {
      if (session.roomId === roomId && session.playerId !== exceptPlayerId) {
        this.send(session.ws, msg);
      }
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

  private onMessage(ws: WebSocket, msg: NetEnvelope) {
    if (msg.type === 'PING') {
      this.send(ws, { type: 'PONG', timeMs: Date.now() });
      const session = this.sessionsByWs.get(ws);
      if (session) session.lastPongMs = Date.now();
      return;
    }

    if (msg.type === 'AUTH') {
      const auth = msg.payload as AuthPayload;
      if (!auth?.playerId || !auth?.username) {
        this.send(ws, { type: 'AUTH_FAIL', error: 'Missing playerId/username' });
        return;
      }

      // Allow one PC / multiple browsers / multiple accounts concurrently.
      // Only replace an existing socket for the *same character (playerId)* —
      // never kick other accounts or other characters of the same account.
      const existing = this.sessionsByPlayer.get(auth.playerId);
      if (existing && existing.ws !== ws) {
        if (existing.disconnectTimer) {
          clearTimeout(existing.disconnectTimer);
          existing.disconnectTimer = undefined;
        }
        try {
          this.send(existing.ws, {
            type: 'SESSION_KICKED',
            timeMs: Date.now(),
            payload: {
              reason: '同一角色已在其他窗口重连',
              username: auth.username,
              playerId: auth.playerId,
            },
          });
          existing.ws.close();
        } catch {}
        this.sessionsByWs.delete(existing.ws);
      } else if (existing?.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = undefined;
      }

      const session: ClientSession = {
        ws,
        playerId: auth.playerId,
        username: auth.username,
        playerName: auth.playerName || auth.username,
        classId: auth.classId,
        spec: auth.spec,
        role: auth.role,
        roomId: existing?.roomId ?? null,
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
        const body = msg.payload as RoomCreatePayload;
        const host: PlayerInfo = body.host || {
          id: session.playerId,
          name: session.playerName,
          classId: session.classId as any,
          spec: session.spec,
          role: session.role as any,
        };
        host.id = session.playerId;
        const room = this.roomManager.createRoom({
          name: body.name || `${session.playerName}的队伍`,
          dungeonId: body.dungeonId,
          difficulty: body.difficulty,
          customDifficulty: body.customDifficulty,
          host,
        });
        session.roomId = room.id;
        this.send(ws, { type: 'ROOM_UPDATE', roomId: room.id, payload: room });
        this.pushRoomList();
        break;
      }

      case 'ROOM_JOIN': {
        const roomId = msg.roomId || (msg.payload as any)?.roomId;
        const room = this.roomManager.getRoom(roomId);
        if (!room) {
          this.send(ws, { type: 'ERROR', error: 'Room not found' });
          break;
        }
        if (room.members.some((m) => m.id === session.playerId)) {
          session.roomId = room.id;
          this.send(ws, { type: 'ROOM_UPDATE', roomId: room.id, payload: room });
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
          // Fall back to waiting queue if humans not full but no AI to replace
          const humans = this.roomManager.countHumanPlayers(roomId);
          const quota = this.roomManager.getQuota(room.dungeonId);
          if (humans < quota.capacity) {
            this.roomManager.joinWaitingQueue(roomId, {
              id: session.playerId,
              name: session.playerName,
              classId: session.classId as any,
              spec: session.spec,
              role: (session.role as any) || 'DPS',
            });
            session.roomId = room.id;
            this.pushRoomUpdate(this.roomManager.getRoom(roomId)!);
          } else {
            this.send(ws, { type: 'ERROR', error: join.reason || '玩家人数已满' });
          }
          break;
        }

        session.roomId = room.id;
        this.pushRoomUpdate(join.room);
        if (join.replacedAiId) {
          // Mid-combat / AI-filled: notify host to inherit combat unit; AI disappears after swap
          this.broadcastRoom(room.id, {
            type: 'MEMBER_HOT_SWAP',
            roomId: room.id,
            timeMs: Date.now(),
            payload: {
              roomId: room.id,
              room: join.room,
              playerId: session.playerId,
              replacedAiId: join.replacedAiId,
            },
          });
        }
        break;
      }

      case 'ROOM_LEAVE': {
        if (!session.roomId) break;
        const leftRoomId = session.roomId;
        const room = this.roomManager.getRoom(leftRoomId);
        if (!room) {
          session.roomId = null;
          break;
        }
        const isHost = room.hostId === session.playerId;
        const inRun = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
        session.roomId = null;

        // Host leave / return lobby mid-run → destroy room; remaining players settle
        if (isHost) {
          this.destroyRoomAndNotify(leftRoomId, 'host_left', inRun);
          break;
        }

        // Non-host mid-run: AI takes over their slot so the dungeon continues
        if (inRun) {
          const replaced = this.roomManager.replaceHumanWithAi(leftRoomId, session.playerId);
          if (replaced.roomDeleted) {
            this.destroyRoomAndNotify(leftRoomId, 'empty', false);
            break;
          }
          if (replaced.ok && replaced.room) {
            this.broadcastRoom(leftRoomId, {
              type: 'MEMBER_REPLACE_AI',
              roomId: leftRoomId,
              timeMs: Date.now(),
              payload: {
                roomId: leftRoomId,
                playerId: session.playerId,
                aiMemberId: replaced.aiMemberId,
                room: replaced.room,
              },
            });
            this.pushRoomUpdate(replaced.room);
          }
          break;
        }

        // Lobby leave: remove seat
        const result = this.roomManager.leaveRoom(leftRoomId, session.playerId);
        if (result.roomDeleted) {
          this.destroyRoomAndNotify(leftRoomId, result.destroyedByHost ? 'host_left' : 'empty', false);
        } else {
          const updated = this.roomManager.getRoom(leftRoomId);
          if (updated) this.pushRoomUpdate(updated);
          else this.pushRoomList();
        }
        break;
      }

      case 'ROOM_CLOSED': {
        // Host requests destroy (return lobby / wipe FINISH)
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const room = this.roomManager.getRoom(roomId);
        if (!room) break;
        if (room.hostId !== session.playerId) {
          this.send(ws, { type: 'ERROR', error: 'Host only' });
          break;
        }
        const reason = (msg.payload as any)?.reason || 'destroyed';
        const inRun = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
        const forceSummary = inRun || reason === 'host_left';
        session.roomId = null;
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
            this.roomManager.autoFillAi(roomId);
            break;
          case 'ADD_AI':
            if (action.role) this.roomManager.addAiMember(roomId, action.role);
            break;
          case 'KICK':
            if (action.memberId) this.roomManager.kickMember(roomId, action.memberId);
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
        if (room) this.pushRoomUpdate(room);
        this.broadcastRoom(roomId, {
          type: 'ROOM_START',
          roomId,
          timeMs: Date.now(),
          payload: room,
        });
        break;
      }

      case 'VOTE_START': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const body = msg.payload as VoteStartPayload | { kind?: NetworkVoteKind };
        const kind = (body as VoteStartPayload)?.vote?.kind || (body as any)?.kind;
        if (kind === 'WIPE' || kind === 'SKIP_TRAVEL') {
          this.startVote(roomId, kind);
        }
        break;
      }

      case 'VOTE_CAST': {
        const roomId = msg.roomId || session.roomId;
        if (!roomId) break;
        const body = msg.payload as VoteCastPayload;
        if (!body?.kind || !body.choice) break;
        this.applyVoteCast(roomId, body.kind, session.playerId, body.choice);
        break;
      }

      case 'PLAYER_INPUT': {
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        if (session.roomId && session.roomId !== msg.roomId) break;
        const input = msg.payload as PlayerInputPayload;
        if (input?.kind === 'REQUEST_SKIP_TRAVEL') {
          this.startVote(msg.roomId, 'SKIP_TRAVEL');
          // auto-count requester as YES
          this.applyVoteCast(msg.roomId, 'SKIP_TRAVEL', session.playerId, 'YES');
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
        // Relay cast/move/etc to host and peers
        this.broadcastRoom(msg.roomId, msg, session.playerId);
        break;
      }

      case 'COMBAT_STATE':
      case 'MEMBER_HOT_SWAP':
      case 'CAST_INTERRUPT': {
        // Relay only within room; combat tick stays on host client
        if (!msg.roomId && session.roomId) msg.roomId = session.roomId;
        if (!msg.roomId) break;
        // Drop cross-room spoofing (session must belong to this room)
        if (session.roomId && session.roomId !== msg.roomId) break;

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
          // Clear votes when leaving wipe / settling
          if (snap?.runPhase === 'SUMMARY' || snap?.runPhase === 'TRAVEL_RECOVERY') {
            this.votes.clearRoom(msg.roomId);
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
    if (!session) return;
    this.sessionsByWs.delete(ws);

    // Keep presence entry briefly for reconnect; schedule AI replace if still in room
    session.disconnectTimer = setTimeout(() => {
      const current = this.sessionsByPlayer.get(session.playerId);
      if (!current || current.ws !== ws) return; // reconnected on new socket

      this.sessionsByPlayer.delete(session.playerId);
      this.broadcastAll({ type: 'PRESENCE', timeMs: Date.now(), payload: this.presencePayload() });

      if (current.roomId) {
        this.votes.clearRoom(current.roomId);
        const room = this.roomManager.getRoom(current.roomId);
        if (!room) return;

        // Host disconnect / leave always destroys the room; mid-run guests settle
        if (room.hostId === session.playerId) {
          const inRun = room.status === 'IN_COMBAT' || room.status === 'OUT_OF_COMBAT';
          this.destroyRoomAndNotify(current.roomId, 'host_left', inRun);
          return;
        }

        if (room.status === 'LOBBY') {
          const result = this.roomManager.leaveRoom(current.roomId, session.playerId);
          if (result.roomDeleted) {
            this.broadcastAll({
              type: 'ROOM_CLOSED',
              roomId: current.roomId,
              timeMs: Date.now(),
              payload: { roomId: current.roomId, reason: 'empty' },
            });
            this.pushRoomList();
          } else {
            const updated = this.roomManager.getRoom(current.roomId);
            if (updated) this.pushRoomUpdate(updated);
          }
        } else {
          // Non-host disconnect mid-run: replace with AI
          const replaced = this.roomManager.replaceHumanWithAi(current.roomId, session.playerId);
          if (replaced.roomDeleted) {
            this.broadcastAll({
              type: 'ROOM_CLOSED',
              roomId: current.roomId,
              timeMs: Date.now(),
              payload: { roomId: current.roomId, reason: 'empty' },
            });
            this.pushRoomList();
            return;
          }
          if (replaced.ok && replaced.room) {
            this.broadcastRoom(current.roomId, {
              type: 'MEMBER_REPLACE_AI',
              roomId: current.roomId,
              timeMs: Date.now(),
              payload: {
                roomId: current.roomId,
                playerId: session.playerId,
                aiMemberId: replaced.aiMemberId,
                room: replaced.room,
              },
            });
            this.pushRoomUpdate(replaced.room);
          }
        }
      }
    }, DISCONNECT_AI_MS);
  }
}
