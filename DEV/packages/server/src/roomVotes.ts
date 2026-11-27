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
 * Wipe: majority RETRY/FINISH; all voted with tie => FINISH (结算);
 * incomplete 15s timeout => RETRY (AFK continue).
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

  /**
   * V2 投票鲁棒性：玩家在投票期间掉线/离房。
   * - 若已投票：保留其投票结果，不改分母；
   * - 若有资格但未投票：将其从 eligiblePlayerIds 移除，动态重算分母并检查是否立刻达标结算。
   */
  onPlayerDropped(
    roomId: string,
    playerId: string
  ): Array<{ kind: NetworkVoteKind; state: NetworkVoteState; earlyResult?: string }> {
    const updates: Array<{ kind: NetworkVoteKind; state: NetworkVoteState; earlyResult?: string }> = [];
    for (const kind of ['WIPE', 'SKIP_TRAVEL'] as NetworkVoteKind[]) {
      const k = this.key(roomId, kind);
      const cur = this.votes.get(k);
      if (!cur || cur.state.resolved) continue;
      if (!cur.state.eligiblePlayerIds.includes(playerId)) continue;
      // 已投过票的不受影响
      if (cur.state.votes[playerId]) continue;

      cur.state.eligiblePlayerIds = cur.state.eligiblePlayerIds.filter((id) => id !== playerId);
      const snapshot = (): NetworkVoteState => ({
        ...cur.state,
        votes: { ...cur.state.votes },
        eligiblePlayerIds: [...cur.state.eligiblePlayerIds],
      });

      const n = cur.state.eligiblePlayerIds.length;
      if (n <= 0) {
        if (cur.timer) clearTimeout(cur.timer);
        cur.state.resolved = true;
        cur.state.result = kind === 'SKIP_TRAVEL' ? 'NO' : 'FINISH';
        const state = snapshot();
        this.votes.delete(k);
        updates.push({ kind, state, earlyResult: cur.state.result });
        continue;
      }

      if (kind === 'SKIP_TRAVEL') {
        if (hasMajorityYes(cur.state.eligiblePlayerIds, cur.state.votes, 'YES')) {
          cur.state.resolved = true;
          cur.state.result = 'YES';
          if (cur.timer) clearTimeout(cur.timer);
          const state = snapshot();
          this.votes.delete(k);
          updates.push({ kind, state, earlyResult: 'YES' });
        } else {
          const allVoted = cur.state.eligiblePlayerIds.every((id) => !!cur.state.votes[id]);
          if (allVoted) {
            cur.state.resolved = true;
            cur.state.result = 'NO';
            if (cur.timer) clearTimeout(cur.timer);
            const state = snapshot();
            this.votes.delete(k);
            updates.push({ kind, state, earlyResult: 'NO' });
          } else {
            updates.push({ kind, state: snapshot() });
          }
        }
      } else {
        const retry = cur.state.eligiblePlayerIds.filter((id) => cur.state.votes[id] === 'RETRY').length;
        const finish = cur.state.eligiblePlayerIds.filter((id) => cur.state.votes[id] === 'FINISH').length;
        const allVoted = cur.state.eligiblePlayerIds.every((id) => !!cur.state.votes[id]);
        const majority = resolveWipeMajority(cur.state.eligiblePlayerIds, cur.state.votes) as WipeVoteChoice | null;
        const hasStrictMajority = retry > n / 2 || finish > n / 2;
        const early = hasStrictMajority && majority ? majority : allVoted ? majority || 'FINISH' : null;
        if (early) {
          cur.state.resolved = true;
          cur.state.result = early;
          if (cur.timer) clearTimeout(cur.timer);
          const state = snapshot();
          this.votes.delete(k);
          updates.push({ kind, state, earlyResult: early });
        } else {
          updates.push({ kind, state: snapshot() });
        }
      }
    }
    return updates;
  }

  /** Merge currently seated humans into an in-flight tally (hot-join / id drift). */
  ensureEligible(roomId: string, kind: NetworkVoteKind, playerIds: string[]) {
    const cur = this.votes.get(this.key(roomId, kind));
    if (!cur || cur.state.resolved) return;
    for (const id of playerIds) {
      if (id && !cur.state.eligiblePlayerIds.includes(id)) {
        cur.state.eligiblePlayerIds.push(id);
      }
    }
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

    const snapshot = (): NetworkVoteState => ({
      ...cur.state,
      votes: { ...cur.state.votes },
      eligiblePlayerIds: [...cur.state.eligiblePlayerIds],
    });

    if (kind === 'SKIP_TRAVEL') {
      // Strict majority: yes > eligible/2（半数以上）
      if (hasMajorityYes(cur.state.eligiblePlayerIds, cur.state.votes, 'YES')) {
        cur.state.resolved = true;
        cur.state.result = 'YES';
        if (cur.timer) clearTimeout(cur.timer);
        const state = snapshot();
        this.votes.delete(this.key(roomId, kind));
        return { state, earlyResult: 'YES' };
      }
      // All eligible voted NO / mixed without majority YES → wait for timeout
      const allVoted = cur.state.eligiblePlayerIds.every((id) => cur.state.votes[id]);
      if (allVoted && !hasMajorityYes(cur.state.eligiblePlayerIds, cur.state.votes, 'YES')) {
        cur.state.resolved = true;
        cur.state.result = 'NO';
        if (cur.timer) clearTimeout(cur.timer);
        const state = snapshot();
        this.votes.delete(this.key(roomId, kind));
        return { state, earlyResult: 'NO' };
      }
    } else {
      const n = cur.state.eligiblePlayerIds.length;
      const retry = cur.state.eligiblePlayerIds.filter((id) => cur.state.votes[id] === 'RETRY').length;
      const finish = cur.state.eligiblePlayerIds.filter((id) => cur.state.votes[id] === 'FINISH').length;
      const allVoted = cur.state.eligiblePlayerIds.every((id) => !!cur.state.votes[id]);
      const majority = resolveWipeMajority(cur.state.eligiblePlayerIds, cur.state.votes) as WipeVoteChoice | null;
      // Strict majority (> half) can settle before everyone votes
      const hasStrictMajority = retry > n / 2 || finish > n / 2;
      // Everyone cast: settle now. 1同意+1结束 (tie) → FINISH 结算, never wait for timeout RETRY
      const early = hasStrictMajority && majority ? majority : allVoted ? majority || 'FINISH' : null;
      if (early) {
        cur.state.resolved = true;
        cur.state.result = early;
        if (cur.timer) clearTimeout(cur.timer);
        const state = snapshot();
        this.votes.delete(this.key(roomId, kind));
        return { state, earlyResult: early };
      }
    }

    return { state: snapshot() };
  }
}
