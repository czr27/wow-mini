/**
 * Cast / channel lifecycle over COMBAT_EFFECT for remote action bars.
 * Every authority (human / AI / boss) publishes start → land|interrupt.
 *
 * Remote HUD: smooth progress from CAST_START totalMs; on LAND/INTERRUPT show a
 * brief full-bar flash (green success / red interrupt) so observers still see the outcome.
 */
import type { CombatEffect, NetworkCastTimeline } from '@cata-raid-sim/engine';
import { publishCombatEffectAlreadyApplied } from './networkCombatAuthority.js';

export const CAST_END_FLASH_MS = 450;

export type CompanionCastHud = {
  spellName: string;
  progress: number;
  spellId?: string;
  totalMs?: number;
  interruptible?: boolean;
  /** Brief outcome flash after cast ends (target/focus observers). */
  endFlash?: 'success' | 'interrupt';
  flashUntilMs?: number;
};

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

export function publishCastLand(
  p: Pick<CastLifecyclePublish, 'unitId' | 'spellId' | 'spellName' | 'targetId' | 'isHarmful' | 'atMs'>
) {
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

export function publishCastInterrupt(
  p: Pick<CastLifecyclePublish, 'unitId' | 'spellId' | 'spellName' | 'targetId' | 'atMs'>
) {
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

/** Keep expired end-flash entries out of the HUD map. */
export function pruneCompanionCastFlashes(
  casts: Record<string, CompanionCastHud>,
  now = Date.now()
): Record<string, CompanionCastHud> {
  let changed = false;
  const next: Record<string, CompanionCastHud> = {};
  for (const [id, c] of Object.entries(casts)) {
    if (c.endFlash && c.flashUntilMs != null && now >= c.flashUntilMs) {
      changed = true;
      continue;
    }
    next[id] = c;
  }
  return changed ? next : casts;
}

/**
 * Merge CAST_LAND / INTERRUPT into companion HUD as a full-bar flash
 * (green success / red interrupt) using the last known spell name.
 */
export function applyCastEndFlashToCompanionCasts(
  casts: Record<string, CompanionCastHud>,
  effect: CombatEffect,
  timelinesBeforeClear: NetworkCastTimeline[],
  now = Date.now()
): Record<string, CompanionCastHud> {
  if (effect.kind !== 'CAST_LAND' && effect.kind !== 'INTERRUPT') return casts;
  const prev = timelinesBeforeClear.find((c) => c.unitId === effect.sourceId);
  const spellName = effect.spellName || prev?.spellName || effect.spellId;
  const spellId = effect.spellId || prev?.spellId;
  return {
    ...pruneCompanionCastFlashes(casts, now),
    [effect.sourceId]: {
      spellName,
      spellId,
      progress: 1,
      totalMs: prev?.totalMs,
      interruptible: prev?.interruptible,
      endFlash: effect.kind === 'INTERRUPT' ? 'interrupt' : 'success',
      flashUntilMs: now + CAST_END_FLASH_MS,
    },
  };
}

/** Build companionCasts HUD map from timelines (excludes self). Preserves active end flashes. */
export function companionCastsFromTimelines(
  timelines: NetworkCastTimeline[],
  myId: string | null | undefined,
  now = Date.now(),
  prevFlashes?: Record<string, CompanionCastHud>
): Record<string, CompanionCastHud> {
  const out: Record<string, CompanionCastHud> = {};
  for (const c of timelines) {
    if (c.interrupted || (myId && c.unitId === myId)) continue;
    const elapsed = Math.max(0, now - c.startedAtMs);
    if (elapsed >= c.totalMs) continue;
    out[c.unitId] = {
      spellName: c.spellName,
      spellId: c.spellId,
      progress: Math.min(1, elapsed / Math.max(1, c.totalMs)),
      totalMs: c.totalMs,
      interruptible: c.interruptible !== false && !c.isChannel,
    };
  }
  // Keep end-flash rows that are still live and not replaced by a new cast
  if (prevFlashes) {
    for (const [id, c] of Object.entries(prevFlashes)) {
      if (!c.endFlash || c.flashUntilMs == null || now >= c.flashUntilMs) continue;
      if (out[id]) continue; // active cast wins
      if (myId && id === myId) continue;
      out[id] = c;
    }
  }
  return out;
}

/** Stamp boss unit nameplate fields from cast HUD (canvas draws these). Host + guest. */
export function stampBossCastOntoUnit(
  boss: { id: string } & Record<string, any>,
  cast: CompanionCastHud | null | undefined,
  recentOverheadSkillName?: string | null
): void {
  if (!cast || cast.endFlash === 'interrupt') {
    boss.isCasting = false;
    boss.castingSpellName = undefined;
    boss.castProgress = 0;
    if (!cast?.endFlash) {
      boss.overheadSkillName = recentOverheadSkillName || undefined;
    }
    return;
  }
  if (cast.endFlash === 'success') {
    boss.isCasting = false;
    boss.castingSpellName = cast.spellName;
    boss.castProgress = 1;
    boss.overheadSkillName = cast.spellName;
    return;
  }
  boss.isCasting = true;
  boss.castingSpellName = cast.spellName;
  boss.castProgress = Math.min(1, Math.max(0, cast.progress));
  boss.overheadSkillName = cast.spellName;
}

export type GuestBossCastingState = {
  spellName: string;
  spellId?: string;
  elapsedMs: number;
  castTimeMs: number;
  interruptible: boolean;
};

/**
 * Single writer for boss cast HUD: unit nameplate fields + optional React guestBossCasting.
 * Call from host AI tick, guest EFFECT HUD, and COMBAT_STATE gap-fill — never fork the formulas.
 */
export function syncBossCastHud(opts: {
  boss: ({ id: string } & Record<string, any>) | null | undefined;
  cast: CompanionCastHud | null | undefined;
  recentOverheadSkillName?: string | null;
  setGuestBossCasting?: (next: GuestBossCastingState | null) => void;
}): void {
  const { boss, cast, recentOverheadSkillName, setGuestBossCasting } = opts;
  if (!boss) {
    setGuestBossCasting?.(null);
    return;
  }
  stampBossCastOntoUnit(boss, cast, recentOverheadSkillName);
  if (!setGuestBossCasting) return;
  if (cast && !cast.endFlash) {
    setGuestBossCasting({
      spellName: cast.spellName,
      spellId: cast.spellId,
      elapsedMs: Math.round((cast.progress || 0) * (cast.totalMs || 1)),
      castTimeMs: cast.totalMs || 1,
      interruptible: cast.interruptible !== false,
    });
  } else {
    setGuestBossCasting(null);
  }
}

/**
 * Apply one CAST_START / CAST_LAND / INTERRUPT onto timelines + companion HUD.
 * Host receive, guest batch, and hostEffectHudHook must all call this — not fork.
 */
export function applyRemoteCastEffect(opts: {
  effect: CombatEffect;
  timelines: NetworkCastTimeline[];
  companionCasts: Record<string, CompanionCastHud>;
  skipUnitId?: string | null;
  now?: number;
}): {
  timelines: NetworkCastTimeline[];
  companionCasts: Record<string, CompanionCastHud>;
} {
  const now = opts.now ?? Date.now();
  const e = opts.effect;
  if (e.kind !== 'CAST_START' && e.kind !== 'CAST_LAND' && e.kind !== 'INTERRUPT') {
    return { timelines: opts.timelines, companionCasts: opts.companionCasts };
  }
  const before = opts.timelines;
  const timelines = applyCastLifecycleToTimelines(before, e, opts.skipUnitId);
  let companionCasts: Record<string, CompanionCastHud>;
  if (e.kind === 'CAST_LAND' || e.kind === 'INTERRUPT') {
    companionCasts = applyCastEndFlashToCompanionCasts(opts.companionCasts, e, before, now);
  } else {
    companionCasts = companionCastsFromTimelines(timelines, opts.skipUnitId, now, opts.companionCasts);
  }
  return { timelines, companionCasts };
}
