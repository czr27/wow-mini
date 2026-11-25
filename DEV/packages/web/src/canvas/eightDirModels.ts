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
  /** Ambient neon FX intensity 0..1 (1 = local player/focus, 0.25 = unrelated teammates). */
  fxIntensity?: number;
  /** Animation tick for subtle neon pulse/orbiters. */
  tickCount?: number;
};

/** 赛博/霓虹深渊统一深墨轮廓色 */
export const NEON_INK = '#090B14';

/** 零 shadowBlur 高性能霓虹矩形（外晕 + 高饱和本体 + 可选白炽核心） */
export function drawNeonGlowRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  neonColor: string,
  intensity = 1,
  coreColor: string | null = '#ffffff'
): void {
  const k = Math.max(0, Math.min(1.2, intensity));
  const a0 = ctx.globalAlpha;
  if (k > 0.15) {
    ctx.globalAlpha = a0 * 0.3 * Math.min(1, k);
    ctx.fillStyle = neonColor;
    ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  }
  ctx.globalAlpha = a0;
  ctx.fillStyle = neonColor;
  ctx.fillRect(x, y, w, h);
  if (coreColor && Math.abs(w) >= 2 && Math.abs(h) >= 2) {
    ctx.globalAlpha = a0 * (0.55 + 0.45 * Math.min(1, k));
    ctx.fillStyle = coreColor;
    ctx.fillRect(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5);
  }
  ctx.globalAlpha = a0;
}

