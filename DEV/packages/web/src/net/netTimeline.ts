import type {
  NetworkCastTimeline,
  NetworkCooldownTimeline,
  NetworkGcdTimeline,
} from '@cata-raid-sim/engine';

/** Remaining ms from startedAt + total (clamped). */
export function timelineRemainingMs(startedAtMs: number, totalMs: number, now = Date.now()): number {
  if (totalMs <= 0) return 0;
  const elapsed = Math.max(0, now - startedAtMs);
  return Math.max(0, totalMs - elapsed);
}

export function timelineProgress(startedAtMs: number, totalMs: number, now = Date.now()): number {
  if (totalMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now - startedAtMs) / totalMs));
}

export function buildCastFromTimeline(
  cast: NetworkCastTimeline,
  now = Date.now()
): {
  spellName: string;
  spellId: string;
  progress: number;
  elapsedMs: number;
  totalMs: number;
  isChannel?: boolean;
  targetId?: string;
} | null {
  if (cast.interrupted) return null;
  const remaining = timelineRemainingMs(cast.startedAtMs, cast.totalMs, now);
  if (remaining <= 0) return null;
  const elapsedMs = cast.totalMs - remaining;
  return {
    spellName: cast.spellName,
    spellId: cast.spellId,
    progress: timelineProgress(cast.startedAtMs, cast.totalMs, now),
    elapsedMs,
    totalMs: cast.totalMs,
    isChannel: cast.isChannel,
    targetId: cast.targetId,
  };
}

export function cooldownRemainingFromTimelines(
  timelines: NetworkCooldownTimeline[] | undefined,
  unitId: string,
  spellId: string,
  now = Date.now()
): number {
  if (!timelines) return 0;
  const hit = timelines.find((t) => t.unitId === unitId && t.spellId === spellId);
  if (!hit) return 0;
  return timelineRemainingMs(hit.startedAtMs, hit.totalMs, now);
}

export function gcdRemainingFromTimelines(
  timelines: NetworkGcdTimeline[] | undefined,
  unitId: string,
  now = Date.now()
): { remaining: number; total: number } {
  if (!timelines) return { remaining: 0, total: 1000 };
  const hit = timelines.find((t) => t.unitId === unitId);
  if (!hit) return { remaining: 0, total: 1000 };
  return {
    remaining: timelineRemainingMs(hit.startedAtMs, hit.totalMs, now),
    total: hit.totalMs || 1000,
  };
}
