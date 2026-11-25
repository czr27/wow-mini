import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_GONE_TIMEOUT_MS,
  isHostAliveSignal,
  shouldGuestLeaveOnHostSilence,
} from '../hostLeaveWatch.js';

describe('hostLeaveWatch', () => {
  it('recognizes host-alive combat/room packets for active room', () => {
    assert.equal(
      isHostAliveSignal('COMBAT_STATE', { roomId: 'r1', activeRoomId: 'r1' }),
      true
    );
    assert.equal(
      isHostAliveSignal('COMBAT_BATCH', { roomId: 'r1', activeRoomId: 'r1' }),
      true
    );
    assert.equal(
      isHostAliveSignal('COMBAT_STATE', { roomId: 'other', activeRoomId: 'r1' }),
      false
    );
    assert.equal(isHostAliveSignal('PING'), false);
  });

  it('guest leaves after 10s host silence while in room', () => {
    assert.equal(
      shouldGuestLeaveOnHostSilence({
        isNetworkGuest: true,
        activeRoomId: 'r1',
        lastHostSignalMs: 1_000,
        nowMs: 1_000 + HOST_GONE_TIMEOUT_MS,
      }),
      true
    );
    assert.equal(
      shouldGuestLeaveOnHostSilence({
        isNetworkGuest: true,
        activeRoomId: 'r1',
        lastHostSignalMs: 1_000,
        nowMs: 1_000 + HOST_GONE_TIMEOUT_MS - 1,
      }),
      false
    );
    assert.equal(
      shouldGuestLeaveOnHostSilence({
        isNetworkGuest: false,
        activeRoomId: 'r1',
        lastHostSignalMs: 1_000,
        nowMs: 1_000 + HOST_GONE_TIMEOUT_MS + 5_000,
      }),
      false,
      '房主自己不因该看门狗离房'
    );
    assert.equal(
      shouldGuestLeaveOnHostSilence({
        isNetworkGuest: true,
        activeRoomId: null,
        lastHostSignalMs: 1_000,
        nowMs: 1_000 + HOST_GONE_TIMEOUT_MS + 5_000,
      }),
      false
    );
  });
});
