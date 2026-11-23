import {
  decodeNetMessage,
  encodeNetMessage,
  type AuthPayload,
  type LobbyRoom,
  type NetEnvelope,
  type NetMessageType,
  type NetworkCombatSnapshot,
  type PlayerInputPayload,
  type RoomActionPayload,
  type RoomCreatePayload,
} from '@cata-raid-sim/engine';

import { resolveGameWsUrl } from './apiBase.js';

export type NetListener = (msg: NetEnvelope) => void;

function defaultWsUrl(): string {
  return resolveGameWsUrl();
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

/** 技能类意图：丢了会重传；MOVE 等高频仍 fire-and-forget（靠后续 COMBAT_STATE 纠偏位置） */
const RELIABLE_INPUT_KINDS = new Set<PlayerInputPayload['kind']>([
  'CAST',
  'GROUND_CAST',
  'SUMMON',
  'INTERRUPT',
  'DISPEL',
]);

const RELIABLE_RETRY_MS = 280;
const RELIABLE_MAX_ATTEMPTS = 6;
const HOST_ACK_RING = 64;

type PendingReliableInput = {
  roomId: string;
  payload: PlayerInputPayload;
  sentAtMs: number;
  attempts: number;
};

export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<NetListener>();
  private auth: AuthPayload | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private _connected = false;
  private _rooms: LobbyRoom[] = [];
  private _onlinePlayerIds: string[] = [];
  private combatSeq = 0;
  private clientInputSeq = 0;
  /** Guest: awaiting host ackedInputIds */
  private pendingReliable = new Map<string, PendingReliableInput>();
  /** Host: idempotent apply + rolling ack window for guests */
  private processedGuestInputIds = new Set<string>();
  private processedGuestInputOrder: string[] = [];
  private hostAckRing: string[] = [];
  /** Bumps on each new socket so stale onclose handlers cannot flip UI to offline. */
  private socketGen = 0;
  /** Consecutive failed reconnect attempts — drives backoff delay. */
  private reconnectAttempt = 0;
  private lastWsUrl = defaultWsUrl();

  get connected() {
    return this._connected;
  }

  get rooms() {
    return this._rooms;
  }

  get onlinePlayerIds() {
    return this._onlinePlayerIds;
  }

  /** Optimistic lobby mirror (e.g. AI fill) before ROOM_UPDATE arrives. */
  replaceRoom(room: LobbyRoom) {
    const idx = this._rooms.findIndex((r) => r.id === room.id);
    if (idx >= 0) {
      const next = this._rooms.slice();
      next[idx] = room;
      this._rooms = next;
    } else {
      this._rooms = [...this._rooms, room];
    }
  }

  subscribe(listener: NetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(msg: NetEnvelope) {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch (err) {
        console.warn('[NetClient] listener error', err);
      }
    }
  }

  private detachSocket(ws: WebSocket | null) {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  }

  connect(auth: AuthPayload, url = defaultWsUrl()) {
    this.auth = auth;
    this.lastWsUrl = url || defaultWsUrl();
    this.intentionalClose = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Already attached — just refresh AUTH (e.g. character switch).
      this._connected = true;
      this.clearReconnectTimer();
      this.send({ type: 'AUTH', payload: auth });
      return;
    }

    // Stuck CONNECTING: abandon and open a fresh socket (server may be back).
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      this.detachSocket(this.ws);
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    // Abandon any closing/half-dead socket so its onclose cannot mark us offline later.
    if (this.ws) {
      this.detachSocket(this.ws);
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const gen = ++this.socketGen;
    try {
      this.ws = new WebSocket(this.lastWsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    const ws = this.ws;

    ws.onopen = () => {
      if (this.ws !== ws || gen !== this.socketGen) return;
      this._connected = true;
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();
      this.emit({ type: 'CONNECTED', timeMs: Date.now() });
      this.send({ type: 'AUTH', payload: this.auth! });
      if (this.pingTimer) clearInterval(this.pingTimer);
      // 服务端心跳超时约 40s；10s 一轮 PING 便于及时剔除掉线房主房间
      this.pingTimer = setInterval(() => this.send({ type: 'PING' }), 10_000);
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws || gen !== this.socketGen) return;
      const msg = decodeNetMessage(String(ev.data));
      if (!msg) return;
      if (msg.type === 'SESSION_KICKED') {
        // Stop auto-reconnect until user logs in again
        this.intentionalClose = true;
        this.auth = null;
        this.clearReconnectTimer();
      }
      if (msg.type === 'AUTH_OK') {
        this._connected = true;
        this.reconnectAttempt = 0;
        this.clearReconnectTimer();
      }
      if (msg.type === 'AUTH_FAIL') {
        this._connected = false;
        // Keep trying — server may reject briefly during restart
        this.scheduleReconnect();
      }
      if (msg.type === 'ROOM_LIST_SYNC' && Array.isArray(msg.payload)) {
        this._rooms = msg.payload as LobbyRoom[];
      }
      if (msg.type === 'ROOM_UPDATE' && msg.payload) {
        const room = msg.payload as LobbyRoom;
        const idx = this._rooms.findIndex((r) => r.id === room.id);
        if (idx >= 0) this._rooms[idx] = room;
        else this._rooms = [...this._rooms, room];
      }
      if (msg.type === 'ROOM_CLOSED' && msg.payload) {
        const closedId = (msg.payload as { roomId?: string }).roomId || msg.roomId;
        if (closedId) this._rooms = this._rooms.filter((r) => r.id !== closedId);
      }
      if (msg.type === 'PRESENCE' && msg.payload && Array.isArray((msg.payload as any).onlinePlayerIds)) {
        this._onlinePlayerIds = (msg.payload as any).onlinePlayerIds;
      }
      this.emit(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws || gen !== this.socketGen) return;
      const wasConnected = this._connected;
      this._connected = false;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.ws = null;
      if (wasConnected || !this.intentionalClose) {
        this.emit({ type: 'DISCONNECTED', timeMs: Date.now() });
      }
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will handle reconnect
    };
  }

  disconnect() {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    this._connected = false;
    this.socketGen++;
    this.reconnectAttempt = 0;
    this.detachSocket(ws);
    try {
      ws?.close();
    } catch {}
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Silent keep-alive: retry forever while logged in (until logout / session kick). */
  private scheduleReconnect() {
    if (this.intentionalClose || !this.auth) return;
    if (this.reconnectTimer) return; // already queued
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempt, 4)),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose || !this.auth) return;
      this.connect(this.auth, this.lastWsUrl);
    }, delay);
  }

  /** Ensure a live session after lobby return / room close (no-op if already up). */
  ensureConnected() {
    if (!this.auth) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._connected = true;
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();
      return;
    }
    this.intentionalClose = false;
    this.connect(this.auth, this.lastWsUrl);
  }

  send(msg: NetEnvelope) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeNetMessage(msg));
  }

  requestRoomList() {
    this.send({ type: 'ROOM_LIST' });
  }

  /** Update session profile (spec/role) on the open socket without reconnecting. */
  refreshAuthProfile(patch: Partial<AuthPayload>) {
    if (!this.auth) return;
    this.auth = { ...this.auth, ...patch };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'AUTH', payload: this.auth });
    }
  }

  createRoom(payload: RoomCreatePayload) {
    this.send({ type: 'ROOM_CREATE', payload });
  }

  joinRoom(
    roomId: string,
    player?: {
      id: string;
      name: string;
      classId: string;
      spec: string;
      role?: string;
    }
  ) {
    this.send({
      type: 'ROOM_JOIN',
      roomId,
      payload: player ? { roomId, player } : { roomId },
    });
  }

  leaveRoom(roomId?: string) {
    this.send({ type: 'ROOM_LEAVE', roomId });
  }

  /** Host destroys room for everyone (wipe finish / explicit close). */
  closeRoom(roomId: string, reason = 'destroyed') {
    this.send({ type: 'ROOM_CLOSED', roomId, payload: { roomId, reason } });
  }

  roomAction(roomId: string, action: RoomActionPayload) {
    this.send({ type: 'ROOM_ACTION', roomId, payload: action });
  }

  startRoom(roomId: string) {
    this.send({ type: 'ROOM_START', roomId });
  }

  sendPlayerInput(roomId: string, payload: PlayerInputPayload) {
    let body = payload;
    if (RELIABLE_INPUT_KINDS.has(payload.kind)) {
      const clientInputId =
        payload.clientInputId || `ci_${++this.clientInputSeq}_${Date.now().toString(36)}`;
      body = { ...payload, clientInputId };
      this.pendingReliable.set(clientInputId, {
        roomId,
        payload: body,
        sentAtMs: Date.now(),
        attempts: 1,
      });
    }
    this.send({ type: 'PLAYER_INPUT', roomId, payload: body });
  }

  /** Guest: host COMBAT_STATE 回传 ack 后停止重传 */
  ackReliableInputs(ids: string[] | undefined | null) {
    if (!ids || ids.length === 0) return;
    for (const id of ids) {
      if (id) this.pendingReliable.delete(id);
    }
  }

  /** Guest: 未 ack 的可靠意图按间隔重传（技能丢包可补；次数封顶） */
  flushReliableInputRetries() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.pendingReliable.size === 0) return;
    const now = Date.now();
    for (const [id, pending] of [...this.pendingReliable.entries()]) {
      if (now - pending.sentAtMs < RELIABLE_RETRY_MS) continue;
      if (pending.attempts >= RELIABLE_MAX_ATTEMPTS) {
        this.pendingReliable.delete(id);
        continue;
      }
      pending.attempts += 1;
      pending.sentAtMs = now;
      this.send({ type: 'PLAYER_INPUT', roomId: pending.roomId, payload: pending.payload });
    }
  }

  clearReliableInputs() {
    this.pendingReliable.clear();
  }

  /** Host: 同一 clientInputId 只结算一次；重复送达仍记 ack 供客人停重传 */
  shouldApplyGuestInput(clientInputId: string | undefined): boolean {
    if (!clientInputId) return true;
    if (this.processedGuestInputIds.has(clientInputId)) {
      this.noteHostInputAck(clientInputId);
      return false;
    }
    this.processedGuestInputIds.add(clientInputId);
    this.processedGuestInputOrder.push(clientInputId);
    while (this.processedGuestInputOrder.length > HOST_ACK_RING) {
      const old = this.processedGuestInputOrder.shift();
      if (old) this.processedGuestInputIds.delete(old);
    }
    this.noteHostInputAck(clientInputId);
    return true;
  }

  noteHostInputAck(clientInputId: string) {
    if (!clientInputId) return;
    this.hostAckRing.push(clientInputId);
    while (this.hostAckRing.length > HOST_ACK_RING) this.hostAckRing.shift();
  }

  peekHostInputAcks(): string[] {
    return this.hostAckRing.length ? this.hostAckRing.slice() : [];
  }

  clearHostInputAckState() {
    this.processedGuestInputIds.clear();
    this.processedGuestInputOrder = [];
    this.hostAckRing = [];
  }

  sendCombatState(snapshot: Omit<NetworkCombatSnapshot, 'seq'> & { seq?: number }) {
    const seq = snapshot.seq ?? ++this.combatSeq;
    const ackedInputIds =
      snapshot.ackedInputIds && snapshot.ackedInputIds.length > 0
        ? snapshot.ackedInputIds
        : this.peekHostInputAcks();
    this.send({
      type: 'COMBAT_STATE',
      roomId: snapshot.roomId,
      seq,
      timeMs: snapshot.timeMs,
      payload: {
        ...snapshot,
        seq,
        ...(ackedInputIds.length ? { ackedInputIds } : {}),
      },
    });
  }

  sendCastInterrupt(roomId: string, unitId: string, spellId?: string) {
    this.send({
      type: 'CAST_INTERRUPT',
      roomId,
      timeMs: Date.now(),
      payload: { unitId, spellId, atMs: Date.now() },
    });
  }

  sendHotSwap(roomId: string, payload: unknown) {
    this.send({ type: 'MEMBER_HOT_SWAP', roomId, timeMs: Date.now(), payload });
  }

  startVote(roomId: string, kind: 'WIPE' | 'SKIP_TRAVEL') {
    this.send({ type: 'VOTE_START', roomId, payload: { kind } });
  }

  castVote(roomId: string, kind: 'WIPE' | 'SKIP_TRAVEL', choice: string) {
    this.send({
      type: 'VOTE_CAST',
      roomId,
      payload: {
        kind,
        // Prefer authed character id so server eligibility matches room.members[].id
        playerId: this.auth?.playerId || '',
        choice,
      },
    });
  }

  requestSkipTravel(roomId: string, playerId: string) {
    this.sendPlayerInput(roomId, {
      kind: 'REQUEST_SKIP_TRAVEL',
      playerId,
    });
  }
}

export const netClient = new NetClient();

export type { NetMessageType, LobbyRoom, NetworkCombatSnapshot };
