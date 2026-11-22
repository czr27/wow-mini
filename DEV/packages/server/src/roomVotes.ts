import {
  hasMajorityYes,
  resolveWipeMajority,
  type NetworkVoteKind,
  type NetworkVoteState,
  type WipeVoteChoice,
} from '@cata-raid-sim/engine';

export interface ActiveRoomVote {
  state: NetworkVoteState;
  timer?: ReturnType<typeof setTimeout>;
}

const SKIP_TRAVEL_TIMEOUT_MS = 10_000;
const WIPE_VOTE_TIMEOUT_MS = 15_000;

/**
 * Server-side vote tallies for wipe retry and skip-travel.
 * Skip-travel: majority YES required; 10s timeout => disagree (NO).
 * Wipe: majority RETRY/FINISH among votes; 15s timeout => RETRY.
 */
export class RoomVoteTracker {
  private votes = new Map<string, ActiveRoomVote>();

  private key(roomId: string, kind: NetworkVoteKind) {
    return `${roomId}:${kind}`;
  }

  get(roomId: string, kind: NetworkVoteKind): NetworkVoteState | undefined {
    return this.votes.get(this.key(roomId, kind))?.state;
  }

  clear(roomId: string, kind: NetworkVoteKind) {
    const k = this.key(roomId, kind);
    const cur = this.votes.get(k);
    if (cur?.timer) clearTimeout(cur.timer);
    this.votes.delete(k);
  }

  clearRoom(roomId: string) {
    this.clear(roomId, 'WIPE');
    this.clear(roomId, 'SKIP_TRAVEL');
  }

  start(
    roomId: string,
    kind: NetworkVoteKind,
    eligiblePlayerIds: string[],
    onTimeout: (result: string, state: NetworkVoteState) => void
  ): NetworkVoteState {
    this.clear(roomId, kind);
    const timeoutMs = kind === 'SKIP_TRAVEL' ? SKIP_TRAVEL_TIMEOUT_MS : WIPE_VOTE_TIMEOUT_MS;
    const state: NetworkVoteState = {
      kind,
      roomId,
      startedAtMs: Date.now(),
      timeoutMs,
      votes: {},
      eligiblePlayerIds: [...eligiblePlayerIds],
      resolved: false,
      result: null,
    };

    const timer = setTimeout(() => {
      const cur = this.votes.get(this.key(roomId, kind));
      if (!cur || cur.state.resolved) return;
      let result: string;
      if (kind === 'SKIP_TRAVEL') {
        result = hasMajorityYes(cur.state.eligiblePlayerIds, cur.state.votes, 'YES') ? 'YES' : 'NO';
      } else {
        result = resolveWipeMajority(cur.state.eligiblePlayerIds, cur.state.votes) || 'RETRY';
      }
      cur.state.resolved = true;
      cur.state.result = result;
      onTimeout(result, cur.state);
      this.votes.delete(this.key(roomId, kind));
    }, timeoutMs);

    this.votes.set(this.key(roomId, kind), { state, timer });
    return state;
  }

  cast(
    roomId: string,
    kind: NetworkVoteKind,
    playerId: string,
    choice: string
  ): { state: NetworkVoteState; earlyResult?: string } | null {
    const cur = this.votes.get(this.key(roomId, kind));
    if (!cur || cur.state.resolved) return null;
    if (!cur.state.eligiblePlayerIds.includes(playerId)) return null;

    cur.state.votes[playerId] = choice;

    if (kind === 'SKIP_TRAVEL') {
      if (hasMajorityYes(cur.state.eligiblePlayerIds, cur.state.votes, 'YES')) {
        cur.state.resolved = true;
        cur.state.result = 'YES';
        if (cur.timer) clearTimeout(cur.timer);
        const state = { ...cur.state };
        this.votes.delete(this.key(roomId, kind));
        return { state, earlyResult: 'YES' };
      }
      // All eligible voted NO / mixed without majority YES → wait for timeout
      const allVoted = cur.state.eligiblePlayerIds.every((id) => cur.state.votes[id]);
      if (allVoted && !hasMajorityYes(cur.state.eligiblePlayerIds, cur.state.votes, 'YES')) {
        cur.state.resolved = true;
        cur.state.result = 'NO';
        if (cur.timer) clearTimeout(cur.timer);
        const state = { ...cur.state };
        this.votes.delete(this.key(roomId, kind));
        return { state, earlyResult: 'NO' };
      }
    } else {
      const majority = resolveWipeMajority(cur.state.eligiblePlayerIds, cur.state.votes) as WipeVoteChoice | null;
      const allVoted = cur.state.eligiblePlayerIds.every((id) => cur.state.votes[id]);
      if (majority && (allVoted || majority)) {
        // Resolve early once a strict majority exists
        const retry = cur.state.eligiblePlayerIds.filter((id) => cur.state.votes[id] === 'RETRY').length;
        const finish = cur.state.eligiblePlayerIds.filter((id) => cur.state.votes[id] === 'FINISH').length;
        if (retry > cur.state.eligiblePlayerIds.length / 2 || finish > cur.state.eligiblePlayerIds.length / 2) {
          cur.state.resolved = true;
          cur.state.result = majority;
          if (cur.timer) clearTimeout(cur.timer);
          const state = { ...cur.state };
          this.votes.delete(this.key(roomId, kind));
          return { state, earlyResult: majority };
        }
      }
    }

    return { state: cur.state };
  }
}
