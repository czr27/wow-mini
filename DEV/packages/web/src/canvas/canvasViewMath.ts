/**
 * Local-only canvas camera math.
 * World positions stay axis-aligned; view transforms are client presentation only.
 *
 * ISO camera (orbit order):
 * 1) Translate so pivot (player) is origin
 * 2) Yaw around vertical (RMB horizontal)
 * 3) Pitch foreshortens *view depth* (screen-Y after yaw) — RMB vertical
 *    so pitch feels the same at every yaw
 * 4) Zoom + map pivot to screen center
 *
 * Sprites / nameplates / cast bars: billboard upright via enterScreenSpaceFromIso.
 */

/**
 * Pitch = look-down angle from horizontal (degrees).
 * RMB vertical: mouse down → 90° (top-down); mouse up → 20° (low oblique).
 * Squash linear: 20°→0.40, 90°→1.0.
 */
export const ISO_PITCH_DEG_MIN = 20;
export const ISO_PITCH_DEG_MAX = 90;
export const ISO_PITCH_DEG_DEFAULT = 60;
/** Ground view-depth scale at 20° / 90°. */
export const ISO_PITCH_SQUASH_AT_MIN = 0.4;
export const ISO_PITCH_SQUASH_AT_MAX = 1;
export const ISO_ORBIT_PX_PER_TURN = 514;
export const ISO_PITCH_DRAG_PX_FULL = 140;

export function clampIsoPitchDeg(pitchDeg: number): number {
  if (!Number.isFinite(pitchDeg)) return ISO_PITCH_DEG_DEFAULT;
  return Math.min(ISO_PITCH_DEG_MAX, Math.max(ISO_PITCH_DEG_MIN, pitchDeg));
}

/** Map pitch degrees → view-depth Y-scale (20°→0.4 … 90°→1). */
export function pitchDegToSin(pitchDeg: number): number {
  const d = clampIsoPitchDeg(pitchDeg);
  const t = (d - ISO_PITCH_DEG_MIN) / (ISO_PITCH_DEG_MAX - ISO_PITCH_DEG_MIN);
  return ISO_PITCH_SQUASH_AT_MIN + t * (ISO_PITCH_SQUASH_AT_MAX - ISO_PITCH_SQUASH_AT_MIN);
}

/** @deprecated Prefer pitchDegToSin(ISO_PITCH_DEG_DEFAULT). */
export const ISO_PITCH_SIN = pitchDegToSin(ISO_PITCH_DEG_DEFAULT);

/** Mouse down (positive dy) → 90°; mouse up → 20°. */
export function pitchDegFromOrbitDrag(
  pitchDegAtStart: number,
  clientDy: number,
  pxFullRange = ISO_PITCH_DRAG_PX_FULL
): number {
  const span = ISO_PITCH_DEG_MAX - ISO_PITCH_DEG_MIN;
  const delta = (clientDy / Math.max(1, pxFullRange)) * span;
  return clampIsoPitchDeg(pitchDegAtStart + delta);
}

export type ViewCamera = {
  mode: 'TOPDOWN' | 'ISO';
  yawRad: number;
  pivotX: number;
  pivotY: number;
  screenX: number;
  screenY: number;
  pitchSin?: number;
  zoom?: number;
};

export function orbitRadiansPerPixel(pxPerTurn = ISO_ORBIT_PX_PER_TURN): number {
  return (Math.PI * 2) / Math.max(1, pxPerTurn);
}

function camZoom(cam: ViewCamera): number {
  const z = cam.zoom ?? 1;
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/**
 * Apply faux-iso ground transform.
 * Order on points: −pivot → rotate(−yaw) → scale(1, pitch) → zoom → +screen
 * (pitch after yaw = foreshorten camera depth, not world-Y)
 */
export function applyCanvasViewTransform(
  ctx: CanvasRenderingContext2D,
  cam: ViewCamera
): void {
  const zoom = camZoom(cam);
  if (cam.mode !== 'ISO') {
    if (Math.abs(zoom - 1) < 1e-6) return;
    ctx.translate(cam.screenX, cam.screenY);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.screenX, -cam.screenY);
    return;
  }
  const pitch = cam.pitchSin ?? ISO_PITCH_SIN;
  const yaw = cam.yawRad || 0;
  // Canvas applies last-call first → write inverse of desired point order
  ctx.translate(cam.screenX, cam.screenY);
  ctx.scale(zoom, zoom);
  ctx.scale(1, pitch);
  ctx.rotate(-yaw);
  ctx.translate(-cam.pivotX, -cam.pivotY);
}

/**
 * Undo ISO matrix so subsequent draws are upright screen pixels. Pair with restore().
 */
