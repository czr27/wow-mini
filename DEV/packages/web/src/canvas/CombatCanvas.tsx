import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Unit,
  GroundEffect,
  FloatingCombatText,
  RunPhase,
  evaluateGroundFormationPosition,
  GroundTargetState,
  createAIPersonality,
  resolveFidgetIdleThresholdMs,
} from '@cata-raid-sim/engine';
import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';

interface Props {
  units: Unit[];
  bossUnit?: Unit;
  bossTargetId?: string | null;
  groundEffects: GroundEffect[];
  floatingTexts: FloatingCombatText[];
  runPhase: RunPhase | 'PULL_APPROACH';
  screenShake: boolean;
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
  onSetFocus?: (id: string) => void;
  onPlayerMove?: () => void;
  onCancelCast?: () => void;
  onApproachComplete?: () => void;
  onFastForwardTravel?: () => void;
  revivingUnitId?: string | null;
  reviveProgress?: number;
  autoApproachTarget?: { targetX: number; targetY: number; desiredDist: number } | null;
  onApproachTargetReached?: () => void;
  dungeonTier?: any;
  targetBossName?: string;
  currentBossIndex?: number;
  travelRemainingMs?: number;
  totalTravelMs?: number;
  isCorpseRunning?: boolean;
  corpseRunRemainingMs?: number;
  groundTargetState?: GroundTargetState | null;
  onConfirmGroundTarget?: (slotIdx: number, spellId: string, x: number, y: number) => void;
  onCancelGroundTarget?: () => void;
}

interface Projectile {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  kind: 'FIRE' | 'FROST' | 'HEAL';
  progress: number;
}

interface MeleeSlash {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  elapsedMs: number;
  totalMs: number;
}

interface HealingBeam {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  elapsedMs: number;
  totalMs: number;
}

export type MobModelType =
  | 'WORGEN_PATROL'
  | 'DARK_WOLF'
  | 'SHADOW_CHANNELER'
  | 'SHADOW_SHIELDGUARD'
  | 'TWILIGHT_DRAKONID'
  | 'LAVA_DRAKE'
  | 'TWILIGHT_VOIDWEAVER'
  | 'DRAGON_ANNIHILATOR';

export interface TrashMob {
  id: string;
  name: string;
  mobModel: MobModelType;
  packIndex: number; // 1 or 2
  distAlongMaze: number;
  x: number;
  y: number;
  /** Idle stand offset from pack anchor — used for mild combat bob. */
  baseX: number;
  baseY: number;
  hp: number;
  visualHp: number; // for smooth health bar lagging chip
  maxHp: number;
  isDead: boolean;
  /** Dead mobs become persistent tombstones (no auto-despawn). */
  isTombstone: boolean;
  dissipateAlpha: number; // kept for legacy FX; tombstones stay at 1
}

interface EncounterSCTItem {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  isCrit: boolean;
}

// ── Boss Drawing Sub-renderers (Shadowfang Keep + Dragon Soul) ──────────────

function drawBaronAshbury(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const isArchangel = boss.hp < boss.maxHp * 0.3;

  // Dark Archangel Void Wings under 30% HP
  if (isArchangel) {
    ctx.save();
    const wingFlap = Math.sin(tickCount * 0.15) * 8;
    // Left Wing
    ctx.fillStyle = 'rgba(124, 58, 237, 0.85)';
    ctx.beginPath();
    ctx.moveTo(-15, -25);
    ctx.quadraticCurveTo(-65 + wingFlap, -60, -75 + wingFlap, -20);
    ctx.quadraticCurveTo(-50 + wingFlap, 10, -15, 0);
    ctx.fill();
    // Right Wing
    ctx.beginPath();
    ctx.moveTo(15, -25);
    ctx.quadraticCurveTo(65 - wingFlap, -60, 75 - wingFlap, -20);
    ctx.quadraticCurveTo(50 - wingFlap, 10, 15, 0);
    ctx.fill();

    // Void particles
    ctx.fillStyle = '#C084FC';
    for (let i = 0; i < 4; i++) {
      const px = -60 + ((i * 35 + tickCount * 3) % 120);
      const py = -40 + Math.sin(tickCount * 0.2 + i) * 15;
      ctx.fillRect(px, py, 3, 3);
    }
    ctx.restore();

    ctx.fillStyle = '#A855F7';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('😈 黑暗大天使形态 (狂暴暗影箭雨！)', 0, -84);
  }

  // Victorian Tailcoat Body
  ctx.fillStyle = '#1e1b2e';
  ctx.fillRect(-22, -30, 44, 58);
  // Imperial Purple Lapels
  ctx.fillStyle = '#4c1d95';
  ctx.fillRect(-18, -28, 36, 12);
  // White Cravat / Jabot
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.lineTo(-8, -14);
  ctx.lineTo(8, -14);
  ctx.closePath();
  ctx.fill();

  // Skeletal Visage
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(0, -42, 14, 0, Math.PI * 2);
  ctx.fill();
  // Eyes: Green normally, Red in Archangel
  ctx.fillStyle = isArchangel ? '#EF4444' : '#10B981';
  ctx.fillRect(-6, -44, 4, 3);
  ctx.fillRect(2, -44, 4, 3);

  // High arched collar
  ctx.fillStyle = '#312e81';
  ctx.beginPath();
  ctx.moveTo(-14, -36);
  ctx.lineTo(-20, -50);
  ctx.lineTo(-12, -40);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, -36);
  ctx.lineTo(20, -50);
  ctx.lineTo(12, -40);
  ctx.fill();
}

function drawBaronSilverlaine(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  // Ethereal Ghost Lord Worgen (translucent cyan)
  ctx.save();
  const alpha = 0.82 + Math.sin(tickCount * 0.08) * 0.12;
  ctx.globalAlpha = alpha;

  // Ghost wolf body
  ctx.fillStyle = '#0f766e';
  ctx.fillRect(-24, -30, 48, 56);
  // Ghost wisps
  ctx.fillStyle = '#2dd4bf';
  ctx.fillRect(-20, -26, 40, 14);

  // Wolf Spirit Head
  ctx.fillStyle = '#115e59';
  ctx.beginPath();
  ctx.arc(0, -42, 15, 0, Math.PI * 2);
  ctx.fill();

  // Wolf Ears
  ctx.fillStyle = '#14b8a6';
  ctx.beginPath();
  ctx.moveTo(-12, -50);
  ctx.lineTo(-6, -62);
  ctx.lineTo(-2, -50);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, -50);
  ctx.lineTo(6, -62);
  ctx.lineTo(2, -50);
  ctx.fill();

  // Snout & Fangs
  ctx.fillStyle = '#0d9488';
  ctx.fillRect(-6, -42, 12, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-4, -34, 2, 3);
  ctx.fillRect(2, -34, 2, 3);

  // Spectral Pale Eyes
  ctx.fillStyle = '#99f6e4';
  ctx.fillRect(-6, -46, 3, 3);
  ctx.fillRect(3, -46, 3, 3);

  // Ethereal Claws
  ctx.fillStyle = '#5eead4';
  ctx.fillRect(-32, -8, 8, 22);
  ctx.fillRect(24, -8, 8, 22);

  ctx.restore();
}

function drawCommanderSpringvale(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  // Heavy Steel Plate
  ctx.fillStyle = '#334155';
  ctx.fillRect(-25, -30, 50, 58);
  // Unholy Miasma Green Inlay
  ctx.fillStyle = '#15803d';
  ctx.fillRect(-20, -26, 40, 14);

  // Greathelm Visor
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(0, -44, 15, 0, Math.PI * 2);
  ctx.fill();
  // Glowing green eye slit
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(-8, -45, 16, 3);

  // Massive Spiked Shoulders (Pauldrons)
  ctx.fillStyle = '#475569';
  ctx.fillRect(-38, -36, 15, 20);
  ctx.fillRect(23, -36, 15, 20);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(-34, -44, 6, 9);
  ctx.fillRect(28, -44, 6, 9);

  // Skull Tower Shield (Left Arm)
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-44, -14, 16, 42);
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(-36, 4, 5, 0, Math.PI * 2);
  ctx.fill();

  // Two-handed Claymore (Right Arm)
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(30, -38, 5, 68);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(26, -10, 13, 5);

  // Unholy Foot Miasma
  ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
  ctx.beginPath();
  ctx.arc(0, 32, 28, 0, Math.PI * 2);
  ctx.fill();
}

