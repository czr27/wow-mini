/**
 * Host tracks each human authority's presence:
 * - Soft-wait for first OWNER_SNAPSHOT after combat start (timeout → fight anyway)
 * - Any combat packet refreshes lastSeen
 * - Silence > AUTHORITY_SILENCE_KICK_MS → kick offline
 * - Hot-join seats are tracked for kick only — never block the whole raid
 */
import type { LobbyRoom } from '@cata-raid-sim/engine';

export const AUTHORITY_SILENCE_KICK_MS = 10_000;
/** Max time host pauses combat waiting for guests' first OWNER_SNAPSHOT */
export const AUTHORITY_INITIAL_WAIT_MS = 5_000;

export type AuthorityPresenceEntry = {
  playerId: string;
  trackedAtMs: number;
  lastAnyMs: number;
  initialReceived: boolean;
  kickRequested: boolean;
  /** Only seats present at ROOM_START gate combat; hot-join does not */
  blocksCombatStart: boolean;
};

const entries = new Map<string, AuthorityPresenceEntry>();
let epochActive = false;

function humanGuestIds(room: LobbyRoom | null | undefined, hostId: string | null): string[] {
  if (!room?.members?.length || !hostId) return [];
  return room.members
    .filter((m) => !m.isAi && m.id !== hostId)
    .map((m) => m.id);
}

/** Call on ROOM_START / combat epoch — reset wait for every human guest. */
export function beginAuthorityPresenceEpoch(
  room: LobbyRoom | null | undefined,
  hostId: string | null,
  nowMs = Date.now()
): void {
  entries.clear();
  epochActive = true;
  for (const id of humanGuestIds(room, hostId)) {
    entries.set(id, {
      playerId: id,
      trackedAtMs: nowMs,
      lastAnyMs: nowMs,
      initialReceived: false,
      kickRequested: false,
      blocksCombatStart: true,
    });
  }
}

export function endAuthorityPresenceEpoch(): void {
  entries.clear();
  epochActive = false;
}

export function noteAuthorityPacket(
  playerId: string,
  kind: 'OWNER_SNAPSHOT' | 'COMBAT_EFFECT' | 'PLAYER_INPUT',
  nowMs = Date.now()
): void {
  if (!epochActive || !playerId) return;
  const e = entries.get(playerId);
  if (!e) return;
  e.lastAnyMs = nowMs;
  if (kind === 'OWNER_SNAPSHOT') e.initialReceived = true;
}

/** Hot-join mid-run: track for silence kick only — do not freeze the raid. */
export function trackAuthoritySeat(playerId: string, nowMs = Date.now()): void {
  if (!epochActive || !playerId) return;
  if (entries.has(playerId)) return;
  entries.set(playerId, {
    playerId,
    trackedAtMs: nowMs,
    lastAnyMs: nowMs,
    initialReceived: false,
    kickRequested: false,
    blocksCombatStart: false,
  });
}

/**
 * True when combat may proceed:
 * - no blocking seats, or
 * - each blocking seat has initial OWNER_SNAPSHOT, or
 * - initial wait window elapsed (then silence kick handles AFK).
 */
export function allAuthoritiesInitialReady(
  room?: LobbyRoom | null,
  hostId?: string | null,
  nowMs = Date.now()
): boolean {
  if (!epochActive) return true;
  const ids =
    room && hostId != null ? humanGuestIds(room, hostId) : [...entries.keys()];
  if (ids.length === 0) return true;
  for (const id of ids) {
    const e = entries.get(id);
    if (!e?.blocksCombatStart) continue;
    if (e.initialReceived) continue;
    if (nowMs - e.trackedAtMs < AUTHORITY_INITIAL_WAIT_MS) return false;
  }
  return true;
}

export function listAuthoritiesPendingInitial(): string[] {
  return [...entries.values()]
    .filter((e) => e.blocksCombatStart && !e.initialReceived)
    .map((e) => e.playerId);
}

export function takeAuthoritySilenceKicks(nowMs = Date.now()): string[] {
  if (!epochActive) return [];
  const out: string[] = [];
  for (const e of entries.values()) {
    if (e.kickRequested) continue;
    if (nowMs - e.lastAnyMs < AUTHORITY_SILENCE_KICK_MS) continue;
    e.kickRequested = true;
    out.push(e.playerId);
  }
  return out;
}

export function clearAuthorityPresence(playerId: string): void {
  entries.delete(playerId);
}

/** True while host still tracks this human seat (packets flowing / not cleared). */
export function isTrackedAuthority(playerId: string): boolean {
  return epochActive && entries.has(playerId);
}

export function __authorityPresenceDebug() {
  return { epochActive, entries: [...entries.values()] };
}
