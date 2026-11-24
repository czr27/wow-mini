/**
 * Cast / channel lifecycle over COMBAT_EFFECT for remote action bars.
 * Every authority (human / AI / boss) publishes start → land|interrupt.
 */
import type { CombatEffect, NetworkCastTimeline } from '@cata-raid-sim/engine';
import { publishCombatEffectAlreadyApplied } from './networkCombatAuthority.js';

export type CastLifecyclePublish = {
  unitId: string;
  spellId: string;
  spellName?: string;
  targetId?: string | null;
  totalMs?: number;
  isChannel?: boolean;
  interruptible?: boolean;
  isHarmful?: boolean;
  atMs?: number;
};

export function publishCastStart(p: CastLifecyclePublish) {
  publishCombatEffectAlreadyApplied({
    sourceId: p.unitId,
    targetId: p.targetId || p.unitId,
    spellId: p.spellId,
    spellName: p.spellName,
    kind: 'CAST_START',
    totalMs: Math.max(1, p.totalMs || 1500),
    isChannel: !!p.isChannel,
    interruptible: p.interruptible !== false && !p.isChannel,
    visualTone: p.isHarmful ? 'ENEMY' : 'HEAL',
    atMs: p.atMs ?? Date.now(),
  });
}

export function publishCastLand(p: Pick<CastLifecyclePublish, 'unitId' | 'spellId' | 'spellName' | 'targetId' | 'isHarmful' | 'atMs'>) {
  publishCombatEffectAlreadyApplied({
    sourceId: p.unitId,
    targetId: p.targetId || p.unitId,
    spellId: p.spellId,
    spellName: p.spellName,
    kind: 'CAST_LAND',
    visualTone: p.isHarmful ? 'ENEMY' : 'HEAL',
    atMs: p.atMs ?? Date.now(),
  });
}

export function publishCastInterrupt(p: Pick<CastLifecyclePublish, 'unitId' | 'spellId' | 'spellName' | 'targetId' | 'atMs'>) {
  publishCombatEffectAlreadyApplied({
    sourceId: p.unitId,
    targetId: p.targetId || p.unitId,
    spellId: p.spellId || 'interrupt',
    spellName: p.spellName,
    kind: 'INTERRUPT',
    atMs: p.atMs ?? Date.now(),
  });
}

/** Apply CAST_START / CAST_LAND / INTERRUPT onto local cast timeline map (remote HUD). */
export function applyCastLifecycleToTimelines(
  timelines: NetworkCastTimeline[],
  effect: CombatEffect,
  skipUnitId?: string | null
): NetworkCastTimeline[] {
  if (skipUnitId && effect.sourceId === skipUnitId) return timelines;
  const now = effect.atMs || Date.now();
  if (effect.kind === 'CAST_START') {
    return [
      ...timelines.filter((c) => c.unitId !== effect.sourceId),
      {
        unitId: effect.sourceId,
        spellId: effect.spellId,
        spellName: effect.spellName || effect.spellId,
        startedAtMs: now,
        totalMs: Math.max(1, effect.totalMs || 1500),
        isChannel: !!effect.isChannel,
        targetId: effect.targetId,
        interruptible: effect.interruptible !== false && !effect.isChannel,
      },
    ];
  }
  if (effect.kind === 'CAST_LAND' || effect.kind === 'INTERRUPT') {
    return timelines.filter((c) => c.unitId !== effect.sourceId);
  }
  return timelines;
}

/** Build companionCasts HUD map from timelines (excludes self). */
export function companionCastsFromTimelines(
  timelines: NetworkCastTimeline[],
  myId: string | null | undefined,
  now = Date.now()
): Record<string, { spellName: string; progress: number; spellId?: string }> {
  const out: Record<string, { spellName: string; progress: number; spellId?: string }> = {};
  for (const c of timelines) {
    if (c.interrupted || (myId && c.unitId === myId)) continue;
    const elapsed = Math.max(0, now - c.startedAtMs);
    if (elapsed >= c.totalMs) continue;
    out[c.unitId] = {
      spellName: c.spellName,
      spellId: c.spellId,
      progress: Math.min(1, elapsed / Math.max(1, c.totalMs)),
    };
  }
  return out;
}
