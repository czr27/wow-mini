/**
 * 职业 / Boss 朝向剪影：连续 FacingPose。
 * 眼/手/鞋按肢体身份（前/后，由 facing fwd 锚定）做位置矢量插值；脸背向 faceAlpha 渐隐。
 */
import type { ClassId, Unit } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';
import {
  type FacingDir,
  type FacingPose,
  applyFacingPoseTransform,
  facingPoseFromDir,
  facingPoseFromRad,
  radToFacingDir,
} from './facingOctant.js';
import { applySideLightOverlay } from './isoVolumeFx.js';

export type EightDirVolumeOpts = {
  /** Stronger shoulder/depth by facing. */
  octantVolume?: boolean;
  /** Side-light strength 0..1 (0 = off). */
  sideLightStrength?: number;
  /** Screen-space light X sign (−1 left / +1 right). */
  sideLightX?: number;
};

/** 眼睛造型（像素块，按职业/Boss 个性） */
export type EyeLook =
  | 'block'
  | 'glow'
  | 'slit'
  | 'beast'
  | 'ring'
  | 'cross'
  | 'toxic'
  | 'visor'
  | 'hollow'
  | 'rune';

/** 当前朝向姿态（职业/Boss 绘制时写入，供五官 helper 读取） */
let activeFacingPose: FacingPose = facingPoseFromDir(2);

export function getActiveFacingPose(): FacingPose {
  return activeFacingPose;
}

export function facingDirFromRad(rad: number | undefined | null): FacingDir {
  return radToFacingDir(typeof rad === 'number' ? rad : Math.PI / 2); // 默认朝南
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 朝向侧：+1 东/右，−1 西/左（与 weaponSide 一致） */
function facingFwd(pose: FacingPose): 1 | -1 {
  return pose.eyeBiasX >= 0 ? 1 : -1;
}

/** 嘴/眼：乘 faceAlpha；背向直接跳过 */
function withFaceAlpha(
  ctx: CanvasRenderingContext2D,
  pose: FacingPose,
  paint: () => void
): void {
  if (!pose.showFace || pose.faceAlpha <= 0.01) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * pose.faceAlpha;
  paint();
  ctx.globalAlpha = prev;
}

/** 在已算好的矩形上画个性眼（仅 fillRect，便于测试假 ctx） */
function paintEyeLook(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  look: EyeLook
): void {
  if (w < 0.2 || h < 0.2) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const a0 = ctx.globalAlpha;
  switch (look) {
    case 'glow': {
      ctx.fillStyle = color;
      ctx.globalAlpha = a0 * 0.35;
      ctx.fillRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6);
      ctx.globalAlpha = a0;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - w * 0.18, cy - h * 0.18, Math.max(0.6, w * 0.35), Math.max(0.6, h * 0.35));
      break;
    }
    case 'slit': {
      const sw = Math.max(0.7, w * 0.38);
      const sh = h * 1.15;
      ctx.fillStyle = color;
      ctx.fillRect(cx - sw / 2, y - (sh - h) * 0.3, sw, sh);
      break;
    }
    case 'beast': {
      ctx.fillStyle = color;
      ctx.fillRect(x - 0.4, cy - h * 0.28, w + 0.8, Math.max(0.8, h * 0.55));
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - w * 0.12, cy - h * 0.2, Math.max(0.5, w * 0.22), Math.max(0.6, h * 0.4));
      break;
    }
    case 'ring': {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.56);
      ctx.fillStyle = color;
      ctx.fillRect(cx - w * 0.14, cy - h * 0.14, Math.max(0.5, w * 0.28), Math.max(0.5, h * 0.28));
      break;
    }
    case 'cross': {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - w * 0.12, y + h * 0.1, Math.max(0.5, w * 0.24), h * 0.8);
      ctx.fillRect(x + w * 0.1, cy - h * 0.12, w * 0.8, Math.max(0.5, h * 0.24));
      break;
    }
    case 'toxic': {
      ctx.fillStyle = '#14532d';
      ctx.fillRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ecfccb';
      ctx.fillRect(cx - w * 0.15, cy - h * 0.15, Math.max(0.5, w * 0.3), Math.max(0.5, h * 0.3));
      break;
    }
    case 'visor': {
      ctx.fillStyle = color;
      ctx.fillRect(x - 0.6, cy - h * 0.22, w + 1.2, Math.max(0.9, h * 0.5));
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = a0 * 0.55;
      ctx.fillRect(x + w * 0.15, cy - h * 0.12, w * 0.35, Math.max(0.4, h * 0.2));
      ctx.globalAlpha = a0;
      break;
    }
    case 'hollow': {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x - 0.6, y - 0.4, w + 1.2, h + 0.8);
      ctx.fillStyle = color;
      ctx.fillRect(cx - w * 0.22, cy - h * 0.22, Math.max(0.7, w * 0.45), Math.max(0.7, h * 0.45));
      break;
    }
    case 'rune': {
      ctx.fillStyle = color;
      ctx.globalAlpha = a0 * 0.4;
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.globalAlpha = a0;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#e0f2fe';
      ctx.fillRect(cx - w * 0.1, y + h * 0.15, Math.max(0.45, w * 0.2), h * 0.7);
      ctx.fillRect(x + w * 0.15, cy - h * 0.1, w * 0.7, Math.max(0.45, h * 0.2));
      break;
    }
    case 'block':
    default: {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      break;
    }
  }
}

