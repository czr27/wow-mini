/**
 * 五人本 Boss 像素外形：按 dungeon_guides 定位 + 经典形象绘制。
 * 约定：脚下原点已由 drawBossModel translate；造型以躯干/头/标志物区分。
 * 眼睛随 withBossEightDirFacing 写入的八向姿态偏移。
 */
import type { Unit } from '@cata-raid-sim/engine';
import { drawFacingEyePair } from './eightDirModels.js';

function body(ctx: CanvasRenderingContext2D, color: string, w = 44, h = 56) {
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -30, w, h);
}

function head(ctx: CanvasRenderingContext2D, color: string, r = 13, y = -42) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function eyes(ctx: CanvasRenderingContext2D, color: string, y = -44) {
  drawFacingEyePair(ctx, color, { y, size: 3.2, halfGap: 5 });
}

// ── Deadmines ──────────────────────────────────────────────────────────────

/** 戈洛克：双生火/冰拳的食人魔术士（攻略：火霜拳轮换） */
function drawGlubtok(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#57534e', 52, 58);
  ctx.fillStyle = '#78716c';
  ctx.fillRect(-22, -28, 44, 14);
  head(ctx, '#a8a29e', 16, -44);
  // 双角
  ctx.fillStyle = '#44403c';
  ctx.beginPath();
  ctx.moveTo(-10, -54);
  ctx.lineTo(-16, -68);
  ctx.lineTo(-4, -56);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -54);
  ctx.lineTo(16, -68);
  ctx.lineTo(4, -56);
  ctx.fill();
  eyes(ctx, '#fbbf24', -46);
  // 左炎拳 / 右霜拳脉冲
  const pulse = 1 + Math.sin(tickCount * 0.2) * 0.15;
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(-30, -4, 10 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7dd3fc';
  ctx.beginPath();
  ctx.arc(30, -4, 10 * pulse, 0, Math.PI * 2);
  ctx.fill();
}

/** 赫利克斯：骑乘木虱的地精拆轮（攻略：先打木虱再跳背） */
function drawHelix(ctx: CanvasRenderingContext2D, tickCount: number) {
  // 木虱底座
  ctx.fillStyle = '#3f3f46';
  ctx.fillRect(-28, -8, 56, 36);
  ctx.fillStyle = '#71717a';
  ctx.fillRect(-22, -4, 44, 16);
  ctx.fillStyle = '#a1a1aa';
  ctx.fillRect(-18, 8, 10, 8);
  ctx.fillRect(8, 8, 10, 8);
  // 地精骑手
  const bob = Math.sin(tickCount * 0.15) * 2;
  ctx.fillStyle = '#365314';
  ctx.fillRect(-12, -28 + bob, 24, 22);
  ctx.fillStyle = '#84cc16';
  ctx.fillRect(-10, -26 + bob, 20, 10);
  head(ctx, '#4d7c0f', 10, -36 + bob);
  eyes(ctx, '#facc15', -38 + bob);
  // 齿轮扳手
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(14, -22 + bob, 4, 18);
  ctx.beginPath();
  ctx.arc(16, -24 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
}

/** 死神5000：收割机巨械（攻略：正面收割 / 过载乱跑） */
function drawFoeReaper(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#3f3f46', 50, 54);
  ctx.fillStyle = '#52525b';
  ctx.fillRect(-20, -26, 40, 18);
  // 烟囱排气
  const smoke = Math.sin(tickCount * 0.2) * 3;
  ctx.fillStyle = '#78716c';
  ctx.fillRect(-6, -48, 12, 16);
  ctx.fillStyle = 'rgba(161,161,170,0.55)';
  ctx.beginPath();
  ctx.arc(-2, -56 + smoke, 5, 0, Math.PI * 2);
  ctx.arc(6, -60 - smoke, 4, 0, Math.PI * 2);
  ctx.fill();
  // 驾驶舱眼灯
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-14, -22, 28, 12);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-10, -19, 8, 6);
  ctx.fillRect(2, -19, 8, 6);
  // 收割镰臂
  ctx.fillStyle = '#a1a1aa';
  ctx.fillRect(-38, -10, 16, 6);
  ctx.fillRect(22, -10, 16, 6);
  ctx.fillStyle = '#e11d48';
  ctx.beginPath();
  ctx.moveTo(-38, -12);
  ctx.lineTo(-52, 4);
  ctx.lineTo(-34, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(38, -12);
  ctx.lineTo(52, 4);
  ctx.lineTo(34, 2);
  ctx.fill();
}

