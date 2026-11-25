/**
 * Client-side AoE ring state: instant hold + 10ms fade, persistent until effect ends.
 * Remote ground auras: throw from caster → land → grow small→full (not pop-in).
 * Flat fill (no radial feather). Transparency from radius: ≤5yd 40% … ≥30yd 96%.
 */
import type { GroundEffect, Unit, NetworkCombatAction } from '@cata-raid-sim/engine';
import {
  AOE_FADE_MS,
  AOE_INSTANT_HOLD_MS,
  AOE_RGB,
  AOE_OUTLINE_ALLY_RGB,
  AOE_OUTLINE_ENEMY_RGB,
  resolveAoeAlphaByRadiusPx,
  resolveAoeTone,
  isEnemyActorUnit,
  isHealFillGroundEffect,
  type AoeVisualTone,
} from '@cata-raid-sim/engine';
import {
  resolveProjectileFlightStyle,
  sampleProjectileFlight,
  type ProjectileFlightStyle,
} from './combatHitFx.js';

/** Min caster→ground distance (px) to play a throw; closer = local place (grow only). */
export const AOE_REMOTE_THROW_MIN_DIST_PX = 28;
/** Grow duration after landing (or after local place). */
export const AOE_RING_GROW_MS = 240;
/** Start radius as fraction of final while throwing / at land. */
export const AOE_RING_START_FRAC = 0.12;

export type AoeRingMotif =
  | 'WATER_RIPPLE'
  | 'NATURE_PETAL'
  | 'HOLY_RUNE'
  | 'FROST_CRYSTAL'
  | 'UNHOLY_SIGIL'
  | 'ARCANE_RING';

export interface AoeRingState {
  id: string;
  x: number;
  y: number;
  radius: number;
  tone: AoeVisualTone;
  /** true → white outline; false → red outline (by caster side, not fill tone) */
  friendlyCaster: boolean;
  baseAlpha: number;
  /** Deterministic spell/class motif for visual differentiation */
  spellId?: string;
  ownerClassId?: string;
  /** When the ring should start fading (performance.now()) */
  fadeAt: number;
  /** Absolute expire after fade completes */
  expireAt: number;
  /** Linked persistent ground effect id (if any) */
  groundEffectId?: string;
  persistent: boolean;
  /** Final radius after grow completes */
  targetRadius: number;
  bornAt: number;
  /** Caster origin for remote throw (omit / same as land = no throw travel) */
  fromX: number;
  fromY: number;
  landX: number;
  landY: number;
  throwMs: number;
  growMs: number;
  flight: ProjectileFlightStyle;
}

export function resolveAoeRingMotif(
  spellId?: string | null,
  ownerClassId?: string | null,
  tone?: AoeVisualTone
): AoeRingMotif {
  const sid = (spellId || '').toLowerCase();
  const cid = (ownerClassId || '').toUpperCase();
  if (sid.includes('healing_rain') || sid.includes('healing_tide') || sid.includes('治疗之雨') || sid.includes('治疗之潮')) {
    return 'WATER_RIPPLE';
  }
  if (
    sid.includes('efflorescence') ||
    sid.includes('swiftmend') ||
    sid.includes('tranquility') ||
    sid.includes('百花') ||
    cid === 'DRUID'
  ) {
    return 'NATURE_PETAL';
  }
  if (
    sid.includes('power_word_barrier') ||
    sid.includes('pw_barrier') ||
    sid.includes('lightwell') ||
    sid.includes('light_well') ||
    sid.includes('consecration') ||
    sid.includes('圣光井') ||
    cid === 'PRIEST' ||
    cid === 'PALADIN'
  ) {
    return 'HOLY_RUNE';
  }
  if (
    sid.includes('blizzard') ||
    sid.includes('frozen_orb') ||
    sid.includes('ring_of_frost') ||
    sid.includes('暴风雪') ||
    sid.includes('寒冰宝珠') ||
    cid === 'MAGE'
  ) {
    return 'FROST_CRYSTAL';
  }
  if (
    sid.includes('death_and_decay') ||
    sid.includes('desecration') ||
    sid.includes('rain_of_fire') ||
    sid.includes('枯萎凋零') ||
    sid.includes('亵渎') ||
    cid === 'DK' ||
    cid === 'WARLOCK' ||
    tone === 'ENEMY'
  ) {
    return 'UNHOLY_SIGIL';
  }
  return 'ARCANE_RING';
}