/**
 * 双眼：前眼（朝向侧）滑到侧视位；后眼收向头心并缩小。身份由 facingFwd 锚定。
 */
export function drawFacingEyePair(
  ctx: CanvasRenderingContext2D,
  color: string,
  opts?: {
    y?: number;
    size?: number;
    /** 双眼相对中心的半距（bias 前） */
    halfGap?: number;
    sway?: number;
    pose?: FacingPose;
    look?: EyeLook;
  }
): void {
  const pose = opts?.pose ?? activeFacingPose;
  const sf = clamp01(pose.sideFactor);
  const e = pose.eyeBiasX;
  const y = opts?.y ?? -19;
  const size = opts?.size ?? 2.4;
  const halfGap = opts?.halfGap ?? 3.2;
  const sway = opts?.sway ?? 0;
  const look = opts?.look ?? 'block';
  const fwd = facingFwd(pose);

  const leftX0 = -halfGap + sway + e;
  const rightX0 = halfGap - size + sway + e;
  const sideX1 = sway + fwd * Math.min(5.5, Math.max(2.2, Math.abs(e) * 0.85)) - size * 0.35;
  const sideW1 = size + 0.6;

  // 前眼 = 朝向侧那只；后眼 = 对侧
  const frontX0 = fwd > 0 ? rightX0 : leftX0;
  const rearX0 = fwd > 0 ? leftX0 : rightX0;
  const rearTargetX = sway + e * 0.12 - size * 0.5;

  const frontX = lerp(frontX0, sideX1, sf);
  const frontW = lerp(size, sideW1, sf);
  const rearX = lerp(rearX0, rearTargetX, sf);
  const rearScale = lerp(1, 0, sf);
  const rearW = size * rearScale;
  const rearH = size * rearScale;
  const rearY = y + (size - rearH) * 0.5;

  withFaceAlpha(ctx, pose, () => {
    const baseA = ctx.globalAlpha;
    if (rearW > 0.2) {
      paintEyeLook(ctx, color, rearX, rearY, rearW, rearH, look);
      ctx.globalAlpha = baseA;
    }
    paintEyeLook(ctx, color, frontX, y, frontW, size, look);
    ctx.globalAlpha = baseA;
  });
}

/**
 * 嘴巴：宽度随侧视缩短；下唇随 sideFactor 加厚（几何，非叠影）。
 */
export function drawFacingMouth(
  ctx: CanvasRenderingContext2D,
  color: string,
  opts?: {
    y?: number;
    sway?: number;
    pose?: FacingPose;
  }
): void {
  const pose = opts?.pose ?? activeFacingPose;
  const sf = clamp01(pose.sideFactor);
  const e = pose.eyeBiasX;
  const sway = opts?.sway ?? 0;
  const y = opts?.y ?? -14.2;
  const absE = Math.abs(e);
  const frontW = absE >= 2 ? 4.4 : 5.2;
  const w = lerp(frontW, 3.4, sf);
  const h = lerp(1.7, 1.4, sf);
  const x = sway + e * 0.6 - w / 2;
  const lipH = lerp(0, 0.8, sf);

  withFaceAlpha(ctx, pose, () => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    if (lipH > 0.05) {
      ctx.fillRect(x + w * 0.15, y + h, w * 0.7, lipH);
    }
  });
}

