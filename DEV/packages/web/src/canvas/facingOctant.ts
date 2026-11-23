/**
 * 八向朝向：E NE N NW W SW S SE（画布 Y 向下，atan2 一致）
 * 移动中朝移动方向，否则朝释法/打击目标。
 */
export type FacingDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const FACING_DIR_LABELS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

/** 弧度 → 八向（扇区中心对齐八方向） */
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
  /** 水平镜像（朝西侧） */
  flipX: boolean;
  /** 眼睛水平偏置（正=朝右；侧面加大以便读朝向） */
  eyeBiasX: number;
  /** 武器侧：+1 右 / -1 左（镜像前） */
  weaponSide: 1 | -1;
  /** 是否画正面五官（正北背向隐藏；西北/东北仍露侧脸眼） */
  showFace: boolean;
  /** 肩宽系数（背向略窄） */
  shoulderScale: number;
  /** 前后感：背向躯干略短 */
  depthScaleY: number;
}

/** 由八向得到绘制姿态参数（默认剪影按「朝南/朝镜头」设计） */
export function facingPoseFromDir(dir: FacingDir): FacingPose {
  switch (dir) {
    case 0: // E — 强侧视，眼睛明显偏右
      return { flipX: false, eyeBiasX: 4.2, weaponSide: 1, showFace: true, shoulderScale: 1, depthScaleY: 1 };
    case 1: // SE
      return { flipX: false, eyeBiasX: 2.6, weaponSide: 1, showFace: true, shoulderScale: 1, depthScaleY: 1 };
    case 2: // S
      return { flipX: false, eyeBiasX: 0, weaponSide: 1, showFace: true, shoulderScale: 1, depthScaleY: 1 };
    case 3: // SW
      return { flipX: true, eyeBiasX: 2.6, weaponSide: 1, showFace: true, shoulderScale: 1, depthScaleY: 1 };
    case 4: // W
      return { flipX: true, eyeBiasX: 4.2, weaponSide: 1, showFace: true, shoulderScale: 1, depthScaleY: 1 };
    case 5: // NW — 背斜，仍露侧眼示向
      return { flipX: true, eyeBiasX: 3.2, weaponSide: 1, showFace: true, shoulderScale: 0.92, depthScaleY: 0.95 };
    case 6: // N — 正背，不画五官
      return { flipX: false, eyeBiasX: 0, weaponSide: -1, showFace: false, shoulderScale: 0.88, depthScaleY: 0.92 };
    case 7: // NE
      return { flipX: false, eyeBiasX: 3.2, weaponSide: -1, showFace: true, shoulderScale: 0.92, depthScaleY: 0.95 };
    default:
      return { flipX: false, eyeBiasX: 0, weaponSide: 1, showFace: true, shoulderScale: 1, depthScaleY: 1 };
  }
}

/** 在已 translate 到脚底原点的 ctx 上应用八向变换 */
export function applyFacingPoseTransform(ctx: CanvasRenderingContext2D, pose: FacingPose): void {
  if (pose.flipX) ctx.scale(-1, 1);
  if (pose.shoulderScale !== 1 || pose.depthScaleY !== 1) {
    ctx.scale(pose.shoulderScale, pose.depthScaleY);
  }
}
