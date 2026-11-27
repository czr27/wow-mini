import type { NetEnvelope } from './NetProtocol.js';

export const RELIABLE_CACHE_MAX = 50;

export interface ResendReqPayload {
  missingSeqs: number[];
}

export interface ResendExpiredPayload {
  expiredSeqs: number[];
}

/**
 * 双向可靠序列号通道（V2）：
 * - 发送方对每个非高频包分配单调递增 reliableSeq（从 1 开始）并缓存最近 50 包；
 * - 每个出站包自动捎带 lastRecvSeq（已连续收到对端的最大 reliableSeq，实现 Piggyback ACK）；
 * - 接收方若发现 reliableSeq 跳号，返回缺失列表以触发 RESEND_REQ；
 * - 发送方响应 RESEND_REQ：在 50 包缓存内补发原包，已淘汰的返回 expiredSeqs（触发 RESEND_EXPIRED）。
 */
export class ReliableChannel {
  private nextSendSeq = 1;
  /** 最近已发送但尚未全部确认的包缓存（上限 50） */
  private sendCache = new Map<number, NetEnvelope>();
  private sendOrder: number[] = [];

  /** 已连续收到对端的最大 seq */
  private contiguousRecvSeq = 0;
  /** 乱序提前到达的 seq 集合 */
  private outOfOrderRecv = new Set<number>();
  /** 对端已确认收到我方的最大 seq */
  private peerAckedSeq = 0;

  constructor(private readonly maxCache = RELIABLE_CACHE_MAX) {}

  get lastRecvSeq(): number {
    return this.contiguousRecvSeq;
  }

  get lastPeerAckedSeq(): number {
    return this.peerAckedSeq;
  }

  get cachedCount(): number {
    return this.sendCache.size;
  }

  /** 为非高频出站包打上 reliableSeq + lastRecvSeq 并入 50 包缓存 */
  stampOutgoing<T>(msg: NetEnvelope<T>): NetEnvelope<T> {
    const seq = this.nextSendSeq++;
    const stamped: NetEnvelope<T> = {
      ...msg,
      reliableSeq: seq,
      lastRecvSeq: this.contiguousRecvSeq,
    };
    this.sendCache.set(seq, stamped);
    this.sendOrder.push(seq);
    while (this.sendOrder.length > this.maxCache) {
      const evicted = this.sendOrder.shift();
      if (evicted !== undefined) this.sendCache.delete(evicted);
    }
    return stamped;
  }

  /** 为高频包（如 MOVE）仅捎带 lastRecvSeq，不消耗 reliableSeq 也不入缓存 */
  attachPiggybackAck<T>(msg: NetEnvelope<T>): NetEnvelope<T> {
    return {
      ...msg,
      lastRecvSeq: this.contiguousRecvSeq,
    };
  }

  /** 收到对端任意包时，先处理捎带的 lastRecvSeq，再处理 reliableSeq 连续性 */
  onIncoming(msg: NetEnvelope): {
    isDuplicate: boolean;
    missingSeqs: number[];
    hasGap: boolean;
  } {
    if (typeof msg.lastRecvSeq === 'number' && msg.lastRecvSeq > this.peerAckedSeq) {
      this.peerAckedSeq = msg.lastRecvSeq;
      // 清理已被对端连续确认的发送缓存
      while (this.sendOrder.length > 0 && this.sendOrder[0] <= this.peerAckedSeq) {
        const acked = this.sendOrder.shift();
        if (acked !== undefined) this.sendCache.delete(acked);
      }
    }

    const seq = msg.reliableSeq;
    if (typeof seq !== 'number' || seq <= 0) {
      return { isDuplicate: false, missingSeqs: [], hasGap: false };
    }

    if (seq <= this.contiguousRecvSeq || this.outOfOrderRecv.has(seq)) {
      return { isDuplicate: true, missingSeqs: [], hasGap: false };
    }

    if (seq === this.contiguousRecvSeq + 1) {
      this.contiguousRecvSeq = seq;
      while (this.outOfOrderRecv.has(this.contiguousRecvSeq + 1)) {
        this.contiguousRecvSeq++;
        this.outOfOrderRecv.delete(this.contiguousRecvSeq);
      }
      return { isDuplicate: false, missingSeqs: [], hasGap: this.outOfOrderRecv.size > 0 };
    }

    // 发生跳号：记录乱序包并收集缺失区间
    this.outOfOrderRecv.add(seq);
    const missingSeqs: number[] = [];
    for (let s = this.contiguousRecvSeq + 1; s < seq; s++) {
      if (!this.outOfOrderRecv.has(s)) missingSeqs.push(s);
    }
    return { isDuplicate: false, missingSeqs, hasGap: true };
  }