/** 撕心船长：狼人海盗上将（攻略：迷雾甲板 / 蒸汽） */
function drawRipsnarl(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#1c1917', 46, 56);
  ctx.fillStyle = '#44403c';
  ctx.fillRect(-18, -26, 36, 12);
  // 海盗大衣金扣
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-4, -18, 3, 3);
  ctx.fillRect(2, -10, 3, 3);
  head(ctx, '#292524', 14, -42);
  // 狼耳
  ctx.fillStyle = '#18181b';
  ctx.beginPath();
  ctx.moveTo(-10, -50);
  ctx.lineTo(-6, -64);
  ctx.lineTo(-2, -50);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -50);
  ctx.lineTo(6, -64);
  ctx.lineTo(2, -50);
  ctx.fill();
  eyes(ctx, '#f97316', -44);
  // 三角帽
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(-18, -48);
  ctx.lineTo(0, -62);
  ctx.lineTo(18, -48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(-4, -56, 8, 3);
  // 迷雾丝带
  const fog = Math.sin(tickCount * 0.1) * 4;
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.beginPath();
  ctx.ellipse(-20 + fog, 10, 14, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(18 - fog, 14, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 曲奇：甲板厨子鱼人（攻略：抛掷好/坏食物） */
function drawCookie(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#0e7490', 40, 48);
  ctx.fillStyle = '#155e75';
  ctx.fillRect(-16, -24, 32, 12);
  head(ctx, '#22d3ee', 14, -38);
  // 大嘴
  ctx.fillStyle = '#083344';
  ctx.beginPath();
  ctx.ellipse(0, -34, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  eyes(ctx, '#fef08a', -42);
  // 厨师帽
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-10, -58, 20, 14);
  ctx.beginPath();
  ctx.arc(0, -58, 12, Math.PI, 0);
  ctx.fill();
  // 抛食物
  const toss = (tickCount % 40) / 40;
  ctx.fillStyle = toss > 0.5 ? '#4ade80' : '#a855f7';
  ctx.beginPath();
  ctx.arc(22 + toss * 8, -20 - Math.sin(toss * Math.PI) * 18, 5, 0, Math.PI * 2);
  ctx.fill();
}

/** 梵妮莎：迪菲亚黑衣刺客（攻略：英雄尾王 / 绳索梦魇） */
function drawVanessa(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#1c1917', 38, 54);
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(-16, -26, 32, 10);
  // 迪菲亚红巾
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(-8, -34);
  ctx.lineTo(8, -34);
  ctx.lineTo(0, -22);
  ctx.closePath();
  ctx.fill();
  head(ctx, '#fde68a', 12, -44);
  eyes(ctx, '#ef4444', -46);
  // 双匕
  const flash = tickCount % 20 < 6;
  ctx.fillStyle = flash ? '#f8fafc' : '#94a3b8';
  ctx.fillRect(-28, -16, 14, 3);
  ctx.fillRect(14, -16, 14, 3);
  ctx.fillStyle = '#78350f';
  ctx.fillRect(-18, -14, 4, 8);
  ctx.fillRect(14, -14, 4, 8);
}

// ── Scarlet Monastery ──────────────────────────────────────────────────────

/** 韦沙斯：血色审讯官（攻略：暗言术痛） */
function drawVishas(ctx: CanvasRenderingContext2D, _tickCount: number) {
  body(ctx, '#7f1d1d', 42, 54);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-14, -26, 28, 14);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, '#dc2626');
  // 审讯兜帽
  ctx.fillStyle = '#450a0a';
  ctx.beginPath();
  ctx.moveTo(-14, -40);
  ctx.lineTo(0, -58);
  ctx.lineTo(14, -40);
  ctx.closePath();
  ctx.fill();
  // 圣契
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(14, -12, 10, 14);
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(16, -10, 6, 4);
}

/** 萨尔诺斯：血法师焰环（攻略：火焰新星） */
function drawThalnoren(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#9f1239', 42, 54);
  ctx.fillStyle = '#fecaca';
  ctx.fillRect(-14, -26, 28, 10);
  head(ctx, '#fca5a5', 12, -42);
  eyes(ctx, '#f97316');
  const flame = Math.sin(tickCount * 0.25) * 3;
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(-8, -52);
  ctx.lineTo(0, -66 + flame);
  ctx.lineTo(8, -52);
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(18, -8, 7 + flame * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** 洛克希：驯犬者披挂（攻略：开战刷猎犬） */
function drawLoksey(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#991b1b', 44, 54);
  ctx.fillStyle = '#44403c';
  ctx.fillRect(-18, -24, 36, 12);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, '#ef4444');
  // 猎犬项圈挂饰
  ctx.fillStyle = '#a8a29e';
  ctx.fillRect(-8, -18, 16, 4);
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(0, -12, 4, 0, Math.PI * 2);
  ctx.fill();
  // 侧旁猎犬剪影
  const bob = Math.sin(tickCount * 0.2) * 2;
  ctx.fillStyle = '#292524';
  ctx.fillRect(-36, 4 + bob, 16, 10);
  ctx.beginPath();
  ctx.arc(-34, 2 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
}

/** 杜安：奥法师紫袍 + 气泡意象（攻略：半血奥术气泡自爆） */
function drawDoan(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  body(ctx, '#4c1d95', 42, 54);
  ctx.fillStyle = '#a78bfa';
  ctx.fillRect(-16, -26, 32, 12);
  head(ctx, '#e9d5ff', 12, -42);
  eyes(ctx, '#c084fc');
  // 法师尖帽
  ctx.fillStyle = '#2e1065';
  ctx.beginPath();
  ctx.moveTo(-12, -44);
  ctx.lineTo(0, -70);
  ctx.lineTo(12, -44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-3, -58, 6, 4);
  const bubbled = boss.buffs?.some(b => b.spellId === 'arcane_bubble') || boss.hp / boss.maxHp <= 0.5;
  if (bubbled) {
    const pulse = 18 + Math.sin(tickCount * 0.2) * 2;
    ctx.strokeStyle = 'rgba(168,85,247,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -10, pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 赫洛德：军械库勇士双斧旋风（攻略：旋风斩 / 学徒潮） */
function drawHerod(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#b91c1c', 46, 56);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-18, -26, 36, 12);
  head(ctx, '#fde68a', 13, -42);
  eyes(ctx, '#ef4444');
  // 羽冠盔
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(-14, -52, 28, 8);
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.lineTo(-6, -68);
  ctx.lineTo(6, -68);
  ctx.closePath();
  ctx.fill();
  // 旋风双斧
  const spin = tickCount * 0.35;
  ctx.save();
  ctx.rotate(spin);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(-36, -3, 72, 6);
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(-40, -8, 12, 16);
  ctx.fillRect(28, -8, 12, 16);
  ctx.restore();
}

/** 莫格莱尼：血色大领主板甲（攻略：假死 → 怀特迈恩复活） */
function drawMograine(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const fakeDead = boss.hp / Math.max(1, boss.maxHp) <= 0.05;
  body(ctx, fakeDead ? '#44403c' : '#9f1239', 46, 56);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-18, -26, 36, 14);
  // 胸前血色十字
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(-3, -24, 6, 16);
  ctx.fillRect(-8, -18, 16, 5);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, fakeDead ? '#64748b' : '#ef4444');
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(-14, -52, 28, 8);
  if (!fakeDead) {
    // 战锤
    ctx.fillStyle = '#78716c';
    ctx.fillRect(18, -28, 5, 36);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(14, -34, 14, 10);
  } else {
    ctx.fillStyle = 'rgba(248,250,252,0.35)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('假死…', 0, 8);
  }
  void tickCount;
}

// ── Stratholme ─────────────────────────────────────────────────────────────

/** 威利：血色炮手（攻略：开炮清火枪手） */
function drawWilley(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#991b1b', 42, 54);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-14, -24, 28, 10);
  head(ctx, '#fde68a', 12, -42);
  eyes(ctx, '#ef4444');
  // 肩炮
  ctx.fillStyle = '#3f3f46';
  ctx.fillRect(14, -28, 22, 10);
  ctx.fillStyle = '#52525b';
  ctx.fillRect(30, -26, 10, 6);
  if (tickCount % 28 < 5) {
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(44, -23, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 巴纳扎尔：达索汉人形 → 恶魔（攻略：半血变身恶魔） */
function drawBalnazzar(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const demon = boss.hp / Math.max(1, boss.maxHp) <= 0.5;
  if (!demon) {
    body(ctx, '#7f1d1d', 44, 54);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-16, -26, 32, 12);
    head(ctx, '#fde68a', 12, -42);
    eyes(ctx, '#ef4444');
    ctx.fillStyle = '#450a0a';
    ctx.fillRect(-16, -52, 32, 8);
    return;
  }
  // 恐惧魔王
  body(ctx, '#3f0a0a', 48, 56);
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(-20, -26, 40, 14);
  const wing = Math.sin(tickCount * 0.15) * 6;
  ctx.fillStyle = 'rgba(127,29,29,0.85)';
  ctx.beginPath();
  ctx.moveTo(-18, -20);
  ctx.quadraticCurveTo(-50 - wing, -40, -48, 10);
  ctx.lineTo(-18, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, -20);
  ctx.quadraticCurveTo(50 + wing, -40, 48, 10);
  ctx.lineTo(18, 8);
  ctx.fill();
  head(ctx, '#450a0a', 14, -44);
  // 角
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(-8, -54);
  ctx.lineTo(-14, -70);
  ctx.lineTo(-2, -56);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -54);
  ctx.lineTo(14, -70);
  ctx.lineTo(2, -56);
  ctx.fill();
  eyes(ctx, '#f97316', -46);
}

/** 拉姆斯登：屠宰房憎恶（攻略：践踏 / 亡灵增援） */
function drawRamstein(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#3f6212', 54, 58);
  ctx.fillStyle = '#65a30d';
  ctx.fillRect(-22, -24, 44, 16);
  // 双头
  ctx.fillStyle = '#1a2e05';
  ctx.beginPath();
  ctx.arc(-10, -42, 11, 0, Math.PI * 2);
  ctx.arc(12, -40, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a3e635';
  ctx.fillRect(-14, -44, 3, 3);
  ctx.fillRect(10, -42, 3, 3);
  // 缝线
  ctx.strokeStyle = '#14532d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(0, 20);
  ctx.stroke();
  const stomp = Math.abs(Math.sin(tickCount * 0.12)) * 4;
  ctx.fillStyle = '#4d7c0f';
  ctx.fillRect(-24, 22 + stomp, 18, 8);
  ctx.fillRect(6, 22 + stomp, 18, 8);
}

/** 瑞文戴尔：天灾死亡骑士（攻略：暗影打击 + 骷髅） */
function drawRivendare(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#1e1b4b', 46, 56);
  ctx.fillStyle = '#312e81';
  ctx.fillRect(-18, -26, 36, 14);
  // 符文肩甲
  ctx.fillStyle = '#4c1d95';
  ctx.fillRect(-28, -28, 12, 16);
  ctx.fillRect(16, -28, 12, 16);
  head(ctx, '#cbd5e1', 13, -42);
  eyes(ctx, '#22d3ee');
  // 骷髅冠
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(-12, -54, 24, 6);
  // 符文剑
  ctx.fillStyle = '#64748b';
  ctx.fillRect(20, -30, 4, 40);
  const glow = Math.sin(tickCount * 0.2) * 2;
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(21, -28 + glow, 2, 12);
}

// ── Zul'Gurub ──────────────────────────────────────────────────────────────

/** 温诺希斯：蛇神高阶祭司（攻略：低语 / 毒链接 / 蛇神形态） */
function drawVenoxis(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#166534', 44, 54);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(-16, -26, 32, 12);
  head(ctx, '#14532d', 13, -42);
  eyes(ctx, '#a3e635');
  // 蛇冠
  const sway = Math.sin(tickCount * 0.15) * 4;
  ctx.fillStyle = '#84cc16';
  ctx.beginPath();
  ctx.moveTo(-6, -52);
  ctx.quadraticCurveTo(-14 + sway, -70, 0, -64);
  ctx.quadraticCurveTo(14 - sway, -70, 6, -52);
  ctx.fill();
  // 毒牙
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(-5, -34, 2, 6);
  ctx.fillRect(3, -34, 2, 6);
}

/** 曼多基尔：血领主 + 奥根意象（攻略：斩首 / 必杀奥根） */
function drawMandokir(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#7f1d1d', 46, 56);
  ctx.fillStyle = '#450a0a';
  ctx.fillRect(-18, -26, 36, 12);
  head(ctx, '#166534', 13, -42);
  eyes(ctx, '#facc15');
  // 獠牙
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-7, -36, 3, 7);
  ctx.fillRect(4, -36, 3, 7);
  // 斩首巨斧
  ctx.fillStyle = '#78716c';
  ctx.fillRect(-36, -18, 18, 5);
  ctx.fillStyle = '#e11d48';
  ctx.beginPath();
  ctx.moveTo(-36, -22);
  ctx.lineTo(-48, -8);
  ctx.lineTo(-34, -6);
  ctx.fill();
  // 侧旁迅猛龙剪影（奥根）
  const bob = Math.sin(tickCount * 0.18) * 2;
  ctx.fillStyle = '#14532d';
  ctx.fillRect(22, 6 + bob, 20, 12);
  ctx.beginPath();
  ctx.arc(40, 4 + bob, 6, 0, Math.PI * 2);
  ctx.fill();
}

/** 基尔娜拉：豹群女祭司（攻略：半血前清豹，否则狂暴） */
function drawKilnara(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const enrage = boss.hp / Math.max(1, boss.maxHp) <= 0.5;
  body(ctx, enrage ? '#18181b' : '#3f3f46', 42, 54);
  ctx.fillStyle = enrage ? '#f97316' : '#a1a1aa';
  ctx.fillRect(-16, -26, 32, 10);
  head(ctx, '#27272a', 12, -42);
  eyes(ctx, enrage ? '#ef4444' : '#fbbf24');
  // 豹耳
  ctx.fillStyle = '#09090b';
  ctx.beginPath();
  ctx.moveTo(-10, -50);
  ctx.lineTo(-6, -62);
  ctx.lineTo(-2, -50);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -50);
  ctx.lineTo(6, -62);
  ctx.lineTo(2, -50);
  ctx.fill();
  // 豹尾
  const sway = Math.sin(tickCount * 0.2) * 8;
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(16, 18);
  ctx.quadraticCurveTo(28 + sway, 28, 22, 36);
  ctx.stroke();
}

/** 赞吉尔：巫医与三锅意象（攻略：大锅药剂） */
function drawZanzil(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#365314', 42, 52);
  ctx.fillStyle = '#4d7c0f';
  ctx.fillRect(-14, -24, 28, 10);
  head(ctx, '#166534', 12, -40);
  eyes(ctx, '#a3e635');
  // 巫医面具
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-10, -48, 20, 6);
  ctx.fillRect(-8, -54, 4, 8);
  ctx.fillRect(4, -54, 4, 8);
  // 三锅色点
  const colors = ['#22c55e', '#3b82f6', '#ef4444'];
  colors.forEach((c, i) => {
    const bob = Math.sin(tickCount * 0.15 + i) * 2;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(-16 + i * 16, 18 + bob, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** 金度：碎神者影障（攻略：三层脆障） */
function drawJindo(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#1e1b4b', 46, 56);
  ctx.fillStyle = '#4c1d95';
  ctx.fillRect(-18, -26, 36, 12);
  head(ctx, '#312e81', 13, -42);
  eyes(ctx, '#c084fc');
  // 影冠
  ctx.fillStyle = '#7c3aed';
  ctx.beginPath();
  ctx.moveTo(-12, -48);
  ctx.lineTo(0, -66);
  ctx.lineTo(12, -48);
  ctx.closePath();
  ctx.fill();
  // 脆障层环
  for (let i = 0; i < 3; i++) {
    const pulse = Math.sin(tickCount * 0.12 + i) * 2;
    ctx.strokeStyle = `rgba(168,85,247,${0.35 + i * 0.15})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -8, 22 + i * 8 + pulse, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 未知五人本回落：迪菲亚式矿工剪影，避免误用死亡之翼 */
function drawGenericFiveMan(ctx: CanvasRenderingContext2D, tickCount: number) {
  body(ctx, '#44403c', 42, 52);
  ctx.fillStyle = '#a8a29e';
  ctx.fillRect(-14, -24, 28, 10);
  head(ctx, '#fde68a', 12, -40);
  eyes(ctx, '#ef4444');
  const bob = Math.sin(tickCount * 0.1) * 2;
  ctx.fillStyle = '#78716c';
  ctx.fillRect(14, -16 + bob, 4, 22);
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
