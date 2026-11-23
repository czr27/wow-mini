/**
 * 职业 / Boss 八向剪影建模：按 FacingPose 偏移五官与武器侧。
 * 所有职业均画朝向眼；侧面加大 eyeBias 便于读朝向。
 */
import type { ClassId, Unit } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';
import {
  type FacingDir,
  type FacingPose,
  applyFacingPoseTransform,
  facingPoseFromDir,
  radToFacingDir,
} from './facingOctant.js';

/** 当前八向姿态（职业/Boss 绘制时写入，供五官 helper 读取） */
let activeFacingPose: FacingPose = facingPoseFromDir(2);

export function getActiveFacingPose(): FacingPose {
  return activeFacingPose;
}

export function facingDirFromRad(rad: number | undefined | null): FacingDir {
  return radToFacingDir(typeof rad === 'number' ? rad : Math.PI / 2); // 默认朝南
}

/**
 * 统一双眼：随 eyeBiasX 整体偏移；强侧视只保留前侧一只眼。
 * 背向 (showFace=false) 不画。
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
  }
): void {
  const pose = opts?.pose ?? activeFacingPose;
  if (!pose.showFace) return;
  const e = pose.eyeBiasX;
  const y = opts?.y ?? -19;
  const size = opts?.size ?? 2.4;
  const halfGap = opts?.halfGap ?? 3.2;
  const sway = opts?.sway ?? 0;
  ctx.fillStyle = color;
  // 强侧视：单眼前移，朝向更清晰
  if (Math.abs(e) >= 3.6) {
    const x = sway + Math.sign(e || 1) * Math.min(5.5, Math.abs(e) * 0.85);
    ctx.fillRect(x - size * 0.35, y, size + 0.6, size);
    return;
  }
  ctx.fillRect(-halfGap + sway + e, y, size, size);
  ctx.fillRect(halfGap - size + sway + e, y, size, size);
}

/**
 * 嘴巴：随 eyeBias 前移；侧视缩短；背向不画。
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
  if (!pose.showFace) return;
  const e = pose.eyeBiasX;
  const sway = opts?.sway ?? 0;
  const y = opts?.y ?? -14.2;
  const side = Math.abs(e) >= 3.6;
  const w = side ? 3.4 : Math.abs(e) >= 2 ? 4.4 : 5.2;
  const h = side ? 1.4 : 1.7;
  const x = sway + e * 0.6 - w / 2;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // 侧视加一点下唇提示
  if (side) {
    ctx.fillRect(x + w * 0.15, y + h, w * 0.7, 0.8);
  }
}

/**
 * 双手/小臂：随朝向前伸后收；侧视一前一后；背向略收肩仍画手。
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
  const e = pose.eyeBiasX;
  const sway = opts?.sway ?? 0;
  const y = opts?.y ?? -3;
  const armW = opts?.armW ?? 3.4;
  const armH = opts?.armH ?? 8.5;
  const spread = (opts?.spread ?? 9.2) * (pose.showFace ? 1 : 0.82);
  const bias = e * 0.55;
  ctx.fillStyle = color;

  if (Math.abs(e) >= 3.6) {
    const fwd = Math.sign(e || 1);
    // 前手：更靠前、略抬
    ctx.fillRect(sway + bias + fwd * (spread * 0.85) - armW * 0.4, y - 2.2, armW + 1.2, armH + 1);
    // 拳/手掌
    ctx.fillRect(sway + bias + fwd * (spread * 0.85 + armW * 0.2), y + armH - 3.5, armW + 1.6, 3.2);
    // 后手：收在身后
    ctx.fillRect(
      sway + bias - fwd * (spread * 0.45) - armW * 0.35,
      y + 1.2,
      armW * 0.9,
      armH - 1.2
    );
  } else {
    // 朝右：右手略前下、左手略后；朝左相反
    const lead = e * 0.35;
    ctx.fillRect(-spread + sway + bias - lead * 0.3, y + Math.max(0, -e) * 0.35, armW, armH);
    ctx.fillRect(spread - armW + sway + bias + lead * 0.3, y + Math.max(0, e) * 0.35, armW, armH);
    // 小手掌
    ctx.fillRect(-spread + sway + bias - lead * 0.3 - 0.4, y + armH - 2.2, armW + 1.2, 2.6);
    ctx.fillRect(spread - armW + sway + bias + lead * 0.3 - 0.4, y + armH - 2.2, armW + 1.2, 2.6);
  }
}

/** 武器/法杖等水平偏移（与手同向） */
export function facingHandBiasX(pose: FacingPose): number {
  return pose.eyeBiasX * 0.55;
}

