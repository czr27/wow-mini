/**
 * Continuous facing pose (canvas Y-down, atan2-consistent):
 * 0=E, π/2=S (toward camera), π=W, −π/2=N (away).
 * Octants remain for debug / quantization helpers only.
 */
export type FacingDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const FACING_DIR_LABELS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

const EYE_BIAS_PEAK = 4.2;

function normalizeRad(rad: number): number {
  let a = rad;
  while (a < -Math.PI) a += Math.PI * 2;
  while (a >= Math.PI) a -= Math.PI * 2;
  return a;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 弧度 → 八向（扇区中心对齐八方向；绘制请用 facingPoseFromRad） */
export function radToFacingDir(rad: number): FacingDir {
  const step = Math.PI / 4;
  let a = rad;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  return (Math.round(a / step) % 8) as FacingDir;
}

export function facingDirToRad(dir: FacingDir): number {
  return (dir * Math.PI) / 4;
}

export interface FacingPose {
  /**
   * @deprecated Continuous pose never mirrors; always false.
   * Kept so older callers compiling against the field still typecheck.
   */
  flipX: boolean;
  /** 眼睛水平偏置（正=朝右 / 东；负=朝左 / 西） */
  eyeBiasX: number;
  /** 武器侧：+1 右 / -1 左 */
  weaponSide: 1 | -1;
  /** 是否画正面五官（faceAlpha > 0.05） */
  showFace: boolean;
  /** 五官不透明度 0..1（背向渐隐） */
  faceAlpha: number;
  /** 肩宽系数（侧面略宽、背向略窄） */
  shoulderScale: number;
  /** 前后感：背向躯干略短 */
  depthScaleY: number;
  /** 0=正面双肢布局，1=强侧视前后肢布局（供 helper 混合） */
  sideFactor: number;
}

/**
 * Continuous pose from facing radians (no hard flip / octant snap).
 * volumeBoost：加大侧面肩宽 / 背向压扁。
 */
export function facingPoseFromRad(rad: number, volumeBoost = false): FacingPose {
  const a = normalizeRad(Number.isFinite(rad) ? rad : Math.PI / 2);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const backFactor = Math.max(0, -s); // 0 front/side → 1 pure north
  const sideAbs = Math.abs(c);

  const eyeBiasX = c * EYE_BIAS_PEAK;
  // 五官：背半球不可见；纯侧视（两眼叠成一只）才开始显化，越朝镜头越实。
  // s=sin：南=+1 镜头 / 东西方=0 侧视 / 北=−1 背影
  const faceAlpha = smoothstep(-0.15, 0.55, s);
  const sideFactor = smoothstep(0.25, 0.92, sideAbs);

  let shoulderScale: number;
  let depthScaleY: number;
  if (volumeBoost) {
    shoulderScale = 1.04 + sideAbs * 0.1 - backFactor * 0.26;
    depthScaleY = 1.04 - sideAbs * 0.14 - backFactor * 0.22;
  } else {
    shoulderScale = 1 - backFactor * 0.12;
    depthScaleY = 1 - backFactor * 0.08;
  }

  const weaponSide: 1 | -1 = c >= 0 ? 1 : -1;

  return {
    flipX: false,
    eyeBiasX,
    weaponSide,
    showFace: faceAlpha > 0.05,
    faceAlpha,
    shoulderScale,
    depthScaleY,
    sideFactor,
  };
}

/** Octant wrapper → continuous pose at that sector center. */
export function facingPoseFromDir(dir: FacingDir, volumeBoost = false): FacingPose {
  return facingPoseFromRad(facingDirToRad(dir), volumeBoost);
}

/** Shoulder / depth scale only — no hard X mirror. */
export function applyFacingPoseTransform(ctx: CanvasRenderingContext2D, pose: FacingPose): void {
  if (pose.shoulderScale !== 1 || pose.depthScaleY !== 1) {
    ctx.scale(pose.shoulderScale, pose.depthScaleY);
  }
}
