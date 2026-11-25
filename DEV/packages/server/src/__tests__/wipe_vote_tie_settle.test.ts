/**
 * 2 humans: 1 RETRY + 1 FINISH must settle immediately as FINISH (结算),
 * not wait for timeout → forced RETRY.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RoomVoteTracker } from '../roomVotes.js';

describe('wipe vote all-voted tie', () => {
  it('1 RETRY + 1 FINISH settles early as FINISH', () => {
    const votes = new RoomVoteTracker();
    let timedOut: string | null = null;
    votes.start('room1', 'WIPE', ['host', 'guest'], (result) => {
      timedOut = result;
    });

    const first = votes.cast('room1', 'WIPE', 'host', 'RETRY');
    assert.ok(first);
    assert.equal(first!.earlyResult, undefined, '一人投票尚不结算');

    const second = votes.cast('room1', 'WIPE', 'guest', 'FINISH');
    assert.ok(second);
    assert.equal(second!.earlyResult, 'FINISH', '全员投完平票应立刻结算');
    assert.equal(votes.get('room1', 'WIPE'), undefined, '投票已清');
    assert.equal(timedOut, null, '不应再走到超时 RETRY');
  });

  it('2 RETRY settles early as RETRY', () => {
    const votes = new RoomVoteTracker();
    votes.start('room1', 'WIPE', ['a', 'b'], () => {});
    votes.cast('room1', 'WIPE', 'a', 'RETRY');
    const done = votes.cast('room1', 'WIPE', 'b', 'RETRY');
    assert.equal(done?.earlyResult, 'RETRY');
  });
});