  /** 响应对端的 RESEND_REQ：返回可补发的原包列表与已过期淘汰的 seq 列表 */
  handleResendRequest(missingSeqs: number[]): {
    found: NetEnvelope[];
    expired: number[];
  } {
    const found: NetEnvelope[] = [];
    const expired: number[] = [];
    for (const seq of missingSeqs) {
      const cached = this.sendCache.get(seq);
      if (cached) {
        found.push({ ...cached, lastRecvSeq: this.contiguousRecvSeq });
      } else {
        expired.push(seq);
      }
    }
    return { found, expired };
  }

  /** 收到对端 RESEND_EXPIRED：推进连续水位跳过已无法补发的区间，避免无限重问，交由镜像包兜底 */
  onResendExpired(expiredSeqs: number[]): void {
    if (!expiredSeqs.length) return;
    const maxExpired = Math.max(...expiredSeqs);
    if (maxExpired > this.contiguousRecvSeq) {
      this.contiguousRecvSeq = maxExpired;
      for (const s of [...this.outOfOrderRecv]) {
        if (s <= this.contiguousRecvSeq) this.outOfOrderRecv.delete(s);
      }
      while (this.outOfOrderRecv.has(this.contiguousRecvSeq + 1)) {
        this.contiguousRecvSeq++;
        this.outOfOrderRecv.delete(this.contiguousRecvSeq);
      }
    }
  }

  reset(): void {
    this.nextSendSeq = 1;
    this.sendCache.clear();
    this.sendOrder = [];
    this.contiguousRecvSeq = 0;
    this.outOfOrderRecv.clear();
    this.peerAckedSeq = 0;
  }
}

/**
 * 事件 vs 镜像兜底覆盖判定规则（V2）：
 * - 若事件包连续无丢包（!hasEventGap），且最后事件时间晚于镜像包（lastEventTimeMs > mirrorTimeMs）
 *   或镜像包对应的事件序号恰好是最后事件包的下一包（mirrorEventSeq === lastEventSeq + 1），
 *   则可忽略冗余镜像覆盖（返回 false）；
 * - 否则（存在丢包/断层或尚未初始化）必须用镜像包强覆盖兜底（返回 true）。
 */
export function shouldApplyMirrorSnapshot(opts: {
  hasEventGap: boolean;
  isInitialized: boolean;
  lastEventTimeMs: number;
  mirrorTimeMs: number;
  lastEventSeq?: number;
  mirrorEventSeq?: number;
}): boolean {
  if (!opts.isInitialized) return true;
  if (opts.hasEventGap) return true;
  if (opts.lastEventTimeMs > opts.mirrorTimeMs) return false;
  if (
    typeof opts.lastEventSeq === 'number' &&
    typeof opts.mirrorEventSeq === 'number' &&
    opts.mirrorEventSeq === opts.lastEventSeq + 1
  ) {
    return false;
  }
  return true;
}

/**
 * 50ms 窗口原序合包器（按接收先后顺序收集消息，定时 flush）
 */
export class OrderedBatchCoalescer<T> {
  private queue: T[] = [];

  push(item: T): void {
    this.queue.push(item);
  }

  get size(): number {
    return this.queue.length;
  }

  drain(): T[] {
    if (this.queue.length === 0) return [];
    return this.queue.splice(0, this.queue.length);
  }
}