/**
 * 双手：左/右身份锚定 → 前手/后手侧视位；位置与尺寸矢量插值。
 */
export function drawFacingHands(
  ctx: CanvasRenderingContext2D,
  color: string,
  opts?: {
    y?: number;
    sway?: number;
    pose?: FacingPose;
    armW?: number;
    armH?: number;
    spread?: number;
  }
): void {
  const pose = opts?.pose ?? activeFacingPose;
  const sf = clamp01(pose.sideFactor);
  const e = pose.eyeBiasX;
  const sway = opts?.sway ?? 0;
  const y = opts?.y ?? -3;
  const armW = opts?.armW ?? 3.4;
  const armH = opts?.armH ?? 8.5;
  const spread = (opts?.spread ?? 9.2) * (pose.showFace ? 1 : 0.82);
  const bias = e * 0.55;
  const fwd = facingFwd(pose);
  const lead = e * 0.35;

  const leftX0 = -spread + sway + bias - lead * 0.3;
  const leftY0 = y + Math.max(0, -e) * 0.35;
  const rightX0 = spread - armW + sway + bias + lead * 0.3;
  const rightY0 = y + Math.max(0, e) * 0.35;

  const frontX1 = sway + bias + fwd * (spread * 0.85) - armW * 0.4;
  const frontY1 = y - 2.2;
  const frontW1 = armW + 1.2;
  const frontH1 = armH + 1;
  const rearX1 = sway + bias - fwd * (spread * 0.45) - armW * 0.35;
  const rearY1 = y + 1.2;
  const rearW1 = armW * 0.9;
  const rearH1 = armH - 1.2;

  const frontX0 = fwd > 0 ? rightX0 : leftX0;
  const frontY0 = fwd > 0 ? rightY0 : leftY0;
  const rearX0 = fwd > 0 ? leftX0 : rightX0;
  const rearY0 = fwd > 0 ? leftY0 : rightY0;

  const fX = lerp(frontX0, frontX1, sf);
  const fY = lerp(frontY0, frontY1, sf);
  const fW = lerp(armW, frontW1, sf);
  const fH = lerp(armH, frontH1, sf);
  const rX = lerp(rearX0, rearX1, sf);
  const rY = lerp(rearY0, rearY1, sf);
  const rW = lerp(armW, rearW1, sf);
  const rH = lerp(armH, rearH1, sf);

  ctx.fillStyle = color;
  ctx.fillRect(rX, rY, rW, rH);
  ctx.fillRect(fX, fY, fW, fH);
  // 掌：正面小掌 → 侧视前拳
  const palmW = lerp(armW + 1.2, armW + 1.6, sf);
  const palmH = lerp(2.6, 3.2, sf);
  const palmX = lerp(fX - 0.4, sway + bias + fwd * (spread * 0.85 + armW * 0.2), sf);
  const palmY = lerp(fY + fH - 2.2, fY + fH - 3.5, sf);
  ctx.fillRect(palmX, palmY, palmW, palmH);
  // 后手小掌随正面淡出
  if (sf < 0.85) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (1 - sf);
    ctx.fillRect(rX - 0.4, rY + rH - 2.2, armW + 1.2, 2.6);
    ctx.globalAlpha = prev;
  }
}

/** 武器/法杖等水平偏移（与手同向） */
export function facingHandBiasX(pose: FacingPose): number {
  return pose.eyeBiasX * 0.55;
}

/**
 * 鞋子：左/右 → 前/后脚矢量插值；鞋尖随前脚生长。
 */
