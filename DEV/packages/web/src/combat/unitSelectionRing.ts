/**
 * Shared foot-level unit selection ring for Bosses, Trash Mobs, Players, Allies, and Pets.
 * Differentiates friend/foe, local player facing, and class/role accents deterministically.
 */
import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';

export type SelectionRingAffiliation = 'ENEMY' | 'SELF' | 'ALLY';

export interface SelectionRingStyle {
  affiliation: SelectionRingAffiliation;
  outerColor: string;
  innerColor: string;
  fillRgba: string;
  outerWidth: number;
  reticleTicks: number;
  showFacingNotch: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '#FFD700').replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 255,
    parseInt(full.slice(2, 4), 16) || 215,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

export function resolveUnitSelectionRingStyle(opts: {
  isEnemy?: boolean;
  isSelf?: boolean;
  classId?: string | null;
  role?: string | null;
  isBoss?: boolean;
}): SelectionRingStyle {
  if (opts.isEnemy || opts.isBoss) {
    return {
      affiliation: 'ENEMY',
      outerColor: '#FF4444',
      innerColor: 'rgba(255, 180, 180, 0.65)',
      fillRgba: 'rgba(255, 68, 68, 0.22)',
      outerWidth: opts.isBoss ? 2.5 : 2,
      reticleTicks: 4,
      showFacingNotch: false,
    };
  }

  if (opts.isSelf) {
    return {
      affiliation: 'SELF',
      outerColor: '#FFD700',
      innerColor: 'rgba(255, 248, 200, 0.65)',
      fillRgba: 'rgba(255, 215, 0, 0.22)',
      outerWidth: 2,
      reticleTicks: 0,
      showFacingNotch: true,
    };
  }

  const cid = (opts.classId || '').toUpperCase();
  const classHex = CLASS_COLORS[cid as keyof typeof CLASS_COLORS] || '#38BDF8';
  const [r, g, b] = hexToRgb(classHex);
  const role = (opts.role || '').toUpperCase();
  return {
    affiliation: 'ALLY',
    outerColor: classHex,
    innerColor:
      role === 'TANK'
        ? 'rgba(250, 204, 21, 0.65)'
        : role === 'HEALER'
          ? 'rgba(110, 231, 183, 0.65)'
          : `rgba(${r}, ${g}, ${b}, 0.55)`,
    fillRgba: `rgba(${r}, ${g}, ${b}, 0.2)`,
    outerWidth: role === 'TANK' ? 2.2 : 1.8,
    reticleTicks: role === 'HEALER' ? 4 : 0,
    showFacingNotch: false,
  };
}

export function drawUnitSelectionRing(
  ctx: CanvasRenderingContext2D,
  opts: {
    x?: number;
    y: number;
    rx: number;
    ry: number;
    isEnemy?: boolean;
    isSelf?: boolean;
    classId?: string | null;
    role?: string | null;
    isBoss?: boolean;
    facingRad?: number;
    tickCount?: number;
  }
): void {
  const cx = opts.x ?? 0;
  const cy = opts.y;
  const style = resolveUnitSelectionRingStyle(opts);
  const pulse =
    typeof opts.tickCount === 'number'
      ? 0.92 + 0.08 * Math.sin(opts.tickCount * 0.14)
      : 1;

  ctx.save();
  ctx.globalAlpha *= pulse;

  // Outer ground ellipse + translucent fill
  ctx.beginPath();
  ctx.ellipse(cx, cy, opts.rx, opts.ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = style.fillRgba;
  ctx.fill();
  ctx.strokeStyle = style.outerColor;
  ctx.lineWidth = style.outerWidth;
  ctx.stroke();

  // Inner concentric ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy, opts.rx * 0.72, opts.ry * 0.72, 0, 0, Math.PI * 2);
  ctx.strokeStyle = style.innerColor;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Enemy / Healer cardinal reticle ticks on outer perimeter
  if (style.reticleTicks > 0) {
    ctx.strokeStyle = style.outerColor;
    ctx.lineWidth = opts.isBoss ? 1.8 : 1.3;
    const tickIn = 0.84;
    const tickOut = 1.1;
    ctx.beginPath();
    for (let i = 0; i < style.reticleTicks; i++) {
      const a = (i * Math.PI * 2) / style.reticleTicks;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.moveTo(cx + cos * opts.rx * tickIn, cy + sin * opts.ry * tickIn);
      ctx.lineTo(cx + cos * opts.rx * tickOut, cy + sin * opts.ry * tickOut);
    }
    ctx.stroke();
  }

  // Self facing directional chevron
  if (style.showFacingNotch && typeof opts.facingRad === 'number') {
    const a = opts.facingRad;
    const tipX = cx + Math.cos(a) * opts.rx * 1.18;
    const tipY = cy + Math.sin(a) * opts.ry * 1.18;
    const leftX = cx + Math.cos(a - 0.22) * opts.rx * 0.94;
    const leftY = cy + Math.sin(a - 0.22) * opts.ry * 0.94;
    const rightX = cx + Math.cos(a + 0.22) * opts.rx * 0.94;
    const rightY = cy + Math.sin(a + 0.22) * opts.ry * 0.94;
    ctx.fillStyle = style.outerColor;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
