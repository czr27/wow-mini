/**
 * 五人本 Boss 像素外形：按 dungeon_guides 定位 + 经典形象绘制。
 * 约定：脚下原点已由 drawBossModel translate；造型以躯干/头/标志物区分。
 * 眼睛随 withBossEightDirFacing 写入的八向姿态偏移。
 */
import type { Unit } from '@cata-raid-sim/engine';
import {
  NEON_INK,
  drawCyberBox,
  drawEightDirLayers,
  drawFacingEyePair,
  drawNeonGlowCircle,
  drawNeonGlowLine,
  drawNeonGlowRect,
  facingHandBiasX,
  getActiveFacingPose,
  isFacingBack,
  type EyeLook,
} from './eightDirModels.js';

function body(
  ctx: CanvasRenderingContext2D,
  color: string,
  w = 44,
  h = 56,
  rimColor?: string
) {
  drawCyberBox(ctx, -w / 2, -30, w, h, color, NEON_INK, rimColor, 1.6);
}

function head(ctx: CanvasRenderingContext2D, color: string, r = 13, y = -42) {
  ctx.fillStyle = NEON_INK;
  ctx.beginPath();
  ctx.arc(0, y, r + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function eyes(ctx: CanvasRenderingContext2D, color: string, y = -44, look: EyeLook = 'glow') {
  drawFacingEyePair(ctx, color, { y, size: 3.4, halfGap: 5, look });
}

// ── Deadmines ──────────────────────────────────────────────────────────────

/** 戈洛克：双生火/冰拳的食人魔术士（攻略：火霜拳轮换） */
function drawGlubtok(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const pulse = 1 + Math.sin(tickCount * 0.2) * 0.15;
  drawEightDirLayers(pose, {
    back: () => {
      if (isFacingBack(pose)) {
        drawNeonGlowLine(ctx, -8, -22, -8, 12, 2.2, '#FF6B00', 0.85);
        drawNeonGlowLine(ctx, 8, -22, 8, 12, 2.2, '#00F0FF', 0.85);
      }
    },
    core: () => {
      body(ctx, '#292524', 52, 58, '#FF6B00');
      drawCyberBox(ctx, -22, -28, 44, 14, '#44403c', NEON_INK, '#00F0FF', 1.4);
      head(ctx, '#78716c', 16, -44);
      ctx.fillStyle = NEON_INK;
      ctx.beginPath(); ctx.moveTo(-10, -54); ctx.lineTo(-17, -69); ctx.lineTo(-4, -56); ctx.fill();
      ctx.beginPath(); ctx.moveTo(10, -54); ctx.lineTo(17, -69); ctx.lineTo(4, -56); ctx.fill();
      eyes(ctx, '#FFE047', -46, 'cross');
    },
    front: () => {
      drawNeonGlowCircle(ctx, -30 * wSide + hBias, -4, 10 * pulse, '#FF6B00', 1);
      drawNeonGlowCircle(ctx, 30 * wSide + hBias, -4, 10 * pulse, '#00F0FF', 1);
    },
  });
}

/** 赫利克斯：骑乘木虱的地精拆轮（攻略：先打木虱再跳背） */
function drawHelix(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const bob = Math.sin(tickCount * 0.15) * 2;
  drawCyberBox(ctx, -28, -8, 56, 36, '#1f2937', NEON_INK, '#FFE600', 1.6);
  drawCyberBox(ctx, -22, -4, 44, 16, '#374151', NEON_INK);
  drawNeonGlowRect(ctx, -18, 8, 10, 8, '#FFE600', 0.8);
  drawNeonGlowRect(ctx, 8, 8, 10, 8, '#FFE600', 0.8);
  drawCyberBox(ctx, -12, -28 + bob, 24, 22, '#14532d', NEON_INK, '#39FF14', 1.5);
  drawCyberBox(ctx, -10, -26 + bob, 20, 10, '#365314', NEON_INK);
  head(ctx, '#4d7c0f', 10, -36 + bob);
  eyes(ctx, '#FFE600', -38 + bob, 'visor');
  const wx = 16 * pose.weaponSide + facingHandBiasX(pose);
  drawCyberBox(ctx, wx - 2, -22 + bob, 4, 18, '#FACC15', NEON_INK);
  drawNeonGlowCircle(ctx, wx, -24 + bob, 5, '#FFE600', 0.9);
}

/** 死神5000：收割机巨械（攻略：正面收割 / 过载乱跑） */
function drawFoeReaper(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const smoke = Math.sin(tickCount * 0.2) * 3;
  body(ctx, '#1f2937', 50, 54, '#FF2A55');
  drawCyberBox(ctx, -20, -26, 40, 18, '#374151', NEON_INK, '#F59E0B', 1.4);
  drawCyberBox(ctx, -6, -48, 12, 16, '#57534e', NEON_INK);
  ctx.fillStyle = 'rgba(203,213,225,0.6)';
  ctx.beginPath();
  ctx.arc(-2, -56 + smoke, 5, 0, Math.PI * 2);
  ctx.arc(6, -60 - smoke, 4, 0, Math.PI * 2);
  ctx.fill();
  drawCyberBox(ctx, -14, -22, 28, 12, '#090B14', NEON_INK, '#FF1744', 1.2);
  eyes(ctx, '#FF1744', -19, 'visor');
  drawCyberBox(ctx, -38, -10, 16, 6, '#94a3b8', NEON_INK);
  drawCyberBox(ctx, 22, -10, 16, 6, '#94a3b8', NEON_INK);
  drawNeonGlowLine(ctx, -38, -12, -52, 4, 3.5, '#FF2A55', 1);
  drawNeonGlowLine(ctx, 38, -12, 52, 4, 3.5, '#FF2A55', 1);
  if (isFacingBack(pose)) {
    drawNeonGlowRect(ctx, -12, -14, 24, 16, '#FF6B00', 0.85);
  }
}

/** 撕心船长：狼人海盗上将（攻略：迷雾甲板 / 蒸汽） */
function drawRipsnarl(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const fog = Math.sin(tickCount * 0.1) * 4;
  drawEightDirLayers(pose, {
    back: () => {
      if (isFacingBack(pose)) {
        drawCyberBox(ctx, -22, -28, 44, 54, '#3b071e', NEON_INK, '#FF5500', 1.6);
      }
      ctx.fillStyle = 'rgba(148,163,184,0.3)';
      ctx.beginPath();
      ctx.ellipse(-20 + fog, 10, 14, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(18 - fog, 14, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    core: () => {
      body(ctx, '#1c1917', 46, 56, '#FF5500');
      drawCyberBox(ctx, -18, -26, 36, 12, '#450a0a', NEON_INK, '#FACC15', 1.4);
      drawNeonGlowRect(ctx, -4, -18, 3, 3, '#FACC15', 0.9);
      drawNeonGlowRect(ctx, 2, -10, 3, 3, '#FACC15', 0.9);
      head(ctx, '#292524', 14, -42);
      ctx.fillStyle = NEON_INK;
      ctx.beginPath(); ctx.moveTo(-10, -50); ctx.lineTo(-6, -64); ctx.lineTo(-2, -50); ctx.fill();
      ctx.beginPath(); ctx.moveTo(10, -50); ctx.lineTo(6, -64); ctx.lineTo(2, -50); ctx.fill();
      eyes(ctx, '#FF5500', -44, 'beast');
      ctx.fillStyle = NEON_INK;
      ctx.beginPath(); ctx.moveTo(-19, -47); ctx.lineTo(0, -64); ctx.lineTo(19, -47); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath(); ctx.moveTo(-17, -48); ctx.lineTo(0, -62); ctx.lineTo(17, -48); ctx.closePath(); ctx.fill();
      drawNeonGlowRect(ctx, -4, -56, 8, 3, '#FF2A55', 0.95);
    },
  });
}

/** 曲奇：甲板厨子鱼人（攻略：抛掷好/坏食物） */
function drawCookie(ctx: CanvasRenderingContext2D, tickCount: number) {
  const toss = (tickCount % 40) / 40;
  body(ctx, '#083344', 40, 48, '#00F5D4');
  drawCyberBox(ctx, -16, -24, 32, 12, '#155e75', NEON_INK, '#00F5D4', 1.4);
  head(ctx, '#06b6d4', 14, -38);
  eyes(ctx, '#FFE600', -42, 'ring');
  drawCyberBox(ctx, -10, -58, 20, 14, '#f8fafc', NEON_INK);
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath(); ctx.arc(0, -58, 12, Math.PI, 0); ctx.fill();
  drawNeonGlowCircle(
    ctx,
    22 + toss * 8,
    -20 - Math.sin(toss * Math.PI) * 18,
    5,
    toss > 0.5 ? '#39FF14' : '#C026D3',
    0.95
  );
}

/** 梵妮莎：迪菲亚黑衣刺客（攻略：英雄尾王 / 绳索梦魇） */
function drawVanessa(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const flash = tickCount % 20 < 6;
  drawEightDirLayers(pose, {
    back: () => {
      if (isFacingBack(pose)) {
        drawCyberBox(ctx, -18, -28, 36, 52, '#7f1d1d', NEON_INK, '#FF2A55', 1.6);
      }
    },
    core: () => {
      body(ctx, '#18181b', 38, 54, '#FF2A55');
      drawCyberBox(ctx, -16, -26, 32, 10, '#7f1d1d', NEON_INK, '#FF2A55', 1.4);
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.moveTo(-8, -34); ctx.lineTo(8, -34); ctx.lineTo(0, -22); ctx.closePath(); ctx.fill();
      head(ctx, '#fde68a', 12, -44);
      eyes(ctx, '#00FF87', -46, 'slit');
    },
    front: () => {
      const blade = flash ? '#00FF87' : '#39FF14';
      drawNeonGlowLine(ctx, -16, -15, -30, -15, 2.8, blade, 1);
      drawNeonGlowLine(ctx, 16, -15, 30, -15, 2.8, blade, 1);
    },
  });
}

// ── Scarlet Monastery ──────────────────────────────────────────────────────

/** 韦沙斯：血色审讯官（攻略：暗言术痛） */
function drawVishas(ctx: CanvasRenderingContext2D, _tickCount: number) {
  body(ctx, '#450a0a', 42, 54, '#FF2A55');
  drawCyberBox(ctx, -14, -26, 28, 14, '#f8fafc', NEON_INK, '#FF2A55', 1.4);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, '#FF2A55', -44, 'hollow');
  ctx.fillStyle = NEON_INK;
  ctx.beginPath(); ctx.moveTo(-15, -40); ctx.lineTo(0, -59); ctx.lineTo(15, -40); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7f1d1d';
  ctx.beginPath(); ctx.moveTo(-13, -40); ctx.lineTo(0, -56); ctx.lineTo(13, -40); ctx.closePath(); ctx.fill();
  drawCyberBox(ctx, 14, -12, 10, 14, '#FACC15', NEON_INK, '#FF2A55', 1.3);
}

/** 萨尔诺斯：血法师焰环（攻略：火焰新星） */
function drawThalnoren(ctx: CanvasRenderingContext2D, tickCount: number) {
  const flame = Math.sin(tickCount * 0.25) * 3;
  body(ctx, '#4c0519', 42, 54, '#FF5500');
  drawCyberBox(ctx, -14, -26, 28, 10, '#fecaca', NEON_INK, '#FF5500', 1.4);
  head(ctx, '#fca5a5', 12, -42);
  eyes(ctx, '#FF5500', -44, 'visor');
  drawNeonGlowLine(ctx, -6, -52, 0, -66 + flame, 3.2, '#FF5500', 1);
  drawNeonGlowLine(ctx, 6, -52, 0, -66 + flame, 3.2, '#FF5500', 1);
  drawNeonGlowCircle(ctx, 18, -8, 7 + flame * 0.3, '#FF6B00', 1);
}

/** 洛克希：驯犬者披挂（攻略：开战刷猎犬） */
function drawLoksey(ctx: CanvasRenderingContext2D, tickCount: number) {
  const bob = Math.sin(tickCount * 0.2) * 2;
  body(ctx, '#7f1d1d', 44, 54, '#FB923C');
  drawCyberBox(ctx, -18, -24, 36, 12, '#292524', NEON_INK, '#FB923C', 1.4);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, '#FB923C', -44, 'beast');
  drawNeonGlowCircle(ctx, 0, -12, 4, '#FACC15', 0.9);
  drawCyberBox(ctx, -36, 4 + bob, 16, 10, '#1c1917', NEON_INK, '#FB923C', 1.2);
  drawNeonGlowCircle(ctx, -34, 2 + bob, 4.5, '#292524', 0.4, null);
}

/** 杜安：奥法师紫袍 + 气泡意象（攻略：半血奥术气泡自爆） */
function drawDoan(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  body(ctx, '#2e1065', 42, 54, '#C026D3');
  drawCyberBox(ctx, -16, -26, 32, 12, '#7c3aed', NEON_INK, '#E879F9', 1.4);
  head(ctx, '#e9d5ff', 12, -42);
  eyes(ctx, '#E879F9', -44, 'rune');
  ctx.fillStyle = NEON_INK;
  ctx.beginPath(); ctx.moveTo(-13, -44); ctx.lineTo(0, -71); ctx.lineTo(13, -44); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3b0764';
  ctx.beginPath(); ctx.moveTo(-11, -44); ctx.lineTo(0, -68); ctx.lineTo(11, -44); ctx.closePath(); ctx.fill();
  drawNeonGlowRect(ctx, -3, -58, 6, 4, '#FFE047', 1);
  const bubbled = boss.buffs?.some(b => b.spellId === 'arcane_bubble') || boss.hp / boss.maxHp <= 0.5;
  if (bubbled) {
    const pulse = 18 + Math.sin(tickCount * 0.2) * 2;
    ctx.strokeStyle = '#E879F9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -10, pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 赫洛德：军械库勇士双斧旋风（攻略：旋风斩 / 学徒潮） */
function drawHerod(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#7f1d1d', 46, 56, '#FF2A55');
  drawCyberBox(ctx, -18, -26, 36, 12, '#f8fafc', NEON_INK, '#FF2A55', 1.4);
  // 赫洛德标志性单侧巨型尖刺肩甲
  drawCyberBox(ctx, -34, -34, 15, 20, '#334155', NEON_INK, '#FF2A55', 1.6);
  head(ctx, '#fde68a', 13, -42);
  eyes(ctx, '#FF2A55', -44, 'visor');
  drawCyberBox(ctx, -14, -52, 28, 8, '#450a0a', NEON_INK, '#FF2A55', 1.2);
  const spin = tickCount * 0.35;
  ctx.save();
  ctx.rotate(spin);
  drawCyberBox(ctx, -36, -3, 72, 6, '#94a3b8', NEON_INK);
  drawNeonGlowRect(ctx, -40, -8, 12, 16, '#FF2A55', 0.95);
  drawNeonGlowRect(ctx, 28, -8, 12, 16, '#FF2A55', 0.95);
  ctx.restore();
}

/** 莫格莱尼：血色大领主板甲（攻略：假死 → 怀特迈恩复活） */
function drawMograine(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const fakeDead = boss.hp / Math.max(1, boss.maxHp) <= 0.05;
  body(ctx, fakeDead ? '#292524' : '#7f1d1d', 46, 56, fakeDead ? '#64748b' : '#FFE047');
  drawCyberBox(ctx, -18, -26, 36, 14, '#f8fafc', NEON_INK, '#FF2A55', 1.4);
  drawNeonGlowRect(ctx, -3, -24, 6, 16, '#FF2A55', fakeDead ? 0.25 : 0.95);
  drawNeonGlowRect(ctx, -8, -18, 16, 5, '#FF2A55', fakeDead ? 0.25 : 0.95);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, fakeDead ? '#64748b' : '#FF2A55', -44, fakeDead ? 'block' : 'hollow');
  drawCyberBox(ctx, -14, -52, 28, 8, '#450a0a', NEON_INK);
  if (!fakeDead) {
    drawCyberBox(ctx, 18, -28, 5, 36, '#78716c', NEON_INK);
    drawCyberBox(ctx, 14, -34, 14, 10, '#FACC15', NEON_INK, '#ffffff', 1.4);
  } else {
    ctx.fillStyle = 'rgba(248,250,252,0.45)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('假死…', 0, 8);
  }
  void tickCount;
}

// ── Stratholme ─────────────────────────────────────────────────────────────

/** 威利：血色炮手（攻略：开炮清火枪手） */
function drawWilley(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const wx = 22 * pose.weaponSide + facingHandBiasX(pose);
  body(ctx, '#7f1d1d', 42, 54, '#FF6B00');
  drawCyberBox(ctx, -14, -24, 28, 10, '#f8fafc', NEON_INK, '#FF6B00', 1.2);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, '#FF2A55', -44, 'hollow');
  drawCyberBox(ctx, wx - 11, -28, 22, 10, '#3f3f46', NEON_INK, '#FACC15', 1.3);
  if (tickCount % 28 < 5) {
    drawNeonGlowCircle(ctx, wx + 14 * pose.weaponSide, -23, 5.5, '#FF6B00', 1);
  }
}

/** 巴纳扎尔：达索汉人形 → 恶魔（攻略：半血变身恶魔） */
function drawBalnazzar(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const demon = boss.hp / Math.max(1, boss.maxHp) <= 0.5;
  const pose = getActiveFacingPose();
  if (!demon) {
    body(ctx, '#7f1d1d', 44, 54, '#FF2A55');
    drawCyberBox(ctx, -16, -26, 32, 12, '#f8fafc', NEON_INK, '#FF2A55', 1.3);
    head(ctx, '#fde68a', 12, -42);
    eyes(ctx, '#FF2A55', -44, 'hollow');
    drawCyberBox(ctx, -16, -52, 32, 8, '#450a0a', NEON_INK);
    return;
  }
  const wing = Math.sin(tickCount * 0.15) * 6;
  drawEightDirLayers(pose, {
    back: () => {
      ctx.fillStyle = NEON_INK;
      ctx.beginPath();
      ctx.moveTo(-18, -20); ctx.quadraticCurveTo(-54 - wing, -44, -52, 12); ctx.lineTo(-18, 8); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(18, -20); ctx.quadraticCurveTo(54 + wing, -44, 52, 12); ctx.lineTo(18, 8); ctx.fill();
      drawNeonGlowLine(ctx, -18, -18, -46 - wing * 0.5, -26, 2.2, '#D946EF', 0.95);
      drawNeonGlowLine(ctx, 18, -18, 46 + wing * 0.5, -26, 2.2, '#D946EF', 0.95);
    },
    core: () => {
      body(ctx, '#2b0718', 48, 56, '#D946EF');
      drawCyberBox(ctx, -20, -26, 40, 14, '#581c87', NEON_INK, '#E879F9', 1.4);
      head(ctx, '#3b0764', 14, -44);
      drawNeonGlowLine(ctx, -8, -54, -14, -70, 3, '#FACC15', 0.85, '#090B14');
      drawNeonGlowLine(ctx, 8, -54, 14, -70, 3, '#FACC15', 0.85, '#090B14');
      eyes(ctx, '#D946EF', -46, 'toxic');
    },
  });
}

/** 拉姆斯登：屠宰房憎恶（攻略：践踏 / 亡灵增援） */
function drawRamstein(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#1a2e05', 54, 58, '#39FF14');
  drawCyberBox(ctx, -22, -24, 44, 16, '#3f6212', NEON_INK, '#39FF14', 1.4);
  ctx.fillStyle = NEON_INK;
  ctx.beginPath(); ctx.arc(-10, -42, 12.5, 0, Math.PI * 2); ctx.arc(12, -40, 11.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#365314';
  ctx.beginPath(); ctx.arc(-10, -42, 11, 0, Math.PI * 2); ctx.arc(12, -40, 10, 0, Math.PI * 2); ctx.fill();
  drawFacingEyePair(ctx, '#39FF14', { y: -44, size: 2.8, halfGap: 3.2, look: 'toxic', sway: -10 });
  drawFacingEyePair(ctx, '#A3E635', { y: -42, size: 2.6, halfGap: 3.0, look: 'hollow', sway: 12 });
  drawNeonGlowLine(ctx, 0, -20, 0, 20, 2.2, '#39FF14', 0.9);
  const stomp = Math.abs(Math.sin(tickCount * 0.12)) * 4;
  drawCyberBox(ctx, -24, 22 + stomp, 18, 8, '#4d7c0f', NEON_INK);
  drawCyberBox(ctx, 6, 22 + stomp, 18, 8, '#4d7c0f', NEON_INK);
}

/** 瑞文戴尔：天灾死亡骑士（攻略：暗影打击 + 骷髅） */
function drawRivendare(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const wx = 22 * pose.weaponSide + facingHandBiasX(pose);
  body(ctx, '#13112b', 46, 56, '#00F0FF');
  drawCyberBox(ctx, -18, -26, 36, 14, '#1e1b4b', NEON_INK, '#00F0FF', 1.4);
  drawCyberBox(ctx, -28, -28, 12, 16, '#312e81', NEON_INK, '#00F0FF', 1.5);
  drawCyberBox(ctx, 16, -28, 12, 16, '#312e81', NEON_INK, '#00F0FF', 1.5);
  head(ctx, '#cbd5e1', 13, -42);
  eyes(ctx, '#00F0FF', -44, 'glow');
  drawCyberBox(ctx, -12, -54, 24, 6, '#e2e8f0', NEON_INK);
  drawCyberBox(ctx, wx - 2, -30, 4, 40, '#475569', NEON_INK, '#00F0FF', 1.4);
  const glow = Math.sin(tickCount * 0.2) * 2;
  drawNeonGlowRect(ctx, wx - 1, -28 + glow, 2, 14, '#00F0FF', 1);
}

// ── Zul'Gurub ──────────────────────────────────────────────────────────────

/** 温诺希斯：蛇神高阶祭司（攻略：低语 / 毒链接 / 蛇神形态） */
function drawVenoxis(ctx: CanvasRenderingContext2D, tickCount: number) {
  const sway = Math.sin(tickCount * 0.15) * 4;
  body(ctx, '#064e3b', 44, 54, '#22C55E');
  drawCyberBox(ctx, -16, -26, 32, 12, '#166534', NEON_INK, '#39FF14', 1.4);
  head(ctx, '#14532d', 13, -42);
  eyes(ctx, '#39FF14', -44, 'toxic');
  drawNeonGlowLine(ctx, -5, -52, sway, -68, 3, '#39FF14', 0.9);
  drawNeonGlowLine(ctx, 5, -52, sway, -68, 3, '#39FF14', 0.9);
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(-5, -34, 2, 6);
  ctx.fillRect(3, -34, 2, 6);
}

/** 曼多基尔：血领主 + 奥根意象（攻略：斩首 / 必杀奥根） */
function drawMandokir(ctx: CanvasRenderingContext2D, tickCount: number) {
  const bob = Math.sin(tickCount * 0.18) * 2;
  body(ctx, '#450a0a', 46, 56, '#FF1744');
  drawCyberBox(ctx, -18, -26, 36, 12, '#7f1d1d', NEON_INK, '#FACC15', 1.4);
  head(ctx, '#166534', 13, -42);
  eyes(ctx, '#FFE600', -44, 'beast');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-7, -36, 3, 7);
  ctx.fillRect(4, -36, 3, 7);
  drawCyberBox(ctx, -36, -18, 18, 5, '#78716c', NEON_INK);
  drawNeonGlowRect(ctx, -46, -20, 12, 14, '#FF1744', 0.95);
  drawCyberBox(ctx, 22, 6 + bob, 20, 12, '#14532d', NEON_INK, '#39FF14', 1.2);
  drawNeonGlowCircle(ctx, 40, 4 + bob, 5.5, '#14532d', 0.4, null);
}

/** 基尔娜拉：豹群女祭司（攻略：半血前清豹，否则狂暴） */
function drawKilnara(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const enrage = boss.hp / Math.max(1, boss.maxHp) <= 0.5;
  const neon = enrage ? '#FF2A55' : '#E879F9';
  body(ctx, '#18181b', 42, 54, neon);
  drawCyberBox(ctx, -16, -26, 32, 10, enrage ? '#7f1d1d' : '#3f3f46', NEON_INK, neon, 1.4);
  head(ctx, '#27272a', 12, -42);
  eyes(ctx, neon, -44, 'beast');
  ctx.fillStyle = NEON_INK;
  ctx.beginPath(); ctx.moveTo(-10, -50); ctx.lineTo(-6, -63); ctx.lineTo(-2, -50); ctx.fill();
  ctx.beginPath(); ctx.moveTo(10, -50); ctx.lineTo(6, -63); ctx.lineTo(2, -50); ctx.fill();
  const sway = Math.sin(tickCount * 0.2) * 8;
  drawNeonGlowLine(ctx, 16, 18, 26 + sway * 0.5, 34, 3, neon, 0.85, null);
}

/** 赞吉尔：巫医与三锅意象（攻略：大锅药剂） */
function drawZanzil(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#1a2e05', 42, 52, '#4ADE80');
  drawCyberBox(ctx, -14, -24, 28, 10, '#365314', NEON_INK, '#4ADE80', 1.4);
  head(ctx, '#166534', 12, -40);
  eyes(ctx, '#39FF14', -44, 'toxic');
  drawCyberBox(ctx, -10, -48, 20, 6, '#FACC15', NEON_INK);
  drawCyberBox(ctx, -8, -54, 4, 8, '#FACC15', NEON_INK);
  drawCyberBox(ctx, 4, -54, 4, 8, '#FACC15', NEON_INK);
  const colors = ['#39FF14', '#00F0FF', '#FF2A55'];
  colors.forEach((c, i) => {
    const bob = Math.sin(tickCount * 0.15 + i) * 2;
    drawNeonGlowCircle(ctx, -16 + i * 16, 18 + bob, 6, c, 0.95);
  });
}

/** 金度：碎神者影障（攻略：三层脆障） */
function drawJindo(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#130e26', 46, 56, '#A855F7');
  drawCyberBox(ctx, -18, -26, 36, 12, '#3b0764', NEON_INK, '#C084FC', 1.4);
  head(ctx, '#1e1b4b', 13, -42);
  eyes(ctx, '#E879F9', -44, 'rune');
  ctx.fillStyle = NEON_INK;
  ctx.beginPath(); ctx.moveTo(-13, -48); ctx.lineTo(0, -67); ctx.lineTo(13, -48); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7c3aed';
  ctx.beginPath(); ctx.moveTo(-11, -48); ctx.lineTo(0, -64); ctx.lineTo(11, -48); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const pulse = Math.sin(tickCount * 0.12 + i) * 2;
    ctx.strokeStyle = `rgba(192,132,252,${0.4 + i * 0.18})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -8, 22 + i * 8 + pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 未知五人本回落：迪菲亚式矿工剪影，避免误用死亡之翼 */
function drawGenericFiveMan(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#292524', 42, 52, '#F59E0B');
  drawCyberBox(ctx, -14, -24, 28, 10, '#57534e', NEON_INK, '#F59E0B', 1.2);
  head(ctx, '#fde68a', 12, -40);
  eyes(ctx, '#FF2A55', -44, 'hollow');
  const bob = Math.sin(tickCount * 0.1) * 2;
  drawCyberBox(ctx, 14, -16 + bob, 4, 22, '#78716c', NEON_INK);
}

/**
 * @returns true 若已按五人本 Boss 绘制
 */
export function drawFiveManBossModel(
  ctx: CanvasRenderingContext2D,
  bossUnit: Unit,
  tickCount: number,
): boolean {
  const id = (bossUnit.id || '').toLowerCase();
  switch (id) {
    case 'glubtok':
      drawGlubtok(ctx, tickCount);
      return true;
    case 'helix':
      drawHelix(ctx, tickCount);
      return true;
    case 'foe_reaper':
      drawFoeReaper(ctx, tickCount);
      return true;
    case 'ripsnarl':
      drawRipsnarl(ctx, tickCount);
      return true;
    case 'cookie':
      drawCookie(ctx, tickCount);
      return true;
    case 'vanessa':
      drawVanessa(ctx, tickCount);
      return true;
    case 'vishas':
      drawVishas(ctx, tickCount);
      return true;
    case 'thalnoren':
      drawThalnoren(ctx, tickCount);
      return true;
    case 'loksey':
      drawLoksey(ctx, tickCount);
      return true;
    case 'doan':
      drawDoan(ctx, bossUnit, tickCount);
      return true;
    case 'herod':
      drawHerod(ctx, tickCount);
      return true;
    case 'mograine_whitemane':
    case 'mograine':
      drawMograine(ctx, bossUnit, tickCount);
      return true;
    case 'willey':
      drawWilley(ctx, tickCount);
      return true;
    case 'balnazzar':
      drawBalnazzar(ctx, bossUnit, tickCount);
      return true;
    case 'ramstein':
      drawRamstein(ctx, tickCount);
      return true;
    case 'rivendare':
      drawRivendare(ctx, tickCount);
      return true;
    case 'venoxis':
      drawVenoxis(ctx, tickCount);
      return true;
    case 'mandokir':
      drawMandokir(ctx, tickCount);
      return true;
    case 'kilnara':
      drawKilnara(ctx, bossUnit, tickCount);
      return true;
    case 'zanzil':
      drawZanzil(ctx, tickCount);
      return true;
    case 'jindo':
      drawJindo(ctx, tickCount);
      return true;
    default:
      return false;
  }
}

export function drawFiveManBossFallback(ctx: CanvasRenderingContext2D, tickCount: number) {
  drawGenericFiveMan(ctx, tickCount);
}