function toneRgb(tone: AoeVisualTone): readonly [number, number, number] {
  return AOE_RGB[tone];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Throw duration scales with distance; local placements get 0. */
export function resolveAoeThrowMs(distPx: number): number {
  if (distPx < AOE_REMOTE_THROW_MIN_DIST_PX) return 0;
  return Math.round(clamp(160 + distPx * 0.55, 220, 480));
}

export function resolveAoeRingPose(
  ring: Pick<
    AoeRingState,
    | 'bornAt'
    | 'fromX'
    | 'fromY'
    | 'landX'
    | 'landY'
    | 'throwMs'
    | 'growMs'
    | 'targetRadius'
    | 'flight'
    | 'x'
    | 'y'
    | 'radius'
  >,
  now: number
): { x: number; y: number; radius: number; throwing: boolean; growT: number } {
  const age = Math.max(0, now - ring.bornAt);
  const throwMs = Math.max(0, ring.throwMs || 0);
  const growMs = Math.max(0, ring.growMs ?? AOE_RING_GROW_MS);
  const targetR = Math.max(1, ring.targetRadius || ring.radius || 1);
  const startR = Math.max(6, targetR * AOE_RING_START_FRAC);

  if (throwMs > 0 && age < throwMs) {
    const t = age / throwMs;
    const pose = sampleProjectileFlight(
      ring.fromX,
      ring.fromY,
      ring.landX,
      ring.landY,
      t,
      ring.flight || 'arc'
    );
    // Slight grow while in flight so the landing blob already reads as an aura seed
    const rad = startR + (targetR * 0.18 - startR) * t;
    return { x: pose.x, y: pose.y, radius: rad, throwing: true, growT: 0 };
  }

  const growAge = age - throwMs;
  if (growMs > 0 && growAge < growMs) {
    const t = clamp(growAge / growMs, 0, 1);
    const ease = 1 - (1 - t) * (1 - t);
    return {
      x: ring.landX,
      y: ring.landY,
      radius: startR + (targetR - startR) * ease,
      throwing: false,
      growT: t,
    };
  }

  return {
    x: ring.landX ?? ring.x,
    y: ring.landY ?? ring.y,
    radius: targetR,
    throwing: false,
    growT: 1,
  };
}

export function createInstantRing(opts: {
  id: string;
  x: number;
  y: number;
  radius: number;
  tone: AoeVisualTone;
  baseAlpha: number;
  friendlyCaster?: boolean;
  now?: number;
}): AoeRingState {
  const now = opts.now ?? performance.now();
  const fadeAt = now + AOE_INSTANT_HOLD_MS;
  return {
    id: opts.id,
    x: opts.x,
    y: opts.y,
    radius: opts.radius,
    tone: opts.tone,
    friendlyCaster: opts.friendlyCaster !== false,
    baseAlpha: opts.baseAlpha,
    fadeAt,
    expireAt: fadeAt + AOE_FADE_MS,
    persistent: false,
    targetRadius: opts.radius,
    bornAt: now,
    fromX: opts.x,
    fromY: opts.y,
    landX: opts.x,
    landY: opts.y,
    throwMs: 0,
    growMs: 0,
    flight: 'straight',
  };
}

export function createPersistentRing(opts: {
  id: string;
  x: number;
  y: number;
  radius: number;
  tone: AoeVisualTone;
  baseAlpha: number;
  remainingMs: number;
  friendlyCaster?: boolean;
  spellId?: string;
  ownerClassId?: string;
  now?: number;
  fromX?: number;
  fromY?: number;
  flight?: ProjectileFlightStyle;
  throwMs?: number;
  growMs?: number;
}): AoeRingState {
  const now = opts.now ?? performance.now();
  const fadeAt = now + Math.max(0, opts.remainingMs);
  const fromX = opts.fromX ?? opts.x;
  const fromY = opts.fromY ?? opts.y;
  const dist = Math.hypot(opts.x - fromX, opts.y - fromY);
  const throwMs = opts.throwMs ?? resolveAoeThrowMs(dist);
  const growMs = opts.growMs ?? AOE_RING_GROW_MS;
  return {
    id: opts.id,
    x: opts.x,
    y: opts.y,
    radius: opts.radius,
    tone: opts.tone,
    friendlyCaster: opts.friendlyCaster !== false,
    baseAlpha: opts.baseAlpha,
    spellId: opts.spellId,
    ownerClassId: opts.ownerClassId,
    fadeAt,
    expireAt: fadeAt + AOE_FADE_MS,
    groundEffectId: opts.id,
    persistent: true,
    targetRadius: opts.radius,
    bornAt: now,
    fromX,
    fromY,
    landX: opts.x,
    landY: opts.y,
    throwMs,
    growMs,
    flight: opts.flight ?? 'arc',
  };
}

/** Sync persistent rings from host groundEffects; departing ids get a 10ms fade. */
export function syncPersistentRingsFromGround(
  rings: AoeRingState[],
  groundEffects: GroundEffect[],
  unitsById: Map<string, Unit>,
  now: number
): AoeRingState[] {
  const next = rings.filter((r) => !r.persistent || now < r.expireAt);
  const byId = new Map(next.map((r) => [r.id, r]));
  const liveIds = new Set<string>();

  for (const g of groundEffects) {
    if (g.kind === 'CONE_WARNING') continue;
    // Totem / heal / damage zones all show a radius fill
    if (g.kind !== 'HEAL_ZONE' && g.kind !== 'DAMAGE_ZONE' && g.kind !== 'TOTEM') continue;
    liveIds.add(g.id);
    const owner = unitsById.get(g.ownerId);
    const isHealFill = isHealFillGroundEffect(g);
    const friendlyCaster = !isEnemyActorUnit(owner);
    // 填充只看分类：绿治疗 / 黄增益 / 红伤害；描边看敌我
    const finalTone = resolveAoeTone({
      groundKind: g.kind,
      spellId: g.spellId,
      isHeal: isHealFill,
    });
    const baseAlpha = resolveAoeAlphaByRadiusPx(g.radius);
    const existing = byId.get(g.id);
    if (existing && existing.persistent) {
      existing.landX = g.x;
      existing.landY = g.y;
      existing.targetRadius = g.radius;
      existing.tone = finalTone;
      existing.friendlyCaster = friendlyCaster;
      existing.baseAlpha = baseAlpha;
      existing.spellId = g.spellId;
      existing.ownerClassId = owner?.classId;
      // Keep fadeAt in sync with remaining lifetime (don't restart fade early)
      const wantFade = now + Math.max(0, g.remainingMs);
      if (Math.abs(wantFade - existing.fadeAt) > 40) {
        existing.fadeAt = wantFade;
        existing.expireAt = wantFade + AOE_FADE_MS;
      }
      // After throw+grow, snap logical x/y/radius to ground for consumers
      const pose = resolveAoeRingPose(existing, now);
      if (!pose.throwing && pose.growT >= 1) {
        existing.x = g.x;
        existing.y = g.y;
        existing.radius = g.radius;
      }
    } else {
      const fromX = owner?.position?.x ?? g.x;
      const fromY = owner?.position?.y ?? g.y;
      const ring = createPersistentRing({
        id: g.id,
        x: g.x,
        y: g.y,
        radius: g.radius,
        tone: finalTone,
        friendlyCaster,
        baseAlpha,
        spellId: g.spellId,
        ownerClassId: owner?.classId,
        remainingMs: g.remainingMs,
        now,
        fromX,
        fromY,
        flight: resolveProjectileFlightStyle(owner?.classId),
      });
      next.push(ring);
      byId.set(g.id, ring);
    }
  }

  // Effects removed from snapshot → start fade immediately if not already fading
  for (const r of next) {
    if (!r.persistent) continue;
    if (liveIds.has(r.id)) continue;
    if (r.fadeAt > now) {
      r.fadeAt = now;
      r.expireAt = now + AOE_FADE_MS;
    }
  }

  return next.filter((r) => now < r.expireAt);
}

export function ingestCombatActionsAsRings(
  rings: AoeRingState[],
  actions: Array<NetworkCombatAction | {
    id: string;
    actorId: string;
    spellId: string;
    x?: number;
    y?: number;
    radius?: number;
    aoePulse?: boolean;
    visualTone?: AoeVisualTone;
    kind?: string;
    groundEffectId?: string;
  }>,
  unitsById: Map<string, Unit>,
  now: number,
  seenIds: Set<string>
): AoeRingState[] {
  // Instant aoePulse actions draw as feathered class-color discs (combatClassAoePulse),
  // not flat terrain rings. Persistent zones still come from groundEffects.
  void actions;
  void unitsById;
  void seenIds;
  return rings.filter((r) => now < r.expireAt);
}

/**
 * Hard-edged flat fill — remote rings throw from caster then grow to final radius.
 * Transparency from drawn radius (≤5yd → 40% → alpha 0.6; ≥30yd → 96% → alpha 0.04).
 */
export function drawAoeRing(
  ctx: CanvasRenderingContext2D,
  ring: AoeRingState,
  now: number,
  opts?: { heightShadow?: boolean }
): void {
  if (now >= ring.expireAt) return;
  const pose = resolveAoeRingPose(ring, now);
  const rad = Math.max(1, pose.radius);
  let alpha = resolveAoeAlphaByRadiusPx(Math.max(rad, ring.targetRadius || rad));
  // While throwing / early grow, nudge alpha up so the seed is readable
  if (pose.throwing || pose.growT < 1) {
    alpha = Math.max(alpha, 0.22);
  }
  if (now >= ring.fadeAt) {
    const t = (now - ring.fadeAt) / Math.max(1, AOE_FADE_MS);
    alpha *= 1 - Math.min(1, t);
  }
  if (alpha <= 0.001) return;

  const [r, g, b] = toneRgb(ring.tone);
  const outline = ring.friendlyCaster !== false ? AOE_OUTLINE_ALLY_RGB : AOE_OUTLINE_ENEMY_RGB;
  const outlineA = Math.min(1, 0.55 + alpha * 0.45);

  // Ground shadow under flying throw (land point, not lifted tip)
  if (opts?.heightShadow && pose.throwing) {
    const age = Math.max(0, now - ring.bornAt);
    const throwMs = Math.max(1, ring.throwMs || 1);
    const t = Math.min(1, age / throwMs);
    const flight = sampleProjectileFlight(
      ring.fromX,
      ring.fromY,
      ring.landX,
      ring.landY,
      t,
      ring.flight || 'arc'
    );
    if (flight.lift > 2) {
      const gx = ring.fromX + (ring.landX - ring.fromX) * t;
      const gy = ring.fromY + (ring.landY - ring.fromY) * t;
      const shadowT = Math.min(1, flight.lift / 80);
      ctx.fillStyle = `rgba(0,0,0,${0.22 * shadowT})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, Math.max(5, rad * 0.55), Math.max(2.5, rad * 0.22), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, rad, 0, Math.PI * 2);
  ctx.fill();

  // Bright seed + tapered motion trail at the thrown tip so the lob reads as a projectile
  if (pose.throwing) {
    const age = Math.max(0, now - ring.bornAt);
    const throwMs = Math.max(1, ring.throwMs || 1);
    const t = Math.min(1, age / throwMs);
    const prevT = Math.max(0, t - 0.14);
    const prevPose = sampleProjectileFlight(
      ring.fromX,
      ring.fromY,
      ring.landX,
      ring.landY,
      prevT,
      ring.flight || 'arc'
    );
    const seedR = Math.max(4, rad * 0.45);
    const seedA = Math.min(0.88, alpha + 0.38);

    // Tapered motion trail behind thrown aura seed
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${seedA * 0.55})`;
    ctx.lineWidth = Math.max(2, seedR * 0.9);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(prevPose.x, prevPose.y);
    ctx.lineTo(pose.x, pose.y);
    ctx.stroke();

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${seedA})`;
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, seedR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${outline[0]}, ${outline[1]}, ${outline[2]}, ${Math.min(0.75, seedA)})`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, seedR, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // 强制描边：友方白 / 敌方红
    ctx.strokeStyle = `rgba(${outline[0]}, ${outline[1]}, ${outline[2]}, ${outlineA})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, rad, 0, Math.PI * 2);
    ctx.stroke();

    // Deterministic spell/class motif accents (lightweight, non-cluttering)
    const motif = resolveAoeRingMotif(ring.spellId, ring.ownerClassId, ring.tone);
    const accentA = Math.min(0.65, alpha + 0.22);
    if (rad >= 14) {
      ctx.strokeStyle = `rgba(${outline[0]}, ${outline[1]}, ${outline[2]}, ${accentA * 0.55})`;
      ctx.lineWidth = 1;
      if (motif === 'WATER_RIPPLE') {
        ctx.beginPath();
        ctx.arc(pose.x, pose.y, rad * 0.68, 0, Math.PI * 2);
        ctx.stroke();
      } else if (motif === 'NATURE_PETAL' || motif === 'FROST_CRYSTAL') {
        const ticks = 6;
        ctx.beginPath();
        for (let i = 0; i < ticks; i++) {
          const a = (i * Math.PI * 2) / ticks;
          ctx.moveTo(pose.x + Math.cos(a) * rad * 0.86, pose.y + Math.sin(a) * rad * 0.86);
          ctx.lineTo(pose.x + Math.cos(a) * rad, pose.y + Math.sin(a) * rad);
        }
        ctx.stroke();
      } else if (motif === 'HOLY_RUNE') {
        const ticks = 4;
        ctx.beginPath();
        for (let i = 0; i < ticks; i++) {
          const a = (i * Math.PI * 2) / ticks;
          ctx.moveTo(pose.x + Math.cos(a) * rad * 0.8, pose.y + Math.sin(a) * rad * 0.8);
          ctx.lineTo(pose.x + Math.cos(a) * rad * 1.06, pose.y + Math.sin(a) * rad * 1.06);
        }
        ctx.stroke();
      } else if (motif === 'UNHOLY_SIGIL') {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(pose.x, pose.y, rad * 0.82, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/** 锥形预警：伤害类红填充；描边按施法者敌我（Boss 锥形 → 红边） */
export function drawConeWarning(
  ctx: CanvasRenderingContext2D,
  effect: Pick<GroundEffect, 'x' | 'y' | 'radius'> & {
    facingRad?: number;
    coneAngleRad?: number;
    colorHex?: string;
  },
  opts?: { friendlyCaster?: boolean }
): void {
  const rad = Math.max(1, effect.radius);
  const alpha = resolveAoeAlphaByRadiusPx(rad);
  if (alpha <= 0.001) return;
  const facing = effect.facingRad ?? Math.PI;
  const coneAngle = effect.coneAngleRad ?? Math.PI / 3;
  // 分类：锥形预警一律伤害红（忽略 colorHex）
  const [r, g, b] = AOE_RGB.ENEMY;
  const outline = opts?.friendlyCaster ? AOE_OUTLINE_ALLY_RGB : AOE_OUTLINE_ENEMY_RGB;
  const outlineA = Math.min(1, 0.55 + alpha * 0.45);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.beginPath();
  ctx.moveTo(effect.x, effect.y);
  ctx.arc(effect.x, effect.y, rad, facing - coneAngle / 2, facing + coneAngle / 2);
  ctx.closePath();
  ctx.fill();

  // Inner range arc guides for immediate cone readability
  if (rad >= 20) {
    ctx.strokeStyle = `rgba(${outline[0]}, ${outline[1]}, ${outline[2]}, ${outlineA * 0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, rad * 0.55, facing - coneAngle / 2, facing + coneAngle / 2);
    ctx.stroke();
  }

  ctx.strokeStyle = `rgba(${outline[0]}, ${outline[1]}, ${outline[2]}, ${outlineA})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(effect.x, effect.y);
  ctx.arc(effect.x, effect.y, rad, facing - coneAngle / 2, facing + coneAngle / 2);
  ctx.closePath();
  ctx.stroke();
}
