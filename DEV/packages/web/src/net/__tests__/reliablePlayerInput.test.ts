/**
 * Guest reliable intents: ack / idempotent apply / retry bookkeeping
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NetClient } from '../NetClient.js';

describe('联机可靠意图与快照 ack', () => {
  it('1. 房主同一 clientInputId 只应用一次，重复仍可记 ack', () => {
    const net = new NetClient();
    assert.equal(net.shouldApplyGuestInput('ci_a'), true);
    assert.equal(net.shouldApplyGuestInput('ci_a'), false);
    assert.ok(net.peekHostInputAcks().includes('ci_a'));
  });

  it('2. 无 clientInputId 的 MOVE 类始终可应用', () => {
    const net = new NetClient();
    assert.equal(net.shouldApplyGuestInput(undefined), true);
    assert.equal(net.shouldApplyGuestInput(''), true);
  });

  it('3. ackReliableInputs 清除客人 pending', () => {
    const net = new NetClient();
    // 不连 WS 时 send 为空操作，但仍登记 pending
    (net as any).pendingReliable.set('ci_b', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', spellId: 'x', clientInputId: 'ci_b' },
      sentAtMs: Date.now(),
      attempts: 1,
    });
    assert.equal((net as any).pendingReliable.has('ci_b'), true);
    net.ackReliableInputs(['ci_b']);
    assert.equal((net as any).pendingReliable.has('ci_b'), false);
  });

  it('4. clear 重置房主/客人状态', () => {
    const net = new NetClient();
    net.shouldApplyGuestInput('ci_c');
    (net as any).pendingReliable.set('ci_d', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', clientInputId: 'ci_d' },
      sentAtMs: Date.now(),
      attempts: 1,
    });
    net.clearHostInputAckState();
    net.clearReliableInputs();
    assert.equal(net.peekHostInputAcks().length, 0);
    assert.equal((net as any).pendingReliable.size, 0);
    assert.equal(net.shouldApplyGuestInput('ci_c'), true, '清除后可再次应用同 id');
  });
});