function drawLordWalden(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  // Leather Apron Body
  ctx.fillStyle = '#451a03';
  ctx.fillRect(-20, -28, 40, 56);
  ctx.fillStyle = '#78350f';
  ctx.fillRect(-16, -24, 32, 38);

  // Head & Mad Alchemist Hair
  ctx.fillStyle = '#fed7aa';
  ctx.beginPath();
  ctx.arc(0, -40, 13, 0, Math.PI * 2);
  ctx.fill();
  // Wild grey hair
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(-15, -48, 30, 8);
  ctx.fillRect(-17, -44, 6, 12);
  ctx.fillRect(11, -44, 6, 12);

  // Brass Goggles (One green lens, one red lens)
  ctx.fillStyle = '#ca8a04';
  ctx.fillRect(-9, -43, 8, 7);
  ctx.fillRect(1, -43, 8, 7);
  ctx.fillStyle = '#22c55e'; // Left green lens
  ctx.fillRect(-7, -41, 4, 3);
  ctx.fillStyle = '#ef4444'; // Right red lens
  ctx.fillRect(3, -41, 4, 3);

  // Bandolier of chemical vials
  ctx.fillStyle = '#1c1917';
  ctx.fillRect(-18, -14, 36, 6);
  const vialColors = ['#22c55e', '#ef4444', '#38bdf8'];
  vialColors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(-12 + i * 10, -20, 6, 9);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(-11 + i * 10, -22, 4, 2);
  });

  // Bubbling Flask in Hand
  const bobY = Math.sin(tickCount * 0.15) * 2;
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(28, -6 + bobY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(26, -18 + bobY, 4, 6);

  // Drifting chemical smoke puffs
  ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.beginPath();
  ctx.arc(28, -24 + bobY, 4, 0, Math.PI * 2);
  ctx.arc(31, -30 + bobY, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawLordGodfrey(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  // Burgundy Longcoat Body
  ctx.fillStyle = '#4c0519';
  ctx.fillRect(-22, -30, 44, 58);
  // Gold Double-breasted Buttons
  ctx.fillStyle = '#facc15';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(-6, -22 + i * 9, 3, 3);
    ctx.fillRect(3, -22 + i * 9, 3, 3);
  }

  // Head & Aristocratic Grey Hair
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(0, -42, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(-14, -50, 28, 8);
  ctx.fillRect(-16, -46, 5, 14);
  ctx.fillRect(11, -46, 5, 14);

  // Wire spectacles & Monocle
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-8, -44, 6, 5);
  ctx.strokeRect(2, -44, 6, 5);

  // Godfrey's Dual Flintlock Pistols
  // Left Pistol
  ctx.fillStyle = '#78350f';
  ctx.fillRect(-34, -14, 16, 6);
  ctx.fillStyle = '#52525b';
  ctx.fillRect(-38, -12, 18, 6);
  ctx.fillStyle = '#d4af37';
  ctx.fillRect(-26, -14, 4, 10);

  // Right Pistol
  ctx.fillStyle = '#78350f';
  ctx.fillRect(18, -14, 16, 6);
  ctx.fillStyle = '#52525b';
  ctx.fillRect(20, -12, 18, 6);
  ctx.fillStyle = '#d4af37';
  ctx.fillRect(22, -14, 4, 10);

  // Gunpowder smoke & muzzle spark
  const shootTick = tickCount % 25;
  if (shootTick < 5) {
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(-42, -9, 4, 0, Math.PI * 2);
    ctx.arc(42, -9, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Drifting smoke
    ctx.fillStyle = 'rgba(212, 212, 216, 0.45)';
    ctx.beginPath();
    ctx.arc(-42 - shootTick * 0.5, -12 - shootTick * 0.4, 3 + shootTick * 0.3, 0, Math.PI * 2);
    ctx.arc(42 + shootTick * 0.5, -12 - shootTick * 0.4, 3 + shootTick * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Dragon Soul Boss Sub-renderers ──────────────────────────────────────────

function drawMorchok(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Colossal Jagged Obsidian Earth Elemental with Resonating Crystals
  ctx.fillStyle = '#292524';
  ctx.fillRect(-30, -32, 60, 64);
  ctx.fillStyle = '#44403c';
  ctx.fillRect(-24, -28, 48, 20);
  // Resonating Crystal Spikes on shoulders
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.moveTo(-28, -25);
  ctx.lineTo(-44, -55);
  ctx.lineTo(-20, -35);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, -25);
  ctx.lineTo(44, -55);
  ctx.lineTo(20, -35);
  ctx.fill();
  // Glowing amber crystal facets
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-12, -15, 24, 10);
  ctx.fillRect(-6, 2, 12, 12);
  // Heavy Stone Head
  ctx.fillStyle = '#1c1917';
  ctx.beginPath();
  ctx.arc(0, -42, 16, 0, Math.PI * 2);
  ctx.fill();
  // Glowing Magma Fissure Eyes
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(-8, -44, 5, 3);
  ctx.fillRect(3, -44, 5, 3);
  // Floating Earth debris
  const floatY = Math.sin(tickCount * 0.1) * 3;
  ctx.fillStyle = '#78716c';
  ctx.fillRect(-38, -10 + floatY, 8, 8);
  ctx.fillRect(30, 5 - floatY, 8, 8);
}

function drawZonozz(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Warlord Zon'ozz - C'Thun Faceless Behemoth
  ctx.fillStyle = '#1e1b4b';
  ctx.fillRect(-28, -26, 56, 58);
  // Writhing Tentacles
  ctx.strokeStyle = '#4338ca';
  ctx.lineWidth = 5;
  ctx.beginPath();
  const sway1 = Math.sin(tickCount * 0.1) * 8;
  const sway2 = Math.cos(tickCount * 0.1) * 8;
  ctx.moveTo(-20, 20);
  ctx.quadraticCurveTo(-45 + sway1, 35, -35, 45);
  ctx.moveTo(20, 20);
  ctx.quadraticCurveTo(45 - sway2, 35, 35, 45);
  ctx.stroke();
  // Abyssal Chitinous Mantle
  ctx.fillStyle = '#312e81';
  ctx.fillRect(-22, -22, 44, 20);
  // Giant Central Void Eyeball of C'Thun
  ctx.fillStyle = '#e0e7ff';
  ctx.beginPath();
  ctx.arc(0, -35, 18, 0, Math.PI * 2);
  ctx.fill();
  // Shifting Void Iris
  const irisX = Math.sin(tickCount * 0.05) * 4;
  ctx.fillStyle = '#7c2d12';
  ctx.beginPath();
  ctx.arc(irisX, -35, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(irisX, -35, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(irisX, -35, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawYorsahj(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Yor'sahj the Unsleeping - Aberrant Void Ooze
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-26, -26, 52, 56);
  // Pulsing Ooze Globs (Black, Red, Green)
  const pulse = Math.sin(tickCount * 0.12) * 3;
  ctx.fillStyle = '#16a34a'; // Acid green
  ctx.beginPath();
  ctx.arc(-16, -10 + pulse, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dc2626'; // Deep blood
  ctx.beginPath();
  ctx.arc(16, -10 - pulse, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7c3aed'; // Shadow globule
  ctx.beginPath();
  ctx.arc(0, 10 + pulse, 14, 0, Math.PI * 2);
  ctx.fill();
  // Maw with multiple jagged eyes
  ctx.fillStyle = '#09090b';
  ctx.beginPath();
  ctx.arc(0, -38, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#facc15';
  ctx.fillRect(-8, -42, 4, 3);
  ctx.fillRect(4, -42, 4, 3);
  ctx.fillRect(-2, -34, 4, 3);
}

function drawHagara(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Hagara the Stormbinder - Ice & Lightning Shaman
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(-20, -28, 40, 56);
  // Elemental Mantle
  ctx.fillStyle = '#0369a1';
  ctx.fillRect(-16, -24, 32, 14);
  // Shamanic Headdress
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.arc(0, -38, 13, 0, Math.PI * 2);
  ctx.fill();
  // Lightning eyes
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(-6, -40, 3, 3);
  ctx.fillRect(3, -40, 3, 3);
  // Left Hand: Lightning Spark Orb
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(-28, -12, 7 + Math.sin(tickCount * 0.2) * 2, 0, Math.PI * 2);
  ctx.fill();
  // Right Hand: Glacial Ice Spear
  ctx.fillStyle = '#bae6fd';
  ctx.fillRect(24, -36, 4, 42);
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(26, -46);
  ctx.lineTo(21, -34);
  ctx.lineTo(31, -34);
  ctx.fill();
}

function drawUltraxion(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Ultraxion - Twilight Dragon
  const wingFlap = Math.sin(tickCount * 0.15) * 10;
  ctx.fillStyle = 'rgba(88, 28, 135, 0.9)';
  ctx.beginPath();
  ctx.moveTo(-15, -20);
  ctx.quadraticCurveTo(-65 + wingFlap, -65, -80 + wingFlap, -20);
  ctx.quadraticCurveTo(-55 + wingFlap, 15, -15, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(15, -20);
  ctx.quadraticCurveTo(65 - wingFlap, -65, 80 - wingFlap, -20);
  ctx.quadraticCurveTo(55 - wingFlap, 15, 15, 0);
  ctx.fill();
  // Dragon Scale Body
  ctx.fillStyle = '#2e1065';
  ctx.fillRect(-22, -28, 44, 58);
  ctx.fillStyle = '#4c1d95';
  ctx.fillRect(-16, -24, 32, 18);
  // Draconic Head with Horns
  ctx.fillStyle = '#1e1b4b';
  ctx.beginPath();
  ctx.arc(0, -42, 16, 0, Math.PI * 2);
  ctx.fill();
  // Swept Obsidian Horns
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(-8, -50);
  ctx.lineTo(-24, -68);
  ctx.lineTo(-14, -46);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -50);
  ctx.lineTo(24, -68);
  ctx.lineTo(14, -46);
  ctx.fill();
  // Glowing Twilight Eyes
  ctx.fillStyle = '#c084fc';
  ctx.fillRect(-8, -44, 4, 3);
  ctx.fillRect(4, -44, 4, 3);
  // Unstable Twilight Sparks
  ctx.fillStyle = '#f43f5e';
  const spark = (tickCount * 3) % 40;
  ctx.fillRect(-20 + spark, -20 + Math.sin(spark) * 8, 3, 3);
}

function drawWarmasterBlackhorn(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Warmaster Blackhorn - Armored Tauren Warlord
  ctx.fillStyle = '#3f3f46';
  ctx.fillRect(-26, -30, 52, 60);
  ctx.fillStyle = '#71717a';
  ctx.fillRect(-20, -26, 40, 16);
  // Massive Horned Tauren Head
  ctx.fillStyle = '#27272a';
  ctx.beginPath();
  ctx.arc(0, -42, 16, 0, Math.PI * 2);
  ctx.fill();
  // Great Horns
  ctx.fillStyle = '#d4d4d8';
  ctx.beginPath();
  ctx.moveTo(-10, -48);
  ctx.quadraticCurveTo(-36, -65, -34, -40);
  ctx.lineTo(-12, -42);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -48);
  ctx.quadraticCurveTo(36, -65, 34, -40);
  ctx.lineTo(12, -42);
  ctx.fill();
  // Red War Eyes
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(-7, -44, 4, 3);
  ctx.fillRect(3, -44, 4, 3);
  // Spiked Halberd
  ctx.fillStyle = '#a1a1aa';
  ctx.fillRect(26, -45, 4, 60);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(22, -48, 12, 10);
}

function drawSpineOfDeathwing(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Spine of Deathwing - Elementium Plate section with burning tendons
  ctx.fillStyle = '#1c1917';
  ctx.fillRect(-32, -32, 64, 64);
  // Armor Plate Rivets
  ctx.fillStyle = '#44403c';
  ctx.fillRect(-28, -28, 56, 12);
  ctx.fillRect(-28, 16, 56, 12);
  // Molten Lava Core Fissure
  ctx.fillStyle = '#ea580c';
  ctx.fillRect(-8, -26, 16, 52);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(-4, -20, 8, 40);
  // Burning Tendon Erupting
  const sway = Math.sin(tickCount * 0.18) * 6;
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(-6, -10);
  ctx.quadraticCurveTo(-20 + sway, -45, 0 + sway, -55);
  ctx.quadraticCurveTo(20 + sway, -45, 6, -10);
  ctx.fill();
  // Floating Cinders
  ctx.fillStyle = '#f97316';
  for (let i = 0; i < 4; i++) {
    const cy = -30 - ((tickCount * 2 + i * 12) % 35);
    ctx.fillRect(-15 + i * 10, cy, 3, 3);
  }
}

function drawMadnessOfDeathwing(ctx: CanvasRenderingContext2D, tickCount: number) {
  // Madness of Deathwing - Colossal Molten Corrupted Dragon Head & Elementium Jaw
  const jawDrop = Math.sin(tickCount * 0.1) * 4;
  // Molten Wings in background
  ctx.fillStyle = 'rgba(185, 28, 28, 0.85)';
  ctx.beginPath();
  ctx.moveTo(-20, -25);
  ctx.quadraticCurveTo(-75, -65, -85, -15);
  ctx.quadraticCurveTo(-60, 20, -15, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(20, -25);
  ctx.quadraticCurveTo(75, -65, 85, -15);
  ctx.quadraticCurveTo(60, 20, 15, 0);
  ctx.fill();
  // Elementium Plated Neck & Body
  ctx.fillStyle = '#1c1917';
  ctx.fillRect(-28, -25, 56, 58);
  // Molten Lava Fissures
  ctx.fillStyle = '#ea580c';
  ctx.fillRect(-6, -20, 12, 45);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(-3, -15, 6, 35);
  // Great Dragon Head
  ctx.fillStyle = '#292524';
  ctx.beginPath();
  ctx.arc(0, -45, 20, 0, Math.PI * 2);
  ctx.fill();
  // Great Horns of the Destroyer
  ctx.fillStyle = '#0c0a09';
  ctx.beginPath();
  ctx.moveTo(-10, -55);
  ctx.lineTo(-30, -78);
  ctx.lineTo(-16, -48);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -55);
  ctx.lineTo(30, -78);
  ctx.lineTo(16, -48);
  ctx.fill();
  // Elementium Bolted Lower Jaw
  ctx.fillStyle = '#57534e';
  ctx.fillRect(-16, -34 + jawDrop, 32, 14);
  ctx.fillStyle = '#ea580c';
  ctx.fillRect(-12, -30 + jawDrop, 24, 6); // Fire breathing maw
  // Blazing Golden Lava Eyes
  ctx.fillStyle = '#fde047';
  ctx.fillRect(-11, -48, 5, 4);
  ctx.fillRect(6, -48, 5, 4);
}

function drawBossModel(
  ctx: CanvasRenderingContext2D,
  bossUnit: Unit,
  pos: { x: number; y: number },
  isSelected: boolean,
  tickCount: number,
  isMoving = false
) {
  ctx.save();
  // Running footstep bob animation when pursuing target
  const runBob = isMoving ? Math.abs(Math.sin(tickCount * 0.35)) * 4 : 0;
  ctx.translate(pos.x, pos.y - runBob);

  if (isSelected) {
    ctx.strokeStyle = '#FF4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  const shadowScale = isMoving ? 1 - runBob * 0.05 : 1;
  ctx.ellipse(0, 36, 48 * shadowScale, 18 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Subtle dust puffs when boss is running
  if (isMoving && tickCount % 8 < 4) {
    ctx.fillStyle = 'rgba(180, 160, 140, 0.3)';
    ctx.beginPath();
    ctx.arc(-18, 34, 5, 0, Math.PI * 2);
    ctx.arc(18, 35, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const bId = (bossUnit.id || '').toLowerCase();

  if (bId === 'ashbury') {
    drawBaronAshbury(ctx, bossUnit, tickCount);
  } else if (bId === 'silverlaine') {
    drawBaronSilverlaine(ctx, bossUnit, tickCount);
  } else if (bId === 'springvale') {
    drawCommanderSpringvale(ctx, bossUnit, tickCount);
  } else if (bId === 'walden') {
    drawLordWalden(ctx, bossUnit, tickCount);
  } else if (bId === 'godfrey') {
    drawLordGodfrey(ctx, bossUnit, tickCount);
  } else if (bId === 'morchok') {
    drawMorchok(ctx, tickCount);
  } else if (bId === 'zonozz') {
    drawZonozz(ctx, tickCount);
  } else if (bId === 'yorsahj') {
    drawYorsahj(ctx, tickCount);
  } else if (bId === 'hagara') {
    drawHagara(ctx, tickCount);
  } else if (bId === 'ultraxion') {
    drawUltraxion(ctx, tickCount);
  } else if (bId === 'blackhorn') {
    drawWarmasterBlackhorn(ctx, tickCount);
  } else if (bId === 'spine') {
    drawSpineOfDeathwing(ctx, tickCount);
  } else if (bId === 'madness') {
    drawMadnessOfDeathwing(ctx, tickCount);
  } else {
    // Default Dragon Soul dragon silhouette
    drawMadnessOfDeathwing(ctx, tickCount);
  }

  // Boss Overhead Name & Skull
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`💀 ${bossUnit.name}`, 0, -68);

  // Overhead Status: Cast bar when stationary-casting, or Running indicator when pursuing target
  const isCasting = Boolean((bossUnit as any)?.isCasting);
  const castingSpellName = (bossUnit as any)?.castingSpellName;
  const castProgress = (bossUnit as any)?.castProgress || 0;

  if (isCasting && castingSpellName) {
    const barW = 74;
    const barH = 7;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(-barW / 2 - 1, -85 - 1, barW + 2, barH + 2);
    ctx.fillStyle = '#EAB308';
    ctx.fillRect(-barW / 2, -85, barW * Math.min(1, Math.max(0, castProgress)), barH);
    ctx.strokeStyle = '#713F12';
    ctx.lineWidth = 1;
    ctx.strokeRect(-barW / 2, -85, barW, barH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(castingSpellName, 0, -88);
  } else if (isMoving) {
    ctx.fillStyle = '#F87171';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('🏃 追击目标中...', 0, -84);
  }

  ctx.restore();
}

// ── Class Character Drawing (Enhanced Authentic Models) ─────────────────────

function drawClassCharacter(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  pos: { x: number; y: number },
  isPlayer: boolean,
  isSelected: boolean,
  tickCount: number,
  idx: number
) {
  const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
  ctx.save();
  ctx.translate(pos.x, pos.y);

  if (!isAlive) {
    ctx.fillStyle = '#888';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🪦', 0, 0);
    ctx.font = '10px sans-serif';
    ctx.fillText(u.name, 0, 16);
    ctx.restore();
    return;
  }

  // Selected Golden Halo
  if (isSelected) {
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.stroke();
  }

  const isMelee =
    u.role === 'TANK' ||
    u.classId === 'ROGUE' ||
    u.classId === 'WARRIOR' ||
    u.classId === 'DK' ||
    (u.classId === 'PALADIN' && u.role !== 'HEALER');
  const sway = isMelee ? Math.sin(tickCount * 0.12 + idx) * 2.2 : Math.sin(tickCount * 0.06 + idx) * 1.0;
  const classColor = CLASS_COLORS[u.classId as any] || '#888';

  // 1. Shadow underneath
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (u.isPet) {
    const isWater = u.name.includes('水') || u.name.includes('Water');
    if (isWater) {
      // Swirling Cyan Water Elemental
      ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.beginPath();
      ctx.arc(0 + sway, -6, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#E0F2FE';
      ctx.fillRect(-3 + sway, -9, 2, 2);
      ctx.fillRect(2 + sway, -9, 2, 2);
    } else {
      // Unholy Ghoul
      ctx.fillStyle = '#3f6212';
      ctx.fillRect(-7 + sway, -8, 14, 14);
      ctx.fillStyle = '#84cc16';
      ctx.fillRect(-4 + sway, -14, 8, 7);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-2 + sway, -12, 1.5, 1.5);
      ctx.fillRect(1 + sway, -12, 1.5, 1.5);
    }
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#bae6fd';
    ctx.textAlign = 'center';
    ctx.fillText(u.name, 0, 14);
    ctx.restore();
    return;
  }

  // 2. Class-specific Body & Armor Silhouettes
  switch (u.classId) {
    case 'DK': {
      // Dark Runed Plate Armor
      ctx.fillStyle = '#1e1b2e';
      ctx.fillRect(-10 + sway, -14, 20, 24);
      ctx.fillStyle = '#C41F3B'; // Blood red trim
      ctx.fillRect(-8 + sway, -12, 16, 8);
      // Spiked Horned Helm
      ctx.fillStyle = '#2d2845';
      ctx.beginPath();
      ctx.arc(0 + sway, -18, 8, 0, Math.PI * 2);
      ctx.fill();
      // Glowing Cyan Runic Eyes
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(-4 + sway, -20, 2.5, 2.5);
      ctx.fillRect(2 + sway, -20, 2.5, 2.5);
      // Spikes
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(-10 + sway, -24, 3, 7);
      ctx.fillRect(7 + sway, -24, 3, 7);
      // Weapon: Tower Shield + Runeblade
      ctx.fillStyle = '#475569';
      ctx.fillRect(10 + sway, -8, 6, 20); // Shield
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(12 + sway, -4, 2, 12); // Frost rune line
      break;
    }
    case 'DRUID': {
      // Leather tunic with nature leafy mantle
      ctx.fillStyle = '#272018';
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.fillStyle = '#15803D'; // Green foliage cape
      ctx.fillRect(-9 + sway, -10, 18, 6);
      // Head
      ctx.fillStyle = '#FF7D0A';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      // Wooden Antlers with emerald glow
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
      // Nature Staff with emerald crystal
      ctx.fillStyle = '#78350F';
      ctx.fillRect(9 + sway, -22, 3, 30);
      ctx.fillStyle = '#22C55E';
      ctx.beginPath();
      ctx.arc(10.5 + sway, -24, 4.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'SHAMAN': {
      // Mail Armor & Wolf Cowl
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9 + sway, -12, 18, 22);
      ctx.fillStyle = '#0070DE';
      ctx.fillRect(-7 + sway, -10, 14, 8);
      // Wolf Cowl
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 8, 0, Math.PI * 2);
      ctx.fill();
      // Pointed Wolf ears
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.moveTo(-7 + sway, -23);
      ctx.lineTo(-4 + sway, -29);
      ctx.lineTo(-1 + sway, -23);
      ctx.moveTo(1 + sway, -23);
      ctx.lineTo(4 + sway, -29);
      ctx.lineTo(7 + sway, -23);
      ctx.fill();
      // Lightning Mace + Shield
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(9 + sway, -16, 4, 22);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(7 + sway, -18, 8, 5); // Mace head
      break;
    }
    case 'MAGE': {
      // Kirin Tor Wizard Robe
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(-8 + sway, -12, 16, 24);
      ctx.fillStyle = '#40C7EB';
      ctx.fillRect(-6 + sway, -10, 12, 7);
      // Wizard Hood / Head
      ctx.fillStyle = '#312e81';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      // Arcane Wizard Wand with glowing fireball orb
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(9 + sway, -18, 2.5, 24);
      ctx.fillStyle = '#F97316';
      ctx.beginPath();
      ctx.arc(10.5 + sway, -20, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ROGUE': {
      // Stealth Leather Armor & Hood
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.fillStyle = '#27272a';
      ctx.fillRect(-7 + sway, -10, 14, 8);
      // Assassin Hood covering face
      ctx.fillStyle = '#3f3f46';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      // Yellow glowing assassin slits
      ctx.fillStyle = '#FFF569';
      ctx.fillRect(-4 + sway, -18, 2.5, 2);
      ctx.fillRect(2 + sway, -18, 2.5, 2);
      // Dual Poison Daggers
      ctx.fillStyle = '#71717a';
      ctx.fillRect(8 + sway, -14, 3, 18);
      ctx.fillRect(-11 + sway, -14, 3, 18);
      ctx.fillStyle = '#84CC16'; // Dripping venom
      ctx.fillRect(7 + sway, -16, 5, 3);
      ctx.fillRect(-12 + sway, -16, 5, 3);
      break;
    }
    case 'WARRIOR': {
      // Heavy Steel Plate Armor & Shoulder Pauldrons
      ctx.fillStyle = '#3f2e21';
      ctx.fillRect(-10 + sway, -13, 20, 23);
      ctx.fillStyle = '#C79C6E'; // Warrior bronze/steel trim
      ctx.fillRect(-11 + sway, -13, 22, 6);
      // Horned Gladiator Helm
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(0 + sway, -18, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444'; // Crimson visor plume
      ctx.fillRect(-2 + sway, -27, 4, 5);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-4 + sway, -19, 8, 2);
      // Greatsword / Tower Shield
      if (u.role === 'TANK') {
        ctx.fillStyle = '#78350f';
        ctx.fillRect(10 + sway, -9, 6, 20);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(12 + sway, -5, 2, 12);
      } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(10 + sway, -24, 3.5, 28);
        ctx.fillStyle = '#b45309';
        ctx.fillRect(8 + sway, -4, 7.5, 3);
      }
      break;
    }
    case 'PALADIN': {
      // Radiant Golden/Silver Plate Armor
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-10 + sway, -13, 20, 23);
      ctx.fillStyle = '#F58CBA'; // Paladin class trim
      ctx.fillRect(-8 + sway, -11, 16, 7);
      ctx.fillStyle = '#FACC15'; // Golden Holy Tabard Cross
      ctx.fillRect(-1.5 + sway, -10, 3, 14);
      ctx.fillRect(-5 + sway, -6, 10, 3);
      // Golden Crowned Helm
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(0 + sway, -18, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(-4 + sway, -20, 2.5, 2);
      ctx.fillRect(2 + sway, -20, 2.5, 2);
      // Radiant Hammer or Shield
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(10 + sway, -18, 3, 24);
      ctx.fillStyle = '#fde047';
      ctx.fillRect(7 + sway, -21, 9, 6);
      break;
    }
    case 'HUNTER': {
      // Emerald Mail & Ranger Cloak
      ctx.fillStyle = '#1a2e05';
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.fillStyle = '#ABD473';
      ctx.fillRect(-7 + sway, -10, 14, 7);
      // Ranger Hood
      ctx.fillStyle = '#365314';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#bef264';
      ctx.fillRect(-3.5 + sway, -18, 2, 2);
      ctx.fillRect(1.5 + sway, -18, 2, 2);
      // Longbow
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(9 + sway, -6, 12, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.stroke();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10 + sway, -17);
      ctx.lineTo(10 + sway, 5);
      ctx.stroke();
      break;
    }
    case 'PRIEST': {
      // White/Gold Vestments (or Shadowform Violet for Shadow DPS)
      const isShadow = u.role === 'DPS';
      ctx.fillStyle = isShadow ? '#2e1065' : '#e2e8f0';
      ctx.fillRect(-8 + sway, -12, 16, 24);
      ctx.fillStyle = isShadow ? '#9333ea' : '#facc15';
      ctx.fillRect(-6 + sway, -10, 12, 6);
      // Head + Halo
      ctx.fillStyle = isShadow ? '#4c1d95' : '#f8fafc';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isShadow ? '#c084fc' : '#fde047';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0 + sway, -26, 6, 2.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Benediction Staff
      ctx.fillStyle = isShadow ? '#7e22ce' : '#eab308';
      ctx.fillRect(9 + sway, -20, 2.5, 28);
      ctx.fillStyle = isShadow ? '#e879f9' : '#fef08a';
      ctx.beginPath();
      ctx.arc(10.2 + sway, -22, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'WARLOCK': {
      // Fel-trimmed Dark Demonologist Robes
      ctx.fillStyle = '#1e1033';
      ctx.fillRect(-8 + sway, -12, 16, 24);
      ctx.fillStyle = '#9482C9';
      ctx.fillRect(-6 + sway, -10, 12, 6);
      // Horned Fel Cowl
      ctx.fillStyle = '#3b0764';
      ctx.beginPath();
      ctx.arc(0 + sway, -17, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635'; // Fel green eyes
      ctx.fillRect(-3.5 + sway, -18, 2.2, 2);
      ctx.fillRect(1.5 + sway, -18, 2.2, 2);
      // Fel Staff & Soul Shard Orb
      ctx.fillStyle = '#581c87';
      ctx.fillRect(9 + sway, -19, 2.5, 26);
      ctx.fillStyle = '#84cc16';
      ctx.beginPath();
      ctx.arc(10.2 + sway, -21, 4.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = classColor;
      ctx.fillRect(-8 + sway, -12, 16, 22);
      ctx.beginPath();
      ctx.arc(0 + sway, -16, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Small Name Bar
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isPlayer ? `★ ${u.name} (我)` : u.name, 0, 24);

  // Small HP Bar
  const hpPct = Math.max(0, Math.min(1, u.hp / u.maxHp));
  ctx.fillStyle = '#222';
  ctx.fillRect(-16, 28, 32, 4);
  ctx.fillStyle = classColor;
  ctx.fillRect(-16, 28, 32 * hpPct, 4);

  ctx.restore();
}

// ── Procedural Dungeon Labyrinth Corridors ──────────────────────────────────
// 1. Shadowfang Keep (5-man Castle Corridors, 10 waypoints)
const SHADOWFANG_WAYPOINTS = [
  { x: 60, y: 80 },    // 1. Entrance top-left
  { x: 240, y: 80 },   // 2. Head east
  { x: 240, y: 220 },  // 3. Turn south
  { x: 120, y: 220 },  // 4. Loop west
  { x: 120, y: 310 },  // 5. Turn south to lower corridor
  { x: 430, y: 310 },  // 6. Long east corridor across bottom
  { x: 430, y: 95 },   // 7. Turn north into central corridor
  { x: 600, y: 95 },   // 8. Turn east
  { x: 600, y: 230 },  // 9. Turn south
  { x: 720, y: 230 },  // 10. Turn east to exit portal!
];

// 2. Dragon Soul (20-man Obsidian Platforms & Twilight Bridges, 10 waypoints)
const DRAGON_SOUL_WAYPOINTS = [
  { x: 60, y: 310 },   // 1. Entrance bottom-left (Wyrmrest base)
  { x: 220, y: 310 },  // 2. East obsidian causeway
  { x: 220, y: 160 },  // 3. North volcanic bridge
  { x: 350, y: 160 },  // 4. East along dragon ridge
  { x: 350, y: 290 },  // 5. South into twilight caldera
  { x: 500, y: 290 },  // 6. East across magma chasm
  { x: 500, y: 85 },   // 7. North up to Wyrmrest terrace
  { x: 620, y: 85 },   // 8. East along high dragon platform
  { x: 620, y: 200 },  // 9. South down to rift platform
  { x: 720, y: 200 },  // 10. Exit: Twilight Gateway
];

/** Melee DPS that stand on the boss flanks in combat formation. */
function isMeleeDpsUnit(u: Unit): boolean {
  return (
    u.classId === 'ROGUE' ||
    u.classId === 'WARRIOR' ||
    ((u.classId === 'DK' || u.classId === 'PALADIN') && u.role === 'DPS')
  );
}

/**
 * Predicted combat standing position — shared by PULL_APPROACH march and
 * BOSS_COMBAT AI so the tank (and party) never teleport on pull.
 * Boss is expected at ~ (500, 180); tank holds left so boss faces away from raid.
 */
function getCombatFormationPos(
  u: Unit,
  idx: number,
  bossPos: { x: number; y: number },
  hpPct = 1
): { x: number; y: number } {
  if (u.role === 'TANK') {
    const tankOffset = idx % 2 === 0 ? -12 : 16;
    return hpPct >= 0.6
      ? { x: 445, y: 180 + tankOffset }
      : { x: 400, y: 180 + tankOffset };
  }
  if (isMeleeDpsUnit(u)) {
    const meleeAngle = Math.PI - 0.45 + (idx % 4) * 0.32;
    const meleeDist = 48 + ((idx * 6) % 12);
    return {
      x: bossPos.x + Math.cos(meleeAngle) * meleeDist,
      y: bossPos.y + Math.sin(meleeAngle) * meleeDist,
    };
  }
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  const nameCode = u.name ? u.name.charCodeAt(0) : 65;
  const hashX = ((idx * 31 + nameCode) % 17) - 8;
  const hashY = ((idx * 43 + nameCode) % 21) - 10;
  return {
    x: 210 + col * 50 + hashX,
    y: 105 + (row % 5) * 36 + hashY,
  };
}

function computePathGeometry(waypoints: Array<{ x: number; y: number }>) {
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const seg = Math.hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].y - waypoints[i].y);
    segLens.push(seg);
    totalLen += seg;
  }
  const getPoint = (dist: number): { x: number; y: number } => {
    let remaining = Math.max(0, Math.min(totalLen, dist));
    for (let i = 0; i < segLens.length; i++) {
      if (remaining <= segLens[i]) {
        const ratio = segLens[i] > 0 ? remaining / segLens[i] : 0;
        return {
          x: waypoints[i].x + (waypoints[i + 1].x - waypoints[i].x) * ratio,
          y: waypoints[i].y + (waypoints[i + 1].y - waypoints[i].y) * ratio,
        };
      }
      remaining -= segLens[i];
    }
    return waypoints[waypoints.length - 1];
  };
  return { segLens, totalLen, getPoint };
}

function makeTrashMob(
  partial: Omit<TrashMob, 'baseX' | 'baseY' | 'visualHp' | 'isDead' | 'isTombstone' | 'dissipateAlpha' | 'hp'> & {
    maxHp: number;
  }
): TrashMob {
  return {
    ...partial,
    baseX: partial.x,
    baseY: partial.y,
    hp: partial.maxHp,
    visualHp: partial.maxHp,
    isDead: false,
    isTombstone: false,
    dissipateAlpha: 1.0,
  };
}

function createDungeonTrashMobs(
  tier: '5man' | '20man',
  getPoint: (dist: number) => { x: number; y: number },
  totalLen: number
): TrashMob[] {
  const p1Dist = totalLen * 0.32;
  const p2Dist = totalLen * 0.72;
  const pt1 = getPoint(p1Dist);
  const pt2 = getPoint(p2Dist);

  if (tier === '20man') {
    return [
      makeTrashMob({
        id: 'ds_mob_1',
        name: '暮光狂热龙人',
        mobModel: 'TWILIGHT_DRAKONID',
        packIndex: 1,
        distAlongMaze: p1Dist,
        x: pt1.x - 14,
        y: pt1.y - 16,
        maxHp: 52000,
      }),
      makeTrashMob({
        id: 'ds_mob_2',
        name: '炽热熔岩幼龙',
        mobModel: 'LAVA_DRAKE',
        packIndex: 1,
        distAlongMaze: p1Dist + 18,
        x: pt1.x + 18,
        y: pt1.y + 12,
        maxHp: 46000,
      }),
      makeTrashMob({
        id: 'ds_mob_3',
        name: '暮光腐化织法者',
        mobModel: 'TWILIGHT_VOIDWEAVER',
        packIndex: 2,
        distAlongMaze: p2Dist,
        x: pt2.x - 12,
        y: pt2.y - 14,
        maxHp: 54000,
      }),
      makeTrashMob({
        id: 'ds_mob_4',
        name: '巨龙之魂毁灭者',
        mobModel: 'DRAGON_ANNIHILATOR',
        packIndex: 2,
        distAlongMaze: p2Dist + 18,
        x: pt2.x + 20,
        y: pt2.y + 10,
        maxHp: 62000,
      }),
    ];
  }

  // 5-man: Shadowfang Keep — lighter pools so discrete hits chip them down visibly
  return [
    makeTrashMob({
      id: 'sfk_mob_1',
      name: '影牙巡逻狼人',
      mobModel: 'WORGEN_PATROL',
      packIndex: 1,
      distAlongMaze: p1Dist,
      x: pt1.x - 12,
      y: pt1.y - 12,
      maxHp: 22000,
    }),
    makeTrashMob({
      id: 'sfk_mob_2',
      name: '狂暴黑狼守卫',
      mobModel: 'DARK_WOLF',
      packIndex: 1,
      distAlongMaze: p1Dist + 16,
      x: pt1.x + 18,
      y: pt1.y + 12,
      maxHp: 18000,
    }),
    makeTrashMob({
      id: 'sfk_mob_3',
      name: '影牙暗影导魔师',
      packIndex: 2,
      mobModel: 'SHADOW_CHANNELER',
      distAlongMaze: p2Dist,
      x: pt2.x - 12,
      y: pt2.y - 10,
      maxHp: 20000,
    }),
    makeTrashMob({
      id: 'sfk_mob_4',
      name: '影牙重装盾卫',
      mobModel: 'SHADOW_SHIELDGUARD',
      packIndex: 2,
      distAlongMaze: p2Dist + 16,
      x: pt2.x + 18,
      y: pt2.y + 12,
      maxHp: 26000,
    }),
  ];
}

function killTrashMobAsTombstone(mob: TrashMob) {
  mob.hp = 0;
  mob.isDead = true;
  mob.isTombstone = true;
  mob.dissipateAlpha = 1.0;
  mob.x = mob.baseX;
  mob.y = mob.baseY;
}

function drawTrashTombstone(ctx: CanvasRenderingContext2D, mob: TrashMob) {
  // Weathered grave marker left on the corridor after the fight
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4b5563';
  ctx.beginPath();
  ctx.moveTo(-10, 8);
  ctx.lineTo(-10, -10);
  ctx.quadraticCurveTo(-10, -22, 0, -22);
  ctx.quadraticCurveTo(10, -22, 10, -10);
  ctx.lineTo(10, 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#6b7280';
  ctx.fillRect(-7, -6, 14, 10);

  ctx.fillStyle = '#9ca3af';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✝', 0, 2);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 8px sans-serif';
  ctx.fillText(mob.name.length > 6 ? `${mob.name.slice(0, 5)}…` : mob.name, 0, 22);
}

function drawTrashMob(ctx: CanvasRenderingContext2D, mob: TrashMob, tickCount: number, is20Man: boolean) {
  if (mob.isDead && !mob.isTombstone && mob.dissipateAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, mob.isTombstone ? 1 : mob.dissipateAlpha));
  ctx.translate(mob.x, mob.y);

  if (mob.isTombstone || (mob.isDead && mob.hp <= 0)) {
    drawTrashTombstone(ctx, mob);
    ctx.restore();
    return;
  }

  // 1. Ground Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. Pixel Model by mobModel
  switch (mob.mobModel) {
    case 'WORGEN_PATROL': {
      ctx.fillStyle = '#261b1b';
      ctx.fillRect(-10, -14, 20, 24);
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(-8, -12, 16, 10);
      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.arc(0, -18, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#292524';
      ctx.fillRect(-5, -16, 10, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3, -10, 2, 3);
      ctx.fillRect(1, -10, 2, 3);
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.moveTo(-7, -24);
      ctx.lineTo(-4, -30);
      ctx.lineTo(-1, -24);
      ctx.moveTo(1, -24);
      ctx.lineTo(4, -30);
      ctx.lineTo(7, -24);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-4, -20, 2.5, 2);
      ctx.fillRect(2, -20, 2.5, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-12, -4, 4, 14);
      ctx.fillRect(8, -4, 4, 14);
      break;
    }
    case 'DARK_WOLF': {
      ctx.fillStyle = '#1e1e24';
      ctx.fillRect(-14, -8, 28, 16);
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.arc(-10, -12, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#27272a';
      ctx.fillRect(-18, -12, 8, 5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-16, -7, 2, 3);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-12, -14, 2.5, 2);
      ctx.fillStyle = '#3f3f46';
      ctx.beginPath();
      ctx.moveTo(-12, -18);
      ctx.lineTo(-9, -24);
      ctx.lineTo(-6, -18);
      ctx.fill();
      ctx.fillStyle = '#18181b';
      ctx.fillRect(12, -6, 8, 4);
      break;
    }
    case 'SHADOW_CHANNELER': {
      ctx.fillStyle = '#3b0764';
      ctx.fillRect(-9, -12, 18, 24);
      ctx.fillStyle = '#6b21a8';
      ctx.fillRect(-7, -10, 14, 20);
      ctx.fillStyle = '#1e1b4b';
      ctx.beginPath();
      ctx.arc(0, -16, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(-4, -17, 2.5, 2);
      ctx.fillRect(2, -17, 2.5, 2);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(8, -26, 3, 34);
      const orbPulse = Math.sin(tickCount * 0.2) * 2;
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.arc(9.5, -28, 5 + orbPulse, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'SHADOW_SHIELDGUARD': {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-11, -14, 22, 26);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9, -12, 18, 12);
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(0, -18, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-4, -18, 8, 2);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-16, -10, 8, 24);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-15, -4, 6, 12);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(9, -16, 3, 26);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(7, -20, 7, 7);
      break;
    }
    case 'TWILIGHT_DRAKONID': {
      ctx.fillStyle = '#4c0519';
      ctx.fillRect(-12, -16, 24, 28);
      ctx.fillStyle = '#881337';
      ctx.fillRect(-9, -13, 18, 14);
      ctx.fillStyle = '#1f1315';
      ctx.beginPath();
      ctx.arc(0, -20, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(-7, -26);
      ctx.lineTo(-12, -34);
      ctx.lineTo(-4, -26);
      ctx.moveTo(7, -26);
      ctx.lineTo(12, -34);
      ctx.lineTo(4, -26);
      ctx.fill();
      ctx.fillStyle = '#78350f';
      ctx.fillRect(10, -32, 3, 44);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(7, -35, 9, 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-5, -21, 3, 2.5);
      ctx.fillRect(2, -21, 3, 2.5);
      break;
    }
    case 'LAVA_DRAKE': {
      const wingFlap = Math.sin(tickCount * 0.2) * 5;
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.moveTo(-18 - wingFlap, -22);
      ctx.lineTo(-4, -10);
      ctx.lineTo(-14, 0);
      ctx.moveTo(18 + wingFlap, -22);
      ctx.lineTo(4, -10);
      ctx.lineTo(14, 0);
      ctx.fill();
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(-8, -12, 16, 20);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(-5, -10, 10, 12);
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.arc(0, -18, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-3, -12, 6, 3);
      break;
    }
    case 'TWILIGHT_VOIDWEAVER': {
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(-10, -14, 20, 26);
      ctx.fillStyle = '#311042';
      ctx.fillRect(-8, -11, 16, 16);
      ctx.fillStyle = '#701a75';
      for (let t = 0; t < 3; t++) {
        const sw = Math.sin(tickCount * 0.2 + t) * 3;
        ctx.fillRect(-8 + t * 6 + sw, 10, 3, 8);
      }
      const crystalY = -28 + Math.sin(tickCount * 0.15) * 3;
      ctx.fillStyle = '#c026d3';
      ctx.beginPath();
      ctx.moveTo(0, crystalY - 7);
      ctx.lineTo(6, crystalY);
      ctx.lineTo(0, crystalY + 7);
      ctx.lineTo(-6, crystalY);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'DRAGON_ANNIHILATOR': {
      ctx.fillStyle = '#262626';
      ctx.fillRect(-13, -16, 26, 28);
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-10, -13, 20, 14);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(-18, -16, 6, 12);
      ctx.fillRect(12, -16, 6, 12);
      ctx.fillStyle = '#171717';
      ctx.beginPath();
      ctx.arc(0, -20, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-5, -20, 10, 2.5);
      ctx.fillStyle = '#404040';
      ctx.fillRect(11, -30, 4, 42);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(8, -34, 12, 10);
      break;
    }
  }

  // 3. Overhead Health Bar with Smooth Visual Chipping
  mob.visualHp += (mob.hp - mob.visualHp) * 0.18;
  const hpPct = Math.max(0, mob.hp / mob.maxHp);
  const visualPct = Math.max(0, mob.visualHp / mob.maxHp);
  const barWidth = 46;

  // Background Bar
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(-barWidth / 2, -36, barWidth, 5);

  // Yellow Damage Lag Chip
  if (visualPct > hpPct) {
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-barWidth / 2, -36, barWidth * visualPct, 5);
  }

  // Red Active HP
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-barWidth / 2, -36, barWidth * hpPct, 5);

  // Border
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(-barWidth / 2, -36, barWidth, 5);

  // Overhead Name & Level
  ctx.fillStyle = is20Man ? '#e879f9' : '#f87171';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(mob.name, 0, -41);

  // Overhead HP Numbers
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px sans-serif';
  ctx.fillText(`${Math.ceil(mob.hp)}`, 0, -30);

  ctx.restore();
}

/**
 * 全屏石质大殿地面：战术网格铺满整张画布，无中间矩形框/区域约束。
 */
function drawArenaBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // 1. Full-screen stone floor with soft center highlight
  const floorGrad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    40,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72
  );
  floorGrad.addColorStop(0, '#15152a');
  floorGrad.addColorStop(0.55, '#111122');
  floorGrad.addColorStop(1, '#080812');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Fine tactical grid across the entire viewport (30px)
  ctx.strokeStyle = '#1c1c38';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 3. Subtle major tile seams every 90px
  ctx.strokeStyle = '#141428';
  ctx.lineWidth = 1.25;
  for (let x = 0; x <= width; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 4. Soft center rune rings (decorative only, no bounding box)
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 68, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 74, 0, Math.PI * 2);
  ctx.stroke();

  // 5. Corner pillars + torch glow
  const pillars = [
    { x: 50, y: 38 },
    { x: width - 50, y: 38 },
    { x: 50, y: height - 38 },
    { x: width - 50, y: height - 38 },
  ];
  for (const p of pillars) {
    const torchGrad = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 45);
    torchGrad.addColorStop(0, 'rgba(251, 146, 60, 0.18)');
    torchGrad.addColorStop(0.4, 'rgba(251, 146, 60, 0.05)');
    torchGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = torchGrad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#131322';
    ctx.strokeStyle = '#24243e';
    ctx.lineWidth = 1.5;
    ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
    ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
  }

  // 6. Soft edge vignette (no hard arena rectangle)
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.42,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.78
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(3, 3, 7, 0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

// ── Main CombatCanvas Component ───────────────────────────────────────────

export const CombatCanvas: React.FC<Props> = ({
  units,
  bossUnit,
  bossTargetId,
  groundEffects,
  floatingTexts,
  runPhase,
  screenShake,
  selectedUnitId,
  dungeonTier = '5man',
  targetBossName = '首领',
  currentBossIndex = 0,
  travelRemainingMs,
  totalTravelMs = 12000,
  isCorpseRunning = false,
  corpseRunRemainingMs = 0,
  onSelectUnit,
  onSetFocus,
  onPlayerMove,
  onCancelCast,
  onApproachComplete,
  onFastForwardTravel,
  revivingUnitId,
  reviveProgress = 0,
  autoApproachTarget = null,
  onApproachTargetReached,
  groundTargetState = null,
  onConfirmGroundTarget,
  onCancelGroundTarget,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Dynamic Positions (Centered in the 60% battle rectangle)
  const playerPosRef = useRef<{ x: number; y: number }>({ x: 230, y: 180 });
  const mouseCanvasPosRef = useRef<{ x: number; y: number } | null>(null);
  const bossPosRef = useRef<{ x: number; y: number }>({ x: 500, y: 180 });
  const lastBossIdRef = useRef<string | null>(null);
  const isBossMovingRef = useRef<boolean>(false);
  const companionPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  /** AI 多动症：站桩计时 + 单次小幅踱步偏移（不改动拉怪/治疗圈等意图站位） */
  const companionFidgetRef = useRef<Record<string, {
    idleMs: number;
    activeUntil: number;
    ox: number;
    oy: number;
    lastX: number;
    lastY: number;
  }>>({});
  const keysPressedRef = useRef<Set<string>>(new Set());

  // Mouse Click-to-Move & Auto-Pathfinding in Maze
  const clickTargetRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const autoNavActiveRef = useRef<boolean>(true);
  const mazeLeadDistRef = useRef<number>(0);

  // Approach pull animation timer — start poses captured so march ends on combat spots
  const approachElapsedRef = useRef<number>(0);
  const approachStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const approachPullFiredRef = useRef(false);
  const prevCanvasPhaseRef = useRef<string | null>(null);
  const pullShoutRef = useRef<string | null>(null);

  // FX references
  const projectilesRef = useRef<Projectile[]>([]);
  const slashesRef = useRef<MeleeSlash[]>([]);
  const beamsRef = useRef<HealingBeam[]>([]);

  // Diablo Dungeon Exploration: Corridor Trash Mobs State Machine
  const initTrashMobs = useCallback((): TrashMob[] => {
    const is20 = dungeonTier === '20man';
    const waypoints = is20 ? DRAGON_SOUL_WAYPOINTS : SHADOWFANG_WAYPOINTS;
    const { getPoint, totalLen } = computePathGeometry(waypoints);
    return createDungeonTrashMobs(dungeonTier, getPoint, totalLen);
  }, [dungeonTier]);

  const trashMobsRef = useRef<TrashMob[]>(initTrashMobs());
  const lastDungeonTierRef = useRef<string>(dungeonTier);
  const lastTargetBossRef = useRef<string>(targetBossName);
  /** Tracks phase for maze refresh — re-entering TRAVEL must revive trash (no leftover tombstones). */
  const lastPhaseForTrashResetRef = useRef<string | null>(null);
  const isEncounteringRef = useRef<boolean>(false);
  const currentEncounterPackRef = useRef<number>(0);
  const encounterTimerMsRef = useRef<number>(0);
  const encounterSCTRef = useRef<EncounterSCTItem[]>([]);
  /** Elapsed-ms when each pack was fully tombstoned — keeps early-clear march smooth. */
  const packClearedAtElapsedRef = useRef<{ 1: number | null; 2: number | null }>({ 1: null, 2: null });

  // Keyboard listeners for WASD & Arrow Keys & Alt+1~9 Target Switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Alt + 1 ~ 9 quick target switching matching RaidFrames order!
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const targetIdx = parseInt(e.key, 10) - 1;
        const rolePriority: Record<string, number> = { TANK: 0, HEALER: 1, DPS: 2 };
        const sorted = [...units].sort((a, b) => (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99));
        if (targetIdx >= 0 && targetIdx < sorted.length) {
          onSelectUnit(sorted[targetIdx].id);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (groundTargetState) {
          e.preventDefault();
          e.stopPropagation();
          if (onCancelGroundTarget) onCancelGroundTarget();
          return;
        }
        if (onCancelCast) {
          e.preventDefault();
          e.stopPropagation();
          onCancelCast();
          return;
        }
      }

      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        keysPressedRef.current.add(key);
        // Pressing WASD turns off auto-pathfinding and click-to-move
        autoNavActiveRef.current = false;
        clickTargetRef.current = null;
        if (onPlayerMove) onPlayerMove();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysPressedRef.current.delete(key);
    };

    const handleBlur = () => {
      keysPressedRef.current.clear();
    };

    const handleWindowMouseDown = (e: MouseEvent) => {
      if (e.button === 2 && groundTargetState) {
        if (onCancelGroundTarget) onCancelGroundTarget();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('mousedown', handleWindowMouseDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('mousedown', handleWindowMouseDown);
    };
  }, [units, onSelectUnit, groundTargetState, onCancelGroundTarget]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouseCanvasPosRef.current = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleCanvasMouseLeave = () => {
    mouseCanvasPosRef.current = null;
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (groundTargetState) {
      e.preventDefault();
      if (onCancelGroundTarget) onCancelGroundTarget();
      return;
    }
  };

  // Single-click on canvas (Map Interaction):
  // - Click on unit or boss: directly select/target that unit
  // - Click on empty ground: navigate/walk player to clicked position
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // 0. Ground Target Placement Confirmation
    if (groundTargetState) {
      const pPos = playerPosRef.current;
      const inCanvas = clickX >= 30 && clickX <= canvas.width - 30 && clickY >= 30 && clickY <= canvas.height - 30;
      const dist = Math.hypot(clickX - pPos.x, clickY - pPos.y);
      const isAllowed = inCanvas && dist <= groundTargetState.maxRange;
      if (isAllowed) {
        if (onConfirmGroundTarget) {
          onConfirmGroundTarget(groundTargetState.slotIdx, groundTargetState.spellId, clickX, clickY);
        }
      }
      return;
    }

    // Toggle Auto-Nav Button Click (in Maze phase, top-center banner)
    if (runPhase === 'TRAVEL_RECOVERY' && clickX >= 220 && clickX <= 560 && clickY >= 14 && clickY <= 50) {
      autoNavActiveRef.current = !autoNavActiveRef.current;
      clickTargetRef.current = null;
      return;
    }

    const handleSelectOrFocus = (id: string) => {
      if (e.shiftKey) {
        if (onSetFocus) onSetFocus(id);
      } else {
        onSelectUnit(id);
      }
    };

    // 1. Direct Target Selection: Click on Boss
    if (bossUnit && (bossUnit.alive ?? bossUnit.isAlive) && runPhase !== 'TRAVEL_RECOVERY') {
      const bp = bossPosRef.current;
      const dist = Math.hypot(clickX - bp.x, clickY - bp.y);
      if (dist <= 65) {
        handleSelectOrFocus(bossUnit.id);
        clickTargetRef.current = null;
        return;
      }
    }

    // 2. Direct Target Selection: Click on Player Character
    const pp = playerPosRef.current;
    const pUnit = units.find(u => u.isPlayer);
    if (Math.hypot(clickX - pp.x, clickY - pp.y) <= 32) {
      if (pUnit) {
        handleSelectOrFocus(pUnit.id);
        clickTargetRef.current = null;
        return;
      }
    }

    // 3. Direct Target Selection: Click on AI Companion
    for (const u of units) {
      if (u.isPlayer) continue;
      const pos = companionPositionsRef.current[u.id];
      if (pos && Math.hypot(clickX - pos.x, clickY - pos.y) <= 28) {
        handleSelectOrFocus(u.id);
        clickTargetRef.current = null;
        return;
      }
    }

    // 4. Click on empty ground: Navigate/walk player to clicked position (only if alive!)
    if (pUnit && (pUnit.isAlive ?? pUnit.alive) && pUnit.hp > 0) {
      clickTargetRef.current = { x: clickX, y: clickY, time: Date.now() };
      autoNavActiveRef.current = false;
    }
  };

  // Double-click on canvas: Select unit or Boss
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const handleSelectOrFocus = (id: string) => {
      if (e.shiftKey) {
        if (onSetFocus) onSetFocus(id);
      } else {
        onSelectUnit(id);
      }
    };

    // 1. Double click on Boss
    if (bossUnit && (bossUnit.alive ?? bossUnit.isAlive) && runPhase !== 'TRAVEL_RECOVERY') {
      const bp = bossPosRef.current;
      const dist = Math.hypot(clickX - bp.x, clickY - bp.y);
      if (dist <= 65) {
        handleSelectOrFocus(bossUnit.id);
        return;
      }
    }

    // 2. Double click on Player
    const pp = playerPosRef.current;
    if (Math.hypot(clickX - pp.x, clickY - pp.y) <= 35) {
      const pUnit = units.find(u => u.isPlayer);
      if (pUnit) {
        handleSelectOrFocus(pUnit.id);
        return;
      }
    }

    // 3. Double click on AI Companions
    for (const u of units) {
      if (u.isPlayer) continue;
      const pos = companionPositionsRef.current[u.id];
      if (pos && Math.hypot(clickX - pos.x, clickY - pos.y) <= 30) {
        handleSelectOrFocus(u.id);
        return;
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let tickCount = 0;

    // Reset maze trash when: lobby/summary, new travel segment (wipe retry / next boss / first enter), or tier/boss change
    const prevPhaseForTrash = lastPhaseForTrashResetRef.current;
    lastPhaseForTrashResetRef.current = runPhase;
    const enteringTravel =
      runPhase === 'TRAVEL_RECOVERY' && prevPhaseForTrash !== 'TRAVEL_RECOVERY';
    if (
      runPhase === 'LOBBY' ||
      runPhase === 'SUMMARY' ||
      enteringTravel ||
      dungeonTier !== lastDungeonTierRef.current ||
      targetBossName !== lastTargetBossRef.current
    ) {
      lastDungeonTierRef.current = dungeonTier;
      lastTargetBossRef.current = targetBossName;
      trashMobsRef.current = initTrashMobs();
      isEncounteringRef.current = false;
      currentEncounterPackRef.current = 0;
      encounterTimerMsRef.current = 0;
      packClearedAtElapsedRef.current = { 1: null, 2: null };
      mazeLeadDistRef.current = 0;
      const startWp = (dungeonTier === '20man' ? DRAGON_SOUL_WAYPOINTS : SHADOWFANG_WAYPOINTS)[0];
      playerPosRef.current = { x: startWp.x, y: startWp.y };
      companionPositionsRef.current = {};
      companionFidgetRef.current = {};
    }

    const render = () => {
      tickCount++;
      const width = canvas.width;
      const height = canvas.height;

      // Entering PULL_APPROACH: always reset march clock (skip-travel can bypass TRAVEL frames)
      if (runPhase === 'PULL_APPROACH' && prevCanvasPhaseRef.current !== 'PULL_APPROACH') {
        approachElapsedRef.current = 0;
        approachPullFiredRef.current = false;
        approachStartPositionsRef.current = {};
      }
      prevCanvasPhaseRef.current = runPhase;

      // Reset boss position if new boss spawned or during staging approach
      if (bossUnit?.id && bossUnit.id !== lastBossIdRef.current) {
        lastBossIdRef.current = bossUnit.id;
        bossPosRef.current = { x: 500, y: 180 };
        if (bossUnit.position) {
          bossUnit.position.x = 500;
          bossUnit.position.y = 180;
        }
      }
      if (runPhase === 'PULL_APPROACH') {
        // Keep boss planted on the right of the room during entry (visible, not missing)
        bossPosRef.current = { x: 500, y: 180 };
        if (bossUnit?.position) {
          bossUnit.position.x = 500;
          bossUnit.position.y = 180;
        }
      }

      ctx.save();

      // Screen Shake on crit
      if (screenShake) {
        const shakeX = (Math.random() - 0.5) * 6;
        const shakeY = (Math.random() - 0.5) * 6;
        ctx.translate(shakeX, shakeY);
      }

      // Check dead members in party
      const deadMembers = units.filter(u => (!u.alive && !u.isAlive) || u.hp <= 0);
      const hasDeadMembers = deadMembers.length > 0;

      // ── Process Player Movement: WASD Hold / Click-to-Move / Maze Auto-Pathfinding ──
      const keys = keysPressedRef.current;
      let moveX = 0;
      let moveY = 0;
      if (keys.has('w') || keys.has('arrowup')) moveY -= 1;
      if (keys.has('s') || keys.has('arrowdown')) moveY += 1;
      if (keys.has('a') || keys.has('arrowleft')) moveX -= 1;
      if (keys.has('d') || keys.has('arrowright')) moveX += 1;

      // Lock movement if dead or if in travel phase with dead members waiting for resurrection
      const pUnit = units.find(u => u.isPlayer);
      const isPlayerAlive = !!(pUnit && (pUnit.isAlive ?? pUnit.alive) && pUnit.hp > 0);
      const canMove = !(runPhase === 'TRAVEL_RECOVERY' && hasDeadMembers) && isPlayerAlive;

      // ── Dungeon Labyrinth Corridors (Different Mazes per Dungeon Tier) ──
      const is20Man = dungeonTier === '20man';
      const mazeWaypoints = is20Man ? DRAGON_SOUL_WAYPOINTS : SHADOWFANG_WAYPOINTS;
      const { segLens, totalLen: totalMazeLen, getPoint: getPointAlongMaze } = computePathGeometry(mazeWaypoints);

      // ── Synchronized Timeline Calculation ──
      const totalT = totalTravelMs && totalTravelMs > 0 ? totalTravelMs : 12000;
      const rem = travelRemainingMs !== undefined ? travelRemainingMs : 12000;
      const elapsed = Math.max(0, Math.min(totalT, totalT - rem));

      // Synchronized Milestones along totalT:
      // Pack 1 at 32% distance:
      //   0 ~ 18% totalT: Marching from entrance to Pack 1
      //   18% ~ 38% totalT: Combat with Pack 1 (HP decreases smoothly to 0)
      //   38% ~ 44% totalT: Pack 1 soul dissipation & death fade out
      // Pack 2 at 72% distance:
      //   44% ~ 64% totalT: Marching from Pack 1 to Pack 2
      //   64% ~ 84% totalT: Combat with Pack 2 (HP decreases smoothly to 0)
      //   84% ~ 90% totalT: Pack 2 soul dissipation & death fade out
      // Exit Portal:
      //   90% ~ 100% totalT: Sprinting to Exit Portal!
      // Exactly at 100% (elapsed == totalT), party arrives at the exit portal door!
      const tP1Start = 0.18 * totalT;
      const tP1HpZero = 0.38 * totalT;
      const tP1Clear = 0.44 * totalT;
      const tP2Start = 0.64 * totalT;
      const tP2HpZero = 0.84 * totalT;
      const tP2Clear = 0.90 * totalT;

      const stopDist1 = totalMazeLen * 0.32 - 48;
      const stopDist2 = totalMazeLen * 0.72 - 48;

      const packStillAlive = (packIndex: 1 | 2) =>
        trashMobsRef.current.some(m => m.packIndex === packIndex && !m.isDead && !m.isTombstone);

      // Latch the moment each pack falls so early clears don't snap the lead forward
      if (elapsed < tP1Start) {
        packClearedAtElapsedRef.current[1] = null;
        packClearedAtElapsedRef.current[2] = null;
      } else {
        if (!packStillAlive(1) && packClearedAtElapsedRef.current[1] === null) {
          packClearedAtElapsedRef.current[1] = elapsed;
        }
        if (elapsed >= tP2Start && !packStillAlive(2) && packClearedAtElapsedRef.current[2] === null) {
          packClearedAtElapsedRef.current[2] = elapsed;
        }
      }

      let targetLeadDist = 0;
      let currentEncounterPack = 0;

      if (elapsed < tP1Start) {
        targetLeadDist = (elapsed / tP1Start) * stopDist1;
      } else if (elapsed < tP2Start) {
        if (packStillAlive(1)) {
          targetLeadDist = stopDist1;
          currentEncounterPack = 1;
        } else {
          const marchT0 = packClearedAtElapsedRef.current[1] ?? tP1Clear;
          const denom = Math.max(1, tP2Start - marchT0);
          const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
          targetLeadDist = stopDist1 + ratio * (stopDist2 - stopDist1);
        }
      } else if (elapsed < totalT) {
        if (packStillAlive(2)) {
          targetLeadDist = stopDist2;
          currentEncounterPack = 2;
        } else {
          const marchT0 = packClearedAtElapsedRef.current[2] ?? tP2Clear;
          const denom = Math.max(1, totalT - marchT0);
          const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
          targetLeadDist = stopDist2 + ratio * (totalMazeLen - stopDist2);
        }
      } else {
        targetLeadDist = totalMazeLen;
      }

      isEncounteringRef.current = currentEncounterPack > 0;
      currentEncounterPackRef.current = currentEncounterPack;

      // Reset living packs before their fight window; never erase tombstones after clear
      trashMobsRef.current.forEach(mob => {
        const fightStart = mob.packIndex === 1 ? tP1Start : tP2Start;
        const forceKillAt = mob.packIndex === 1 ? tP1HpZero : tP2HpZero;
        if (elapsed < fightStart && !mob.isTombstone) {
          mob.hp = mob.maxHp;
          mob.visualHp = mob.maxHp;
          mob.isDead = false;
          mob.isTombstone = false;
          mob.dissipateAlpha = 1.0;
          mob.x = mob.baseX;
          mob.y = mob.baseY;
        } else if (!mob.isDead && !mob.isTombstone && elapsed >= forceKillAt) {
          // Soft deadline so the march can resume even if DPS RNG was unlucky
          killTrashMobAsTombstone(mob);
        } else if (!mob.isDead && currentEncounterPack === mob.packIndex) {
          // Mild combat bob so the pack doesn't look frozen
          const bob = Math.sin(tickCount * 0.12 + mob.baseX * 0.05) * 2.2;
          const sway = Math.cos(tickCount * 0.09 + mob.baseY * 0.04) * 1.6;
          mob.x = mob.baseX + sway;
          mob.y = mob.baseY + bob;
        }
      });

      // Discrete party ↔ trash combat (chip HP + light return damage). No auto-fade corpses.
      if (currentEncounterPack > 0) {
        const activePackMobs = trashMobsRef.current.filter(
          m => m.packIndex === currentEncounterPack && !m.isDead && !m.isTombstone
        );
        const livingAllies = units.filter(u => (u.isAlive ?? u.alive) && u.hp > 0);

        // Party hits trash — staggered so each mob dies on its own rhythm
        if (activePackMobs.length > 0 && tickCount % 8 === 0) {
          const targetMob = activePackMobs[Math.floor(Math.random() * activePackMobs.length)];
          const isCrit = Math.random() > 0.55;
          const baseHit = is20Man
            ? (isCrit ? 9000 + Math.random() * 5000 : 4800 + Math.random() * 2800)
            : (isCrit ? 5200 + Math.random() * 2800 : 2800 + Math.random() * 1600);
          const dmg = Math.round(baseHit);
          targetMob.hp = Math.max(0, targetMob.hp - dmg);

          slashesRef.current.push({
            id: `slash_${Date.now()}_${Math.random()}`,
            x: targetMob.x + (Math.random() - 0.5) * 20,
            y: targetMob.y + (Math.random() - 0.5) * 16,
            angle: (Math.random() - 0.5) * Math.PI,
            color: isCrit ? '#FACC15' : '#EF4444',
            elapsedMs: 0,
            totalMs: 180,
          });

          const caster = units.find(
            u =>
              (u.isAlive ?? u.alive) &&
              (u.classId === 'MAGE' ||
                u.classId === 'SHAMAN' ||
                u.classId === 'DRUID' ||
                u.classId === 'HUNTER' ||
                u.classId === 'WARLOCK' ||
                u.classId === 'PRIEST')
          );
          if (caster && Math.random() > 0.35) {
            const cPos = caster.isPlayer
              ? playerPosRef.current
              : companionPositionsRef.current[caster.id] || playerPosRef.current;
            const projColor =
              caster.classId === 'MAGE' ? '#F97316' :
              caster.classId === 'SHAMAN' ? '#38BDF8' :
              caster.classId === 'HUNTER' ? '#ABD473' :
              caster.classId === 'WARLOCK' ? '#A855F7' :
              caster.classId === 'PRIEST' ? '#C084FC' : '#FBBF24';
            projectilesRef.current.push({
              id: `proj_${Date.now()}_${Math.random()}`,
              fromX: cPos.x,
              fromY: cPos.y,
              toX: targetMob.x,
              toY: targetMob.y,
              color: projColor,
              kind: 'FIRE',
              progress: 0,
            });
          }

          encounterSCTRef.current.push({
            id: `sct_${Date.now()}_${Math.random()}`,
            text: isCrit ? `💥 ${dmg}!` : `${dmg}`,
            x: targetMob.x + (Math.random() - 0.5) * 24,
            y: targetMob.y - 18,
            color: isCrit ? '#FFD700' : '#FFFFFF',
            createdAt: Date.now(),
            isCrit,
          });

          if (targetMob.hp <= 0) {
            killTrashMobAsTombstone(targetMob);
            encounterSCTRef.current.push({
              id: `tomb_${Date.now()}_${Math.random()}`,
              text: '💀 击杀',
              x: targetMob.x,
              y: targetMob.y - 28,
              color: '#FCA5A5',
              createdAt: Date.now(),
              isCrit: true,
            });
          }
        }

        // Trash returns light damage onto the party (prefer tank, never lethal wipe)
        if (activePackMobs.length > 0 && livingAllies.length > 0 && tickCount % 14 === 0) {
          const attacker = activePackMobs[Math.floor(Math.random() * activePackMobs.length)];
          const tank = livingAllies.find(u => u.role === 'TANK');
          const victim =
            tank && Math.random() < 0.62
              ? tank
              : livingAllies[Math.floor(Math.random() * livingAllies.length)];
          const hit = Math.round(
            is20Man
              ? 900 + Math.random() * 1400
              : 550 + Math.random() * 900
          );
          const floorHp = Math.max(1, Math.round(victim.maxHp * 0.28));
          const applied = Math.min(hit, Math.max(0, victim.hp - floorHp));
          if (applied > 0) {
            victim.hp = Math.max(floorHp, victim.hp - applied);
            const vPos = victim.isPlayer
              ? playerPosRef.current
              : companionPositionsRef.current[victim.id] || {
                  x: victim.position?.x ?? attacker.x - 40,
                  y: victim.position?.y ?? attacker.y,
                };

            // Mob swipe / bolt toward victim
            if (attacker.mobModel === 'SHADOW_CHANNELER' || attacker.mobModel === 'TWILIGHT_VOIDWEAVER') {
              projectilesRef.current.push({
                id: `mob_bolt_${Date.now()}_${Math.random()}`,
                fromX: attacker.x,
                fromY: attacker.y,
                toX: vPos.x,
                toY: vPos.y,
                color: '#A855F7',
                kind: 'FROST',
                progress: 0,
              });
            } else {
              slashesRef.current.push({
                id: `mob_slash_${Date.now()}_${Math.random()}`,
                x: vPos.x + (Math.random() - 0.5) * 12,
                y: vPos.y + (Math.random() - 0.5) * 10,
                angle: Math.atan2(vPos.y - attacker.y, vPos.x - attacker.x),
                color: '#F87171',
                elapsedMs: 0,
                totalMs: 200,
              });
            }

            encounterSCTRef.current.push({
              id: `pdmg_${Date.now()}_${Math.random()}`,
              text: `-${applied}`,
              x: vPos.x + (Math.random() - 0.5) * 16,
              y: vPos.y - 14,
              color: '#FCA5A5',
              createdAt: Date.now(),
              isCrit: false,
            });
          }
        }

        // Light healer top-ups so the skirmish breathes (damage in, heal out)
        if (livingAllies.length > 0 && tickCount % 18 === 0) {
          const healer = livingAllies.find(u => u.role === 'HEALER');
          const hurt = [...livingAllies]
            .filter(u => u.hp < u.maxHp * 0.96)
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (healer && hurt) {
            const healAmt = Math.round(
              is20Man ? 1200 + Math.random() * 1600 : 700 + Math.random() * 1000
            );
            const before = hurt.hp;
            hurt.hp = Math.min(hurt.maxHp, hurt.hp + healAmt);
            const gained = hurt.hp - before;
            if (gained > 0) {
              const hPos = healer.isPlayer
                ? playerPosRef.current
                : companionPositionsRef.current[healer.id] || healer.position || { x: 100, y: 100 };
              const tPos = hurt.isPlayer
                ? playerPosRef.current
                : companionPositionsRef.current[hurt.id] || hurt.position || hPos;
              beamsRef.current.push({
                id: `maze_heal_${Date.now()}_${Math.random()}`,
                fromX: hPos.x,
                fromY: hPos.y,
                toX: tPos.x,
                toY: tPos.y,
                color: '#34D399',
                elapsedMs: 0,
                totalMs: 280,
              });
              encounterSCTRef.current.push({
                id: `pheal_${Date.now()}_${Math.random()}`,
                text: `+${gained}`,
                x: tPos.x + (Math.random() - 0.5) * 12,
                y: tPos.y - 18,
                color: '#6EE7B7',
                createdAt: Date.now(),
                isCrit: false,
              });
            }
          }
        }
      }

      if ((moveX !== 0 || moveY !== 0) && canMove) {
        // Continuous smooth WASD movement (Speed: 5.2 px/frame)
        clickTargetRef.current = null;
        autoNavActiveRef.current = false;
        const len = Math.hypot(moveX, moveY);
        const speed = 5.2;
        playerPosRef.current.x += (moveX / len) * speed;
        playerPosRef.current.y += (moveY / len) * speed;
        playerPosRef.current.x = Math.max(30, Math.min(width - 30, playerPosRef.current.x));
        playerPosRef.current.y = Math.max(30, Math.min(height - 30, playerPosRef.current.y));

        const playerUnit = units.find(u => u.isPlayer);
        if (playerUnit) {
          playerUnit.position.x = playerPosRef.current.x;
          playerUnit.position.y = playerPosRef.current.y;
        }
        if (onPlayerMove) onPlayerMove();
      } else if (autoApproachTarget && canMove) {
        // Auto-approach target when spell distance was insufficient
        const dx = autoApproachTarget.targetX - playerPosRef.current.x;
        const dy = autoApproachTarget.targetY - playerPosRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist > autoApproachTarget.desiredDist) {
          const speed = 4.8;
          playerPosRef.current.x += (dx / dist) * Math.min(speed, dist);
          playerPosRef.current.y += (dy / dist) * Math.min(speed, dist);
          playerPosRef.current.x = Math.max(30, Math.min(width - 30, playerPosRef.current.x));
          playerPosRef.current.y = Math.max(30, Math.min(height - 30, playerPosRef.current.y));

          const playerUnit = units.find(u => u.isPlayer);
          if (playerUnit) {
            playerUnit.position.x = playerPosRef.current.x;
            playerUnit.position.y = playerPosRef.current.y;
          }
          if (onPlayerMove) onPlayerMove();
        } else {
          if (onApproachTargetReached) onApproachTargetReached();
        }
      } else if (clickTargetRef.current && canMove) {
        // Mouse Click-to-Move (Speed: 5.2 px/frame)
        const dest = clickTargetRef.current;
        const dx = dest.x - playerPosRef.current.x;
        const dy = dest.y - playerPosRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 4) {
          const speed = 5.2;
          playerPosRef.current.x += (dx / dist) * Math.min(speed, dist);
          playerPosRef.current.y += (dy / dist) * Math.min(speed, dist);
          playerPosRef.current.x = Math.max(30, Math.min(width - 30, playerPosRef.current.x));
          playerPosRef.current.y = Math.max(30, Math.min(height - 30, playerPosRef.current.y));

          const playerUnit = units.find(u => u.isPlayer);
          if (playerUnit) {
            playerUnit.position.x = playerPosRef.current.x;
            playerUnit.position.y = playerPosRef.current.y;
          }
          if (onPlayerMove) onPlayerMove();
        } else {
          clickTargetRef.current = null;
        }
      } else if (runPhase === 'TRAVEL_RECOVERY' && autoNavActiveRef.current && canMove) {
        // High-precision timeline synchronized lead distance
        mazeLeadDistRef.current = targetLeadDist;
      }

      // If in TRAVEL_RECOVERY and lead reaches Exit Portal:
      const exitPoint = mazeWaypoints[mazeWaypoints.length - 1];
      if (
        runPhase === 'TRAVEL_RECOVERY' &&
        Math.hypot(playerPosRef.current.x - exitPoint.x, playerPosRef.current.y - exitPoint.y) <= 30
      ) {
        if (onFastForwardTravel) onFastForwardTravel();
      }

      // Proximity pull is handled inside STAGE B after entry snap + boss draw (avoid pre-snap false pulls)

      // ── STAGE A: TRAVEL_RECOVERY (Random Procedural Guaranteed-Passable Maze) ──
      if (runPhase === 'TRAVEL_RECOVERY') {
        approachElapsedRef.current = 0;

        if (is20Man) {
          // ── Dragon Soul (20-man Obsidian & Molten Magma) ──
          ctx.fillStyle = '#110508';
          ctx.fillRect(0, 0, width, height);

          // Glowing lava fissure grid
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.22)';
          ctx.lineWidth = 1;
          for (let x = 0; x < width; x += 35) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
          }
          for (let y = 0; y < height; y += 35) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }

          // Molten Magma Fissures
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.35)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(50, 220);
          ctx.quadraticCurveTo(280, 260, 420, 210);
          ctx.quadraticCurveTo(550, 160, 750, 280);
          ctx.stroke();

          // Obsidian Corridor Path (Width: 64px)
          ctx.strokeStyle = '#220910';
          ctx.lineWidth = 62;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(mazeWaypoints[0].x, mazeWaypoints[0].y);
          for (let i = 1; i < mazeWaypoints.length; i++) {
            ctx.lineTo(mazeWaypoints[i].x, mazeWaypoints[i].y);
          }
          ctx.stroke();

          // Molten Basalt Border Trim
          ctx.strokeStyle = '#7f1d1d';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Fiery Orange Luminous Guide Path Dots
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Twilight Dragonfire Braziers
          const dsBraziers = [
            { x: 220, y: 300 },
            { x: 220, y: 170 },
            { x: 350, y: 170 },
            { x: 350, y: 280 },
            { x: 500, y: 280 },
            { x: 500, y: 95 },
            { x: 620, y: 95 },
            { x: 620, y: 190 },
          ];
          for (const b of dsBraziers) {
            ctx.fillStyle = '#1e1b2e';
            ctx.fillRect(b.x - 3, b.y - 8, 6, 14);
            const flicker = Math.sin(tickCount * 0.25 + b.x) * 3;
            ctx.fillStyle = 'rgba(192, 38, 211, 0.28)';
            ctx.beginPath();
            ctx.arc(b.x, b.y, 16 + flicker, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#c026d3';
            ctx.beginPath();
            ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f43f5e';
            ctx.beginPath();
            ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
            ctx.fill();
          }

          // Entrance: Wyrmrest Base
          ctx.fillStyle = '#f97316';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('🚩 龙眠神殿底层集结点', 60, 275);
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(35, 285, 50, 50);

          // Exit: Twilight Gateway
          ctx.save();
          ctx.translate(720, 200);
          const spin = (tickCount * 0.05) % (Math.PI * 2);
          ctx.rotate(spin);
          ctx.strokeStyle = '#c026d3';
          ctx.lineWidth = 3;
          ctx.strokeRect(-25, -25, 50, 50);
          ctx.strokeStyle = '#ef4444';
          ctx.strokeRect(-18, -18, 36, 36);
          ctx.restore();

          ctx.fillStyle = '#f472b6';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`🚪 暮光裂隙·巨龙王座之门 (${targetBossName || '首领'})`, 700, 155);
        } else {
          // ── Shadowfang Keep (5-man Castle Corridors) ──
          ctx.fillStyle = '#080814';
          ctx.fillRect(0, 0, width, height);

          // Cobblestone grid
          ctx.strokeStyle = '#121124';
          ctx.lineWidth = 1;
          for (let x = 0; x < width; x += 35) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
          }
          for (let y = 0; y < height; y += 35) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }

          // Guaranteed Open Corridor Pathway along Waypoints (Width: 62px)
          ctx.strokeStyle = '#18162d';
          ctx.lineWidth = 62;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(mazeWaypoints[0].x, mazeWaypoints[0].y);
          for (let i = 1; i < mazeWaypoints.length; i++) {
            ctx.lineTo(mazeWaypoints[i].x, mazeWaypoints[i].y);
          }
          ctx.stroke();

          // Corridor Border Stone Trim
          ctx.strokeStyle = '#2d284a';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Golden/Purple Luminous Guide Path Dots
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Wall Torches
          const sfkTorches = [
            { x: 240, y: 75 },
            { x: 240, y: 225 },
            { x: 120, y: 215 },
            { x: 120, y: 315 },
            { x: 430, y: 315 },
            { x: 430, y: 90 },
            { x: 600, y: 90 },
            { x: 600, y: 235 },
          ];
          for (const t of sfkTorches) {
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(t.x - 2, t.y - 6, 4, 12);
            const flicker = Math.sin(tickCount * 0.2 + t.x) * 2;
            ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
            ctx.beginPath();
            ctx.arc(t.x, t.y, 14 + flicker, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#F59E0B';
            ctx.beginPath();
            ctx.arc(t.x, t.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // Entrance: Castle Gate
          ctx.fillStyle = '#10B981';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('🚩 城堡前庭出发点', 60, 48);
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(35, 55, 50, 50);

          // Exit: High Keep Portal
          ctx.save();
          ctx.translate(720, 230);
          const spin = (tickCount * 0.05) % (Math.PI * 2);
          ctx.rotate(spin);
          ctx.strokeStyle = '#8B5CF6';
          ctx.lineWidth = 3;
          ctx.strokeRect(-25, -25, 50, 50);
          ctx.strokeStyle = '#38BDF8';
          ctx.strokeRect(-18, -18, 36, 36);
          ctx.restore();

          ctx.fillStyle = '#C084FC';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`🚪 领主大厅传送门 (${targetBossName || '首领'})`, 700, 185);
        }

        // Draw Trash Mobs
        trashMobsRef.current.forEach(mob => {
          drawTrashMob(ctx, mob, tickCount, is20Man);
        });

        // Floating SCT
        const now = Date.now();
        encounterSCTRef.current = encounterSCTRef.current.filter(item => now - item.createdAt < 1200);
        encounterSCTRef.current.forEach(item => {
          const age = now - item.createdAt;
          const progress = age / 1200;
          const yOff = progress * 24;
          const alpha = 1 - progress;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = item.color;
          ctx.font = item.isCrit ? 'bold 13px sans-serif' : 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(item.text, item.x, item.y - yOff);
          ctx.restore();
        });

        // Top Guide Banner
        if (isCorpseRunning) {
          const runSec = Math.max(0, corpseRunRemainingMs / 1000).toFixed(1);
          const progressPct = Math.min(1, Math.max(0, 1 - corpseRunRemainingMs / 10000));
          ctx.fillStyle = 'rgba(127, 29, 29, 0.95)';
          ctx.fillRect(40, 13, width - 80, 38);
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(40, 13, width - 80, 38);
          ctx.fillStyle = '#FECACA';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`💀 所有拥有复活能力的队员均已阵亡！全队受罚跑尸中 (${runSec}s) · 倒计时结束后群体复活进入行军`, width / 2, 30);

          // Progress bar under banner
          ctx.fillStyle = '#450a0a';
          ctx.fillRect(50, 38, width - 100, 6);
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(50, 38, (width - 100) * progressPct, 6);
        } else if (hasDeadMembers) {
          ctx.fillStyle = 'rgba(120, 53, 15, 0.9)';
          ctx.fillRect(50, 16, width - 100, 34);
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(50, 16, width - 100, 34);
          ctx.fillStyle = '#FDE68A';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`🪦 队伍中有队友阵亡 (${deadMembers.map(d => d.name).join(', ')}) · 存活治疗正在施法【起死回生】· 全员齐备方可行军探索`, width / 2, 38);
        } else if (currentEncounterPack > 0) {
          ctx.fillStyle = 'rgba(127, 29, 29, 0.92)';
          ctx.fillRect(220, 14, 340, 34);
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(220, 14, 340, 34);
          ctx.fillStyle = '#FCA5A5';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          const packLabel = currentEncounterPack === 1 ? '第1波通道守卫' : '第2波精英伏兵';
          ctx.fillText(`⚔️ 遭遇${packLabel}！全队停驻激战中 · 肃清后继续推进`, width / 2, 35);
        } else {
          ctx.fillStyle = autoNavActiveRef.current ? 'rgba(14, 116, 144, 0.9)' : 'rgba(30, 41, 59, 0.9)';
          ctx.fillRect(240, 14, 300, 34);
          ctx.strokeStyle = autoNavActiveRef.current ? '#38BDF8' : '#64748B';
          ctx.lineWidth = 2;
          ctx.strokeRect(240, 14, 300, 34);
          ctx.fillStyle = autoNavActiveRef.current ? '#E0F2FE' : '#94A3B8';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            autoNavActiveRef.current
              ? `🧭 自动寻路疾跑中 (${is20Man ? '20人团队' : '5人小队'} 阵型行军)`
              : '🖱️ 手动操控中 (单击地面跑动 / 单击选人 / WASD)',
            width / 2,
            35
          );
        }

        // Draw Party in Maze with Smooth Vector Interpolation (NO TELEPORTATION!)
        const sortedParty = [...units].sort((a, b) => {
          const isMeleeA = a.role === 'DPS' && (a.classId === 'ROGUE' || a.classId === 'DK' || a.classId === 'WARRIOR' || a.classId === 'PALADIN');
          const isMeleeB = b.role === 'DPS' && (b.classId === 'ROGUE' || b.classId === 'DK' || b.classId === 'WARRIOR' || b.classId === 'PALADIN');
          const orderA = a.role === 'TANK' ? 0 : isMeleeA ? 1 : a.role === 'DPS' ? 2 : 3;
          const orderB = b.role === 'TANK' ? 0 : isMeleeB ? 1 : b.role === 'DPS' ? 2 : 3;
          return orderA - orderB;
        });

        sortedParty.forEach((u, rank) => {
          const isPlayer = u.isPlayer;
          let targetPos: { x: number; y: number };

          if (currentEncounterPack > 0) {
            const activeMobs = trashMobsRef.current.filter(
              m => m.packIndex === currentEncounterPack && !m.isDead && !m.isTombstone
            );
            const targetMob = activeMobs[0] || getPointAlongMaze(currentEncounterPack === 1 ? totalMazeLen * 0.32 : totalMazeLen * 0.72);
            const isTank = u.role === 'TANK';
            const isMelee = u.role === 'DPS' && (u.classId === 'ROGUE' || u.classId === 'DK' || u.classId === 'WARRIOR' || u.classId === 'PALADIN');
            const isHealer = u.role === 'HEALER';

            if (isTank) {
              targetPos = { x: targetMob.x - 28, y: targetMob.y - 6 };
            } else if (isMelee) {
              targetPos = { x: targetMob.x - 24, y: targetMob.y + 14 };
            } else if (isHealer) {
              targetPos = { x: targetMob.x - 78 - ((rank % 4) * 12), y: targetMob.y + 16 };
            } else {
              targetPos = { x: targetMob.x - 70 - ((rank % 4) * 12), y: targetMob.y - 14 };
            }
          } else if (autoNavActiveRef.current && !hasDeadMembers) {
            const rankDist = Math.max(0, mazeLeadDistRef.current - rank * (is20Man ? 12 : 26));
            targetPos = getPointAlongMaze(rankDist);
          } else {
            // Manual movement
            targetPos = isPlayer
              ? playerPosRef.current
              : (companionPositionsRef.current[u.id] || { x: 60 + (rank % 5) * 18, y: 80 });

            if (!isPlayer && !hasDeadMembers) {
              const targetX = playerPosRef.current.x - (rank + 1) * 18;
              const targetY = playerPosRef.current.y + (rank % 2 === 0 ? 10 : -10);
              targetPos = { x: targetX, y: targetY };
            }
          }

          // Smooth Vector Lerp: Absolutely NO instant snapping/teleportation!
          const curPos = isPlayer
            ? playerPosRef.current
            : (companionPositionsRef.current[u.id] || { x: targetPos.x, y: targetPos.y });

          const dx = targetPos.x - curPos.x;
          const dy = targetPos.y - curPos.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 0.5) {
            const step = Math.min(dist, Math.max(3.8, dist * 0.22));
            curPos.x += (dx / dist) * step;
            curPos.y += (dy / dist) * step;
          } else {
            curPos.x = targetPos.x;
            curPos.y = targetPos.y;
          }

          if (isPlayer) {
            playerPosRef.current = curPos;
            const playerUnit = units.find(unit => unit.isPlayer);
            if (playerUnit) {
              playerUnit.position.x = curPos.x;
              playerUnit.position.y = curPos.y;
            }
          } else {
            companionPositionsRef.current[u.id] = curPos;
            u.position.x = curPos.x;
            u.position.y = curPos.y;
          }

          drawClassCharacter(ctx, u, curPos, isPlayer, u.id === selectedUnitId, tickCount, rank);

          // If member is dead, show resurrecting beam from healer
          if (!u.alive && revivingUnitId === u.id) {
            const healer = units.find(unit => (unit.role === 'HEALER' || unit.classId === 'SHAMAN' || unit.classId === 'DRUID' || unit.classId === 'PRIEST' || unit.classId === 'PALADIN') && (unit.alive ?? unit.isAlive));
            if (healer) {
              const hPos = healer.isPlayer ? playerPosRef.current : (companionPositionsRef.current[healer.id] || { x: 60, y: 80 });
              ctx.save();
              ctx.strokeStyle = '#10B981';
              ctx.lineWidth = 3;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(hPos.x, hPos.y);
              ctx.lineTo(curPos.x, curPos.y);
              ctx.stroke();
              ctx.restore();

              // Resurrect bar above corpse
              ctx.fillStyle = '#000';
              ctx.fillRect(curPos.x - 25, curPos.y - 25, 50, 6);
              ctx.fillStyle = '#F59E0B';
              ctx.fillRect(curPos.x - 25, curPos.y - 25, 50 * (reviveProgress || 0.5), 6);
              ctx.strokeStyle = '#FFF';
              ctx.lineWidth = 1;
              ctx.strokeRect(curPos.x - 25, curPos.y - 25, 50, 6);
            }
          }
        });

        // Maze skirmish FX: beams / projectiles / slashes
        beamsRef.current.forEach(beam => {
          beam.elapsedMs += 16;
          const progress = beam.elapsedMs / beam.totalMs;
          if (progress < 1) {
            ctx.save();
            ctx.strokeStyle = beam.color || `rgba(16, 185, 129, ${(1 - progress) * 0.85})`;
            ctx.globalAlpha = 1 - progress;
            ctx.lineWidth = 3.5 * (1 - progress * 0.4);
            ctx.beginPath();
            ctx.moveTo(beam.fromX, beam.fromY);
            const midX = (beam.fromX + beam.toX) / 2;
            const midY = Math.min(beam.fromY, beam.toY) - 28;
            ctx.quadraticCurveTo(midX, midY, beam.toX, beam.toY);
            ctx.stroke();
            ctx.restore();
          }
        });
        beamsRef.current = beamsRef.current.filter(b => b.elapsedMs < b.totalMs);

        projectilesRef.current.forEach(proj => {
          proj.progress += 0.05;
          if (proj.progress < 1) {
            const curX = proj.fromX + (proj.toX - proj.fromX) * proj.progress;
            const curY = proj.fromY + (proj.toY - proj.fromY) * proj.progress - Math.sin(proj.progress * Math.PI) * 22;
            ctx.save();
            ctx.fillStyle = proj.color;
            ctx.beginPath();
            ctx.arc(curX, curY, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        });
        projectilesRef.current = projectilesRef.current.filter(p => p.progress < 1);

        slashesRef.current.forEach(slash => {
          slash.elapsedMs += 16;
          const slashProgress = slash.elapsedMs / slash.totalMs;
          if (slashProgress < 1) {
            ctx.save();
            ctx.translate(slash.x, slash.y);
            ctx.rotate(slash.angle);
            ctx.strokeStyle = slash.color;
            ctx.lineWidth = 3 * (1 - slashProgress);
            ctx.beginPath();
            ctx.arc(0, 0, 16 + slashProgress * 8, -Math.PI / 3, Math.PI / 3);
            ctx.stroke();
            ctx.restore();
          }
        });
        slashesRef.current = slashesRef.current.filter(s => s.elapsedMs < s.totalMs);

        ctx.restore();
        animId = requestAnimationFrame(render);
        return;
      }

      // ── STAGE B: PULL_APPROACH — enter from LEFT; AI stand progress tracks tank→boss range ───
      if (runPhase === 'PULL_APPROACH') {
        const bossStand = bossPosRef.current;
        const tankUnit = units.find(u => u.role === 'TANK') || units[0];
        const playerIsTank = !!(tankUnit && tankUnit.isPlayer);
        const leftEntry = { x: 110, y: 180 };

        // Spawn everyone at the left doorway once
        if (approachElapsedRef.current === 0) {
          const startSnap: Record<string, { x: number; y: number }> = {};
          let meleeRank = 0;
          let rangedRank = 0;
          units.forEach((u) => {
            let entry: { x: number; y: number };
            if (u.role === 'TANK') {
              entry = { ...leftEntry };
            } else if (isMeleeDpsUnit(u)) {
              entry = {
                x: 88,
                y: 158 + (meleeRank % 2 === 0 ? -18 : 22) + Math.floor(meleeRank / 2) * 8,
              };
              meleeRank += 1;
            } else if (u.role === 'HEALER') {
              entry = { x: 72, y: 210 + (rangedRank % 3) * 14 };
              rangedRank += 1;
            } else {
              entry = { x: 70, y: 130 + (rangedRank % 5) * 16 };
              rangedRank += 1;
            }
            startSnap[u.id] = entry;
            if (u.isPlayer) {
              playerPosRef.current = { ...entry };
            } else {
              companionPositionsRef.current[u.id] = { ...entry };
            }
            if (u.position) {
              u.position.x = entry.x;
              u.position.y = entry.y;
            }
          });
          approachStartPositionsRef.current = startSnap;
        }

        approachElapsedRef.current += 16;

        // Tank combat stand (progress reference)
        const tankIdx = Math.max(0, units.findIndex(u => u.id === tankUnit?.id));
        const tankDest = tankUnit
          ? getCombatFormationPos(tankUnit, tankIdx, bossStand, 1)
          : { x: 445, y: 180 };

        // ── Player tank: free move; soft auto-walk toward stand if idle (no onPlayerMove — that cancelled casts / side-effects) ──
        if (playerIsTank && canMove) {
          const playerMoving =
            moveX !== 0 || moveY !== 0 || !!clickTargetRef.current || !!autoApproachTarget;
          if (!playerMoving) {
            const dx = tankDest.x - playerPosRef.current.x;
            const dy = tankDest.y - playerPosRef.current.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 2) {
              const step = Math.min(dist, 3.6);
              playerPosRef.current.x += (dx / dist) * step;
              playerPosRef.current.y += (dy / dist) * step;
              if (tankUnit.position) {
                tankUnit.position.x = playerPosRef.current.x;
                tankUnit.position.y = playerPosRef.current.y;
              }
            }
          }
        }

        // Resolve current tank world position
        let tankPos = leftEntry;
        if (tankUnit?.isPlayer) {
          tankPos = { ...playerPosRef.current };
        } else if (tankUnit) {
          // AI tank marches on the timed path toward its stand
          const timed = Math.min(1, approachElapsedRef.current / 3500);
          const timedEase = 1 - Math.pow(1 - timed, 2.2);
          const start = approachStartPositionsRef.current[tankUnit.id] || leftEntry;
          tankPos = {
            x: start.x + timedEase * (tankDest.x - start.x),
            y: start.y + timedEase * (tankDest.y - start.y),
          };
          companionPositionsRef.current[tankUnit.id] = { ...tankPos };
          if (tankUnit.position) {
            tankUnit.position.x = tankPos.x;
            tankUnit.position.y = tankPos.y;
          }
        }

        // Formation progress = how close the tank is to the boss (closer → AI more settled)
        const entryDist = Math.hypot(leftEntry.x - bossStand.x, leftEntry.y - bossStand.y);
        const engageDist = 72; // ~fully in position when tank is this close to boss
        const tankBossDist = Math.hypot(tankPos.x - bossStand.x, tankPos.y - bossStand.y);
        const distProgress = Math.max(
          0,
          Math.min(1, (entryDist - tankBossDist) / Math.max(1, entryDist - engageDist))
        );
        // When no player tank, also allow the timed cinematic to finish the pull
        const timedProgress = playerIsTank
          ? 0
          : Math.min(1, approachElapsedRef.current / 3500);
        const progress = Math.max(distProgress, timedProgress);
        const ease = progress * progress * (3 - 2 * progress); // smoothstep

        drawArenaBackground(ctx, width, height);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(0, 100, 48, 160);
        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 100, 48, 160);
        ctx.fillStyle = '#94A3B8';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('入口', 24, 185);

        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          playerIsTank
            ? `🛡️ 主坦靠近首领，队友随距离落位（${Math.round(progress * 100)}%）· WASD/点击移动开怪`
            : `🛡️ 全员自左侧入口冲入 · 奔向预定站位 · 主坦开怪`,
          width / 2,
          42
        );

        // Draw boss FIRST so entry never looks empty (fallback if React state lags a tick)
        if (bossUnit) {
          drawBossModel(ctx, bossUnit, bossStand, bossUnit.id === selectedUnitId, tickCount);
        } else {
          ctx.save();
          ctx.translate(bossStand.x, bossStand.y);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.beginPath();
          ctx.ellipse(0, 36, 48, 18, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#7f1d1d';
          ctx.fillRect(-28, -36, 56, 64);
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`💀 ${targetBossName || '首领'}`, 0, -68);
          ctx.restore();
        }

        units.forEach((u, idx) => {
          const start = approachStartPositionsRef.current[u.id] || { x: 100, y: 180 };
          const dest = getCombatFormationPos(u, idx, bossStand, 1);

          // Player tank: keep live control position (already updated above / by WASD)
          if (u.isPlayer && playerIsTank) {
            if (u.position) {
              u.position.x = playerPosRef.current.x;
              u.position.y = playerPosRef.current.y;
            }
            drawClassCharacter(
              ctx,
              u,
              playerPosRef.current,
              true,
              u.id === selectedUnitId,
              tickCount,
              idx
            );
            return;
          }

          // AI tank already placed above when not player
          if (u.role === 'TANK' && !u.isPlayer) {
            drawClassCharacter(ctx, u, tankPos, false, u.id === selectedUnitId, tickCount, idx);
            return;
          }

          // AI (and non-tank player): stand progress tracks tank→boss distance
          const desired = {
            x: start.x + ease * (dest.x - start.x),
            y: start.y + ease * (dest.y - start.y),
          };
          const cur = u.isPlayer
            ? playerPosRef.current
            : companionPositionsRef.current[u.id] || { ...start };
          const dx = desired.x - cur.x;
          const dy = desired.y - cur.y;
          const dist = Math.hypot(dx, dy);
          // Chase desired stand; faster as tank commits closer to boss
          const maxStep = 2.2 + ease * 2.8;
          if (dist > 0.5) {
            const step = Math.min(dist, maxStep);
            cur.x += (dx / dist) * step;
            cur.y += (dy / dist) * step;
          } else {
            cur.x = desired.x;
            cur.y = desired.y;
          }

          if (u.isPlayer) {
            playerPosRef.current = { x: cur.x, y: cur.y };
          } else {
            companionPositionsRef.current[u.id] = { x: cur.x, y: cur.y };
          }
          if (u.position) {
            u.position.x = cur.x;
            u.position.y = cur.y;
          }
          drawClassCharacter(ctx, u, cur, !!u.isPlayer, u.id === selectedUnitId, tickCount, idx);
        });

        // Pull once: grace so left-door snap + boss paint always happen first
        const pullRange = 110;
        const approachGraceMs = 450;
        const canPull =
          !approachPullFiredRef.current &&
          approachElapsedRef.current >= approachGraceMs &&
          (tankBossDist <= pullRange || progress >= 0.98);
        if (canPull) {
          approachPullFiredRef.current = true;
          pullShoutRef.current = `🛡️ ${tankUnit ? tankUnit.name : '主坦'}: "就位！开怪！"`;
          if (onApproachComplete) onApproachComplete();
        }

        ctx.restore();
        animId = requestAnimationFrame(render);
        return;
      }

      // ── STAGE C: BOSS_COMBAT & OTHER PHASES ──────────────────────────────────
      drawArenaBackground(ctx, width, height);

      // Top guide text if combat not started
      if (runPhase === 'LOBBY') {
        ctx.fillStyle = '#64748B';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⏳ 副本准备中 · 请在冒险大厅配置专精与动作条后启程', width / 2, 35);
      } else if (runPhase === 'WIPE_VOTE') {
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💀 全团覆灭 · 正在进行灭团处置投票 · 满血原地重试或返回集结点', width / 2, 35);
      } else if (runPhase === 'SUMMARY') {
        ctx.fillStyle = '#10B981';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🏆 全通凯旋！首领战斗报告已生成，可在详情面板查阅 DPS/HPS 分解', width / 2, 35);
      }

      // Active Ground Effects (Heal Zones, Damage Zones, Cone Warning, Totems)
      const activeHealZones: GroundEffect[] = [];
      for (const effect of groundEffects) {
        ctx.save();
        if (effect.kind === 'HEAL_ZONE') {
          activeHealZones.push(effect);
          const grad = ctx.createRadialGradient(effect.x, effect.y, 4, effect.x, effect.y, effect.radius);
          grad.addColorStop(0, 'rgba(16, 185, 129, 0.45)');
          grad.addColorStop(0.7, 'rgba(16, 185, 129, 0.2)');
          grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (effect.kind === 'DAMAGE_ZONE') {
          const grad = ctx.createRadialGradient(effect.x, effect.y, 4, effect.x, effect.y, effect.radius);
          grad.addColorStop(0, 'rgba(239, 68, 68, 0.55)');
          grad.addColorStop(0.7, 'rgba(239, 68, 68, 0.25)');
          grad.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
          ctx.stroke();
        } else if (effect.kind === 'CONE_WARNING') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(effect.x, effect.y);
          const facing = (effect as any).facingRad ?? Math.PI;
          const coneAngle = (effect as any).coneAngleRad ?? (Math.PI / 3);
          ctx.arc(effect.x, effect.y, effect.radius, facing - coneAngle / 2, facing + coneAngle / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (effect.kind === 'TOTEM') {
          ctx.fillStyle = '#0070DE';
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 16, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#8B4513';
          ctx.fillRect(effect.x - 3, effect.y - 10, 6, 20);
          ctx.fillStyle = '#FACC15';
          ctx.fillRect(effect.x - 6, effect.y - 14, 12, 4);
        }
        ctx.restore();
      }

      // ── Process AI Companions Pathfinding & Behaviors (Item 5: Perturbation & Micro-stepping) ──
      const bossPos = bossPosRef.current;
      units.forEach((u, idx) => {
        if (u.isPlayer) return;

        // Missing pose (hot-join etc.): seed on predicted combat formation, slight perturb
        if (!companionPositionsRef.current[u.id]) {
          const base = getCombatFormationPos(u, idx, bossPos, 1);
          const perturbX = ((idx * 17) % 21) - 10;
          const perturbY = ((idx * 23) % 21) - 10;
          companionPositionsRef.current[u.id] = {
            x: base.x + perturbX * 0.35,
            y: base.y + perturbY * 0.35,
          };
        }
        const pos = companionPositionsRef.current[u.id];
        const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
        if (!isAlive) return;

        let targetX = pos.x;
        let targetY = pos.y;
        const hpPct = u.hp / u.maxHp;

        // 1. 默认阵型：与 PULL_APPROACH 共用 getCombatFormationPos，开怪不瞬移
        const defaultTarget = getCombatFormationPos(u, idx, bossPos, hpPct);

        // 2. 地面治疗阵法与负面阵型权衡评估：
        // 存在多个地面治疗阵法时已经在其中一个了就不要走到其他的了，除非有负面阵型要躲避根据权衡是躲避还是继续站位
        // 近战DPS血线健康时不远离Boss走治疗阵，若不影响打Boss可走，恢复健康且打不到Boss时返回攻击Boss
        const formationResult = evaluateGroundFormationPosition({
          currentPos: pos,
          unit: u,
          groundEffects,
          defaultTarget,
          bossPos,
        });

        targetX = formationResult.targetPos.x;
        targetY = formationResult.targetPos.y;

        // 3. 多动症踱步：仅在默认阵型 / 回打 Boss 时允许——不干扰躲圈、蹭治疗阵、拉怪意图点
        // 站桩超过该 AI 的 fidgetIdleThresholdMs（按角色名稳定随机，约 5~60s）后，在意图点周围小幅走动再回位
        {
          const canFidget =
            runPhase === 'BOSS_COMBAT' &&
            !!bossUnit &&
            !!(bossUnit.alive ?? bossUnit.isAlive) &&
            (formationResult.tradeOffDecision === 'DEFAULT_POSITION' ||
              formationResult.tradeOffDecision === 'RETURN_TO_BOSS');

          let fidget = companionFidgetRef.current[u.id];
          if (!fidget) {
            fidget = { idleMs: 0, activeUntil: 0, ox: 0, oy: 0, lastX: pos.x, lastY: pos.y };
            companionFidgetRef.current[u.id] = fidget;
          }

          const nowMs = performance.now();
          const frameDtMs = 1000 / 60;
          const movedPx = Math.hypot(pos.x - fidget.lastX, pos.y - fidget.lastY);
          fidget.lastX = pos.x;
          fidget.lastY = pos.y;

          if (!canFidget) {
            fidget.idleMs = 0;
            fidget.activeUntil = 0;
            fidget.ox = 0;
            fidget.oy = 0;
          } else {
            const personality = createAIPersonality(u.name, u.id);
            const idleThresholdMs = resolveFidgetIdleThresholdMs(personality, {
              role: u.role,
              isMeleeDps: isMeleeDpsUnit(u),
            });
            const atIntent =
              Math.hypot(pos.x - formationResult.targetPos.x, pos.y - formationResult.targetPos.y) <= 14;
            const isFidgeting = nowMs < fidget.activeUntil;

            if (isFidgeting) {
              targetX += fidget.ox;
              targetY += fidget.oy;
            } else {
              fidget.ox = 0;
              fidget.oy = 0;
              // 真正站桩（到岗且几乎不动）才累计不耐烦；赶路中不计
              if (atIntent && movedPx < 0.85) {
                fidget.idleMs += frameDtMs;
                if (fidget.idleMs >= idleThresholdMs) {
                  const angle =
                    (((personality.seed + Math.floor(nowMs / 17) + idx * 97) % 360) * Math.PI) / 180;
                  const radius =
                    personality.fidgetRadiusPx * (0.55 + ((personality.seed >> 5) % 46) / 100);
                  fidget.ox = Math.cos(angle) * radius;
                  fidget.oy = Math.sin(angle) * radius;
                  fidget.activeUntil = nowMs + personality.fidgetDurationMs;
                  fidget.idleMs = 0;
                  targetX += fidget.ox;
                  targetY += fidget.oy;
                }
              } else if (!atIntent) {
                fidget.idleMs = 0;
              }
            }
          }
        }

        // 全场物理边界（外圈不实际限制移动，角色与玩家均可正常走入外圈，只是看起来更广阔）
        targetX = Math.max(30, Math.min(width - 30, targetX));
        targetY = Math.max(30, Math.min(height - 30, targetY));

        // Clamped normal walking/running speed (杜绝过快瞬移与大步切片)
        // isMoving 使用滞回：避免目标距离刚好卡在阈值附近时跑步动画抽搐
        const dx = targetX - pos.x;
        const dy = targetY - pos.y;
        const dist = Math.hypot(dx, dy);
        const wasMoving = !!(u as any).isMoving;
        if (dist > 1) {
          const maxSpeed = 2.4;
          const step = Math.min(dist, maxSpeed);
          pos.x += (dx / dist) * step;
          pos.y += (dy / dist) * step;
          (u as any).isMoving = wasMoving ? dist > 1.6 : dist > 5.0;
        } else {
          (u as any).isMoving = false;
        }

        // 全图自由移动，外圈不限制通行
        pos.x = Math.max(30, Math.min(width - 30, pos.x));
        pos.y = Math.max(30, Math.min(height - 30, pos.y));

        // Sync to unit position
        u.position.x = pos.x;
        u.position.y = pos.y;
      });

      // ── Process Boss Movement & Pursuit AI (受距离约束，够不着会跑过去) ──
      let bossIsMoving = false;
      if (runPhase === 'BOSS_COMBAT' && bossUnit && (bossUnit.alive ?? bossUnit.isAlive) && bossUnit.hp > 0) {
        const isCasting = Boolean((bossUnit as any)?.isCasting);

        // 查找当前首领目标（优先仇恨目标，其次存活坦克、玩家或任意活着的队友）
        const primaryTarget = (bossTargetId ? units.find(u => u.id === bossTargetId && (u.alive ?? u.isAlive)) : null)
          || units.find(u => (u.alive ?? u.isAlive) && u.role === 'TANK')
          || units.find(u => (u.alive ?? u.isAlive) && u.isPlayer)
          || units.find(u => (u.alive ?? u.isAlive));

        if (primaryTarget && !isCasting) {
          const tPos = primaryTarget.isPlayer
            ? playerPosRef.current
            : (companionPositionsRef.current[primaryTarget.id] || primaryTarget.position);

          if (tPos) {
            const dx = tPos.x - bossPosRef.current.x;
            const dy = tPos.y - bossPosRef.current.y;
            const dist = Math.hypot(dx, dy);
            // 追击滞回：开始追击 / 停止追击拉开间距，避免目标在临界距离晃动时 Boss 跑步动画抽搐
            const CHASE_START_DIST = 68;
            const CHASE_STOP_DIST = 54;
            const wasChasing = isBossMovingRef.current;
            const shouldChase = wasChasing ? dist > CHASE_STOP_DIST : dist > CHASE_START_DIST;

            if (shouldChase) {
              const bossSpeed = 2.8; // 首领跑步追击速度
              const step = Math.min(bossSpeed, Math.max(0, dist - CHASE_STOP_DIST));
              if (step > 0.35) {
                bossIsMoving = true;
                bossPosRef.current.x += (dx / dist) * step;
                bossPosRef.current.y += (dy / dist) * step;
              }
            }

            // 场地全范围自由通行，外圈不硬性设阻
            bossPosRef.current.x = Math.max(30, Math.min(width - 30, bossPosRef.current.x));
            bossPosRef.current.y = Math.max(30, Math.min(height - 30, bossPosRef.current.y));
          }
        }

        // 同步位置到 bossUnit 实例，供伤害判定与技能计算
        if (bossUnit.position) {
          bossUnit.position.x = bossPosRef.current.x;
          bossUnit.position.y = bossPosRef.current.y;
        }
      }
      isBossMovingRef.current = bossIsMoving;

      // ── Periodic Dynamic Combat FX (Projectiles, Healing Rays, Slashes) ───────
      if (runPhase === 'BOSS_COMBAT' && bossUnit && bossUnit.alive) {
        // Ranged cast flying projectile (Mage / Warlock / Hunter / Priest / Elemental Shaman)
        if (tickCount % 30 === 0) {
          const rangedDps = units.find(
            u =>
              u.alive &&
              u.role === 'DPS' &&
              (u.classId === 'MAGE' || u.classId === 'WARLOCK' || u.classId === 'HUNTER' || u.classId === 'PRIEST' || u.classId === 'SHAMAN')
          );
          if (rangedDps) {
            const mPos = rangedDps.isPlayer ? playerPosRef.current : (companionPositionsRef.current[rangedDps.id] || { x: 160, y: 160 });
            const rColor =
              rangedDps.classId === 'MAGE' ? '#FF4500' :
              rangedDps.classId === 'WARLOCK' ? '#A855F7' :
              rangedDps.classId === 'HUNTER' ? '#ABD473' :
              rangedDps.classId === 'PRIEST' ? '#C084FC' : '#38BDF8';
            projectilesRef.current.push({
              id: `proj_${Date.now()}_${Math.random()}`,
              fromX: mPos.x,
              fromY: mPos.y,
              toX: bossPos.x,
              toY: bossPos.y,
              color: rColor,
              kind: 'FIRE',
              progress: 0,
            });
          }
        }

        // Healer radiant healing beam
        if (tickCount % 40 === 0) {
          const healer = units.find(u => u.role === 'HEALER' && u.alive);
          if (healer) {
            const wounded = units.filter(u => u.alive && u.hp < u.maxHp);
            const lowest = wounded.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
            const hPos = healer.isPlayer ? playerPosRef.current : (companionPositionsRef.current[healer.id] || { x: 140, y: 220 });
            const tPos = lowest ? (lowest.isPlayer ? playerPosRef.current : (companionPositionsRef.current[lowest.id] || { x: 180, y: 180 })) : hPos;
            beamsRef.current.push({
              id: `beam_${Date.now()}_${Math.random()}`,
              fromX: hPos.x,
              fromY: hPos.y,
              toX: tPos.x,
              toY: tPos.y,
              color: '#10B981',
              elapsedMs: 0,
              totalMs: 450,
            });
          }
        }

        // Melee slash visual
        if (tickCount % 22 === 0) {
          const melee = units.find(u => u.alive && (u.classId === 'ROGUE' || u.classId === 'WARRIOR' || ((u.classId === 'DK' || u.classId === 'PALADIN') && u.role === 'DPS')));
          if (melee) {
            const mPos = companionPositionsRef.current[melee.id];
            // 仅在近战单位实际处于首领攻击范围 (<=80px) 内时播放挥砍视觉特效
            const inRange = !mPos || Math.hypot(mPos.x - bossPos.x, mPos.y - bossPos.y) <= 80;
            if (inRange) {
              slashesRef.current.push({
                id: `slash_${Date.now()}_${Math.random()}`,
                x: bossPos.x - 20 + (Math.random() - 0.5) * 15,
                y: bossPos.y + (Math.random() - 0.5) * 20,
                angle: (Math.random() - 0.5) * Math.PI,
                color: '#FFF569',
                elapsedMs: 0,
                totalMs: 220,
              });
            }
          }
        }
      }

      // ── Draw Mouse Click-to-Move Ping Animation ─────────────────────────────
      if (clickTargetRef.current) {
        const elapsed = Date.now() - clickTargetRef.current.time;
        if (elapsed < 600) {
          const pingR = 4 + (elapsed / 600) * 16;
          const alpha = 1 - elapsed / 600;
          ctx.save();
          ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(clickTargetRef.current.x, clickTargetRef.current.y, pingR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
          ctx.beginPath();
          ctx.arc(clickTargetRef.current.x, clickTargetRef.current.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // ── Draw Boss Target Aggro Line ─────────────────────────────────────────
      if (bossUnit && bossUnit.alive && bossTargetId) {
        const targetUnit = units.find(u => u.id === bossTargetId);
        if (targetUnit && targetUnit.alive) {
          const tPos = targetUnit.isPlayer ? playerPosRef.current : companionPositionsRef.current[targetUnit.id];
          if (tPos) {
            ctx.save();
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(bossPos.x, bossPos.y);
            ctx.lineTo(tPos.x, tPos.y);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // ── Draw Healing Beams ──────────────────────────────────────────────────
      beamsRef.current.forEach(beam => {
        beam.elapsedMs += 16;
        const progress = beam.elapsedMs / beam.totalMs;
        if (progress < 1) {
          ctx.save();
          const alpha = 1 - progress;
          ctx.strokeStyle = `rgba(16, 185, 129, ${alpha * 0.8})`;
          ctx.lineWidth = 4 * (1 - progress * 0.5);
          ctx.beginPath();
          ctx.moveTo(beam.fromX, beam.fromY);
          const midX = (beam.fromX + beam.toX) / 2;
          const midY = Math.min(beam.fromY, beam.toY) - 30;
          ctx.quadraticCurveTo(midX, midY, beam.toX, beam.toY);
          ctx.stroke();
          ctx.restore();
        }
      });
      beamsRef.current = beamsRef.current.filter(b => b.elapsedMs < b.totalMs);

      // ── Draw Projectiles ───────────────────────────────────────────────────
      projectilesRef.current.forEach(proj => {
        proj.progress += 0.05;
        if (proj.progress < 1) {
          const curX = proj.fromX + (proj.toX - proj.fromX) * proj.progress;
          const curY = proj.fromY + (proj.toY - proj.fromY) * proj.progress - Math.sin(proj.progress * Math.PI) * 25;
          ctx.save();
          ctx.fillStyle = proj.color;
          ctx.beginPath();
          ctx.arc(curX, curY, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFA500';
          ctx.beginPath();
          ctx.arc(curX - 4, curY + 2, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
      projectilesRef.current = projectilesRef.current.filter(p => p.progress < 1);

      // ── Draw Melee Slashes ─────────────────────────────────────────────────
      slashesRef.current.forEach(slash => {
        slash.elapsedMs += 16;
        const slashProgress = slash.elapsedMs / slash.totalMs;
        if (slashProgress < 1) {
          ctx.save();
          ctx.translate(slash.x, slash.y);
          ctx.rotate(slash.angle);
          ctx.strokeStyle = slash.color;
          ctx.lineWidth = 3 * (1 - slashProgress);
          ctx.beginPath();
          ctx.arc(0, 0, 18 + slashProgress * 10, -Math.PI / 3, Math.PI / 3);
          ctx.stroke();
          ctx.restore();
        }
      });
      slashesRef.current = slashesRef.current.filter(s => s.elapsedMs < s.totalMs);

      // ── Draw Boss Model ─────────────────────────────────────────────────────
      if (bossUnit) {
        drawBossModel(ctx, bossUnit, bossPosRef.current, bossUnit.id === selectedUnitId, tickCount, isBossMovingRef.current);
      }

      // ── Draw Player Character & Companions ─────────────────────────────────
      units.forEach((u, idx) => {
        const isPlayer = u.isPlayer;
        const pos = isPlayer
          ? playerPosRef.current
          : (companionPositionsRef.current[u.id] || { x: 160 + idx * 25, y: 150 + idx * 30 });

        drawClassCharacter(ctx, u, pos, isPlayer, u.id === selectedUnitId, tickCount, idx);
      });

      // ── Draw Floating Combat Text (SCT) ────────────────────────────────────
      const nowSCT = Date.now();
      for (const fct of floatingTexts) {
        const ageMs = nowSCT - fct.createdAtMs;
        if (ageMs > 1500) continue;

        const targetUnit = units.find(u => u.id === fct.targetId);
        let targetX = 0;
        let targetY = 0;
        const isTargetBoss = fct.targetId === bossUnit?.id;
        const isTargetEnemy = isTargetBoss || targetUnit?.role === 'ENEMY';
        const isTargetPlayer = targetUnit?.isPlayer || fct.isToPlayer;

        if (isTargetBoss) {
          targetX = bossPos.x;
          targetY = bossPos.y - 35;
        } else if (targetUnit) {
          const uPos = targetUnit.isPlayer ? playerPosRef.current : companionPositionsRef.current[targetUnit.id];
          if (uPos) {
            targetX = uPos.x;
            targetY = uPos.y - 25;
          }
        }
        if (targetX === 0 && targetY === 0) continue;

        // 1. 敌人头顶数字：严格只显示 你 & 你的宠物 对敌人造成的伤害与命中判定
        if (isTargetEnemy && !fct.isFromPlayerOrPet) {
          continue;
        }

        // 散布微小水平抖动与减速上浮动画 (模拟魔兽原版 SCT 抛物线浮动)
        let hash = 0;
        for (let i = 0; i < fct.id.length; i++) hash = ((hash << 5) - hash) + fct.id.charCodeAt(i);
        const xJitter = (Math.abs(hash) % 36) - 18;

        const progress = ageMs / 1500;
        const yOffset = Math.sin(progress * Math.PI * 0.5) * 45;
        const alpha = Math.max(0, 1 - Math.pow(progress, 1.4));

        let scale = 1.0;
        if (fct.isCrit) {
          scale = ageMs < 200 ? 1.0 + (1 - ageMs / 200) * 0.4 : 1.0;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(targetX + xJitter, targetY - yOffset);
        if (scale !== 1.0) {
          ctx.scale(scale, scale);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (isTargetEnemy) {
          // ── 敌人头顶数字 (你 & 你的宠物 对敌人造成的伤害) ──
          if (['DODGE', 'PARRY', 'BLOCK', 'RESIST', 'ABSORB', 'MISS', 'IMMUNE'].includes(fct.category) ||
              ['闪避', '招架', '格挡', '抵抗', '吸收', '未命中', '免疫'].includes(fct.text)) {
            // 你打出的命中判定
            ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#FEF08A';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2.5;
            const hitText = fct.text.startsWith('[') ? fct.text : `[${fct.text}]`;
            ctx.strokeText(hitText, 0, 0);
            ctx.fillText(hitText, 0, 0);
          } else if (fct.isCrit) {
            // 暴击放大数字 (Enlarged Pop Font)
            ctx.font = 'bold 22px "Impact", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#FFF500';
            ctx.strokeStyle = '#8B0000';
            ctx.lineWidth = 3;
            ctx.strokeText(`💥 ${fct.text}`, 0, 0);
            ctx.fillText(`💥 ${fct.text}`, 0, 0);
          } else if (fct.category === 'DAMAGE_AUTO') {
            // 白字普攻 (White auto-attack)
            ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2.5;
            ctx.strokeText(fct.text, 0, 0);
            ctx.fillText(fct.text, 0, 0);
          } else if (fct.category === 'DAMAGE_DOT') {
            // DOT持续伤害 (Periodic damage tick)
            ctx.font = 'bold 13.5px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#F59E0B'; // 琥珀金
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(fct.text, 0, 0);
            ctx.fillText(fct.text, 0, 0);
          } else {
            // 黄字技能 (Yellow skill damage)
            ctx.font = 'bold 15.5px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#FFFF00'; // 原汁原味经典 WoW 黄字技能色
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2.5;
            ctx.strokeText(fct.text, 0, 0);
            ctx.fillText(fct.text, 0, 0);
          }
        } else if (isTargetPlayer) {
          // ── 你角色头顶数字 ──
          if (fct.category === 'HEAL') {
            // 2. 你角色头顶绿色数字：治疗量（队友奶你 / 自己回血技能）
            const isCritHeal = fct.isCrit;
            ctx.font = isCritHeal ? 'bold 20px "Impact", sans-serif' : 'bold 14.5px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = isCritHeal ? '#4ADE80' : '#22C55E';
            ctx.strokeStyle = '#022c22';
            ctx.lineWidth = 2.5;
            const cleanText = fct.text.replace(/^\+/, '');
            const healStr = isCritHeal ? `💥 +${cleanText}` : `+${cleanText}`;
            ctx.strokeText(healStr, 0, 0);
            ctx.fillText(healStr, 0, 0);
          } else if (fct.category === 'DAMAGE_TAKEN') {
            // 3. 你角色头顶红色数字：敌人对你造成的伤害
            const isCritDmg = fct.isCrit;
            ctx.font = isCritDmg ? 'bold 20px "Impact", sans-serif' : 'bold 15px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = isCritDmg ? '#FF0000' : '#EF4444';
            ctx.strokeStyle = '#450a0a';
            ctx.lineWidth = 2.5;
            const cleanText = fct.text.replace(/^-/, '');
            const dmgStr = isCritDmg ? `💥 -${cleanText}` : `-${cleanText}`;
            ctx.strokeText(dmgStr, 0, 0);
            ctx.fillText(dmgStr, 0, 0);
          } else if (['DODGE', 'PARRY', 'BLOCK', 'RESIST', 'ABSORB', 'MISS'].includes(fct.category) ||
                     ['闪避', '招架', '格挡', '抵抗', '吸收', '未命中'].includes(fct.text)) {
            // 4. 打到你身上的命中判定结果
            let color = '#38BDF8';
            if (fct.category === 'PARRY' || fct.text === '招架') color = '#F59E0B';
            else if (fct.category === 'BLOCK' || fct.text === '格挡') color = '#A855F7';
            else if (fct.category === 'ABSORB' || fct.text === '吸收') color = '#FCD34D';
            else if (fct.category === 'RESIST' || fct.text === '抵抗') color = '#C084FC';
            else if (fct.category === 'MISS' || fct.text === '未命中') color = '#94A3B8';

            ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = color;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2.5;
            ctx.strokeText(fct.text, 0, 0);
            ctx.fillText(fct.text, 0, 0);
          } else {
            // 默认玩家普通提示
            ctx.font = 'bold 13px sans-serif';
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeText(fct.text, 0, 0);
            ctx.fillText(fct.text, 0, 0);
          }
        } else {
          // ── 队友头顶普通辅助跳字 (保持整洁低调) ──
          if (fct.category === 'HEAL') {
            ctx.font = 'bold 11.5px sans-serif';
            ctx.fillStyle = '#4ADE80';
            ctx.fillText(`+${fct.text.replace(/^\+/, '')}`, 0, 0);
          } else if (fct.isCrit) {
            ctx.font = 'bold 13.5px sans-serif';
            ctx.fillStyle = '#FFD700';
            ctx.fillText(`💥 ${fct.text}`, 0, 0);
          } else {
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(fct.text, 0, 0);
          }
        }
        ctx.restore();
      }

      // ── Ground Target Reticle (Follows mouse, glowing or dimmed based on validity) ──
      if (groundTargetState && mouseCanvasPosRef.current) {
        const { x, y } = mouseCanvasPosRef.current;
        const { radius, color, maxRange, name } = groundTargetState;
        const pPos = playerPosRef.current;
        const dist = Math.hypot(x - pPos.x, y - pPos.y);
        const inCanvas = x >= 30 && x <= width - 30 && y >= 30 && y <= height - 30;
        const isAllowed = inCanvas && dist <= maxRange;

        ctx.save();

        // 1. Draw subtle casting range boundary around player
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(pPos.x, pPos.y, maxRange, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // 2. Connecting laser guide line from player to reticle
        ctx.strokeStyle = isAllowed ? `${color}55` : 'rgba(120, 120, 120, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(pPos.x, pPos.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isAllowed) {
          // Bright, glowing reticle in allowed area
          const pulse = Math.sin(tickCount * 0.15) * 2;
          const effRadius = radius + pulse;

          // Inner translucent glow fill
          ctx.fillStyle = `${color}25`;
          ctx.beginPath();
          ctx.arc(x, y, effRadius, 0, Math.PI * 2);
          ctx.fill();

          // Outer glowing border
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, effRadius, 0, Math.PI * 2);
          ctx.stroke();

          // Rotating compass notches
          const rot = tickCount * 0.03;
          for (let i = 0; i < 4; i++) {
            const angle = rot + (i * Math.PI) / 2;
            const innerR = effRadius - 8;
            const outerR = effRadius + 4;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(angle) * innerR, y + Math.sin(angle) * innerR);
            ctx.lineTo(x + Math.cos(angle) * outerR, y + Math.sin(angle) * outerR);
            ctx.stroke();
          }

          // Center crosshair
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 8, y);
          ctx.lineTo(x + 8, y);
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x, y + 8);
          ctx.stroke();

          // Center dot
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();

          // Guide Text below reticle
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 4;
          ctx.fillText(`左键释放 【${name}】`, x, y + effRadius + 18);
          ctx.fillStyle = '#9ca3af';
          ctx.font = '9px sans-serif';
          ctx.fillText('右键或ESC取消', x, y + effRadius + 30);
        } else {
          // Dimmed / dark reticle when outside allowed area ("否则光圈变暗")
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(20, 20, 30, 0.4)';
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(100, 100, 110, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.stroke();

          // Dimmed crosshair
          ctx.strokeStyle = 'rgba(150, 50, 50, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 6, y);
          ctx.lineTo(x + 6, y);
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x, y + 6);
          ctx.stroke();

          // Dim warning text
          ctx.fillStyle = '#f87171';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('❌ 超出施法范围 (光圈变暗不可释放)', x, y + radius + 18);
          ctx.fillStyle = '#9ca3af';
          ctx.font = '9px sans-serif';
          ctx.fillText('右键或ESC取消', x, y + radius + 30);
        }

        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [units, bossUnit, bossTargetId, groundEffects, floatingTexts, runPhase, screenShake, selectedUnitId, onPlayerMove, onCancelCast, onApproachComplete, onFastForwardTravel, revivingUnitId, reviveProgress, autoApproachTarget, onApproachTargetReached, isCorpseRunning, corpseRunRemainingMs, groundTargetState]);

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden bg-[#070710] cursor-crosshair select-none">
      <canvas
        ref={canvasRef}
        width={780}
        height={360}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        onContextMenu={handleCanvasContextMenu}
        className="w-full h-full block"
        title={groundTargetState ? "单击有效区域释放技能，右键或ESC取消" : "单击地面移动，单击或双击角色选中目标"}
      />
      {/* Top Center Banner when in Ground Targeting Mode */}
      {groundTargetState && (
        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 flex items-center space-x-2 bg-amber-950/90 border border-amber-400 px-3 py-1 rounded-full shadow-lg backdrop-blur z-20 text-xs text-amber-200 animate-pulse pointer-events-none">
          <span>🎯</span>
          <span className="font-bold">
            正在选择【{groundTargetState.name}】释放位置 (鼠标左键确定 · 右键或ESC取消)
          </span>
        </div>
      )}
      {/* Top Left Floating Controls Guide */}
      <div className="absolute top-2 left-3 flex items-center space-x-2 text-[10px] text-gray-300 bg-black/80 px-2.5 py-1 rounded-lg border border-[#3b3b5c] backdrop-blur pointer-events-none">
        <span className="text-amber-400 font-bold">🎮 操控：</span>
        <span>
          单击地面跑动 · 单击选人 · 长按 <strong className="text-white bg-slate-800 px-1 rounded">W A S D</strong> 连续移动 · 
          按 <strong className="text-amber-300 bg-slate-800 px-1 rounded">Alt+1~{units.length}</strong> 切换目标 · 施法距离不足自动跑向目标
        </span>
      </div>
    </div>
  );
};
