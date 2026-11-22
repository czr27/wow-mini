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

  private humanIdsInRoom(roomId: string): string[] {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return [];
    return room.members.filter((m) => m.isPlayer && !m.isAi).map((m) => m.id);
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

      // Reconnect: cancel pending AI replace
      const existing = this.sessionsByPlayer.get(auth.playerId);
      if (existing?.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = undefined;
      }
      if (existing && existing.ws !== ws) {
        try {
          existing.ws.close();
        } catch {}
        this.sessionsByWs.delete(existing.ws);
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
        // Place into first matching empty slot
        const role =
          (session.role as any) ||
          room.slots.find((s) => !s.occupied)?.role ||
          'DPS';
        let slot = room.slots.find((s) => !s.occupied && s.role === role);
        if (!slot) slot = room.slots.find((s) => !s.occupied);
        if (!slot) {
          this.roomManager.joinWaitingQueue(roomId, {
            id: session.playerId,
            name: session.playerName,
            classId: session.classId as any,
            spec: session.spec,
            role,
          });
          session.roomId = room.id;
          this.pushRoomUpdate(room);
          break;
        }
        const member = {
          id: session.playerId,
          name: session.playerName,
          classId: session.classId as any,
          spec: session.spec,
          role: slot.role,
          isPlayer: true,
          isAi: false,
          isHost: false,
          isReady: false,
          slotIndex: slot.index,
        };
        slot.occupied = true;
        slot.member = member;
        room.members.push(member);
        session.roomId = room.id;
        this.pushRoomUpdate(room);
        break;
      }

      case 'ROOM_LEAVE': {
        if (!session.roomId) break;
        const result = this.roomManager.leaveRoom(session.roomId, session.playerId);
        const leftRoomId = session.roomId;
        session.roomId = null;
        if (result.roomDeleted) {
          this.pushRoomList();
        } else {
          const room = this.roomManager.getRoom(leftRoomId);
          if (room) {
            if (result.newHostId) {
              this.broadcastRoom(leftRoomId, {
                type: 'HOST_TRANSFER',
                roomId: leftRoomId,
                payload: { newHostId: result.newHostId, room },
              });
            }
            this.pushRoomUpdate(room);
          } else {
            this.pushRoomList();
          }
        }
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
              this.roomManager.changeMemberSpec(roomId, action.memberId, action.classId, action.spec);
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
        // Auto-start wipe vote when host first reports WIPE_VOTE phase
        if (msg.type === 'COMBAT_STATE' && (msg.payload as any)?.runPhase === 'WIPE_VOTE') {
          if (!this.votes.get(msg.roomId, 'WIPE')) {
            this.startVote(msg.roomId, 'WIPE');
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

        if (room.status === 'LOBBY') {
          const result = this.roomManager.leaveRoom(current.roomId, session.playerId);
          if (result.roomDeleted) {
            this.pushRoomList();
          } else {
            const updated = this.roomManager.getRoom(current.roomId);
            if (updated) {
              if (result.newHostId) {
                this.broadcastRoom(current.roomId, {
                  type: 'HOST_TRANSFER',
                  roomId: current.roomId,
                  payload: { newHostId: result.newHostId, room: updated },
                });
              }
              this.pushRoomUpdate(updated);
            }
          }
        } else {
          // In combat / out of combat: replace with AI and notify host + room
          const replaced = this.roomManager.replaceHumanWithAi(current.roomId, session.playerId);
          if (replaced.roomDeleted) {
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
            if (replaced.newHostId) {
              this.broadcastRoom(current.roomId, {
                type: 'HOST_TRANSFER',
                roomId: current.roomId,
                payload: { newHostId: replaced.newHostId, room: replaced.room },
              });
            }
            this.pushRoomUpdate(replaced.room);
          }
        }
      }
    }, DISCONNECT_AI_MS);
  }
}
