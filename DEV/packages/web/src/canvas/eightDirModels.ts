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
    drawCyberBox(ctx, leftPX, -13.5, pW, pH, palette.armor, NEON_INK, '#FF7D0A', 1.6);
    drawCyberBox(ctx, rightPX, -13.5, pW, pH, palette.armor, NEON_INK, palette.neon, 1.5);

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

type CyberHeroStyle = {
  chassis: string;
  armor: string;
  classColor: string;
  specNeon: string;
  cloak: string;
  helm: string;
  eye: string;
  eyeLook: EyeLook;
  plate?: boolean;
  alpha?: number;
};

/** 通用赛博英雄骨架：职业主色绑定胸甲/大肩甲/披风边缘 + 八向三层遮挡 */
function drawCyberHeroWithSpecs(
  ctx: CanvasRenderingContext2D,
  sway: number,
  pose: FacingPose,
  fx: number,
  style: CyberHeroStyle,
  hooks: {
    backDetail?: () => void;
    helmDetail?: () => void;
    frontWeapon: () => void;
  }
): void {
  const sf = clamp01(pose.sideFactor);
  const e = pose.eyeBiasX;
  const a0 = ctx.globalAlpha;
  if (style.alpha !== undefined) ctx.globalAlpha = a0 * style.alpha;

  const drawBack = () => {
    const cloakW = isFacingBack(pose) ? 18 : 14;
    drawCyberBox(
      ctx,
      -cloakW / 2 + sway - e * 0.2,
      -12,
      cloakW,
      23,
      style.cloak,
      NEON_INK,
      style.classColor,
      1.7
    );
    if (isFacingBack(pose)) hooks.backDetail?.();
  };

  const drawCore = () => {
    const torsoW = style.plate ? 19 : 17;
    drawCyberBox(ctx, -torsoW / 2 + sway, -12.5, torsoW, 22.5, style.chassis, NEON_INK);
    // 职业主色胸甲锚点
    drawCyberBox(
      ctx,
      -(torsoW - 3) / 2 + sway,
      -11,
      torsoW - 3,
      7.5,
      style.classColor,
      NEON_INK,
      style.specNeon,
      1.4
    );
    drawNeonGlowRect(ctx, -2 + sway + e * 0.2, -8.5, 4, 3, style.specNeon, fx);

    // 魔兽标志性大肩甲（职业主色底 + 专精霓虹边）
    const pW = lerp(style.plate ? 7.6 : 6.5, style.plate ? 9.2 : 8.2, sf);
    const pH = style.plate ? 8 : 7;
    const span = style.plate ? 13.5 : 12.2;
    drawCyberBox(ctx, -span + sway + e * 0.2, -14, pW, pH, style.armor, NEON_INK, style.classColor, 1.8);
    drawCyberBox(ctx, span - pW + sway + e * 0.2, -14, pW, pH, style.armor, NEON_INK, style.specNeon, 1.6);

    // 头盔/头颅
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(sway, -17.5, style.plate ? 8.8 : 8.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.helm;
    ctx.beginPath();
    ctx.arc(sway, -17.5, style.plate ? 7.6 : 7, 0, Math.PI * 2);
    ctx.fill();

    hooks.helmDetail?.();
    drawFacingEyePair(ctx, style.eye, {
      y: -18.5,
      size: 2.5,
      sway,
      pose,
      look: style.eyeLook,
    });
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: hooks.frontWeapon });
  ctx.globalAlpha = a0;
}