export function drawFacingShoes(
  ctx: CanvasRenderingContext2D,
  color: string,
  opts?: {
    y?: number;
    sway?: number;
    pose?: FacingPose;
    bootW?: number;
    bootH?: number;
    spread?: number;
  }
): void {
  const pose = opts?.pose ?? activeFacingPose;
  const sf = clamp01(pose.sideFactor);
  const e = pose.eyeBiasX;
  const sway = opts?.sway ?? 0;
  const y = opts?.y ?? 8;
  const bootW = opts?.bootW ?? 6.2;
  const bootH = opts?.bootH ?? 3.8;
  const spread = (opts?.spread ?? 5.2) * (pose.showFace ? 1 : 0.72);
  const bias = e * 0.4;
  const fwd = facingFwd(pose);

  const leftX0 = -spread + sway + bias;
  const rightX0 = spread - bootW + sway + bias;
  const frontX1 = sway + bias + fwd * 2.2 - bootW * 0.35;
  const frontY1 = y - 0.8;
  const frontW1 = bootW + 1.8;
  const rearX1 = sway + bias - fwd * (spread * 0.55) - bootW * 0.35;
  const rearY1 = y + 0.4;
  const rearW1 = bootW * 0.9;
  const rearH1 = bootH - 0.6;

  const frontX0 = fwd > 0 ? rightX0 : leftX0;
  const rearX0 = fwd > 0 ? leftX0 : rightX0;

  const fX = lerp(frontX0, frontX1, sf);
  const fY = lerp(y, frontY1, sf);
  const fW = lerp(bootW, frontW1, sf);
  const fH = bootH;
  const rX = lerp(rearX0, rearX1, sf);
  const rY = lerp(y, rearY1, sf);
  const rW = lerp(bootW, rearW1, sf);
  const rH = lerp(bootH, rearH1, sf);

  ctx.fillStyle = color;
  ctx.fillRect(rX, rY, rW, rH);
  ctx.fillRect(fX, fY, fW, fH);

  // 鞋尖：随朝向与 sideFactor 长出
  const toeReach = (2.2 + Math.abs(e) * 0.2) * Math.max(sf, Math.min(1, Math.abs(e) / 2.5));
  if (toeReach > 0.4) {
    const toeX = sway + bias + fwd * (lerp(2.2, bootW * 0.55 + 1.2, sf)) - 1.2;
    const toeY = fY + fH - lerp(1.3, 1.4, sf);
    ctx.fillRect(toeX, toeY, lerp(3.4, 3.2, sf), lerp(1.5, 1.6, sf));
  }
}

