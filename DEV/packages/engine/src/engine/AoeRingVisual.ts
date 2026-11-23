/**
 * Shared AoE ring visual rules for combat canvas + network FX sync.
 * Instant pulses: hold 100ms then 10ms fade. Persistent zones follow remainingMs then fade.
 * Fill alpha scales with radius only (≤5yd 透明度40% … ≥30yd 96%); tone/color does not change alpha.
 */
import type { Unit } from '../types.js';
import { yardsToPx } from '../classes/ClassRegistry.js';
import type { CombatEngine } from './CombatEngine.js';
import { resolveUnitKind } from './UnitSpawn.js';

/** Hold time for instant-resolve AoE rings (ms). */
export const AOE_INSTANT_HOLD_MS = 100;
/** Fade-out duration when a ring expires (ms). */
export const AOE_FADE_MS = 10;

export type AoeVisualTone = 'HEAL' | 'FRIENDLY' | 'ENEMY';
export type AoeActorTier = 'PLAYER' | 'BOSS' | 'MINION';

/** ≤5yd → 透明度 40% (alpha 0.6); ≥30yd → 透明度 96% (alpha 0.04); linear in between. */
export const AOE_ALPHA_SMALL_RADIUS_YD = 5;
export const AOE_ALPHA_LARGE_RADIUS_YD = 30;
export const AOE_TRANSPARENCY_AT_SMALL = 0.4;
export const AOE_TRANSPARENCY_AT_LARGE = 0.96;
/** Canvas fill alpha = 1 − 透明度 */
export const AOE_ALPHA_AT_SMALL = 0.6;
export const AOE_ALPHA_AT_LARGE = 0.04;

/** @deprecated Actor-tier alphas replaced by radius-based opacity; kept for older callers. */
export const AOE_ALPHA: Record<AoeActorTier, number> = {
  PLAYER: AOE_ALPHA_AT_SMALL,
  BOSS: AOE_ALPHA_AT_SMALL,
  MINION: AOE_ALPHA_AT_SMALL,
};

/** RGB fill colors — heal green / friendly yellow / enemy red */
export const AOE_RGB: Record<AoeVisualTone, readonly [number, number, number]> = {
  HEAL: [16, 185, 129],
  FRIENDLY: [234, 179, 8],
  ENEMY: [239, 68, 68],
};

export function resolveAoeActorTier(unit: {
  isPlayer?: boolean;
  isHumanControlled?: boolean;
  isPet?: boolean;
  unitKind?: string;
  classId?: string;
  role?: string;
} | null | undefined): AoeActorTier {
  if (!unit) return 'PLAYER';
  const kind = resolveUnitKind(unit as any);
  if (kind === 'BOSS' || unit.classId === 'BOSS') return 'BOSS';
  if (kind === 'PET' || kind === 'ADD' || kind === 'NPC' || unit.isPet) return 'MINION';
  return 'PLAYER';
}

/** Flat fill alpha from radius in canvas px (8px ≈ 1yd). */
export function resolveAoeAlphaByRadiusPx(radiusPx: number): number {
  const r = Math.max(0, radiusPx || 0);
  const smallPx = yardsToPx(AOE_ALPHA_SMALL_RADIUS_YD);
  const largePx = yardsToPx(AOE_ALPHA_LARGE_RADIUS_YD);
  if (r <= smallPx) return AOE_ALPHA_AT_SMALL;
  if (r >= largePx) return AOE_ALPHA_AT_LARGE;
  const t = (r - smallPx) / Math.max(1, largePx - smallPx);
  return AOE_ALPHA_AT_SMALL + t * (AOE_ALPHA_AT_LARGE - AOE_ALPHA_AT_SMALL);
}

/** @deprecated Prefer resolveAoeAlphaByRadiusPx — actor tier no longer drives opacity. */
export function resolveAoeAlpha(unit: Parameters<typeof resolveAoeActorTier>[0]): number {
  void unit;
  return AOE_ALPHA_AT_SMALL;
}

/**
 * Ground FX that should render as a heal circle and that AI may seek when hurt.
 * Includes HEAL_ZONE spells and healing/support totems (tide / spirit link / barrier).
 * Mana tide / windfury stay non-heal.
 */
export function isSeekableHealGroundEffect(eff: {
  kind?: string;
  spellId?: string;
  remainingMs?: number;
}): boolean {
  if ((eff.remainingMs ?? 1) <= 0) return false;
  if (eff.kind === 'HEAL_ZONE') return true;
  if (eff.kind !== 'TOTEM') return false;
  const sid = (eff.spellId || '').toLowerCase();
  return (
    sid.includes('healing_tide') ||
    sid.includes('spirit_link') ||
    sid.includes('power_word_barrier') ||
    sid.includes('pw_barrier') ||
    sid.includes('治疗之潮') ||
    sid.includes('灵魂链接')
  );
}

