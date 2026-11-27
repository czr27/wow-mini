import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderedBatchCoalescer,
  RELIABLE_CACHE_MAX,
  ReliableChannel,
  shouldApplyMirrorSnapshot,
} from '../net/ReliableChannel.js';

describe('Network V2: ReliableChannel, 50-packet cache, NACK & mirror override', () => {
  it('1. 正常顺序收发：reliableSeq 单调递增，lastRecvSeq 捎带确认并自动清理缓存', () => {
    const client = new ReliableChannel();
    const server = new ReliableChannel();

    const p1 = client.stampOutgoing({ type: 'PLAYER_INPUT', payload: { kind: 'CAST' } });
    const p2 = client.stampOutgoing({ type: 'COMBAT_EFFECT', payload: { kind: 'DAMAGE' } });
    assert.equal(p1.reliableSeq, 1);
    assert.equal(p2.reliableSeq, 2);
    assert.equal(client.cachedCount, 2);

    const r1 = server.onIncoming(p1);
    assert.equal(r1.isDuplicate, false);
    assert.equal(r1.hasGap, false);
    assert.equal(server.lastRecvSeq, 1);

    const r2 = server.onIncoming(p2);
    assert.equal(r2.isDuplicate, false);
    assert.equal(server.lastRecvSeq, 2);

    // 服务端回包捎带 lastRecvSeq=2，客户端自动清理已确认的 2 包缓存
    const s1 = server.stampOutgoing({ type: 'COMBAT_BATCH', payload: {} });
    assert.equal(s1.lastRecvSeq, 2);
    client.onIncoming(s1);
    assert.equal(client.lastPeerAckedSeq, 2);
    assert.equal(client.cachedCount, 0);
  });

  it('2. 跳号检测 + 50 包缓存补发 + 过期 RESEND_EXPIRED 响应', () => {
    const sender = new ReliableChannel(RELIABLE_CACHE_MAX);
    const receiver = new ReliableChannel(RELIABLE_CACHE_MAX);

    const packets = [];
    for (let i = 0; i < 60; i++) {
      packets.push(sender.stampOutgoing({ type: 'COMBAT_EFFECT', payload: { idx: i } }));
    }
    // 缓存上限严格控制在 50 包（seq 1..10 已淘汰，11..60 在缓存中）
    assert.equal(sender.cachedCount, 50);

    // 接收方收到 seq=1 后直接跳到 seq=15
    receiver.onIncoming(packets[0]);
    const gap = receiver.onIncoming(packets[14]);
    assert.equal(gap.hasGap, true);
    assert.deepEqual(gap.missingSeqs, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    // 发送方处理补发请求：2..10 已过期，11..14 可补发
    const { found, expired } = sender.handleResendRequest(gap.missingSeqs);
    assert.deepEqual(expired, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(
      found.map((m) => m.reliableSeq),
      [11, 12, 13, 14]
    );

    // 接收方收到 RESEND_EXPIRED + 补发包后，连续水位推进到 15
    receiver.onResendExpired(expired);
    for (const m of found) receiver.onIncoming(m);
    assert.equal(receiver.lastRecvSeq, 15);
  });

  it('3. 镜像 vs 事件兜底覆盖规则 & 50ms 原序合包器', () => {
    // 未初始化必须覆盖
    assert.equal(
      shouldApplyMirrorSnapshot({
        hasEventGap: false,
        isInitialized: false,
        lastEventTimeMs: 2000,
        mirrorTimeMs: 1000,
      }),
      true
    );
    // 无丢包且最新事件晚于镜像 -> 忽略冗余镜像
    assert.equal(
      shouldApplyMirrorSnapshot({
        hasEventGap: false,
        isInitialized: true,
        lastEventTimeMs: 2500,
        mirrorTimeMs: 2000,
      }),
      false
    );
    // 无丢包且镜像恰好是最后事件下一包 -> 忽略冗余镜像
    assert.equal(
      shouldApplyMirrorSnapshot({
        hasEventGap: false,
        isInitialized: true,
        lastEventTimeMs: 2000,
        mirrorTimeMs: 2100,
        lastEventSeq: 10,
        mirrorEventSeq: 11,
      }),
      false
    );
    // 有丢包断层 -> 必须强覆盖兜底
    assert.equal(
      shouldApplyMirrorSnapshot({
        hasEventGap: true,
        isInitialized: true,
        lastEventTimeMs: 2500,
        mirrorTimeMs: 2000,
      }),
      true
    );

    const coalescer = new OrderedBatchCoalescer<string>();
    coalescer.push('a');
    coalescer.push('b');
    coalescer.push('c');
    assert.deepEqual(coalescer.drain(), ['a', 'b', 'c']);
    assert.equal(coalescer.size, 0);
  });
});
