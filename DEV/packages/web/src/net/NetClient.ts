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

export type NetListener = (msg: NetEnvelope) => void;

function defaultWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  // Vite dev (3000): talk to game server WS on 3001 directly
  if (window.location.port === '3000' || window.location.port === '') {
    return `${proto}//${host}:3001`;
  }
  return `${proto}//${host}${window.location.port ? `:${window.location.port}` : ''}`;
}

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

  get connected() {
    return this._connected;
  }

  get rooms() {
    return this._rooms;
  }

  get onlinePlayerIds() {
    return this._onlinePlayerIds;
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

  connect(auth: AuthPayload, url = defaultWsUrl()) {
    this.auth = auth;
    this.intentionalClose = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.send({ type: 'AUTH', payload: auth });
      return;
    }
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.warn('[NetClient] WebSocket construct failed', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.send({ type: 'AUTH', payload: this.auth! });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'PING' }), 15000);
    };

    this.ws.onmessage = (ev) => {
      const msg = decodeNetMessage(String(ev.data));
      if (!msg) return;
      if (msg.type === 'ROOM_LIST_SYNC' && Array.isArray(msg.payload)) {
        this._rooms = msg.payload as LobbyRoom[];
      }
      if (msg.type === 'ROOM_UPDATE' && msg.payload) {
        const room = msg.payload as LobbyRoom;
        const idx = this._rooms.findIndex((r) => r.id === room.id);
        if (idx >= 0) this._rooms[idx] = room;
        else this._rooms = [...this._rooms, room];
      }
      if (msg.type === 'PRESENCE' && msg.payload && Array.isArray((msg.payload as any).onlinePlayerIds)) {
        this._onlinePlayerIds = (msg.payload as any).onlinePlayerIds;
      }
      this.emit(msg);
    };

    this.ws.onclose = () => {
      this._connected = false;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will handle reconnect
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  private scheduleReconnect() {
    if (this.intentionalClose || !this.auth) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.auth) this.connect(this.auth);
    }, 2000);
  }

  send(msg: NetEnvelope) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeNetMessage(msg));
  }

  requestRoomList() {
    this.send({ type: 'ROOM_LIST' });
  }

  createRoom(payload: RoomCreatePayload) {
    this.send({ type: 'ROOM_CREATE', payload });
  }

  joinRoom(roomId: string) {
    this.send({ type: 'ROOM_JOIN', roomId, payload: { roomId } });
  }

  leaveRoom(roomId?: string) {
    this.send({ type: 'ROOM_LEAVE', roomId });
  }

  roomAction(roomId: string, action: RoomActionPayload) {
    this.send({ type: 'ROOM_ACTION', roomId, payload: action });
  }

  startRoom(roomId: string) {
    this.send({ type: 'ROOM_START', roomId });
  }

  sendPlayerInput(roomId: string, payload: PlayerInputPayload) {
    this.send({ type: 'PLAYER_INPUT', roomId, payload });
  }

  sendCombatState(snapshot: Omit<NetworkCombatSnapshot, 'seq'> & { seq?: number }) {
    const seq = snapshot.seq ?? ++this.combatSeq;
    this.send({
      type: 'COMBAT_STATE',
      roomId: snapshot.roomId,
      seq,
      timeMs: snapshot.timeMs,
      payload: { ...snapshot, seq },
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
      payload: { kind, playerId: '', choice },
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
