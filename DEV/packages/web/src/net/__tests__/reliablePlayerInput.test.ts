/**
 * Guest reliable intents: RTO/SRTT with attempt-tagged INPUT_ACK
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NetClient,
  computeRtoMs,
  reliableRetryDelayMs,
  updateSrttMs,
} from '../NetClient.js';

describe('联机可靠意图与快照 ack', () => {
  it('0. RTO = max(20, 2·srtt)；初始 srtt=40 → rto=80', () => {
    assert.equal(computeRtoMs(40), 80);
    assert.equal(computeRtoMs(10), 20);
    assert.equal(computeRtoMs(100), 200);
  });

  it('0b. 重试间隔按 rto 翻倍封顶 1000', () => {
    assert.equal(reliableRetryDelayMs(1, 80), 80);
    assert.equal(reliableRetryDelayMs(2, 80), 160);
    assert.equal(reliableRetryDelayMs(5, 80), 1000);
  });

  it('0c. SRTT EWMA 向新样本收敛', () => {
    const next = updateSrttMs(40, 80);
    assert.ok(Math.abs(next - (40 * 7) / 8 - 80 / 8) < 1e-9);
  });

  it('1. 房主同一 clientInputId 只应用一次，重复仍可记 ack', () => {
    const net = new NetClient();
    assert.equal(net.shouldApplyGuestInput('ci_a'), true);
    assert.equal(net.shouldApplyGuestInput('ci_a'), false);
    assert.ok(net.peekHostInputAcks().includes('ci_a'));
  });

  it('1b. clientInputId 含进副本 epoch：离开关再进不会撞上旧 id', () => {
    const net = new NetClient();
    net.beginCombatInputEpoch(1_000_000);
    const first = net.nextClientInputId(1_000_100);
    assert.match(first, /^ci_/);
    assert.ok(first.includes((1_000_000).toString(36)));
    assert.equal(net.shouldApplyGuestInput(first), true);

    // Leave & rejoin: new dungeon epoch → new id namespace
    net.beginCombatInputEpoch(2_000_000);
    const second = net.nextClientInputId(2_000_100);
    assert.notEqual(second, first);
    assert.ok(second.includes((2_000_000).toString(36)));
    // Host still remembering first visit id must not block second-visit cast
    assert.equal(net.shouldApplyGuestInput(first), false);
    assert.equal(net.shouldApplyGuestInput(second), true);
  });

  it('2. 无 clientInputId 的 MOVE 类始终可应用', () => {
    const net = new NetClient();
    assert.equal(net.shouldApplyGuestInput(undefined), true);
  });

  it('3. INPUT_ACK 按 attempt 取对应发出时间算 RTT', () => {
    const net = new NetClient();
    const now = Date.now();
    const t1 = now - 200;
    const t2 = now - 80;
    (net as any).pendingReliable.set('ci_b', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', spellId: 'x', clientInputId: 'ci_b' },
      sentAtMs: t2,
      attemptSentAtMs: new Map([
        [1, t1],
        [2, t2],
      ]),
      attempts: 2,
    });
    // Ack attempt 2 → sample ~80ms (not ~200ms from attempt 1)
    net.ackReliableInputs([{ clientInputId: 'ci_b', attempt: 2 }]);
    assert.equal((net as any).pendingReliable.has('ci_b'), false);
    const srtt = net.getSrttMs();
    // 40·7/8 + 80·1/8 = 45
    assert.ok(Math.abs(srtt - 45) < 3, `srtt should track attempt-2 (~80ms), got ${srtt}`);

    const net2 = new NetClient();
    (net2 as any).pendingReliable.set('ci_b2', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', clientInputId: 'ci_b2' },
      sentAtMs: t2,
      attemptSentAtMs: new Map([
        [1, t1],
        [2, t2],
      ]),
      attempts: 2,
    });
    net2.ackReliableInputs([{ clientInputId: 'ci_b2', attempt: 1 }]);
    // 40·7/8 + 200·1/8 = 60
    assert.ok(
      Math.abs(net2.getSrttMs() - 60) < 3,
      `attempt-1 sample should be ~200ms path, got ${net2.getSrttMs()}`
    );
  });

  it('3b. id-only 兜底 ack 清 pending 但不更新 srtt', () => {
    const net = new NetClient();
    const locked = net.getSrttMs();
    (net as any).pendingReliable.set('ci_c', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', clientInputId: 'ci_c' },
      sentAtMs: Date.now() - 200,
      attemptSentAtMs: new Map([[1, Date.now() - 200]]),
      attempts: 1,
    });
    net.ackReliableInputs(['ci_c']);
    assert.equal((net as any).pendingReliable.has('ci_c'), false);
    assert.equal(net.getSrttMs(), locked);
  });

  it('4. clear 重置房主/客人状态', () => {
    const net = new NetClient();
    net.shouldApplyGuestInput('ci_c');
    net.clearHostInputAckState();
    net.clearReliableInputs();
    assert.equal(net.peekHostInputAcks().length, 0);
    assert.equal(net.shouldApplyGuestInput('ci_c'), true);
  });

  it('5. 初始 RTO 为 80ms', () => {
    const net = new NetClient();
    assert.equal(net.getSrttMs(), 40);
    assert.equal(net.getRtoMs(), 80);
  });

  it('6. 一条超时重试不抬 SRTT，也不改变另一条的 attempt', () => {
    const net = new NetClient();
    const now = Date.now();
    const rto = net.getRtoMs();
    (net as any).ws = { readyState: 1 }; // OPEN — allow flush to send
    const sends: unknown[] = [];
    (net as any).send = (msg: unknown) => sends.push(msg);

    (net as any).pendingReliable.set('ci_old', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', clientInputId: 'ci_old' },
      sentAtMs: now - rto - 1,
      attemptSentAtMs: new Map([[1, now - rto - 1]]),
      attempts: 1,
    });
    (net as any).pendingReliable.set('ci_new', {
      roomId: 'r1',
      payload: { playerId: 'p1', kind: 'CAST', clientInputId: 'ci_new' },
      sentAtMs: now,
      attemptSentAtMs: new Map([[1, now]]),
      attempts: 1,
    });

    const srttBefore = net.getSrttMs();
    net.flushReliableInputRetries();

    assert.equal(net.getSrttMs(), srttBefore, 'timeout must not bump SRTT');
    const oldP = (net as any).pendingReliable.get('ci_old');
    const newP = (net as any).pendingReliable.get('ci_new');
    assert.equal(oldP.attempts, 2, 'timed-out intent retries alone');
    assert.equal(newP.attempts, 1, 'sibling intent stays on attempt 1');
    assert.equal(reliableRetryDelayMs(newP.attempts, rto), rto);
    assert.equal(reliableRetryDelayMs(oldP.attempts, rto), rto * 2);
    assert.ok(sends.length >= 1);
  });
});