/** 零 shadowBlur 高性能霓虹圆点/法球 */
export function drawNeonGlowCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  neonColor: string,
  intensity = 1,
  coreColor: string | null = '#ffffff'
): void {
  const k = Math.max(0, Math.min(1.2, intensity));
  const a0 = ctx.globalAlpha;
  if (k > 0.15) {
    ctx.globalAlpha = a0 * 0.28 * Math.min(1, k);
    ctx.fillStyle = neonColor;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = a0;
  ctx.fillStyle = neonColor;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (coreColor && r >= 1.4) {
    ctx.globalAlpha = a0 * (0.6 + 0.4 * Math.min(1, k));
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = a0;
}

/** 零 shadowBlur 霓虹能量线 */
export function drawNeonGlowLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  neonColor: string,
  intensity = 1,
  coreColor: string | null = '#ffffff'
): void {
  const k = Math.max(0, Math.min(1.2, intensity));
  const a0 = ctx.globalAlpha;
  ctx.lineCap = 'round';
  if (k > 0.15) {
    ctx.globalAlpha = a0 * 0.3 * Math.min(1, k);
    ctx.strokeStyle = neonColor;
    ctx.lineWidth = width + 2.6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.globalAlpha = a0;
  ctx.strokeStyle = neonColor;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  if (coreColor && width >= 1.5) {
    ctx.globalAlpha = a0 * (0.55 + 0.45 * Math.min(1, k));
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = Math.max(0.8, width * 0.38);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.globalAlpha = a0;
}

/** 带深墨轮廓与可选霓虹边缘光的赛博矩形 */
export function drawCyberBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline = NEON_INK,
  rimColor?: string,
  rimWidth = 1.4
): void {
  ctx.fillStyle = outline;
  ctx.fillRect(x - 1.2, y - 1.2, w + 2.4, h + 2.4);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (rimColor) {
    ctx.fillStyle = rimColor;
    ctx.fillRect(x, y, w, rimWidth);
  }
}

/** 八向三层动态遮挡：正面 back→core→front；背面 front→core→back */
export function isFacingBack(pose: FacingPose): boolean {
  return !pose.showFace || pose.faceAlpha < 0.35;
}

export function drawEightDirLayers(
  pose: FacingPose,
  layers: { back?: () => void; core: () => void; front?: () => void }
): void {
  if (isFacingBack(pose)) {
    layers.front?.();
    layers.core();
    layers.back?.();
  } else {
    layers.back?.();
    layers.core();
    layers.front?.();
  }
}

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

type DruidSpecKey = 'RESTORATION' | 'BALANCE' | 'FERAL';

function resolveDruidSpec(u: Unit): DruidSpecKey {
  const s = (u.spec || '').toUpperCase();
  if (s === 'RESTORATION' || s === 'BALANCE' || s === 'FERAL') return s;
  if (u.role === 'HEALER') return 'RESTORATION';
  if (u.role === 'TANK') return 'FERAL';
  return 'BALANCE';
}

/** 德鲁伊三专精：高饱和赛博/霓虹 × 魔兽原味八向模型 */
function drawCyberDruidEightDir(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  sway: number,
  pose: FacingPose,
  fxIntensity: number,
  tickCount: number
): void {
  const spec = resolveDruidSpec(u);
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const sf = clamp01(pose.sideFactor);
  const e = pose.eyeBiasX;

  const palette =
    spec === 'RESTORATION'
      ? {
          chassis: '#0f1f18',
          armor: '#163828',
          neon: '#00FF87',
          neonAlt: '#38BDF8',
          cloak: '#064e3b',
          eye: '#00FF87',
          eyeLook: 'glow' as EyeLook,
        }
      : spec === 'BALANCE'
        ? {
            chassis: '#130e26',
            armor: '#251749',
            neon: '#C026D3',
            neonAlt: '#00F0FF',
            cloak: '#1e1b4b',
            eye: '#00F0FF',
            eyeLook: 'ring' as EyeLook,
          }
        : {
            chassis: '#1a110d',
            armor: '#3b1e0e',
            neon: '#FF7D0A',
            neonAlt: '#FFE600',
            cloak: '#451a03',
            eye: '#FFB800',
            eyeLook: 'beast' as EyeLook,
          };

  const drawBack = () => {
    const cloakW = isFacingBack(pose) ? 18 : 14;
    drawCyberBox(
      ctx,
      -cloakW / 2 + sway - e * 0.2,
      -12,
      cloakW,
      23,
      palette.cloak,
      NEON_INK,
      palette.neon,
      1.6
    );
    if (isFacingBack(pose)) {
      if (spec === 'RESTORATION') {
        drawNeonGlowLine(ctx, sway, -9, sway, 8, 1.5, palette.neon, fxIntensity);
        drawNeonGlowLine(ctx, sway, -3, sway - 5, -7, 1.2, palette.neon, fxIntensity);
        drawNeonGlowLine(ctx, sway, -1, sway + 5, -5, 1.2, palette.neon, fxIntensity);
      } else if (spec === 'BALANCE') {
        drawNeonGlowCircle(ctx, sway, -2, 3.6, palette.neonAlt, fxIntensity, '#ffffff');
        ctx.fillStyle = palette.cloak;
        ctx.beginPath();
        ctx.arc(sway + 1.6, -2.6, 2.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let i = -1; i <= 1; i++) {
          drawNeonGlowLine(
            ctx,
            sway + i * 3.2,
            -8,
            sway + i * 3.2,
            4,
            1.4,
            palette.neon,
            fxIntensity
          );
        }
      }
    }
  };

  const drawCore = () => {
    drawCyberBox(ctx, -8.5 + sway, -12, 17, 22, palette.chassis, NEON_INK);
    drawCyberBox(
      ctx,
      -7 + sway,
      -10.5,
      14,
      7.5,
      palette.armor,
      NEON_INK,
      palette.neon,
      1.5
    );
    drawNeonGlowRect(ctx, -2 + sway + e * 0.2, -8, 4, 3, palette.neon, fxIntensity);

    const pW = lerp(6.5, 8.2, sf);
    const pH = 7.2;
    const leftPX = -12.5 + sway + e * 0.2;
    const rightPX = 12.5 - pW + sway + e * 0.2;
    drawCyberBox(ctx, leftPX, -13.5, pW, pH, palette.armor, NEON_INK, palette.neon, 1.5);
    drawCyberBox(ctx, rightPX, -13.5, pW, pH, palette.armor, NEON_INK, palette.neonAlt, 1.5);

    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(sway, -17.5, 8.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = spec === 'FERAL' ? '#9a3412' : spec === 'BALANCE' ? '#3b0764' : '#065f46';
    ctx.beginPath();
    ctx.arc(sway, -17.5, 7.2, 0, Math.PI * 2);
    ctx.fill();

    if (spec === 'RESTORATION') {
      drawNeonGlowLine(ctx, -4 + sway, -23, -10 + sway, -30, 2, '#92400e', 0.4, null);
      drawNeonGlowLine(ctx, 4 + sway, -23, 10 + sway, -30, 2, '#92400e', 0.4, null);
      drawNeonGlowCircle(ctx, -10.5 + sway, -30.5, 2.2, palette.neon, fxIntensity);
      drawNeonGlowCircle(ctx, 10.5 + sway, -30.5, 2.2, palette.neon, fxIntensity);
    } else if (spec === 'BALANCE') {
      ctx.fillStyle = palette.neon;
      ctx.beginPath();
      ctx.moveTo(-7 + sway, -22);
      ctx.lineTo(-11 + sway, -27);
      ctx.lineTo(-4 + sway, -24);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(7 + sway, -22);
      ctx.lineTo(11 + sway, -27);
      ctx.lineTo(4 + sway, -24);
      ctx.fill();
      if (fxIntensity > 0.4) {
        drawNeonGlowCircle(ctx, sway, -28.5, 2.3, palette.neonAlt, fxIntensity);
      }
    } else {
      ctx.fillStyle = NEON_INK;
      ctx.beginPath();
      ctx.moveTo(-7 + sway, -22);
      ctx.lineTo(-9 + sway, -29);
      ctx.lineTo(-2 + sway, -24);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(7 + sway, -22);
      ctx.lineTo(9 + sway, -29);
      ctx.lineTo(2 + sway, -24);
      ctx.fill();
      drawNeonGlowRect(ctx, -1.5 + sway + e * 0.35, -22, 3, 2.5, palette.neonAlt, fxIntensity, null);
    }

    drawFacingEyePair(ctx, palette.eye, {
      y: -18.5,
      size: 2.5,
      sway,
      pose,
      look: palette.eyeLook,
    });
  };

  const drawFront = () => {
    const wx = 10 * wSide + sway + hBias;
    if (spec === 'RESTORATION') {
      drawCyberBox(ctx, wx - 1.5, -22, 3, 30, '#451a03', NEON_INK);
      drawNeonGlowCircle(ctx, wx, -24.5, 4.4, palette.neon, fxIntensity);
      if (fxIntensity >= 0.75) {
        const ang = tickCount * 0.1;
        drawNeonGlowCircle(
          ctx,
          sway + Math.cos(ang) * 14,
          -10 + Math.sin(ang) * 5,
          1.8,
          palette.neon,
          fxIntensity
        );
      }
    } else if (spec === 'BALANCE') {
      drawCyberBox(ctx, wx - 1.5, -22, 3, 30, '#312e81', NEON_INK);
      drawNeonGlowCircle(ctx, wx, -24.5, 4.5, palette.neonAlt, fxIntensity);
      ctx.fillStyle = NEON_INK;
      ctx.beginPath();
      ctx.arc(wx + 1.8 * wSide, -25, 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (fxIntensity >= 0.75) {
        const ang = tickCount * 0.12;
        drawNeonGlowCircle(
          ctx,
          sway + Math.cos(ang) * 15,
          -14 + Math.sin(ang) * 6,
          1.9,
          palette.neon,
          fxIntensity
        );
      }
    } else {
      const clawX1 = 10 * wSide + sway + hBias;
      const clawX2 = -9 * wSide + sway + hBias * 0.6;
      for (let i = -1; i <= 1; i++) {
        drawNeonGlowLine(
          ctx,
          clawX1,
          -2 + i * 2.2,
          clawX1 + 6 * wSide,
          1 + i * 2.5,
          1.6,
          palette.neon,
          fxIntensity
        );
        drawNeonGlowLine(
          ctx,
          clawX2,
          -1 + i * 2.2,
          clawX2 - 4.5 * wSide,
          2 + i * 2.2,
          1.3,
          palette.neonAlt,
          fxIntensity * 0.85
        );
      }
    }
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
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
      drawCyberDruidEightDir(
        ctx,
        u,
        sway,
        pose,
        volumeOpts?.fxIntensity ?? 1,
        volumeOpts?.tickCount ?? 0
      );
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

export type BossEightDirOpts = {
  hideHands?: boolean;
  hideShoes?: boolean;
  hideMouth?: boolean;
  handColor?: string;
  shoeColor?: string;
  mouthColor?: string;
  backShadeAlpha?: number;
};

/** Boss：连续朝向姿态变换（肩宽/深度，无硬镜像） */
export function withBossEightDirFacing(
  ctx: CanvasRenderingContext2D,
  facingRad: number,
  drawBody: () => void,
  bossOpts?: BossEightDirOpts
): void {
  const pose = facingPoseFromRad(Number.isFinite(facingRad) ? facingRad : Math.PI / 2);
  activeFacingPose = pose;
  ctx.save();
  applyFacingPoseTransform(ctx, pose);
  drawBody();
  if (!bossOpts?.hideMouth) {
    drawFacingMouth(ctx, bossOpts?.mouthColor ?? '#7f1d1d', { y: -33, pose });
  }
  if (!bossOpts?.hideHands) {
    drawFacingHands(ctx, bossOpts?.handColor ?? '#44403c', {
      y: -6,
      pose,
      armW: 7,
      armH: 16,
      spread: 22,
    });
  }
  if (!bossOpts?.hideShoes) {
    drawFacingShoes(ctx, bossOpts?.shoeColor ?? '#0c0a09', {
      y: 30,
      pose,
      bootW: 14,
      bootH: 7.5,
      spread: 13,
    });
  }
  const backShade = 1 - pose.faceAlpha;
  const shadeMax = bossOpts?.backShadeAlpha ?? 0.18;
  if (backShade > 0.05 && shadeMax > 0.005) {
    ctx.fillStyle = `rgba(0,0,0,${shadeMax * backShade})`;
    ctx.fillRect(-36, -70, 72, 100);
  }
  ctx.restore();
}

export type { FacingDir, FacingPose };