export function enterScreenSpaceFromIso(
  ctx: CanvasRenderingContext2D,
  cam: ViewCamera
): void {
  ctx.save();
  const zoom = camZoom(cam);
  if (cam.mode !== 'ISO') {
    if (Math.abs(zoom - 1) >= 1e-6) {
      ctx.translate(cam.screenX, cam.screenY);
      ctx.scale(1 / zoom, 1 / zoom);
      ctx.translate(-cam.screenX, -cam.screenY);
    }
    return;
  }
  const pitch = cam.pitchSin ?? ISO_PITCH_SIN;
  const yaw = cam.yawRad || 0;
  // Inverse of apply: +pivot → R(+yaw) → S(1,1/pitch) → 1/zoom → −screen
  ctx.translate(cam.pivotX, cam.pivotY);
  ctx.rotate(yaw);
  ctx.scale(1, 1 / Math.max(1e-6, pitch));
  ctx.scale(1 / zoom, 1 / zoom);
  ctx.translate(-cam.screenX, -cam.screenY);
}

/** World → view/canvas pixel (matches applyCanvasViewTransform). */
export function worldToView(
  wx: number,
  wy: number,
  cam: ViewCamera
): { x: number; y: number } {
  const zoom = camZoom(cam);
  if (cam.mode !== 'ISO') {
    if (Math.abs(zoom - 1) < 1e-6) return { x: wx, y: wy };
    return {
      x: (wx - cam.screenX) * zoom + cam.screenX,
      y: (wy - cam.screenY) * zoom + cam.screenY,
    };
  }
  const pitch = cam.pitchSin ?? ISO_PITCH_SIN;
  const yaw = cam.yawRad || 0;
  let x = wx - cam.pivotX;
  let y = wy - cam.pivotY;
  // 1) yaw
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  // 2) pitch (view-depth) + zoom + screen
  return {
    x: rx * zoom + cam.screenX,
    y: ry * pitch * zoom + cam.screenY,
  };
}

/** View/canvas pixel → world (inverse of worldToView / applyCanvasViewTransform). */
export function viewToWorld(
  sx: number,
  sy: number,
  cam: ViewCamera
): { x: number; y: number } {
  const zoom = camZoom(cam);
  if (cam.mode !== 'ISO') {
    if (Math.abs(zoom - 1) < 1e-6) return { x: sx, y: sy };
    return {
      x: (sx - cam.screenX) / zoom + cam.screenX,
      y: (sy - cam.screenY) / zoom + cam.screenY,
    };
  }
  const pitch = cam.pitchSin ?? ISO_PITCH_SIN;
  const yaw = cam.yawRad || 0;
  let x = (sx - cam.screenX) / zoom;
  let y = (sy - cam.screenY) / zoom;
  // 1) unpitch
  y = y / Math.max(1e-6, pitch);
  // 2) unyaw
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  return { x: rx + cam.pivotX, y: ry + cam.pivotY };
}

/**
 * Convert a screen-space move intent (e.g. WASD: W=(0,-1)) into a world-space
 * direction. Inverse of yaw-then-pitch: unpitch, then unyaw.
 */
export function screenDirToWorld(
  dsx: number,
  dsy: number,
  cam: ViewCamera
): { x: number; y: number } {
  if (cam.mode !== 'ISO') return { x: dsx, y: dsy };
  const pitch = cam.pitchSin ?? ISO_PITCH_SIN;
  const yaw = cam.yawRad || 0;
  const ux = dsx;
  const uy = dsy / Math.max(1e-6, pitch);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: ux * c - uy * s, y: ux * s + uy * c };
}

/** Facing for octant sprites: world facing relative to camera yaw. */
export function viewRelativeFacingRad(worldFacingRad: number, cam: ViewCamera): number {
  if (cam.mode !== 'ISO') return worldFacingRad;
  return worldFacingRad - (cam.yawRad || 0);
}

/**
 * Painter depth for billboards: larger = closer to camera = draw later.
 * ISO uses view-space Y after yaw (the axis foreshortened by pitch).
 * TOPDOWN falls back to world Y (classic 2D back-to-front).
 */
export function viewDepthKey(wx: number, wy: number, cam: ViewCamera): number {
  if (cam.mode !== 'ISO') return wy;
  const yaw = cam.yawRad || 0;
  const x = wx - cam.pivotX;
  const y = wy - cam.pivotY;
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  return x * sin + y * cos;
}


export type WorldAabb = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * World AABB that covers the full canvas after the view transform
 * (sample corners + edge midpoints so pitched/yawed frustums still fill the screen).
 */
export function worldAabbCoveringCanvas(
  cam: ViewCamera,
  canvasW: number,
  canvasH: number,
  padPx = 64
): WorldAabb {
  const pts = [
    [0, 0],
    [canvasW, 0],
    [canvasW, canvasH],
    [0, canvasH],
    [canvasW / 2, 0],
    [canvasW, canvasH / 2],
    [canvasW / 2, canvasH],
    [0, canvasH / 2],
    [canvasW / 2, canvasH / 2],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [sx, sy] of pts) {
    const w = viewToWorld(sx, sy, cam);
    if (w.x < minX) minX = w.x;
    if (w.y < minY) minY = w.y;
    if (w.x > maxX) maxX = w.x;
    if (w.y > maxY) maxY = w.y;
  }
  const pitch = cam.mode === 'ISO' ? cam.pitchSin ?? ISO_PITCH_SIN : 1;
  const zoom = camZoom(cam);
  const pad = padPx / Math.max(0.2, Math.min(pitch, 1) * zoom);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}
