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

/** RGB fill colors — 治疗绿 / 增益黄 / 伤害红（只看分类，与施法者敌我无关） */
export const AOE_RGB: Record<AoeVisualTone, readonly [number, number, number]> = {
  HEAL: [16, 185, 129],
  FRIENDLY: [234, 179, 8],
  ENEMY: [239, 68, 68],
};

/** 描边：友方施法者白 / 敌方施法者红（强制显示） */
export const AOE_OUTLINE_ALLY_RGB = [255, 255, 255] as const;
export const AOE_OUTLINE_ENEMY_RGB = [239, 68, 68] as const;

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
 * Ground FX that restore HP (green heal fill). Excludes non-heal support like
 * spirit link / mana tide / windfury (those use yellow FRIENDLY).
 */
export function isHealFillGroundEffect(eff: {
  kind?: string;
  spellId?: string;
  remainingMs?: number;
}): boolean {
  if ((eff.remainingMs ?? 1) <= 0) return false;
  if (eff.kind === 'HEAL_ZONE') return true;
  const sid = (eff.spellId || '').toLowerCase();
  if (
    sid.includes('healing_rain') ||
    sid.includes('healing_tide') ||
    sid.includes('lightwell') ||
    sid.includes('light_well') ||
    sid.includes('efflorescence') ||
    sid.includes('swiftmend') ||
    sid.includes('tranquility') ||
    sid.includes('治疗之雨') ||
    sid.includes('治疗之潮') ||
    sid.includes('圣光井') ||
    sid.includes('百花')
  ) {
    return true;
  }
  return false;
}

/**
 * Ground FX that AI may seek when hurt (heal fills + support totems like spirit link).
 * Mana tide / windfury stay non-heal.
 */
export function isSeekableHealGroundEffect(eff: {
  kind?: string;
  spellId?: string;
  remainingMs?: number;
}): boolean {
  if ((eff.remainingMs ?? 1) <= 0) return false;
  if (isHealFillGroundEffect(eff)) return true;
  if (eff.kind !== 'TOTEM') return false;
  const sid = (eff.spellId || '').toLowerCase();
  return (
    sid.includes('spirit_link') ||
    sid.includes('power_word_barrier') ||
    sid.includes('pw_barrier') ||
    sid.includes('灵魂链接')
  );
}

/**
 * Yellow / FRIENDLY persistent ground FX (non-heal beneficial totems etc.).
 * Excludes red hazards and green heal fills.
 */
export function isFriendlyBuffGroundEffect(eff: {
  kind?: string;
  spellId?: string;
  remainingMs?: number;
}): boolean {
  if ((eff.remainingMs ?? 1) <= 0) return false;
  if (eff.kind === 'DAMAGE_ZONE' || eff.kind === 'CONE_WARNING') return false;
  if (isHealFillGroundEffect(eff)) return false;
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

/**
 * Fill tone by effect category only（与施法者敌我无关）:
 * HEAL 绿 / FRIENDLY 黄增益 / ENEMY 红伤害.
 * `isEnemyActor` is ignored for fill — use it only for outline side.
 */
export function resolveAoeTone(opts: {
  isHeal?: boolean;
  /** @deprecated Fill ignores caster side; kept for call-site compat. */
  isEnemyActor?: boolean;
  groundKind?: string;
  spellId?: string;
}): AoeVisualTone {
  void opts.isEnemyActor;
  const sid = (opts.spellId || '').toLowerCase();
  // 绿：回血地形（治疗之雨 / 治疗之潮 / 圣光井 / 百花等）
  if (
    opts.isHeal ||
    isHealFillGroundEffect({
      kind: opts.groundKind,
      spellId: opts.spellId,
      remainingMs: 1,
    }) ||
    sid.includes('swiftmend')
  ) {
    return 'HEAL';
  }
  // 红：伤害地形 / 锥形预警
  if (opts.groundKind === 'DAMAGE_ZONE' || opts.groundKind === 'CONE_WARNING') {
    return 'ENEMY';
  }
  // 黄：友方增益图腾等（灵魂链接 / 法力之潮 / 风怒 / 真言术障…）
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