/**
 * Yellow / FRIENDLY persistent ground FX (non-heal totems etc.) for healthy stacking.
 * Excludes red hazards and green heal circles.
 */
export function isFriendlyBuffGroundEffect(eff: {
  kind?: string;
  spellId?: string;
  remainingMs?: number;
}): boolean {
  if ((eff.remainingMs ?? 1) <= 0) return false;
  if (eff.kind === 'DAMAGE_ZONE' || eff.kind === 'CONE_WARNING') return false;
  if (isSeekableHealGroundEffect(eff)) return false;
  return eff.kind === 'TOTEM';
}

/** Prefer the spatially nearest ground effect from `from`. */
export function pickNearestGroundEffect<T extends { x: number; y: number }>(
  effects: T[],
  from: { x: number; y: number }
): T | null {
  if (effects.length === 0) return null;
  let best = effects[0];
  let bestDist = Math.hypot(from.x - best.x, from.y - best.y);
  for (let i = 1; i < effects.length; i++) {
    const e = effects[i];
    const d = Math.hypot(from.x - e.x, from.y - e.y);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

export function resolveAoeTone(opts: {
  isHeal?: boolean;
  isEnemyActor?: boolean;
  groundKind?: string;
  spellId?: string;
}): AoeVisualTone {
  const sid = (opts.spellId || '').toLowerCase();
  if (
    opts.isHeal ||
    opts.groundKind === 'HEAL_ZONE' ||
    isSeekableHealGroundEffect({ kind: opts.groundKind, spellId: opts.spellId, remainingMs: 1 }) ||
    sid.includes('healing_rain') ||
    sid.includes('efflorescence') ||
    sid.includes('tranquility') ||
    sid.includes('swiftmend')
  ) {
    return 'HEAL';
  }
  if (opts.isEnemyActor) return 'ENEMY';
  return 'FRIENDLY';
}

export function rgba(tone: AoeVisualTone, alpha: number): string {
  const [r, g, b] = AOE_RGB[tone];
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export interface EmitAoePulseOpts {
  actorId: string;
  spellId: string;
  spellName?: string;
  targetId?: string | null;
  x: number;
  y: number;
  radius: number;
  tone: AoeVisualTone;
  /** Default INSTANT — persistent ground FX are drawn from groundEffects instead */
  kind?: 'INSTANT' | 'GROUND_PLACE';
  groundEffectId?: string;
}

/**
 * Instant-resolve AoE no longer spawns fill rings (user preference).
 * Persistent ground FX still come from groundEffects on the canvas.
 * GROUND_PLACE may still log for other sync; aoePulse stays false for instants.
 */
export function emitAoePulse(engine: CombatEngine, opts: EmitAoePulseOpts) {
  if (opts.kind !== 'GROUND_PLACE') {
    return null;
  }
  return engine.logCombatAction({
    actorId: opts.actorId,
    spellId: opts.spellId,
    spellName: opts.spellName,
    targetId: opts.targetId ?? null,
    kind: 'GROUND_PLACE',
    x: opts.x,
    y: opts.y,
    groundEffectId: opts.groundEffectId,
    radius: opts.radius,
    aoePulse: false,
    visualTone: opts.tone,
  });
}

/** Infer pulse center + radius for a spatial AoE from caster/target positions. */
export function resolveAoePulsePose(opts: {
  caster: Unit;
  primaryTarget?: Unit | null;
  radiusPx: number;
  centerMode?: 'CASTER' | 'TARGET' | 'RAID' | 'NONE';
}): { x: number; y: number; radius: number } | null {
  const radius = opts.radiusPx;
  if (!radius || radius <= 0) return null;
  const mode = opts.centerMode || 'CASTER';
  if (mode === 'RAID' || mode === 'NONE') return null;
  if (mode === 'TARGET' && opts.primaryTarget?.position) {
    return { x: opts.primaryTarget.position.x, y: opts.primaryTarget.position.y, radius };
  }
  if (opts.caster.position) {
    return { x: opts.caster.position.x, y: opts.caster.position.y, radius };
  }
  return null;
}

export function isEnemyActorUnit(u: {
  role?: string;
  classId?: string;
  unitKind?: string;
} | null | undefined): boolean {
  if (!u) return false;
  const kind = resolveUnitKind(u as any);
  return kind === 'BOSS' || kind === 'ADD' || kind === 'NPC' || u.role === 'ENEMY' || u.classId === 'BOSS';
}