function drawCyberClassBodyByClassId(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  sway: number,
  pose: FacingPose,
  classColor: string,
  fx: number,
  tick: number
): boolean {
  const spec = (u.spec || '').toUpperCase();
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const wx = 10 * wSide + sway + hBias;
  const ox = -10 * wSide + sway + hBias * 0.7;

  switch (u.classId as ClassId) {
    case 'DK': {
      const s = spec === 'BLOOD' || spec === 'FROST' || spec === 'UNHOLY'
        ? spec
        : u.role === 'TANK' ? 'BLOOD' : 'FROST';
      const specNeon = s === 'BLOOD' ? '#FF2A55' : s === 'FROST' ? '#00F0FF' : '#39FF14';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#161124', armor: '#271e3d', classColor, specNeon, cloak: '#2c0b16',
        helm: '#271e3d', eye: specNeon, eyeLook: 'rune', plate: true,
      }, {
        backDetail: () => {
          drawNeonGlowLine(ctx, sway, -10, sway, 8, 2, specNeon, fx);
        },
        helmDetail: () => {
          drawCyberBox(ctx, -10 + sway, -25, 3, 7, '#cbd5e1', NEON_INK, specNeon, 1.2);
          drawCyberBox(ctx, 7 + sway, -25, 3, 7, '#cbd5e1', NEON_INK, specNeon, 1.2);
        },
        frontWeapon: () => {
          if (s === 'FROST') {
            drawCyberBox(ctx, wx - 1.5, -20, 3, 22, '#475569', NEON_INK, specNeon, 1.3);
            drawCyberBox(ctx, ox - 1.5, -18, 3, 20, '#475569', NEON_INK, specNeon, 1.3);
          } else {
            drawCyberBox(ctx, wx - 2.2, -24, 4.4, 28, '#334155', NEON_INK, specNeon, 1.6);
            drawNeonGlowLine(ctx, wx, -22, wx, 0, 1.5, specNeon, fx);
          }
        },
      });
      return true;
    }
    case 'SHAMAN': {
      const s = spec === 'RESTORATION' || spec === 'ELEMENTAL' || spec === 'ENHANCEMENT'
        ? spec
        : u.role === 'HEALER' ? 'RESTORATION' : 'ELEMENTAL';
      const specNeon = s === 'RESTORATION' ? '#00E5FF' : s === 'ELEMENTAL' ? '#38BDF8' : '#FF5500';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#0e1b2e', armor: '#173052', classColor, specNeon, cloak: '#0c2747',
        helm: '#1e3a5f', eye: specNeon, eyeLook: 'glow', plate: false,
      }, {
        backDetail: () => {
          // 背面图腾柱
          drawCyberBox(ctx, sway - 2.5, -14, 5, 20, '#451a03', NEON_INK, specNeon, 1.5);
          drawNeonGlowCircle(ctx, sway, -15, 2.5, specNeon, fx);
        },
        helmDetail: () => {
          ctx.fillStyle = classColor;
          ctx.beginPath();
          ctx.moveTo(-7 + sway, -22); ctx.lineTo(-4 + sway, -29); ctx.lineTo(-1 + sway, -22);
          ctx.moveTo(1 + sway, -22); ctx.lineTo(4 + sway, -29); ctx.lineTo(7 + sway, -22);
          ctx.fill();
        },
        frontWeapon: () => {
          if (s === 'ENHANCEMENT') {
            drawCyberBox(ctx, wx - 2, -16, 4, 20, '#64748b', NEON_INK, '#FF5500', 1.4);
            drawCyberBox(ctx, ox - 2, -15, 4, 18, '#64748b', NEON_INK, '#00F0FF', 1.4);
          } else {
            drawCyberBox(ctx, wx - 1.5, -20, 3, 26, '#475569', NEON_INK, specNeon, 1.4);
            drawNeonGlowCircle(ctx, wx, -22, 3.8, specNeon, fx);
            drawCyberBox(ctx, ox - 3, -8, 6, 15, '#173052', NEON_INK, classColor, 1.4);
          }
        },
      });
      return true;
    }
    case 'MAGE': {
      const s = spec === 'FIRE' || spec === 'FROST' || spec === 'ARCANE' ? spec : 'FIRE';
      const specNeon = s === 'FIRE' ? '#FF6B00' : s === 'FROST' ? '#00F5FF' : '#E879F9';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#131836', armor: '#1f2b5c', classColor, specNeon, cloak: '#172554',
        helm: '#1e3a8a', eye: specNeon, eyeLook: 'glow',
      }, {
        backDetail: () => {
          drawNeonGlowCircle(ctx, sway, -2, 3.2, specNeon, fx);
        },
        helmDetail: () => {
          if (s === 'ARCANE' && fx > 0.35) {
            ctx.strokeStyle = specNeon;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.ellipse(sway, -26.5, 6.5, 2.2, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (s === 'FROST') {
            drawNeonGlowLine(ctx, -4 + sway, -24, -6 + sway, -29, 1.8, specNeon, fx);
            drawNeonGlowLine(ctx, 4 + sway, -24, 6 + sway, -29, 1.8, specNeon, fx);
          }
        },
        frontWeapon: () => {
          drawCyberBox(ctx, wx - 1.3, -20, 2.6, 26, '#e2e8f0', NEON_INK);
          drawNeonGlowCircle(ctx, wx, -22, 4.2, specNeon, fx);
          if (fx >= 0.75) {
            const ang = tick * 0.13;
            drawNeonGlowCircle(ctx, sway + Math.cos(ang) * 14, -14 + Math.sin(ang) * 5, 1.8, specNeon, fx);
          }
        },
      });
      return true;
    }
    case 'ROGUE': {
      const s = spec === 'COMBAT' || spec === 'ASSASSINATION' || spec === 'SUBTLETY' ? spec : 'COMBAT';
      const specNeon = s === 'COMBAT' ? '#FFE600' : s === 'ASSASSINATION' ? '#4ADE80' : '#C084FC';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#141418', armor: '#27272f', classColor, specNeon, cloak: '#18181b',
        helm: '#27272a', eye: specNeon, eyeLook: 'slit', alpha: s === 'SUBTLETY' ? 0.88 : 1,
      }, {
        backDetail: () => {
          if (s === 'ASSASSINATION') {
            drawNeonGlowRect(ctx, sway - 5, 0, 3, 5, '#4ADE80', fx);
            drawNeonGlowRect(ctx, sway + 2, 0, 3, 5, '#4ADE80', fx);
          } else {
            drawNeonGlowLine(ctx, sway - 5, -8, sway + 5, 6, 1.5, classColor, fx * 0.8, null);
          }
        },
        frontWeapon: () => {
          const len = s === 'COMBAT' ? 20 : 16;
          drawCyberBox(ctx, wx - 1.5, -14, 3, len, '#94a3b8', NEON_INK, specNeon, 1.4);
          drawCyberBox(ctx, ox - 1.5, -14, 3, len, '#94a3b8', NEON_INK, specNeon, 1.4);
        },
      });
      return true;
    }
    case 'WARRIOR': {
      const s = spec === 'PROTECTION' || spec === 'ARMS' || spec === 'FURY'
        ? spec
        : u.role === 'TANK' ? 'PROTECTION' : 'ARMS';
      const specNeon = s === 'PROTECTION' ? '#F8FAFC' : s === 'ARMS' ? '#FF3B30' : '#EF4444';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#261b12', armor: '#4a3524', classColor, specNeon, cloak: '#3b1515',
        helm: '#475569', eye: specNeon, eyeLook: 'visor', plate: true,
      }, {
        backDetail: () => {
          if (s === 'ARMS') {
            drawCyberBox(ctx, sway - 2, -22, 4, 28, '#94a3b8', NEON_INK, specNeon, 1.3);
          }
        },
        helmDetail: () => {
          drawCyberBox(ctx, -2 + sway, -27.5, 4, 5.5, '#ef4444', NEON_INK, specNeon, 1.1);
        },
        frontWeapon: () => {
          if (s === 'PROTECTION') {
            drawCyberBox(ctx, wx - 1.5, -16, 3, 20, '#cbd5e1', NEON_INK);
            drawCyberBox(ctx, ox - 3.5, -11, 7, 22, '#78350f', NEON_INK, classColor, 1.5);
            drawNeonGlowRect(ctx, ox - 1, -6, 2, 12, '#FACC15', fx);
          } else if (s === 'FURY') {
            drawCyberBox(ctx, wx - 2, -24, 4, 28, '#cbd5e1', NEON_INK, specNeon, 1.4);
            drawCyberBox(ctx, ox - 2, -22, 4, 26, '#cbd5e1', NEON_INK, specNeon, 1.4);
          } else {
            drawCyberBox(ctx, wx - 2, -25, 4, 30, '#cbd5e1', NEON_INK, specNeon, 1.5);
            drawCyberBox(ctx, wx - 4, -5, 8, 3, '#b45309', NEON_INK);
          }
        },
      });
      return true;
    }
    case 'PALADIN': {
      const s = spec === 'HOLY' || spec === 'PROTECTION' || spec === 'RETRIBUTION'
        ? spec
        : u.role === 'HEALER' ? 'HOLY' : u.role === 'TANK' ? 'PROTECTION' : 'RETRIBUTION';
      const specNeon = s === 'HOLY' ? '#FFE047' : s === 'PROTECTION' ? '#FACC15' : '#FDE047';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#241522', armor: '#4a2340', classColor, specNeon, cloak: '#422006',
        helm: '#eab308', eye: specNeon, eyeLook: 'ring', plate: true,
      }, {
        backDetail: () => {
          drawNeonGlowLine(ctx, sway, -10, sway, 8, 2, specNeon, fx);
          drawNeonGlowLine(ctx, sway - 5, -3, sway + 5, -3, 2, specNeon, fx);
        },
        helmDetail: () => {
          if (s === 'RETRIBUTION' && fx > 0.4) {
            drawNeonGlowLine(ctx, -8 + sway, -18, -14 + sway, -26, 1.6, specNeon, fx);
            drawNeonGlowLine(ctx, 8 + sway, -18, 14 + sway, -26, 1.6, specNeon, fx);
          }
        },
        frontWeapon: () => {
          if (s === 'RETRIBUTION') {
            drawCyberBox(ctx, wx - 1.8, -22, 3.6, 28, '#94a3b8', NEON_INK);
            drawCyberBox(ctx, wx - 5, -25, 10, 7, '#fde047', NEON_INK, '#ffffff', 1.4);
          } else {
            drawCyberBox(ctx, wx - 1.5, -18, 3, 24, '#94a3b8', NEON_INK);
            drawCyberBox(ctx, wx - 4, -20, 8, 5, '#fde047', NEON_INK);
            drawCyberBox(ctx, ox - 3.5, -10, 7, 20, '#1e293b', NEON_INK, specNeon, 1.5);
          }
        },
      });
      return true;
    }
    case 'HUNTER': {
      const s = spec === 'BEAST_MASTERY' || spec === 'MARKSMANSHIP' || spec === 'SURVIVAL' ? spec : 'MARKSMANSHIP';
      const specNeon = s === 'BEAST_MASTERY' ? '#FB923C' : s === 'MARKSMANSHIP' ? '#22C55E' : '#A3E635';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#16240a', armor: '#2c4714', classColor, specNeon, cloak: '#1a2e05',
        helm: '#365314', eye: specNeon, eyeLook: s === 'MARKSMANSHIP' ? 'visor' : 'beast',
      }, {
        backDetail: () => {
          drawCyberBox(ctx, sway + 2, -12, 5, 18, '#78350f', NEON_INK, specNeon, 1.4);
        },
        frontWeapon: () => {
          drawNeonGlowLine(ctx, wx, -18, wx, 6, 1.2, '#e2e8f0', 0.6, null);
          ctx.strokeStyle = specNeon;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(wx - wSide, -6, 12, -Math.PI / 2.2, Math.PI / 2.2);
          ctx.stroke();
        },
      });
      return true;
    }
    case 'PRIEST': {
      const s = spec === 'DISCIPLINE' || spec === 'HOLY' || spec === 'SHADOW'
        ? spec
        : u.role === 'DPS' ? 'SHADOW' : 'HOLY';
      const isShadow = s === 'SHADOW';
      const specNeon = isShadow ? '#D946EF' : s === 'DISCIPLINE' ? '#FEF08A' : '#38BDF8';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: isShadow ? '#240c4d' : '#cbd5e1',
        armor: isShadow ? '#4c1d95' : '#f8fafc',
        classColor: isShadow ? '#7e22ce' : classColor,
        specNeon,
        cloak: isShadow ? '#1e0b38' : '#e2e8f0',
        helm: isShadow ? '#4c1d95' : '#f8fafc',
        eye: isShadow ? '#F0ABFC' : '#334155',
        eyeLook: isShadow ? 'hollow' : 'cross',
        alpha: isShadow ? 0.9 : 1,
      }, {
        backDetail: () => {
          if (s === 'HOLY') {
            drawNeonGlowLine(ctx, sway - 4, -8, sway - 12, -16, 1.8, '#FFFFFF', fx);
            drawNeonGlowLine(ctx, sway + 4, -8, sway + 12, -16, 1.8, '#FFFFFF', fx);
          }
        },
        helmDetail: () => {
          ctx.strokeStyle = specNeon;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.ellipse(sway, -26.5, 6.2, 2.2, 0, 0, Math.PI * 2);
          ctx.stroke();
        },
        frontWeapon: () => {
          drawCyberBox(ctx, wx - 1.3, -20, 2.6, 28, isShadow ? '#581c87' : '#eab308', NEON_INK);
          drawNeonGlowCircle(ctx, wx, -22.5, 4, specNeon, fx);
        },
      });
      return true;
    }
    case 'WARLOCK': {
      const s = spec === 'AFFLICTION' || spec === 'DEMONOLOGY' || spec === 'DESTRUCTION' ? spec : 'AFFLICTION';
      const specNeon = s === 'AFFLICTION' ? '#A855F7' : s === 'DEMONOLOGY' ? '#E879F9' : '#84CC16';
      drawCyberHeroWithSpecs(ctx, sway, pose, fx, {
        chassis: '#190e2e', armor: '#341c5e', classColor, specNeon, cloak: '#1e1033',
        helm: '#3b0764', eye: specNeon, eyeLook: 'toxic',
      }, {
        backDetail: () => {
          if (fx >= 0.5) drawNeonGlowCircle(ctx, sway, -2, 2.8, specNeon, fx);
        },
        helmDetail: () => {
          if (s === 'DEMONOLOGY') {
            drawNeonGlowLine(ctx, -6 + sway, -21, -12 + sway, -28, 2, specNeon, fx);
            drawNeonGlowLine(ctx, 6 + sway, -21, 12 + sway, -28, 2, specNeon, fx);
          }
        },
        frontWeapon: () => {
          drawCyberBox(ctx, wx - 1.3, -20, 2.6, 26, '#581c87', NEON_INK);
          drawNeonGlowCircle(ctx, wx, -22, 4.2, specNeon, fx);
        },
      });
      return true;
    }
    default:
      return false;
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
  const classColor = CLASS_COLORS[u.classId as keyof typeof CLASS_COLORS] || '#888';
  const fx = volumeOpts?.fxIntensity ?? 1;
  const tick = volumeOpts?.tickCount ?? 0;

  if (u.classId === 'DRUID') {
    drawCyberDruidEightDir(ctx, u, sway, pose, fx, tick);
  } else if (!drawCyberClassBodyByClassId(ctx, u, sway, pose, classColor, fx, tick)) {
    ctx.fillStyle = classColor;
    ctx.fillRect(-8 + sway, -12, 16, 22);
    ctx.beginPath();
    ctx.arc(0 + sway, -16, 7, 0, Math.PI * 2);
    ctx.fill();
    drawFacingEyePair(ctx, '#f8fafc', { y: -17.5, size: 2.2, sway, pose });
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
