/**
 * Sharded-authority combat effect bus.
 * Local authority applies immediately + records effectId; always enqueue for host gather/batch.
 */
import type { CombatEffect, OwnerSnapshot } from '@cata-raid-sim/engine';

const APPLIED_RING = 512;
const DEFAULT_BATCH_MS = 200;

export type EffectSendFn = (effect: CombatEffect) => void;
export type SnapshotSendFn = (snap: OwnerSnapshot) => void;
export type BatchFlushFn = (batch: {
  effects: CombatEffect[];
  snapshots: OwnerSnapshot[];
  ackedEffectIds: string[];
}) => void;

export class CombatEffectIdGen {
  private epochMs = 0;
  private seq = 0;

  beginEpoch(epochMs?: number) {
    this.epochMs = Math.max(1, epochMs ?? Date.now());
    this.seq = 0;
  }

  next(ownerId: string, nowMs = Date.now()): string {
    if (!this.epochMs) this.beginEpoch(nowMs);
    this.seq += 1;
    return `${ownerId}_${this.epochMs.toString(36)}_${this.seq.toString(36)}`;
  }
}

export class AppliedEffectRing {
  private ids = new Set<string>();
  private order: string[] = [];
  private readonly cap: number;

  constructor(cap = APPLIED_RING) {
    this.cap = cap;
  }

  has(effectId: string): boolean {
    return this.ids.has(effectId);
  }

  /** @returns true if newly recorded (not a duplicate) */
  mark(effectId: string): boolean {
    if (!effectId || this.ids.has(effectId)) return false;
    this.ids.add(effectId);
    this.order.push(effectId);
    while (this.order.length > this.cap) {
      const old = this.order.shift();
      if (old) this.ids.delete(old);
    }
    return true;
  }

  clear() {
    this.ids.clear();
    this.order = [];
  }
}

/** Host-side gather: merge guest/host effects + owner snapshots, flush every batchMs. */
export class EffectGatherQueue {
  private effects: CombatEffect[] = [];
  private snapshots = new Map<string, OwnerSnapshot>();
  private ackedEffectIds: string[] = [];
  private lastFlushMs = 0;
  readonly batchMs: number;

  constructor(batchMs = DEFAULT_BATCH_MS) {
    this.batchMs = batchMs;
  }

  enqueueEffect(effect: CombatEffect) {
    if (!effect?.effectId) return;
    this.effects.push(effect);
    this.ackedEffectIds.push(effect.effectId);
    while (this.ackedEffectIds.length > APPLIED_RING) this.ackedEffectIds.shift();
  }

  enqueueSnapshot(snap: OwnerSnapshot) {
    if (!snap?.ownerId) return;
    this.snapshots.set(snap.ownerId, snap);
  }

  /** Returns payload when due; null if nothing to send or interval not elapsed. */
  tryFlush(nowMs = Date.now()): {
    effects: CombatEffect[];
    snapshots: OwnerSnapshot[];
    ackedEffectIds: string[];
  } | null {
    if (this.effects.length === 0 && this.snapshots.size === 0) return null;
    // First enqueue starts the batch window; wait batchMs before first flush
    if (!this.lastFlushMs) {
      this.lastFlushMs = nowMs;
      return null;
    }
    if (nowMs - this.lastFlushMs < this.batchMs) return null;
    this.lastFlushMs = nowMs;
    const effects = this.effects.splice(0, this.effects.length);
    const snapshots = [...this.snapshots.values()];
    this.snapshots.clear();
    const ackedEffectIds = this.ackedEffectIds.slice(-128);
    return { effects, snapshots, ackedEffectIds };
  }

  /** Force flush regardless of interval (e.g. room leave). */
  forceFlush(): {
    effects: CombatEffect[];
    snapshots: OwnerSnapshot[];
    ackedEffectIds: string[];
  } | null {
    if (this.effects.length === 0 && this.snapshots.size === 0) return null;
    this.lastFlushMs = Date.now();
    const effects = this.effects.splice(0, this.effects.length);
    const snapshots = [...this.snapshots.values()];
    this.snapshots.clear();
    return { effects, snapshots, ackedEffectIds: this.ackedEffectIds.slice(-128) };
  }

  clear() {
    this.effects = [];
    this.snapshots.clear();
    this.ackedEffectIds = [];
    this.lastFlushMs = 0;
  }
}

export type AuthorityResolver = (unitId: string) => boolean;

/**
 * Emit helper: assign effectId, optionally apply locally if we own the target, mark ring, send.
 */
export function emitCombatEffect(opts: {
  partial: Omit<CombatEffect, 'effectId'> & { effectId?: string };
  ownerId: string;
  idGen: CombatEffectIdGen;
  applied: AppliedEffectRing;
  isLocalAuthority: AuthorityResolver;
  applyLocal: (effect: CombatEffect) => void;
  send: EffectSendFn;
  nowMs?: number;
}): CombatEffect {
  const nowMs = opts.nowMs ?? Date.now();
  const effectId =
    opts.partial.effectId || opts.idGen.next(opts.ownerId, nowMs);
  const effect: CombatEffect = {
    ...opts.partial,
    effectId,
    atMs: opts.partial.atMs ?? nowMs,
  };
  if (opts.isLocalAuthority(effect.targetId)) {
    if (opts.applied.mark(effectId)) {
      opts.applyLocal(effect);
    }
  } else {
    // Still record outbound ids we authored so batch echo of our CAST_START etc. is fine
    opts.applied.mark(effectId);
  }
  opts.send(effect);
  return effect;
}

/** Apply remote/batch effect once (skip if already applied). */
export function consumeRemoteEffect(
  effect: CombatEffect,
  applied: AppliedEffectRing,
  apply: (effect: CombatEffect) => void
): boolean {
  if (!effect?.effectId) return false;
  if (!applied.mark(effect.effectId)) return false;
  apply(effect);
  return true;
}
