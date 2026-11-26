import {
  decodeNetMessage,
  encodeNetMessage,
  type AuthPayload,
  type CombatBatch,
  type CombatEffect,
  type GmCommandPayload,
  type LobbyRoom,
  type NetEnvelope,
  type NetMessageType,
  type NetworkCombatSnapshot,
  type OwnerSnapshot,
  type PlayerInputPayload,
  type RoomActionPayload,
  type RoomChatSendPayload,
  type RoomCreatePayload,
} from '@cata-raid-sim/engine';

import { resolveGameWsUrl } from './apiBase.js';

export type NetListener = (msg: NetEnvelope) => void;

function defaultWsUrl(): string {
  return resolveGameWsUrl();
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

/**
 * 可靠意图策略（应用层，叠在 TCP/WS 上）：
 * - 共享一份 SRTT → rto = max(20, 2·srtt)，仅由带 attempt 的 INPUT_ACK 更新
 * - 每个 clientInputId 独立计时/翻倍重试；某一条超时不牵连其它意图（无全局退避）
 * - 超时/重传本身不抬 SRTT（避免把「没等到 ack」当成延迟样本）
 * - MOVE 等不带 id：fire-and-forget
 */
const RELIABLE_INPUT_KINDS = new Set<PlayerInputPayload['kind']>([
  'CAST',
  'GROUND_CAST',
  'SUMMON',
  'INTERRUPT',
  'DISPEL',
]);

const RELIABLE_RETRY_CAP_MS = 1000;
const RELIABLE_MAX_ATTEMPTS = 6;
const HOST_ACK_RING = 64;
const MIN_RTO_MS = 20;
const INITIAL_SRTT_MS = 40;
/** Jacobson EWMA weight for new RTT samples */
const SRTT_ALPHA = 1 / 8;

/** rto = max(min_rto, 2 * srtt); defaults → 80ms */
export function computeRtoMs(srttMs: number, minRtoMs = MIN_RTO_MS): number {
  return Math.max(minRtoMs, 2 * Math.max(0, srttMs));
}

/** EWMA: srtt ← (1-α)·srtt + α·rtt */
export function updateSrttMs(srttMs: number, rttSampleMs: number, alpha = SRTT_ALPHA): number {
  const sample = Math.max(0, rttSampleMs);
  return srttMs * (1 - alpha) + sample * alpha;
}

/**
 * Wait after `attempts` sends before next retry / give-up.
 * attempts=1 → rto; then doubles each time, capped at 1000ms.
 */
export function reliableRetryDelayMs(attempts: number, rtoMs: number): number {
  const n = Math.max(1, Math.floor(attempts));
  const base = Math.max(MIN_RTO_MS, rtoMs);
  const exp = Math.min(n - 1, 8);
  return Math.min(RELIABLE_RETRY_CAP_MS, base * 2 ** exp);
}

type PendingReliableInput = {
  roomId: string;
  payload: PlayerInputPayload;
  /** Last transmission wall clock (retry scheduling) */
  sentAtMs: number;
  /** attempt → wall clock when that transmission was sent */
  attemptSentAtMs: Map<number, number>;
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
  /**
   * Wall clock when this client entered the current dungeon/run.
   * Embedded in clientInputId so leave→rejoin cannot collide with host's
   * processed-id ring from the previous visit (same seq after reload).
   */
  private combatInputEpochMs = 0;
  /** Guest: awaiting host ackedInputIds */
  private pendingReliable = new Map<string, PendingReliableInput>();
  /** Guest smoothed RTT for RTO (ms); seed 40 → initial rto 80 */
  private srttMs = INITIAL_SRTT_MS;
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

  /**
   * Start a new cast-id epoch for this dungeon visit.
   * Call on ROOM_START / hot-join into combat so leave→rejoin presses are not
   * idempotent-ignored against the host's previous processed set.
   */
  beginCombatInputEpoch(epochMs?: number) {
    this.combatInputEpochMs = Math.max(1, epochMs ?? Date.now());
    this.clientInputSeq = 0;
    this.pendingReliable.clear();
  }

  getCombatInputEpochMs(): number {
    return this.combatInputEpochMs;
  }

  /**
   * Build unique reliable-intent id: player + epoch + seq + send time.
   * playerId namespaces guests so same-ms ROOM_START + same seq cannot collide
   * on the host's global processedGuestInputIds set.
   */
  nextClientInputId(nowMs = Date.now(), playerId?: string): string {
    if (!this.combatInputEpochMs) {
      this.combatInputEpochMs = Math.max(1, nowMs);
    }
    const who = String(playerId || this.auth?.playerId || 'anon')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 24) || 'anon';
    const epoch = this.combatInputEpochMs.toString(36);
    const seq = (++this.clientInputSeq).toString(36);
    const t = nowMs.toString(36);
    return `ci_${who}_${epoch}_${seq}_${t}`;
  }

  sendPlayerInput(roomId: string, payload: PlayerInputPayload) {
    let body = payload;
    if (RELIABLE_INPUT_KINDS.has(payload.kind)) {
      const clientInputId =
        payload.clientInputId || this.nextClientInputId(Date.now(), payload.playerId);
      const now = Date.now();
      const attempt = 1;
      body = { ...payload, clientInputId, clientInputAttempt: attempt };
      const attemptSentAtMs = new Map<number, number>([[attempt, now]]);
      this.pendingReliable.set(clientInputId, {
        roomId,
        payload: body,
        sentAtMs: now,
        attemptSentAtMs,
        attempts: attempt,
      });
    }
    this.send({ type: 'PLAYER_INPUT', roomId, payload: body });
  }

  sendGmCommand(roomId: string, payload: GmCommandPayload) {
    if (!roomId) return;
    this.send({
      type: 'GM_COMMAND',
      roomId,
      timeMs: Date.now(),
      payload,
    });
  }

  getSrttMs(): number {
    return this.srttMs;
  }

  getRtoMs(): number {
    return computeRtoMs(this.srttMs);
  }

  /** Host: ack the specific transmission (id + attempt) that was received */
  sendInputAck(
    roomId: string,
    acks: Array<{ clientInputId: string; attempt: number }>
  ) {
    const cleaned = acks.filter((a) => a?.clientInputId && a.attempt >= 1);
    if (!roomId || cleaned.length === 0) return;
    this.send({
      type: 'INPUT_ACK',
      roomId,
      timeMs: Date.now(),
      payload: {
        acks: cleaned,
        // backup for older guests / COMBAT_STATE-shaped handlers
        ackedInputIds: cleaned.map((a) => a.clientInputId),
      },
    });
  }

  /**
   * Guest: INPUT_ACK with attempt → RTT from that send's timestamp; clear pending.
   * COMBAT_STATE id-only backup → clear pending, no RTT (ambiguous which attempt).
   */
  ackReliableInputs(
    idsOrAcks:
      | string[]
      | Array<{ clientInputId: string; attempt: number }>
      | undefined
      | null
  ) {
    if (!idsOrAcks || idsOrAcks.length === 0) return;
    const now = Date.now();
    for (const entry of idsOrAcks) {
      if (typeof entry === 'string') {
        if (entry) this.pendingReliable.delete(entry);
        continue;
      }
      const id = entry.clientInputId;
      const attempt = entry.attempt;
      if (!id) continue;
      const pending = this.pendingReliable.get(id);
      if (pending) {
        const sentAt = pending.attemptSentAtMs.get(attempt);
        if (typeof sentAt === 'number') {
          this.srttMs = updateSrttMs(this.srttMs, now - sentAt);
        }
        this.pendingReliable.delete(id);
      }
    }
  }

  /**
   * Guest: per-intent RTO retry (independent schedules).
   * Shared rto is only a delay estimate — timing out one id does not pause or
   * inflate waits for other pending ids (no app-level global backoff).
   */
  flushReliableInputRetries() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.pendingReliable.size === 0) return;
    const now = Date.now();
    const rto = this.getRtoMs();
    for (const [id, pending] of [...this.pendingReliable.entries()]) {
      const waitMs = reliableRetryDelayMs(pending.attempts, rto);
      if (now - pending.sentAtMs < waitMs) continue;
      if (pending.attempts >= RELIABLE_MAX_ATTEMPTS) {
        this.pendingReliable.delete(id);
        continue;
      }
      // Retransmit only this id; do not touch srttMs / other pendings.
      const attempt = pending.attempts + 1;
      pending.attempts = attempt;
      pending.sentAtMs = now;
      pending.attemptSentAtMs.set(attempt, now);
      const payload: PlayerInputPayload = {
        ...pending.payload,
        clientInputId: id,
        clientInputAttempt: attempt,
      };
      pending.payload = payload;
      this.send({ type: 'PLAYER_INPUT', roomId: pending.roomId, payload });
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

  /** Guest/host → host gather: single effect (reliable via clientInputId when set). */
  sendCombatEffect(roomId: string, effect: CombatEffect) {
    this.send({
      type: 'COMBAT_EFFECT',
      roomId,
      timeMs: effect.atMs ?? Date.now(),
      payload: effect,
    });
  }

  /** Authority owner → host gather: unit/pets/CD slice (~200ms). */
  sendOwnerSnapshot(roomId: string, snap: OwnerSnapshot) {
    this.send({
      type: 'OWNER_SNAPSHOT',
      roomId,
      timeMs: snap.timeMs,
      payload: snap,
    });
  }

  /** Host → all: gathered effects + snapshots (preserve original effectIds). */
  sendCombatBatch(batch: Omit<CombatBatch, 'seq'> & { seq?: number }) {
    const seq = batch.seq ?? ++this.combatSeq;
    this.send({
      type: 'COMBAT_BATCH',
      roomId: batch.roomId,
      seq,
      timeMs: batch.timeMs,
      payload: { ...batch, seq },
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

  sendRoomChat(roomId: string, payload: RoomChatSendPayload) {
    this.send({
      type: 'ROOM_CHAT',
      roomId,
      timeMs: Date.now(),
      payload,
    });
  }
}

export const netClient = new NetClient();

export type { NetMessageType, LobbyRoom, NetworkCombatSnapshot };
