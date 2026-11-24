/**
 * Local-only 2.5D volume helpers (pitch squash, ground foot shadow, fog, side light).
 * Does not change world/logic coordinates.
 */
import {
  ISO_PITCH_DEG_MAX,
  ISO_PITCH_DEG_MIN,
  applyCanvasViewTransform,
  clampIsoPitchDeg,
  type ViewCamera,
  viewDepthKey,
} from './canvasViewMath.js';

/** Body Y-scale: 90° → 1, 20° → squashAtMin. */
export function bodyPitchSquashScale(pitchDeg: number, squashAtMin: number): number {
  const d = clampIsoPitchDeg(pitchDeg);
  const t = (d - ISO_PITCH_DEG_MIN) / (ISO_PITCH_DEG_MAX - ISO_PITCH_DEG_MIN);
  const lo = Number.isFinite(squashAtMin) ? Math.min(1, Math.max(0.5, squashAtMin)) : 0.78;
  return lo + t * (1 - lo);
}

/** Slight lean toward camera at low pitch (screen X shear). */
export function bodyPitchShearX(pitchDeg: number): number {
  const d = clampIsoPitchDeg(pitchDeg);
  const t = (ISO_PITCH_DEG_MAX - d) / (ISO_PITCH_DEG_MAX - ISO_PITCH_DEG_MIN);
  return t * 0.12;
}

export type GroundFootShadowOpts = {
  rx: number;
  ry: number;
  alpha: number;
  /** Soft contact darkening outside the hard ellipse. */
  contactShade?: boolean;
  contactAlpha?: number;
  contactScale?: number;
};

/**
 * Ellipse + optional contact ring at world feet.
 * `cam` unused for transform — caller must already be in ground view space
 * (applyCanvasViewTransform) or pass wrapView=true to apply from identity.
 */
export function drawGroundFootShadow(
  ctx: CanvasRenderingContext2D,
  cam: ViewCamera,
  worldX: number,
  worldY: number,
  opts: GroundFootShadowOpts & { wrapView?: boolean }
): void {
  const alpha = Math.max(0, Math.min(1, opts.alpha));
  if (alpha <= 0.001) return;
  const paint = () => {
    if (opts.contactShade) {
      const cs = opts.contactScale ?? 1.55;
      const ca = opts.contactAlpha ?? alpha * 0.35;
      const grd = ctx.createRadialGradient(worldX, worldY, 0, worldX, worldY, opts.rx * cs);
      grd.addColorStop(0, `rgba(0,0,0,${ca})`);
      grd.addColorStop(0.55, `rgba(0,0,0,${ca * 0.45})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(worldX, worldY, opts.rx * cs, opts.ry * cs, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(worldX, worldY, opts.rx, opts.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (opts.wrapView) {
    ctx.save();
    applyCanvasViewTransform(ctx, cam);
    paint();
    ctx.restore();
  } else {
    paint();
  }
}

/** Camera-relative sun: screen light comes from upper-left of view, rotates with yaw. */
export function sideLightScreenDir(yawRad: number): { x: number; y: number } {
  const sunYaw = (yawRad || 0) + Math.PI * 0.75;
  return { x: Math.cos(sunYaw), y: Math.sin(sunYaw) * 0.35 };
}

/**
 * Soft left/right shade overlay in local body space (origin at feet).
 * lightX > 0 → light from right (darken left).
 */
export function applySideLightOverlay(
  ctx: CanvasRenderingContext2D,
  opts: {
    strength: number;
    lightX: number;
    halfW?: number;
    top?: number;
    bottom?: number;
  }
): void {
  const s = Math.max(0, Math.min(1, opts.strength));
  if (s <= 0.001) return;
  const halfW = opts.halfW ?? 22;
  const top = opts.top ?? -36;
  const bottom = opts.bottom ?? 14;
  const h = bottom - top;
  const lx = opts.lightX >= 0 ? 1 : -1;
  ctx.save();
  // Lit side wash
  const lit = ctx.createLinearGradient(-halfW * lx, 0, halfW * lx, 0);
  lit.addColorStop(0, `rgba(255,245,220,${0.1 * s})`);
  lit.addColorStop(0.45, 'rgba(255,245,220,0)');
  lit.addColorStop(1, 'rgba(255,245,220,0)');
  ctx.fillStyle = lit;
  ctx.fillRect(-halfW, top, halfW * 2, h);
  // Shade opposite
  const shade = ctx.createLinearGradient(halfW * lx, 0, -halfW * lx, 0);
  shade.addColorStop(0, `rgba(0,0,20,${0.22 * s})`);
  shade.addColorStop(0.5, 'rgba(0,0,20,0)');
  shade.addColorStop(1, 'rgba(0,0,20,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(-halfW, top, halfW * 2, h);
  ctx.restore();
}

/**
 * Fog factor 0..1 for a world point (1 = fully fogged / distant).
 * Uses viewDepthKey relative to pivot band.
 */
export function depthFogFactor(
  wx: number,
  wy: number,
  cam: ViewCamera,
  strength: number,
  band = 220
): number {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0.001 || cam.mode !== 'ISO') return 0;
  const d = viewDepthKey(wx, wy, cam);
  // Farther from camera (smaller depth key) → more fog
  const t = Math.max(0, Math.min(1, (-d) / Math.max(40, band)));
  return t * s;
}

/** Multiply fill into a dark veil for distant ground (call in ground space). */
export function drawDepthFogVeil(
  ctx: CanvasRenderingContext2D,
  cam: ViewCamera,
  cells: Array<{ x: number; y: number; r: number }>,
  strength: number
): void {
  if (cam.mode !== 'ISO' || strength <= 0.001) return;
  ctx.save();
  for (const c of cells) {
    const f = depthFogFactor(c.x, c.y, cam, strength);
    if (f <= 0.02) continue;
    ctx.fillStyle = `rgba(8,8,18,${0.55 * f})`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.r, c.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Ground blob under a flying FX (world / ground space). */
export function drawFxHeightShadow(
  ctx: CanvasRenderingContext2D,
  groundX: number,
  groundY: number,
  lift: number,
  opts?: { alpha?: number; rx?: number; ry?: number }
): void {
  if (!(lift > 2)) return;
  const t = Math.min(1, lift / 80);
  const alpha = (opts?.alpha ?? 0.28) * t;
  const rx = (opts?.rx ?? 7) * (0.55 + 0.45 * (1 - t * 0.5));
  const ry = (opts?.ry ?? 3.2) * (0.55 + 0.45 * (1 - t * 0.5));
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(groundX, groundY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}