/**
 * 鞋子：随朝向偏移；侧视一前一后；背向仍画脚跟示向。
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
  const e = pose.eyeBiasX;
  const sway = opts?.sway ?? 0;
  const y = opts?.y ?? 8;
  const bootW = opts?.bootW ?? 6.2;
  const bootH = opts?.bootH ?? 3.8;
  const spread = (opts?.spread ?? 5.2) * (pose.showFace ? 1 : 0.72);
  const bias = e * 0.4;
  ctx.fillStyle = color;

  if (Math.abs(e) >= 3.6) {
    const fwd = Math.sign(e || 1);
    // 前脚
    ctx.fillRect(sway + bias + fwd * 2.2 - bootW * 0.35, y - 0.8, bootW + 1.8, bootH);
    // 后脚略小
    ctx.fillRect(
      sway + bias - fwd * (spread * 0.55) - bootW * 0.35,
      y + 0.4,
      bootW * 0.9,
      bootH - 0.6
    );
    // 鞋尖
    ctx.fillRect(sway + bias + fwd * (bootW * 0.55 + 1.2), y + bootH - 1.4, 3.2, 1.6);
  } else {
    ctx.fillRect(-spread + sway + bias, y, bootW, bootH);
    ctx.fillRect(spread - bootW + sway + bias, y, bootW, bootH);
    if (Math.abs(e) > 0.8) {
      const toe = Math.sign(e) * (2.2 + Math.abs(e) * 0.2);
      ctx.fillRect(sway + bias + toe - 1.2, y + bootH - 1.3, 3.4, 1.5);
    }
  }
}

/** 职业八向身体（脚下原点，已 translate） */
export function drawClassEightDirBody(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  sway: number,
  facingDir: FacingDir
): void {
  const pose = facingPoseFromDir(facingDir);
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
      drawFacingEyePair(ctx, '#00ffff', { y: -20, size: 2.6, sway, pose });
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
      drawFacingEyePair(ctx, '#fef3c7', { y: -18.5, size: 2.2, sway, pose });
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
      drawFacingEyePair(ctx, '#7dd3fc', { y: -18.5, size: 2.3, sway, pose });
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
      drawFacingEyePair(ctx, '#e0f2fe', { y: -18.5, size: 2.2, sway, pose });
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
      drawFacingEyePair(ctx, '#FFF569', { y: -18.2, size: 2.2, sway, pose });
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
      drawFacingEyePair(ctx, '#f8fafc', { y: -19.2, size: 2.3, sway, pose });
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
      drawFacingEyePair(ctx, '#fef08a', { y: -20, size: 2.3, sway, pose });
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
      drawFacingEyePair(ctx, '#bef264', { y: -18.2, size: 2.2, sway, pose });
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
      drawFacingEyePair(ctx, '#a3e635', { y: -18.2, size: 2.2, sway, pose });
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

  // 嘴 / 手 / 鞋：统一强化八向
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

  ctx.restore();
}

/** Boss 八向：在已有造型外包一层姿态变换（镜像 + 肩宽） */
export function withBossEightDirFacing(
  ctx: CanvasRenderingContext2D,
  facingDir: FacingDir,
  drawBody: () => void
): void {
  const pose = facingPoseFromDir(facingDir);
  activeFacingPose = pose;
  ctx.save();
  applyFacingPoseTransform(ctx, pose);
  drawBody();
  // Boss 嘴/手/鞋叠在造型上，随朝向偏移
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
  // 正背时加暗罩，强化「背影」
  if (!pose.showFace) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-36, -70, 72, 100);
  }
  ctx.restore();
}

export type { FacingDir, FacingPose };