/** 职业身体（脚下原点，已 translate）；facingRad 连续弧度 */
export function drawClassEightDirBody(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  sway: number,
  facingRad: number,
  volumeOpts?: EightDirVolumeOpts
): void {
  const pose = facingPoseFromRad(
    Number.isFinite(facingRad) ? facingRad : Math.PI / 2,
    !!volumeOpts?.octantVolume
  );
  activeFacingPose = pose;
  ctx.save();
  applyFacingPoseTransform(ctx, pose);
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const classColor = CLASS_COLORS[u.classId as keyof typeof CLASS_COLORS] || '#888';

  switch (u.classId as ClassId) {
    case 'DK': {
      ctx.fillStyle = '#1e1b2e';
      ctx.fillRect(-10 + sway, -14, 20, 24);
      ctx.fillStyle = '#C41F3B';
      ctx.fillRect(-8 + sway, -12, 16, 8);
      ctx.fillStyle = '#2d2845';
      ctx.beginPath();
      ctx.arc(0 + sway, -18, 8, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#00ffff', { y: -20, size: 2.6, sway, pose, look: 'rune' });
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(-10 + sway, -24, 3, 7);
      ctx.fillRect(7 + sway, -24, 3, 7);
      ctx.fillStyle = '#475569';
      ctx.fillRect(10 * wSide + sway + hBias, -8, 6 * wSide, 20);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(12 * wSide + sway + hBias, -4, 2 * wSide, 12);
      break;
    }
    case 'DRUID': {
      ctx.fillStyle = '#272018';
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.fillStyle = '#15803D';
      ctx.fillRect(-9 + sway, -10, 18, 6);
      ctx.fillStyle = '#FF7D0A';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#fef3c7', { y: -18.5, size: 2.2, sway, pose, look: 'beast' });
      ctx.strokeStyle = '#B45309';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4 + sway, -23);
      ctx.lineTo(-8 + sway, -28);
      ctx.lineTo(-12 + sway, -31);
      ctx.moveTo(4 + sway, -23);
      ctx.lineTo(8 + sway, -28);
      ctx.lineTo(12 + sway, -31);
      ctx.stroke();
      ctx.fillStyle = '#78350F';
      ctx.fillRect(9 * wSide + sway + hBias, -22, 3 * wSide, 30);
      ctx.fillStyle = '#22C55E';
      ctx.beginPath();
      ctx.arc(10.5 * wSide + sway + hBias, -24, 4.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'SHAMAN': {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9 + sway, -12, 18, 22);
      ctx.fillStyle = '#0070DE';
      ctx.fillRect(-7 + sway, -10, 14, 8);
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 8, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#7dd3fc', { y: -18.5, size: 2.3, sway, pose, look: 'glow' });
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.moveTo(-7 + sway, -23);
      ctx.lineTo(-4 + sway, -29);
      ctx.lineTo(-1 + sway, -23);
      ctx.moveTo(1 + sway, -23);
      ctx.lineTo(4 + sway, -29);
      ctx.lineTo(7 + sway, -23);
      ctx.fill();
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(9 * wSide + sway + hBias, -16, 4 * wSide, 22);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(7 * wSide + sway + hBias, -18, 8 * wSide, 5);
      break;
    }
    case 'MAGE': {
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(-8 + sway, -12, 16, 24);
      ctx.fillStyle = '#40C7EB';
      ctx.fillRect(-6 + sway, -10, 12, 7);
      ctx.fillStyle = '#312e81';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#e0f2fe', { y: -18.5, size: 2.2, sway, pose, look: 'glow' });
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(9 * wSide + sway + hBias, -18, 2.5 * wSide, 24);
      ctx.fillStyle = '#F97316';
      ctx.beginPath();
      ctx.arc(10.5 * wSide + sway + hBias, -20, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ROGUE': {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.fillStyle = '#27272a';
      ctx.fillRect(-7 + sway, -10, 14, 8);
      ctx.fillStyle = '#3f3f46';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#FFF569', { y: -18.2, size: 2.2, sway, pose, look: 'slit' });
      ctx.fillStyle = '#71717a';
      ctx.fillRect(8 * wSide + sway + hBias, -14, 3 * wSide, 18);
      ctx.fillRect(-11 * wSide + sway + hBias, -14, 3 * wSide, 18);
      ctx.fillStyle = '#84CC16';
      ctx.fillRect(7 * wSide + sway + hBias, -16, 5 * wSide, 3);
      ctx.fillRect(-12 * wSide + sway + hBias, -16, 5 * wSide, 3);
      break;
    }
    case 'WARRIOR': {
      ctx.fillStyle = '#3f2e21';
      ctx.fillRect(-10 + sway, -13, 20, 23);
      ctx.fillStyle = '#C79C6E';
      ctx.fillRect(-11 + sway, -13, 22, 6);
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(0 + sway, -18, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-2 + sway, -27, 4, 5);
      drawFacingEyePair(ctx, '#f8fafc', { y: -19.2, size: 2.3, sway, pose, look: 'visor' });
      if (u.role === 'TANK') {
        ctx.fillStyle = '#78350f';
        ctx.fillRect(10 * wSide + sway + hBias, -9, 6 * wSide, 20);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(12 * wSide + sway + hBias, -5, 2 * wSide, 12);
      } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(10 * wSide + sway + hBias, -24, 3.5 * wSide, 28);
        ctx.fillStyle = '#b45309';
        ctx.fillRect(8 * wSide + sway + hBias, -4, 7.5 * wSide, 3);
      }
      break;
    }
    case 'PALADIN': {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-10 + sway, -13, 20, 23);
      ctx.fillStyle = '#F58CBA';
      ctx.fillRect(-8 + sway, -11, 16, 7);
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(-1.5 + sway, -10, 3, 14);
      ctx.fillRect(-5 + sway, -6, 10, 3);
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(0 + sway, -18, 7.5, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#fef08a', { y: -20, size: 2.3, sway, pose, look: 'ring' });
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(10 * wSide + sway + hBias, -18, 3 * wSide, 24);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(7 * wSide + sway + hBias, -21, 9 * wSide, 6);
      break;
    }
    case 'HUNTER': {
      ctx.fillStyle = '#1a2e05';
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.fillStyle = '#ABD473';
      ctx.fillRect(-7 + sway, -10, 14, 7);
      ctx.fillStyle = '#365314';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#bef264', { y: -18.2, size: 2.2, sway, pose, look: 'beast' });
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(9 * wSide + sway + hBias, -6, 12, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.stroke();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10 * wSide + sway + hBias, -17);
      ctx.lineTo(10 * wSide + sway + hBias, 5);
      ctx.stroke();
      break;
    }
    case 'PRIEST': {
      const isShadow = u.role === 'DPS';
      ctx.fillStyle = isShadow ? '#2e1065' : '#e2e8f0';
      ctx.fillRect(-8 + sway, -12, 16, 24);
      ctx.fillStyle = isShadow ? '#9333ea' : '#facc15';
      ctx.fillRect(-6 + sway, -10, 12, 6);
      ctx.fillStyle = isShadow ? '#4c1d95' : '#f8fafc';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, isShadow ? '#e9d5ff' : '#334155', {
        y: -18.5,
        size: 2.2,
        sway,
        pose,
        look: isShadow ? 'hollow' : 'cross',
      });
      ctx.strokeStyle = isShadow ? '#c084fc' : '#fde047';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0 + sway, -26, 6, 2.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = isShadow ? '#7e22ce' : '#eab308';
      ctx.fillRect(9 * wSide + sway + hBias, -20, 2.5 * wSide, 28);
      ctx.fillStyle = isShadow ? '#e879f9' : '#fef08a';
      ctx.beginPath();
      ctx.arc(10.2 * wSide + sway + hBias, -22, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'WARLOCK': {
      ctx.fillStyle = '#1e1033';
      ctx.fillRect(-8 + sway, -12, 16, 24);
      ctx.fillStyle = '#9482C9';
      ctx.fillRect(-6 + sway, -10, 12, 6);
      ctx.fillStyle = '#3b0764';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#a3e635', { y: -18.2, size: 2.2, sway, pose, look: 'toxic' });
      ctx.fillStyle = '#581c87';
      ctx.fillRect(9 * wSide + sway + hBias, -19, 2.5 * wSide, 26);
      ctx.fillStyle = '#84cc16';
      ctx.beginPath();
      ctx.arc(10.2 * wSide + sway + hBias, -21, 4.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = classColor;
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.beginPath();
      ctx.arc(0 + sway, -16, 7, 0, Math.PI * 2);
      ctx.fill();
      drawFacingEyePair(ctx, '#f8fafc', { y: -17.5, size: 2.2, sway, pose });
    }
  }

  const mouthColor =
    u.classId === 'DK' || u.classId === 'WARLOCK'
      ? '#4c0519'
      : u.classId === 'PRIEST' && u.role !== 'DPS'
        ? '#be123c'
        : '#9f1239';
  const shoeColor =
    u.classId === 'PALADIN' || u.classId === 'WARRIOR'
      ? '#334155'
      : u.classId === 'MAGE' || u.classId === 'PRIEST'
        ? '#1e293b'
        : '#1c1917';
  const handColor =
    u.classId === 'DK'
      ? '#2d2845'
      : u.classId === 'MAGE' || u.classId === 'PRIEST'
        ? '#e2e8f0'
        : u.classId === 'WARLOCK'
          ? '#581c87'
          : '#78716c';
  drawFacingMouth(ctx, mouthColor, { y: -14.2, sway, pose });
  drawFacingHands(ctx, handColor, { y: -3.2, sway, pose });
  drawFacingShoes(ctx, shoeColor, { y: 8.2, sway, pose });

  if ((volumeOpts?.sideLightStrength ?? 0) > 0) {
    applySideLightOverlay(ctx, {
      strength: volumeOpts!.sideLightStrength!,
      lightX: volumeOpts?.sideLightX ?? 1,
    });
  }

  ctx.restore();
}

/** Boss：连续朝向姿态变换（肩宽/深度，无硬镜像） */
export function withBossEightDirFacing(
  ctx: CanvasRenderingContext2D,
  facingRad: number,
  drawBody: () => void
): void {
  const pose = facingPoseFromRad(Number.isFinite(facingRad) ? facingRad : Math.PI / 2);
  activeFacingPose = pose;
  ctx.save();
  applyFacingPoseTransform(ctx, pose);
  drawBody();
  drawFacingMouth(ctx, '#7f1d1d', { y: -33, pose });
  drawFacingHands(ctx, '#44403c', {
    y: -6,
    pose,
    armW: 7,
    armH: 16,
    spread: 22,
  });
  drawFacingShoes(ctx, '#0c0a09', {
    y: 30,
    pose,
    bootW: 14,
    bootH: 7.5,
    spread: 13,
  });
  const backShade = 1 - pose.faceAlpha;
  if (backShade > 0.05) {
    ctx.fillStyle = `rgba(0,0,0,${0.18 * backShade})`;
    ctx.fillRect(-36, -70, 72, 100);
  }
  ctx.restore();
}

export type { FacingDir, FacingPose };
