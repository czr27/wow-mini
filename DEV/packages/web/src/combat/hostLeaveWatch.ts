/** Guest: leave room if host signals gone, or silence exceeds this window. */
export const HOST_GONE_TIMEOUT_MS = 10_000;

/** Host-side packets that prove the room/host sim is still alive for this guest. */
export const HOST_ALIVE_MESSAGE_TYPES = new Set([
  'COMBAT_STATE',
  'COMBAT_BATCH',
  'COMBAT_EFFECT',
  'ROOM_UPDATE',
  'ROOM_START',
  'VOTE_STATE',
  'VOTE_RESULT',
  'VOTE_START',
  'MEMBER_REPLACE_AI',
  'MEMBER_HOT_SWAP',
  'INPUT_ACK',
]);

export function isHostAliveSignal(
  type: string,
  opts?: { roomId?: string | null; activeRoomId?: string | null }
): boolean {
  if (!HOST_ALIVE_MESSAGE_TYPES.has(type)) return false;
  const active = opts?.activeRoomId;
  const msgRoom = opts?.roomId;
  if (active && msgRoom && msgRoom !== active) return false;
  return true;
}

/** True when guest should bail: in active combat/travel run and host silent too long. */
export function shouldGuestLeaveOnHostSilence(opts: {
  isNetworkGuest: boolean;
  activeRoomId: string | null | undefined;
  runPhase?: string | null;
  lastHostSignalMs: number;
  nowMs: number;
  timeoutMs?: number;
}): boolean {
  if (!opts.isNetworkGuest || !opts.activeRoomId) return false;
  if (opts.runPhase === 'LOBBY' || opts.runPhase === 'SUMMARY') return false;
  if (!opts.lastHostSignalMs || opts.lastHostSignalMs <= 0) return false;
  const timeout = opts.timeoutMs ?? HOST_GONE_TIMEOUT_MS;
  return opts.nowMs - opts.lastHostSignalMs >= timeout;
}
