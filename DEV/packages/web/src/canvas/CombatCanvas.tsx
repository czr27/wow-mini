import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  playCombatSfx,
  inferSpellSchool,
  type SfxActorRole,
  type SfxEventKind,
} from '../utils/combatSfx.js';
import { playRaidBuffSfx } from '../utils/bgmManager.js';
import { useGameStore } from '../store/gameStore.js';
import {
  Unit,
  GroundEffect,
  FloatingCombatText,
  RunPhase,
  evaluateGroundFormationPosition,
  computeDungeonPriorityZone,
  findLooseAddForTank,
  orderTanksByThreatPriority,
  clampPosWithinTankRange,
  GroundTargetState,
  createAIPersonality,
  resolveFidgetIdleThresholdMs,
  clampToMazePath,
  getMazeDrawOrigin,
  MAZE_HUD_SAFE_INSETS,
  MAZE_TRAVERSE_SPEED_SCALE,
  resolveAoeAlphaByRadiusPx,
  isTotemUnit,
  resolveUnitFacingRad,
  FIDGET_MAX_PX,
  isPosInHazard,
  isFriendlyGroundEffect,
  resolveCombatDisplayPrefs,
  isEnemyActorUnit,
  getUnitMoveSpeedMultiplier,
  type CombatDisplayPrefs,
  type MazeLayout,
} from '@cata-raid-sim/engine';
import {
  getMazeLayoutSync,
  ensureMazeLayout,
  trashSpawnsToMobs,
} from '../combat/mazeRuntime.js';
import {
  publishHostMazeSync,
  readGuestMazeSync,
} from '../combat/mazeSyncBridge.js';
import { resolveLocalFloatingTextMode } from './floatingTextFilter.js';
import {
  computePathGeometry,
  selectExitClosestHumanLeader,
  stepManualMazeCompanion,
} from './mazeFollowAi.js';
import {
  applyCanvasViewTransform,
  enterScreenSpaceFromIso,
  ISO_ORBIT_PX_PER_TURN,
  ISO_PITCH_DEG_DEFAULT,
  orbitRadiansPerPixel,
  pitchDegFromOrbitDrag,
  pitchDegToSin,
  screenDirToWorld,
  isMouseChordMoveActive,
  viewRelativeFacingRad,
  viewDepthKey,
  viewToWorld,
  worldAabbCoveringCanvas,
  worldToView,
  type ViewCamera,
} from './canvasViewMath.js';

import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';
import {
  type AoeRingState,
  syncPersistentRingsFromGround,
  ingestCombatActionsAsRings,
  drawAoeRing,
  drawConeWarning,
} from '../combat/aoeRingDraw.js';
import {
  createHitFxState,
  ingestCombatActionsAsHitFx,
  pruneHitFx,
  drawHitFx,
  spawnHitProjectile,
  spawnHitSlash,
  spawnHealSnowBurst,
  meleeHandPose,
  BOSS_HIT_FX_COLOR,
  HIT_FX_BOSS_SIZE_MULT,
  type HitFxState,
} from '../combat/combatHitFx.js';
import {
  createClassAoePulseState,
  ingestCombatActionsAsClassAoePulses,
  pruneClassAoePulses,
  drawClassAoePulses,
  type ClassAoePulseState,
} from '../combat/combatClassAoePulse.js';
import {
  resolveBossLinkBeams,
  drawBossLinkBeams,
} from '../combat/bossLinkFx.js';
import { drawUnitSelectionRing } from '../combat/unitSelectionRing.js';
import { drawFiveManBossModel, drawFiveManBossFallback } from './fiveManBossModels.js';
import {
  NEON_INK,
  drawClassEightDirBody,
  drawCyberBox,
  drawEightDirLayers,
  drawFacingEyePair,
  drawNeonGlowCircle,
  drawNeonGlowLine,
  drawNeonGlowRect,
  facingHandBiasX,
  getActiveFacingPose,
  isFacingBack,
  withBossEightDirFacing,
  type BossEightDirOpts,
} from './eightDirModels.js';

interface Props {
  units: Unit[];
  bossUnit?: Unit;
  bossTargetId?: string | null;
  groundEffects: GroundEffect[];
  floatingTexts: FloatingCombatText[];
  runPhase: RunPhase | 'PULL_APPROACH';
  screenShake: boolean;
  selectedUnitId: string | null;
  /** Focus frame target — name always shown in combat */
  focusTargetId?: string | null;
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
  dungeonId?: string;
  targetBossName?: string;
  currentBossIndex?: number;
  travelRemainingMs?: number;
  totalTravelMs?: number;
  isCorpseRunning?: boolean;
  corpseRunRemainingMs?: number;
  groundTargetState?: GroundTargetState | null;
  onConfirmGroundTarget?: (slotIdx: number, spellId: string, x: number, y: number) => void;
  onCancelGroundTarget?: () => void;
  /** When true, remote humans/AI/boss lerp to unit.position from host snapshot */
  syncRemotePositions?: boolean;
  /** 联机客人：不本地结算迷宫小怪，只镜像房主快照 */
  isNetworkGuest?: boolean;
  /** Guest: report local player xy to host for broadcast */
  onNetworkMoveReport?: (x: number, y: number) => void;
  /** Maze auto-path (controlled by TravelRecovery HUD) */
  autoNavActive?: boolean;
  onAutoNavChange?: (active: boolean) => void;
  /** Per-character canvas display prefs (bars / names / FX / terrain) */
  combatDisplayPrefs?: CombatDisplayPrefs | null;
  /** Living enemy units (boss + summoned adds) for Tank AI add-pickup positioning */
  enemyUnits?: Unit[];
}

export type MobModelType =
  | 'WORGEN_PATROL'
  | 'DARK_WOLF'
  | 'SHADOW_CHANNELER'
  | 'SHADOW_SHIELDGUARD'
  | 'TWILIGHT_DRAKONID'
  | 'LAVA_DRAKE'
  | 'TWILIGHT_VOIDWEAVER'
  | 'DRAGON_ANNIHILATOR'
  | 'DEFIAS_MINER'
  | 'GOBLIN_TECH'
  | 'SCARLET_FOOTMAN'
  | 'SCARLET_ACOLYTE'
  | 'SCOURGE_ABOM'
  | 'GARGOYLE_SENTRY'
  | 'TROLL_BERSERKER'
  | 'VENOM_WARLOCK';

export interface TrashMob {
  id: string;
  name: string;
  mobModel: MobModelType;
  packIndex: number;
  /** Path fight pack; false = scenery only (still drawn). */
  isEncounter: boolean;
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
  const pose = getActiveFacingPose();
  const isBack = isFacingBack(pose);
  const e = pose.eyeBiasX;
  const neonEdge = isArchangel ? '#FF1744' : '#E879F9';
  const eyeColor = isArchangel ? '#FF1744' : '#00FF87';

  const drawBack = () => {
    // 黑暗大天使形态：霓虹赛博虚空蝠翼
    if (isArchangel) {
      const wingFlap = Math.sin(tickCount * 0.16) * 8;
      ctx.fillStyle = NEON_INK;
      ctx.beginPath();
      ctx.moveTo(-14, -26);
      ctx.quadraticCurveTo(-68 + wingFlap, -64, -78 + wingFlap, -20);
      ctx.quadraticCurveTo(-52 + wingFlap, 12, -14, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(14, -26);
      ctx.quadraticCurveTo(68 - wingFlap, -64, 78 - wingFlap, -20);
      ctx.quadraticCurveTo(52 - wingFlap, 12, 14, 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(139, 92, 246, 0.85)';
      ctx.beginPath();
      ctx.moveTo(-14, -24);
      ctx.quadraticCurveTo(-62 + wingFlap, -58, -72 + wingFlap, -20);
      ctx.quadraticCurveTo(-48 + wingFlap, 8, -14, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(14, -24);
      ctx.quadraticCurveTo(62 - wingFlap, -58, 72 - wingFlap, -20);
      ctx.quadraticCurveTo(48 - wingFlap, 8, 14, 0);
      ctx.fill();

      // 翼骨霓虹紫脉
      drawNeonGlowLine(ctx, -14, -22, -62 + wingFlap, -32, 2, '#D946EF', 0.95);
      drawNeonGlowLine(ctx, 14, -22, 62 - wingFlap, -32, 2, '#D946EF', 0.95);
    }

    // 高耸贵族燕尾披风（背面覆盖背部）
    const cloakW = isBack ? 46 : 38;
    drawCyberBox(ctx, -cloakW / 2 - e * 0.3, -30, cloakW, 60, '#160b29', NEON_INK, neonEdge, 2);
    if (isBack) {
      drawNeonGlowLine(ctx, 0, -24, 0, 22, 2, neonEdge, 0.9);
    }
  };

  const drawCore = () => {
    // 维多利亚暗紫礼服主体
    drawCyberBox(ctx, -21, -30, 42, 58, '#120a21', NEON_INK, neonEdge, 1.5);
    drawCyberBox(ctx, -17, -28, 34, 13, '#3b0764', NEON_INK, neonEdge, 1.4);

    // 贵族白领结（Jabot）+ 胸前脉冲虚空核
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(e * 0.4, -26);
    ctx.lineTo(-8 + e * 0.4, -14);
    ctx.lineTo(8 + e * 0.4, -14);
    ctx.closePath();
    ctx.fill();
    drawNeonGlowCircle(ctx, e * 0.4, -19, 3.2, isArchangel ? '#FF1744' : '#A855F7', 1);

    // 高耸立领
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.moveTo(-15, -36);
    ctx.lineTo(-22, -53);
    ctx.lineTo(-10, -41);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(15, -36);
    ctx.lineTo(22, -53);
    ctx.lineTo(10, -41);
    ctx.fill();
    drawNeonGlowLine(ctx, -15, -38, -20, -50, 1.6, neonEdge, 0.85, null);
    drawNeonGlowLine(ctx, 15, -38, 20, -50, 1.6, neonEdge, 0.85, null);

    // 骷髅贵族面容
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(0, -42, 15.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(0, -42, 13.6, 0, Math.PI * 2);
    ctx.fill();

    drawFacingEyePair(ctx, eyeColor, {
      y: -44,
      size: 3.4,
      halfGap: 5,
      look: isArchangel ? 'hollow' : 'glow',
    });
  };

  const drawFront = () => {
    // 贵族礼服袖爪（八向偏移）
    const hBias = facingHandBiasX(pose);
    drawCyberBox(ctx, -27 + hBias, -10, 7, 18, '#1e1b2e', NEON_INK, neonEdge, 1.2);
    drawCyberBox(ctx, 20 + hBias, -10, 7, 18, '#1e1b2e', NEON_INK, neonEdge, 1.2);
    drawNeonGlowCircle(ctx, -23.5 + hBias, 10, 2.5, eyeColor, 0.9);
    drawNeonGlowCircle(ctx, 23.5 + hBias, 10, 2.5, eyeColor, 0.9);
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });

  if (isArchangel) {
    ctx.fillStyle = '#E879F9';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('😈 黑暗大天使形态 (狂暴暗影箭雨！)', 0, -84);
  }
}

function drawBaronSilverlaine(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const pose = getActiveFacingPose();
  const isBack = isFacingBack(pose);
  const e = pose.eyeBiasX;
  const hBias = facingHandBiasX(pose);
  const wSide = pose.weaponSide;

  ctx.save();
  ctx.globalAlpha = 0.86 + Math.sin(tickCount * 0.09) * 0.1;

  const drawBack = () => {
    // 幽灵狼人脊背毛刺与灵体尾焰
    if (isBack) {
      drawNeonGlowLine(ctx, 0, -34, 0, 18, 3, '#00F5D4', 0.95);
      drawNeonGlowLine(ctx, -8, -20, -14, -10, 2, '#2DD4BF', 0.85);
      drawNeonGlowLine(ctx, 8, -20, 14, -10, 2, '#2DD4BF', 0.85);
    }
    drawNeonGlowCircle(ctx, -e * 0.5, 20, 10, '#00F5D4', 0.55, null);
  };

  const drawCore = () => {
    // 深青灵体躯干 + 霓虹青色肋骨/战甲纹
    drawCyberBox(ctx, -23, -30, 46, 56, '#062c30', NEON_INK, '#00F5D4', 1.8);
    drawCyberBox(ctx, -18, -25, 36, 13, '#0f5257', NEON_INK, '#2DD4BF', 1.4);
    for (let i = 0; i < 3; i++) {
      drawNeonGlowRect(ctx, -12, -8 + i * 7, 24, 2.2, '#00F5D4', 0.85, null);
    }

    // 狼人头颅 + 尖耳
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(0, -42, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d4f52';
    ctx.beginPath();
    ctx.arc(0, -42, 14.5, 0, Math.PI * 2);
    ctx.fill();

    // 狼耳（霓虹青边）
    ctx.fillStyle = '#0f766e';
    ctx.beginPath();
    ctx.moveTo(-13, -50);
    ctx.lineTo(-6, -64);
    ctx.lineTo(-1, -51);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(13, -50);
    ctx.lineTo(6, -64);
    ctx.lineTo(1, -51);
    ctx.fill();
    drawNeonGlowLine(ctx, -11, -52, -6, -63, 1.5, '#00F5D4', 0.9, null);
    drawNeonGlowLine(ctx, 11, -52, 6, -63, 1.5, '#00F5D4', 0.9, null);

    // 狼吻与獠牙（随 eyeBiasX 产生侧面突吻）
    if (pose.showFace) {
      drawCyberBox(ctx, -6 + e * 1.1, -41, 12, 8, '#115e59', NEON_INK);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-4 + e * 1.1, -33, 2.2, 3.4);
      ctx.fillRect(2 + e * 1.1, -33, 2.2, 3.4);
    }

    drawFacingEyePair(ctx, '#5EEAD4', { y: -46.5, size: 3.2, halfGap: 4.8, look: 'beast' });
  };

  const drawFront = () => {
    // 幽灵双利爪（主侧突出）
    const frontX = 25 * wSide + hBias;
    const rearX = -25 * wSide + hBias;
    drawCyberBox(ctx, frontX - 4, -10, 8, 22, '#0d9488', NEON_INK, '#00F5D4', 1.5);
    drawCyberBox(ctx, rearX - 3.5, -6, 7, 18, '#0f766e', NEON_INK, '#2DD4BF', 1.2);
    for (let i = -1; i <= 1; i++) {
      drawNeonGlowLine(ctx, frontX + i * 2.4, 12, frontX + i * 2.8, 21, 1.6, '#00F5D4', 1);
    }
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
  ctx.restore();
}

function drawCommanderSpringvale(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const pose = getActiveFacingPose();
  const isBack = isFacingBack(pose);
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const e = pose.eyeBiasX;

  const drawBack = () => {
    // 堕落十字军破损披风
    const cloakW = isBack ? 48 : 38;
    drawCyberBox(ctx, -cloakW / 2 - e * 0.2, -30, cloakW, 60, '#0f1f14', NEON_INK, '#39FF14', 1.6);
    if (isBack) {
      // 背面腐化十字架霓虹纹
      drawNeonGlowLine(ctx, 0, -20, 0, 14, 2.4, '#39FF14', 0.9);
      drawNeonGlowLine(ctx, -10, -10, 10, -10, 2.4, '#39FF14', 0.9);
    }
  };

  const drawCore = () => {
    // 脚下亵渎霓虹毒雾
    drawNeonGlowCircle(ctx, 0, 32, 26, '#22C55E', 0.35, null);

    // 黑铁重甲躯干 + 霓虹天灾毒绿胸甲裂纹
    drawCyberBox(ctx, -25, -30, 50, 58, '#182030', NEON_INK, '#39FF14', 1.6);
    drawCyberBox(ctx, -20, -26, 40, 15, '#0f291e', NEON_INK, '#39FF14', 1.5);
    drawNeonGlowLine(ctx, -12, -20, 12, -16, 2, '#39FF14', 0.9);

    // 巨型尖刺肩甲（魔兽大肩甲魂）
    drawCyberBox(ctx, -38, -37, 16, 22, '#273244', NEON_INK, '#39FF14', 1.6);
    drawCyberBox(ctx, 22, -37, 16, 22, '#273244', NEON_INK, '#39FF14', 1.6);
    drawCyberBox(ctx, -34, -46, 6, 9, '#64748b', NEON_INK);
    drawCyberBox(ctx, 28, -46, 6, 9, '#64748b', NEON_INK);

    // 重型铁盔
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(0, -44, 16.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, -44, 15, 0, Math.PI * 2);
    ctx.fill();

    drawFacingEyePair(ctx, '#39FF14', { y: -45, size: 3.4, halfGap: 5.5, look: 'visor' });
  };

  const drawFront = () => {
    // 副手（-wSide）：骷髅塔盾
    const shieldX = -38 * wSide + hBias;
    drawCyberBox(ctx, shieldX - 8, -16, 16, 44, '#131c2e', NEON_INK, '#39FF14', 1.6);
    drawNeonGlowCircle(ctx, shieldX, 4, 5.2, '#39FF14', 0.95, '#e2e8f0');

    // 主手（+wSide）：双手邪恶符文巨剑
    const swordX = 32 * wSide + hBias;
    drawCyberBox(ctx, swordX - 3, -42, 6, 70, '#475569', NEON_INK, '#39FF14', 1.5);
    drawNeonGlowLine(ctx, swordX, -38, swordX, 14, 2.2, '#39FF14', 1);
    drawCyberBox(ctx, swordX - 7, -10, 14, 5, '#d97706', NEON_INK);
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
}

function drawLordWalden(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const pose = getActiveFacingPose();
  const isBack = isFacingBack(pose);
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const e = pose.eyeBiasX;
  const bobY = Math.sin(tickCount * 0.16) * 2.2;

  const drawBack = () => {
    // 背面：大型赛博霓虹炼金反应罐背包
    if (isBack) {
      drawCyberBox(ctx, -16, -26, 32, 38, '#1e293b', NEON_INK, '#00F0FF', 1.6);
      drawNeonGlowRect(ctx, -11, -18, 8, 22, '#39FF14', 0.95);
      drawNeonGlowRect(ctx, 3, -18, 8, 22, '#00F0FF', 0.95);
    }
  };

  const drawCore = () => {
    // 暗褐皮围裙 + 化学背带
    drawCyberBox(ctx, -20, -28, 40, 56, '#271306', NEON_INK, '#FF5500', 1.4);
    drawCyberBox(ctx, -16, -24, 32, 38, '#451a03', NEON_INK);

    // 疯狂炼金师炸毛灰发 + 头颅
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(0, -40, 14.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(0, -40, 13, 0, Math.PI * 2);
    ctx.fill();

    drawCyberBox(ctx, -15, -49, 30, 8, '#cbd5e1', NEON_INK);
    drawCyberBox(ctx, -17, -45, 6, 12, '#cbd5e1', NEON_INK);
    drawCyberBox(ctx, 11, -45, 6, 12, '#cbd5e1', NEON_INK);

    // 赛博铜制护目镜 + 霓虹毒绿镜片
    if (pose.showFace) {
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * pose.faceAlpha;
      drawCyberBox(ctx, -9 + e, -44, 8, 7, '#ca8a04', NEON_INK);
      drawCyberBox(ctx, 1 + e, -44, 8, 7, '#ca8a04', NEON_INK);
      ctx.globalAlpha = a0;
      drawFacingEyePair(ctx, '#39FF14', { y: -42, size: 2.8, halfGap: 5, look: 'toxic' });
    }

    // 胸前高饱和三色霓虹药剂瓶背带
    if (!isBack) {
      ctx.fillStyle = NEON_INK;
      ctx.fillRect(-18, -14, 36, 6);
      const vialColors = ['#39FF14', '#FF2A55', '#00F0FF'];
      vialColors.forEach((color, i) => {
        drawNeonGlowRect(ctx, -12 + i * 10, -20, 6, 9, color, 0.95);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-11 + i * 10, -22, 4, 2);
      });
    }
  };

  const drawFront = () => {
    // 手中冒泡霓虹冰蓝烧瓶 + 上升气泡
    const fx = 28 * wSide + hBias;
    drawNeonGlowCircle(ctx, fx, -6 + bobY, 8.2, '#00F0FF', 1);
    ctx.fillStyle = NEON_INK;
    ctx.fillRect(fx - 2.5, -18 + bobY, 5, 6);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(fx - 1.5, -17 + bobY, 3, 5);

    drawNeonGlowCircle(ctx, fx, -24 + bobY, 3.2, '#00F0FF', 0.7, null);
    drawNeonGlowCircle(ctx, fx + 3 * wSide, -31 + bobY, 4.2, '#39FF14', 0.65, null);
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
}

function drawLordGodfrey(ctx: CanvasRenderingContext2D, boss: Unit, tickCount: number) {
  const pose = getActiveFacingPose();
  const isBack = isFacingBack(pose);
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const sf = pose.sideFactor;
  const e = pose.eyeBiasX;

  const drawBack = () => {
    // 酒红贵族长风衣高领 + 背面霓虹绯红镶边
    const coatW = isBack ? 46 : 42;
    drawCyberBox(ctx, -coatW / 2 - e * 0.2, -30, coatW, 60, '#2b0718', NEON_INK, '#FF2A55', 1.8);
    if (isBack) {
      drawNeonGlowLine(ctx, -12, -24, -14, 24, 1.6, '#FACC15', 0.85, null);
      drawNeonGlowLine(ctx, 12, -24, 14, 24, 1.6, '#FACC15', 0.85, null);
    }
  };

  const drawCore = () => {
    // 酒红双排扣长风衣 + 耀金纽扣
    drawCyberBox(ctx, -22, -30, 44, 58, '#3b071e', NEON_INK, '#FF2A55', 1.6);
    if (!isBack) {
      for (let i = 0; i < 4; i++) {
        drawNeonGlowRect(ctx, -6 + e * 0.3, -22 + i * 9, 3, 3, '#FACC15', 0.9);
        drawNeonGlowRect(ctx, 3 + e * 0.3, -22 + i * 9, 3, 3, '#FACC15', 0.9);
      }
    }

    // 贵族面容 + 灰白长发
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.arc(0, -42, 14.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(0, -42, 13, 0, Math.PI * 2);
    ctx.fill();
    drawCyberBox(ctx, -14, -50, 28, 8, '#cbd5e1', NEON_INK);
    drawCyberBox(ctx, -16, -46, 5, 14, '#cbd5e1', NEON_INK);
    drawCyberBox(ctx, 11, -46, 5, 14, '#cbd5e1', NEON_INK);

    // 金丝眼镜 + 冷冽反光瞳孔
    if (pose.showFace) {
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-8 + e, -44, 6, 5);
      ctx.strokeRect(2 + e, -44, 6, 5);
      drawFacingEyePair(ctx, '#FF2A55', { y: -43, size: 2.6, halfGap: 5, look: 'hollow' });
    }
  };

  const drawFront = () => {
    // 双持赛博燧发火枪（正面左右展开，侧面随 sideFactor 错位前指）
    const spread = 24 * (1 - sf * 0.35);
    const lx = -spread + hBias;
    const rx = spread + hBias;
    const gunDirL = sf > 0.5 ? wSide : -1;
    const gunDirR = sf > 0.5 ? wSide : 1;

    // 左枪
    drawCyberBox(ctx, lx - 8, -14, 16, 6, '#78350f', NEON_INK);
    drawCyberBox(ctx, lx + (gunDirL > 0 ? -4 : -14), -12, 18, 5, '#475569', NEON_INK, '#FF2A55', 1.2);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(lx - 2, -14, 4, 10);

    // 右枪
    drawCyberBox(ctx, rx - 8, -14, 16, 6, '#78350f', NEON_INK);
    drawCyberBox(ctx, rx + (gunDirR > 0 ? -4 : -14), -12, 18, 5, '#475569', NEON_INK, '#FF2A55', 1.2);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(rx - 2, -14, 4, 10);

    // 霓虹枪口火光 / 硝烟
    const shootTick = tickCount % 25;
    const muzzleL = lx + gunDirL * 16;
    const muzzleR = rx + gunDirR * 16;
    if (shootTick < 5) {
      drawNeonGlowCircle(ctx, muzzleL, -9.5, 4.5, '#FF6B00', 1);
      drawNeonGlowCircle(ctx, muzzleR, -9.5, 4.5, '#FF6B00', 1);
    } else {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.42)';
      ctx.beginPath();
      ctx.arc(muzzleL + gunDirL * shootTick * 0.4, -12 - shootTick * 0.4, 2.5 + shootTick * 0.22, 0, Math.PI * 2);
      ctx.arc(muzzleR + gunDirR * shootTick * 0.4, -12 - shootTick * 0.4, 2.5 + shootTick * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
}

// ── Dragon Soul Boss Sub-renderers (Cyber/Neon × WoW) ───────────────────────

function drawMorchok(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const floatY = Math.sin(tickCount * 0.1) * 3;
  const drawBack = () => {
    if (isFacingBack(pose)) {
      drawNeonGlowLine(ctx, 0, -28, 0, 22, 3, '#F59E0B', 0.9);
      drawNeonGlowLine(ctx, -14, -14, 14, -14, 2, '#F59E0B', 0.8);
    }
    drawCyberBox(ctx, -38, -10 + floatY, 8, 8, '#57534e', NEON_INK, '#F59E0B', 1.2);
    drawCyberBox(ctx, 30, 5 - floatY, 8, 8, '#57534e', NEON_INK, '#F59E0B', 1.2);
  };
  const drawCore = () => {
    drawCyberBox(ctx, -30, -32, 60, 64, '#1c1917', NEON_INK, '#F59E0B', 1.8);
    drawCyberBox(ctx, -24, -28, 48, 20, '#292524', NEON_INK, '#FBBF24', 1.5);
    // 晶簇双肩
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.moveTo(-28, -25); ctx.lineTo(-46, -57); ctx.lineTo(-18, -35); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(28, -25); ctx.lineTo(46, -57); ctx.lineTo(18, -35); ctx.fill();
    drawNeonGlowLine(ctx, -28, -27, -43, -53, 3.2, '#F59E0B', 1);
    drawNeonGlowLine(ctx, 28, -27, 43, -53, 3.2, '#F59E0B', 1);
    drawNeonGlowRect(ctx, -12, -15, 24, 9, '#FBBF24', 0.95);
    drawNeonGlowRect(ctx, -6, 2, 12, 12, '#F59E0B', 0.95);
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -42, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#292524';
    ctx.beginPath(); ctx.arc(0, -42, 15.5, 0, Math.PI * 2); ctx.fill();
    drawFacingEyePair(ctx, '#FBBF24', { y: -44, size: 3.6, halfGap: 5.5, look: 'glow' });
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore });
}

function drawZonozz(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const sway1 = Math.sin(tickCount * 0.1) * 8;
  const sway2 = Math.cos(tickCount * 0.1) * 8;
  const drawBack = () => {
    drawNeonGlowLine(ctx, -20, 20, -35 + sway1 * 0.5, 45, 4.5, '#7C3AED', 0.9, '#C084FC');
    drawNeonGlowLine(ctx, 20, 20, 35 - sway2 * 0.5, 45, 4.5, '#7C3AED', 0.9, '#C084FC');
    if (isFacingBack(pose)) {
      drawNeonGlowCircle(ctx, 0, -10, 8, '#C084FC', 0.8);
    }
  };
  const drawCore = () => {
    drawCyberBox(ctx, -28, -26, 56, 58, '#130f2e', NEON_INK, '#C084FC', 1.8);
    drawCyberBox(ctx, -22, -22, 44, 20, '#2e1065', NEON_INK, '#A855F7', 1.5);
    const a0 = ctx.globalAlpha;
    const fa = pose.showFace ? pose.faceAlpha : 0.14;
    ctx.globalAlpha = a0 * Math.max(0.2, fa);
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -35, 19.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0e7ff';
    ctx.beginPath(); ctx.arc(0, -35, 17.5, 0, Math.PI * 2); ctx.fill();
    const irisX = pose.eyeBiasX * 1.1 + Math.sin(tickCount * 0.05) * 2;
    drawNeonGlowCircle(ctx, irisX, -35, 9, '#FF1744', 1, '#090B14');
    ctx.globalAlpha = a0;
    drawFacingEyePair(ctx, '#E879F9', { y: -48, size: 2.6, halfGap: 14, look: 'hollow' });
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore });
}

function drawYorsahj(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const pulse = Math.sin(tickCount * 0.12) * 3;
  const drawBack = () => {
    if (isFacingBack(pose)) {
      drawNeonGlowCircle(ctx, 0, -6, 12, '#A855F7', 0.75);
    }
  };
  const drawCore = () => {
    drawCyberBox(ctx, -26, -26, 52, 56, '#090d1a', NEON_INK, '#A855F7', 1.8);
    drawNeonGlowCircle(ctx, -16, -10 + pulse, 10.5, '#39FF14', 0.95);
    drawNeonGlowCircle(ctx, 16, -10 - pulse, 10.5, '#FF2A55', 0.95);
    drawNeonGlowCircle(ctx, 0, 10 + pulse, 12, '#A855F7', 0.95);
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -38, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#18181b';
    ctx.beginPath(); ctx.arc(0, -38, 14.5, 0, Math.PI * 2); ctx.fill();
    drawFacingEyePair(ctx, '#FACC15', { y: -42, size: 3.4, halfGap: 6, look: 'cross' });
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore });
}

function drawHagara(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const drawBack = () => {
    drawCyberBox(ctx, -22, -26, 44, 54, '#0c2747', NEON_INK, '#00F0FF', 1.6);
  };
  const drawCore = () => {
    drawCyberBox(ctx, -20, -28, 40, 56, '#0f172a', NEON_INK, '#00F0FF', 1.6);
    drawCyberBox(ctx, -16, -24, 32, 14, '#0369a1', NEON_INK, '#38BDF8', 1.5);
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -38, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.arc(0, -38, 12.6, 0, Math.PI * 2); ctx.fill();
    drawFacingEyePair(ctx, '#00F0FF', { y: -40, size: 3.2, halfGap: 4.5, look: 'rune' });
  };
  const drawFront = () => {
    drawNeonGlowCircle(ctx, -28 * wSide + hBias, -12, 7 + Math.sin(tickCount * 0.2) * 1.8, '#FFE600', 1);
    const sx = 26 * wSide + hBias;
    drawCyberBox(ctx, sx - 2, -36, 4, 42, '#bae6fd', NEON_INK, '#00F0FF', 1.3);
    drawNeonGlowCircle(ctx, sx, -40, 4.5, '#00F0FF', 1);
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
}

function drawUltraxion(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const wingFlap = Math.sin(tickCount * 0.15) * 10;
  const drawBack = () => {
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.moveTo(-14, -22); ctx.quadraticCurveTo(-68 + wingFlap, -68, -84 + wingFlap, -20);
    ctx.quadraticCurveTo(-56 + wingFlap, 18, -14, 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, -22); ctx.quadraticCurveTo(68 - wingFlap, -68, 84 - wingFlap, -20);
    ctx.quadraticCurveTo(56 - wingFlap, 18, 14, 2); ctx.fill();

    ctx.fillStyle = 'rgba(88, 28, 135, 0.9)';
    ctx.beginPath();
    ctx.moveTo(-15, -20); ctx.quadraticCurveTo(-65 + wingFlap, -65, -80 + wingFlap, -20);
    ctx.quadraticCurveTo(-55 + wingFlap, 15, -15, 0); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(15, -20); ctx.quadraticCurveTo(65 - wingFlap, -65, 80 - wingFlap, -20);
    ctx.quadraticCurveTo(55 - wingFlap, 15, 15, 0); ctx.fill();

    drawNeonGlowLine(ctx, -15, -20, -68 + wingFlap, -28, 2.4, '#E879F9', 0.95);
    drawNeonGlowLine(ctx, 15, -20, 68 - wingFlap, -28, 2.4, '#E879F9', 0.95);
  };
  const drawCore = () => {
    drawCyberBox(ctx, -22, -28, 44, 58, '#1e0b38', NEON_INK, '#E879F9', 1.8);
    drawCyberBox(ctx, -16, -24, 32, 18, '#3b0764', NEON_INK, '#C084FC', 1.4);
    drawNeonGlowCircle(ctx, 0, -10, 6.5, '#E879F9', 1);
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -42, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e1b4b';
    ctx.beginPath(); ctx.arc(0, -42, 15.5, 0, Math.PI * 2); ctx.fill();
    drawNeonGlowLine(ctx, -10, -48, -24, -68, 3, '#E879F9', 0.9, '#090B14');
    drawNeonGlowLine(ctx, 10, -48, 24, -68, 3, '#E879F9', 0.9, '#090B14');
    drawFacingEyePair(ctx, '#E879F9', { y: -44, size: 3.4, halfGap: 6, look: 'toxic' });
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore });
}

function drawWarmasterBlackhorn(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const wSide = pose.weaponSide;
  const hBias = facingHandBiasX(pose);
  const drawBack = () => {
    drawCyberBox(ctx, -28, -28, 56, 56, '#27272a', NEON_INK, '#FF5500', 1.6);
  };
  const drawCore = () => {
    drawCyberBox(ctx, -26, -30, 52, 60, '#1f2937', NEON_INK, '#FF5500', 1.8);
    drawCyberBox(ctx, -20, -26, 40, 16, '#3f3f46', NEON_INK, '#FACC15', 1.4);
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -42, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#27272a';
    ctx.beginPath(); ctx.arc(0, -42, 15.5, 0, Math.PI * 2); ctx.fill();
    drawNeonGlowLine(ctx, -12, -46, -34, -44, 3.5, '#e2e8f0', 0.7, null);
    drawNeonGlowLine(ctx, 12, -46, 34, -44, 3.5, '#e2e8f0', 0.7, null);
    drawFacingEyePair(ctx, '#FF2A55', { y: -44, size: 3.4, halfGap: 5, look: 'hollow' });
  };
  const drawFront = () => {
    const hx = 28 * wSide + hBias;
    drawCyberBox(ctx, hx - 2, -45, 4, 62, '#94a3b8', NEON_INK);
    drawCyberBox(ctx, hx - 7, -49, 14, 11, '#FF2A55', NEON_INK, '#FFE600', 1.5);
    const sx = -28 * wSide + hBias;
    drawCyberBox(ctx, sx - 6, -14, 12, 34, '#3f3f46', NEON_INK, '#FF5500', 1.6);
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore, front: drawFront });
}

function drawSpineOfDeathwing(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const sway = Math.sin(tickCount * 0.18) * 6;
  drawCyberBox(ctx, -32, -32, 64, 64, '#141210', NEON_INK, '#FF6B00', 2);
  drawCyberBox(ctx, -28, -28, 56, 12, '#292524', NEON_INK);
  drawCyberBox(ctx, -28, 16, 56, 12, '#292524', NEON_INK);
  drawNeonGlowRect(ctx, -8, -26, 16, 52, '#FF6B00', 1, '#FDE047');
  drawNeonGlowLine(ctx, 0, -10, sway, -55, 6, '#FF2A55', 0.95, '#FACC15');
  drawFacingEyePair(ctx, '#FFE047', { y: -6, size: 3.6, halfGap: 11, look: 'glow' });
  if (isFacingBack(pose)) {
    drawNeonGlowRect(ctx, -18, -20, 36, 40, '#FF6B00', 0.35, null);
  }
}

function drawMadnessOfDeathwing(ctx: CanvasRenderingContext2D, tickCount: number) {
  const pose = getActiveFacingPose();
  const jawDrop = Math.sin(tickCount * 0.1) * 4;
  const drawBack = () => {
    ctx.fillStyle = NEON_INK;
    ctx.beginPath();
    ctx.moveTo(-20, -25); ctx.quadraticCurveTo(-78, -68, -88, -15);
    ctx.quadraticCurveTo(-60, 22, -15, 0); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, -25); ctx.quadraticCurveTo(78, -68, 88, -15);
    ctx.quadraticCurveTo(60, 22, 15, 0); ctx.fill();
    ctx.fillStyle = 'rgba(185, 28, 28, 0.88)';
    ctx.beginPath();
    ctx.moveTo(-20, -25); ctx.quadraticCurveTo(-75, -65, -85, -15);
    ctx.quadraticCurveTo(-60, 20, -15, 0); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, -25); ctx.quadraticCurveTo(75, -65, 85, -15);
    ctx.quadraticCurveTo(60, 20, 15, 0); ctx.fill();
    drawNeonGlowLine(ctx, -20, -20, -76, -24, 2.5, '#FF6B00', 1, '#FFE047');
    drawNeonGlowLine(ctx, 20, -20, 76, -24, 2.5, '#FF6B00', 1, '#FFE047');
  };
  const drawCore = () => {
    drawCyberBox(ctx, -28, -25, 56, 58, '#141210', NEON_INK, '#FF6B00', 2);
    drawNeonGlowRect(ctx, -6, -20, 12, 45, '#FF6B00', 1, '#FFE047');
    ctx.fillStyle = NEON_INK;
    ctx.beginPath(); ctx.arc(0, -45, 21.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#292524';
    ctx.beginPath(); ctx.arc(0, -45, 20, 0, Math.PI * 2); ctx.fill();
    drawNeonGlowLine(ctx, -12, -55, -30, -78, 4, '#FF6B00', 0.9, '#090B14');
    drawNeonGlowLine(ctx, 12, -55, 30, -78, 4, '#FF6B00', 0.9, '#090B14');
    drawCyberBox(ctx, -16, -34 + jawDrop, 32, 14, '#57534e', NEON_INK, '#94a3b8', 1.4);
    drawNeonGlowRect(ctx, -12, -30 + jawDrop, 24, 6, '#FF6B00', 1, '#FFE047');
    drawFacingEyePair(ctx, '#FFE047', { y: -48, size: 4.2, halfGap: 8, look: 'glow' });
  };
  drawEightDirLayers(pose, { back: drawBack, core: drawCore });
}

function drawBossModel(
  ctx: CanvasRenderingContext2D,
  bossUnit: Unit,
  pos: { x: number; y: number },
  isSelected: boolean,
  tickCount: number,
  isMoving = false,
  opts?: { showName?: boolean; facingRad?: number; scale?: number }
) {
  const scale = opts?.scale ?? 0.76;
  const showName = opts?.showName !== false;
  const facingRad =
    opts?.facingRad ??
    (typeof (bossUnit as { facingRad?: number }).facingRad === 'number'
      ? (bossUnit as { facingRad?: number }).facingRad!
      : Math.PI / 2);
  ctx.save();
  // Running footstep bob animation when pursuing target
  const runBob = isMoving ? Math.abs(Math.sin(tickCount * 0.35)) * 4 : 0;
  ctx.translate(pos.x, pos.y - runBob);
  if (scale !== 1) ctx.scale(scale, scale);

  // Shadow + selection ring at feet (scaled to boss volume — not a full-body circle)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  const shadowScale = isMoving ? 1 - runBob * 0.05 : 1;
  ctx.ellipse(0, 36, 48 * shadowScale, 18 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isSelected) {
    drawUnitSelectionRing(ctx, {
      y: 36,
      rx: 52 * shadowScale,
      ry: 20 * shadowScale,
      isEnemy: true,
      isBoss: true,
      tickCount,
    });
  }

  // Subtle dust puffs when boss is running
  if (isMoving && tickCount % 8 < 4) {
    ctx.fillStyle = 'rgba(180, 160, 140, 0.3)';
    ctx.beginPath();
    ctx.arc(-18, 34, 5, 0, Math.PI * 2);
    ctx.arc(18, 35, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const bId = (bossUnit.id || '').toLowerCase();
  const bossOpts: BossEightDirOpts = {
    hideHands: true,
    hideMouth: true,
    shoeColor: NEON_INK,
    backShadeAlpha: 0.08,
  };

  // 连续朝向：肩宽/深度/五官；铭牌与施法条不受姿态变换影响
  withBossEightDirFacing(ctx, facingRad, () => {
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
    } else if (drawFiveManBossModel(ctx, bossUnit, tickCount)) {
      // 死矿 / 血色 / 斯坦 / ZG：按攻略定位绘制专属外形
    } else {
      // 未知 Boss：五人剪影回落（勿误用死亡之翼）
      drawFiveManBossFallback(ctx, tickCount);
    }
  }, bossOpts);

  ctx.restore();

  // Overhead UI in unscaled upright space (aligned with drawBossHpBar at y = -84..-72,
  // so cast bar / skill hints / chasing text at y = -66..-54 never overlap the HP bar or boss head)
  ctx.save();
  ctx.translate(pos.x, pos.y);

  // Name-only overhead (when HP also on, name is drawn inside drawBossHpBar)
  if (showName) {
    const barH = 12;
    const fontPx = Math.max(7, Math.round(barH * 0.85));
    const label = `💀 ${bossUnit.name}`;
    const y = -84;
    ctx.fillStyle = '#FFE08A';
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, fontPx * 0.22);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(label, 0, y + barH / 2);
    ctx.fillText(label, 0, y + barH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  const isCasting = Boolean((bossUnit as any)?.isCasting);
  const castingSpellName = (bossUnit as any)?.castingSpellName as string | undefined;
  const overheadSkillName = ((bossUnit as any)?.overheadSkillName ||
    (isCasting ? castingSpellName : null)) as string | null | undefined;
  const castProgress = (bossUnit as any)?.castProgress || 0;

  // Cast bar: skill name centered on the bar (classic nameplate). Non-cast
  // overhead announces (e.g. 践踏) still float below HP bar when not casting.
  if (isCasting && castingSpellName) {
    const barW = 86;
    const barH = 12;
    const barY = -66;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(-barW / 2 - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = '#EAB308';
    ctx.fillRect(-barW / 2, barY, barW * Math.min(1, Math.max(0, castProgress)), barH);
    ctx.strokeStyle = '#713F12';
    ctx.lineWidth = 1;
    ctx.strokeRect(-barW / 2, barY, barW, barH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.strokeText(castingSpellName, 0, barY + barH / 2);
    ctx.fillText(castingSpellName, 0, barY + barH / 2);
    ctx.textBaseline = 'alphabetic';
  } else if (overheadSkillName) {
    ctx.fillStyle = '#FDE68A';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(overheadSkillName, 0, -58);
  } else if (isMoving) {
    ctx.fillStyle = '#F87171';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏃 追击目标中...', 0, -58);
  }

  ctx.restore();
}

// ── Class Character Drawing (Enhanced Authentic Models) ─────────────────────


/** Combat nameplate gated by display prefs (defaults: self / target / focus). */
function shouldShowCombatName(
  u: Unit,
  selectedUnitId: string | null | undefined,
  focusTargetId: string | null | undefined,
  prefs: CombatDisplayPrefs,
  localPlayerId?: string | null
): boolean {
  if (u.role !== 'ENEMY' && prefs.showAllNames) return true;
  if (u.isPlayer) return prefs.showSelfName;
  if (u.isPet && localPlayerId && u.ownerId === localPlayerId) return prefs.showSelfName;
  if (selectedUnitId && u.id === selectedUnitId) return prefs.showTargetName;
  if (focusTargetId && (u.id === focusTargetId || (focusTargetId === 'boss' && u.role === 'ENEMY'))) {
    return prefs.showFocusName;
  }
  return false;
}

function shouldShowUnitHpBar(
  u: Unit,
  selectedUnitId: string | null | undefined,
  focusTargetId: string | null | undefined,
  prefs: CombatDisplayPrefs,
  localPlayerId?: string | null
): boolean {
  if (u.role !== 'ENEMY' && prefs.showAllHp) return true;
  if (u.isPlayer) return prefs.showSelfHp;
  if (u.isPet && localPlayerId && u.ownerId === localPlayerId) return prefs.showSelfHp;
  if (selectedUnitId && u.id === selectedUnitId) return prefs.showTargetHp;
  if (focusTargetId && u.id === focusTargetId) return prefs.showFocusHp;
  return false;
}

function drawClassCharacter(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  pos: { x: number; y: number },
  isPlayer: boolean,
  isSelected: boolean,
  tickCount: number,
  idx: number,
  opts?: { scale?: number; showName?: boolean; facingRad?: number }
) {
  const scale = opts?.scale ?? 0.76;
  const showName = opts?.showName ?? true;
  const facingRad =
    opts?.facingRad ??
    (typeof (u as { facingRad?: number }).facingRad === 'number'
      ? (u as { facingRad?: number }).facingRad!
      : Math.PI / 2);
  const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  if (scale !== 1) ctx.scale(scale, scale);

  if (!isAlive) {
    // Same weathered marker as maze trash tombstones
    drawTombstoneIcon(ctx, showName ? u.name : '');
    ctx.restore();
    return;
  }

  const isMelee =
    u.role === 'TANK' ||
    u.classId === 'ROGUE' ||
    u.classId === 'WARRIOR' ||
    u.classId === 'DK' ||
    (u.classId === 'PALADIN' && u.role !== 'HEALER');
  const sway = isMelee ? Math.sin(tickCount * 0.12 + idx) * 2.2 : Math.sin(tickCount * 0.06 + idx) * 1.0;

  // Footprint scale: pets smaller, player slightly larger, normal companions mid
  const footScale = u.isPet ? 0.72 : isPlayer ? 1.15 : 1.0;
  const footY = u.isPet ? 12 : 14;
  const footRx = (u.isPet ? 11 : 16) * footScale;
  const footRy = (u.isPet ? 5 : 7) * footScale;

  // 1. Shadow underneath
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.ellipse(0, footY, footRx * 0.88, footRy * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // Selection ring at feet only (not a full-body circle)
  if (isSelected) {
    drawUnitSelectionRing(ctx, {
      y: footY,
      rx: footRx,
      ry: footRy,
      isSelf: isPlayer,
      classId: u.classId,
      role: u.role,
      facingRad,
      tickCount,
    });
  }

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
    if (showName) {
      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = '#bae6fd';
      ctx.textAlign = 'center';
      ctx.fillText(u.name, 0, 14);
    }
    ctx.restore();
    return;
  }

  // 2. Class body (continuous facing; dim ambient neon FX for unrelated teammates)
  drawClassEightDirBody(ctx, u, sway, facingRad, {
    fxIntensity: isPlayer || isSelected ? 1 : 0.25,
    tickCount,
  });

  // Name-only overhead (when HP also on, name is drawn inside drawUnitHpBar)
  if (showName) {
    const barH = 10;
    const fontPx = Math.max(7, Math.round(barH * 0.85));
    const label = isPlayer ? `★ ${u.name}` : u.name;
    const y = u.isPet ? -22 : -34;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, fontPx * 0.22);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.strokeText(label, 0, y + barH / 2);
    ctx.fillText(label, 0, y + barH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}

/** Fit label into bar width; font height tracks barH. */
function fitNameplateLabel(
  ctx: CanvasRenderingContext2D,
  raw: string,
  maxWidth: number,
  fontPx: number
): string {
  ctx.font = `bold ${fontPx}px sans-serif`;
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s.length < raw.length ? s + '…' : s;
}

function drawNameInsideBar(
  ctx: CanvasRenderingContext2D,
  label: string,
  barW: number,
  barH: number,
  y: number,
  color = '#FFFFFF'
) {
  const fontPx = Math.max(6, Math.round(barH * 0.85 * 0.9)); // 血条内名字小 10%
  const text = fitNameplateLabel(ctx, label, barW - 4, fontPx);
  ctx.fillStyle = color;
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, fontPx * 0.22);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeText(text, 0, y + barH / 2);
  ctx.fillText(text, 0, y + barH / 2);
  ctx.textBaseline = 'alphabetic';
}

/** Name-only plate above head (same anchor as HP bar). */
function drawOverheadNameOnly(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  label: string,
  opts?: { scale?: number; color?: string; barW?: number; barH?: number; y?: number }
) {
  const scale = opts?.scale ?? 1;
  const barW = (opts?.barW ?? 48) * scale;
  const barH = (opts?.barH ?? 10) * scale;
  const y = (opts?.y ?? -34) * scale;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  drawNameInsideBar(ctx, label, barW, barH, y, opts?.color ?? '#FFFFFF');
  ctx.restore();
}

/** Friendly / pet HP bar — above head; optional name drawn inside the bar. */
function drawUnitHpBar(
  ctx: CanvasRenderingContext2D,
  u: Unit,
  pos: { x: number; y: number },
  opts?: { scale?: number; name?: string | null }
) {
  if (!((u.isAlive ?? u.alive) && u.hp > 0)) return;
  const scale = opts?.scale ?? 1;
  const classColor = CLASS_COLORS[u.classId as any] || '#888';
  const hpPct = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)));
  const hasName = !!(opts?.name && opts.name.trim());
  const barW = (u.isPet ? (hasName ? 36 : 24) : hasName ? 52 : 32) * scale;
  const barH = (u.isPet ? (hasName ? 8 : 3) : hasName ? 10 : 4) * scale;
  const y = (u.isPet ? -22 : -34) * scale;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(-barW / 2 - 1, y - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-barW / 2, y, barW, barH);
  ctx.fillStyle = classColor;
  ctx.fillRect(-barW / 2, y, barW * hpPct, barH);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-barW / 2, y, barW, barH);
  if (hasName) {
    const label = u.isPlayer ? `★ ${opts!.name}` : opts!.name!;
    drawNameInsideBar(ctx, label, barW, barH, y);
  }
  ctx.restore();
}

/** Boss HP bar — bright red plate above model; optional name inside. */
function drawBossHpBar(
  ctx: CanvasRenderingContext2D,
  boss: Unit,
  pos: { x: number; y: number },
  opts?: { name?: string | null }
) {
  if (!((boss.isAlive ?? boss.alive) && boss.hp > 0)) return;
  const hpPct = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
  const hasName = !!(opts?.name && opts.name.trim());
  const barW = hasName ? 110 : 88;
  const barH = hasName ? 12 : 7;
  const y = -84;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(-barW / 2 - 1.5, y - 1.5, barW + 3, barH + 3);
  ctx.fillStyle = '#2a0000';
  ctx.fillRect(-barW / 2, y, barW, barH);
  ctx.fillStyle = '#FF1A1A';
  ctx.fillRect(-barW / 2, y, barW * hpPct, barH);
  ctx.fillStyle = 'rgba(255, 120, 120, 0.45)';
  ctx.fillRect(-barW / 2, y, barW * hpPct, Math.max(2, barH * 0.35));
  ctx.strokeStyle = '#7F0000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-barW / 2, y, barW, barH);
  if (hasName) {
    drawNameInsideBar(ctx, `💀 ${opts!.name}`, barW, barH, y, '#FFE08A');
  }
  ctx.restore();
}

/** Draw summoned combat add / tentacle / barrier model on canvas. */
function drawEnemyAddModel(
  ctx: CanvasRenderingContext2D,
  add: Unit,
  pos: { x: number; y: number },
  isSelected: boolean,
  tickCount: number,
  opts?: { showName?: boolean }
) {
  ctx.save();
  ctx.translate(pos.x, pos.y);

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 13, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isSelected) {
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 2, 17, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const sid = add.summonSpellId || '';
  const uid = add.id || '';
  const uname = add.name || '';
  const sway = Math.sin(tickCount * 0.14 + pos.x * 0.05) * 2.5;

  // 约萨希血滴：按颜色绘制对应软泥怪（红/绿/黄/蓝/紫/黑）
  const bloodColorMatch =
    sid.startsWith('yorsahj_blood_')
      ? sid.slice('yorsahj_blood_'.length)
      : uid.startsWith('blood_')
        ? uid.split('_')[1]
        : uname.includes('血红')
          ? 'red'
          : uname.includes('酸绿')
            ? 'green'
            : uname.includes('暗黄')
              ? 'yellow'
              : uname.includes('钴蓝')
                ? 'blue'
                : uname.includes('暗紫')
                  ? 'purple'
                  : uname.includes('深黑')
                    ? 'black'
                    : null;

  if (bloodColorMatch) {
    const BLOOD_PALETTE: Record<string, { fill: string; stroke: string; glow: string }> = {
      red: { fill: '#EF4444', stroke: '#FECACA', glow: '#FCA5A5' },
      green: { fill: '#22C55E', stroke: '#BBF7D0', glow: '#86EFAC' },
      yellow: { fill: '#EAB308', stroke: '#FEF08A', glow: '#FDE047' },
      blue: { fill: '#3B82F6', stroke: '#BFDBFE', glow: '#93C5FD' },
      purple: { fill: '#A855F7', stroke: '#E9D5FF', glow: '#D8B4FE' },
      black: { fill: '#18181B', stroke: '#94A3B8', glow: '#475569' },
    };
    const pal = BLOOD_PALETTE[bloodColorMatch] || BLOOD_PALETTE.red;
    const squish = Math.sin(tickCount * 0.18 + pos.x * 0.05) * 1.5;
    // Slime body
    ctx.fillStyle = pal.fill;
    ctx.beginPath();
    ctx.moveTo(-12 - squish * 0.5, 2);
    ctx.quadraticCurveTo(-11, -15 + squish, 0, -17 + squish);
    ctx.quadraticCurveTo(11, -15 + squish, 12 + squish * 0.5, 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // Highlight / bubble
    ctx.fillStyle = pal.glow;
    ctx.beginPath();
    ctx.arc(-3, -9 + squish * 0.5, 2.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (
    sid.includes('bloodvenom') ||
    sid.includes('tentacle') ||
    sid.includes('limb') ||
    sid.includes('corruption')
  ) {
    // 触须类：紫红扭曲触须 + 毒光核心
    ctx.fillStyle = sid.includes('bloodvenom') ? '#6B21A8' : '#7F1D1D';
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.quadraticCurveTo(-5 + sway, -14, sway * 1.4, -24);
    ctx.quadraticCurveTo(6 + sway, -14, 7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = sid.includes('bloodvenom') ? '#A3E635' : '#F87171';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = sid.includes('bloodvenom') ? '#BEF264' : '#FCA5A5';
    ctx.beginPath();
    ctx.arc(sway * 0.8, -14, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (sid.includes('barrier') || sid.includes('crystal') || sid.includes('ice_tomb')) {
    // 水晶/屏障类
    ctx.fillStyle = sid.includes('ice') ? '#38BDF8' : '#A855F7';
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(10, -10);
    ctx.lineTo(6, 2);
    ctx.lineTo(-6, 2);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#F3E8FF';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    // 常规召唤小怪（食尸鬼/僵尸/骷髅/豹/狂战士等）
    ctx.fillStyle = '#450A0A';
    ctx.beginPath();
    ctx.arc(0, -10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Glowing red eyes
    ctx.fillStyle = '#FCA5A5';
    ctx.fillRect(-4, -13, 2.5, 2.5);
    ctx.fillRect(1.5, -13, 2.5, 2.5);
  }

  if (opts?.showName) {
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(add.name, 1, -29);
    ctx.fillStyle = '#FCA5A5';
    ctx.fillText(add.name, 0, -30);
  }
  ctx.restore();
}

/** Compact red HP plate for summoned adds; optional name inside. */
function drawEnemyAddHpBar(
  ctx: CanvasRenderingContext2D,
  add: Unit,
  pos: { x: number; y: number },
  opts?: { name?: string | null }
) {
  if (!((add.isAlive ?? add.alive) && add.hp > 0)) return;
  const hpPct = Math.max(0, Math.min(1, add.hp / Math.max(1, add.maxHp)));
  const hasName = !!(opts?.name && opts.name.trim());
  const barW = hasName ? 68 : 48;
  const barH = hasName ? 10 : 5;
  const y = -36;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(-barW / 2 - 1, y - 1, barW + 2, barH + 2);
  ctx.fillStyle = '#2a0000';
  ctx.fillRect(-barW / 2, y, barW, barH);
  ctx.fillStyle = '#EF4444';
  ctx.fillRect(-barW / 2, y, barW * hpPct, barH);
  ctx.strokeStyle = '#7F1D1D';
  ctx.lineWidth = 1;
  ctx.strokeRect(-barW / 2, y, barW, barH);
  if (hasName) {
    drawNameInsideBar(ctx, opts!.name!, barW, barH, y, '#FECACA');
  }
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

function makeTrashMob(
  partial: Omit<TrashMob, 'baseX' | 'baseY' | 'visualHp' | 'isDead' | 'isTombstone' | 'dissipateAlpha' | 'hp' | 'isEncounter'> & {
    maxHp: number;
    isEncounter?: boolean;
  }
): TrashMob {
  return {
    ...partial,
    isEncounter: partial.isEncounter !== false,
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

/** Shared tombstone icon (maze trash + combat deaths). Base 0.3, +30%→0.39, +20%→0.468. */
const TOMBSTONE_DRAW_SCALE = 0.468;

function drawTombstoneIcon(
  ctx: CanvasRenderingContext2D,
  name: string,
  scale: number = TOMBSTONE_DRAW_SCALE
) {
  ctx.save();
  ctx.scale(scale, scale);

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
  ctx.fillText(name.length > 6 ? `${name.slice(0, 5)}…` : name, 0, 22);
  ctx.restore();
}

function drawTrashTombstone(ctx: CanvasRenderingContext2D, mob: TrashMob, showName = true) {
  drawTombstoneIcon(ctx, showName ? mob.name : '');
}

function drawTrashMob(
  ctx: CanvasRenderingContext2D,
  mob: TrashMob,
  tickCount: number,
  is20Man: boolean,
  opts?: { scale?: number; showName?: boolean; isSelected?: boolean }
) {
  const scale = opts?.scale ?? 1;
  const showName = opts?.showName ?? true;
  if (mob.isDead && !mob.isTombstone && mob.dissipateAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, mob.isTombstone ? 1 : mob.dissipateAlpha));
  ctx.translate(mob.x, mob.y);
  if (scale !== 1) ctx.scale(scale, scale);

  if (mob.isTombstone || (mob.isDead && mob.hp <= 0)) {
    drawTrashTombstone(ctx, mob, showName);
    ctx.restore();
    return;
  }

  // 1. Ground Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 14, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (opts?.isSelected) {
    drawUnitSelectionRing(ctx, {
      y: 14,
      rx: 20,
      ry: 8,
      isEnemy: true,
      tickCount,
    });
  }

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
    case 'DEFIAS_MINER': {
      ctx.fillStyle = '#44403c';
      ctx.fillRect(-10, -12, 20, 24);
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(-8, -10, 16, 10);
      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.arc(0, -16, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-7, -18, 14, 3);
      ctx.fillStyle = '#78716c';
      ctx.fillRect(8, -6, 4, 16);
      break;
    }
    case 'GOBLIN_TECH': {
      ctx.fillStyle = '#365314';
      ctx.fillRect(-9, -10, 18, 20);
      ctx.fillStyle = '#84cc16';
      ctx.fillRect(-7, -8, 14, 10);
      ctx.fillStyle = '#14532d';
      ctx.beginPath();
      ctx.arc(0, -14, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-4, -15, 3, 2);
      ctx.fillRect(1, -15, 3, 2);
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(10, -8, 4 + Math.sin(tickCount * 0.25), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'SCARLET_FOOTMAN': {
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-10, -14, 20, 26);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-8, -12, 16, 10);
      ctx.fillStyle = '#450a0a';
      ctx.beginPath();
      ctx.arc(0, -18, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-3, -20, 6, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(9, -18, 3, 28);
      break;
    }
    case 'SCARLET_ACOLYTE': {
      ctx.fillStyle = '#881337';
      ctx.fillRect(-9, -12, 18, 24);
      ctx.fillStyle = '#fecaca';
      ctx.fillRect(-7, -10, 14, 12);
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.arc(0, -16, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(8, -26, 3, 32);
      const orb = Math.sin(tickCount * 0.2) * 1.5;
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(9.5, -28, 4 + orb, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'SCOURGE_ABOM': {
      ctx.fillStyle = '#3f6212';
      ctx.fillRect(-14, -14, 28, 28);
      ctx.fillStyle = '#65a30d';
      ctx.fillRect(-11, -10, 22, 14);
      ctx.fillStyle = '#1a2e05';
      ctx.beginPath();
      ctx.arc(-4, -18, 7, 0, Math.PI * 2);
      ctx.arc(5, -16, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.fillRect(-6, -18, 2, 2);
      ctx.fillRect(4, -16, 2, 2);
      break;
    }
    case 'GARGOYLE_SENTRY': {
      const wing = Math.sin(tickCount * 0.18) * 4;
      ctx.fillStyle = '#57534e';
      ctx.beginPath();
      ctx.moveTo(-16 - wing, -18);
      ctx.lineTo(-4, -6);
      ctx.lineTo(-12, 4);
      ctx.moveTo(16 + wing, -18);
      ctx.lineTo(4, -6);
      ctx.lineTo(12, 4);
      ctx.fill();
      ctx.fillStyle = '#44403c';
      ctx.fillRect(-8, -10, 16, 20);
      ctx.fillStyle = '#292524';
      ctx.beginPath();
      ctx.arc(0, -14, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-3, -14, 6, 2);
      break;
    }
    case 'TROLL_BERSERKER': {
      ctx.fillStyle = '#166534';
      ctx.fillRect(-11, -14, 22, 26);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(-9, -12, 18, 12);
      ctx.fillStyle = '#14532d';
      ctx.beginPath();
      ctx.arc(0, -18, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.beginPath();
      ctx.moveTo(-6, -24);
      ctx.lineTo(-3, -32);
      ctx.lineTo(0, -24);
      ctx.moveTo(2, -24);
      ctx.lineTo(5, -32);
      ctx.lineTo(8, -24);
      ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.fillRect(9, -20, 3, 30);
      break;
    }
    case 'VENOM_WARLOCK': {
      ctx.fillStyle = '#365314';
      ctx.fillRect(-9, -12, 18, 24);
      ctx.fillStyle = '#4d7c0f';
      ctx.fillRect(-7, -10, 14, 14);
      ctx.fillStyle = '#1a2e05';
      ctx.beginPath();
      ctx.arc(0, -16, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#84cc16';
      ctx.fillRect(8, -28, 3, 34);
      const drip = Math.sin(tickCount * 0.22) * 2;
      ctx.fillStyle = '#a3e635';
      ctx.beginPath();
      ctx.arc(9.5, -30 + drip, 4, 0, Math.PI * 2);
      ctx.fill();
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
  if (showName) {
    ctx.fillStyle = is20Man ? '#e879f9' : '#f87171';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(mob.name, 0, -41);
  }

  // Overhead HP Numbers
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.ceil(mob.hp)}`, 0, -30);

  ctx.restore();
}

/**
 * 全屏石质大殿地面：战术网格铺满整张画布，无中间矩形框/区域约束。
 */
/** Boss-room décor in fixed top-down world coords (canvas 780×360). */
const ARENA_ROOM_CX = 390;
const ARENA_ROOM_CY = 180;
const ARENA_ROOM_PILLARS = [
  { x: 50, y: 38 },
  { x: 730, y: 38 },
  { x: 50, y: 322 },
  { x: 730, y: 322 },
] as const;

/**
 * Arena floor in *world* space — call AFTER applyCanvasViewTransform.
 * Grid yaw/pitch-deforms with the ground; rune rings stay at room center (not player).
 */
function drawArenaFloorWorld(
  ctx: CanvasRenderingContext2D,
  cam: ViewCamera,
  canvasW: number,
  canvasH: number
) {
  const aabb = worldAabbCoveringCanvas(cam, canvasW, canvasH, 96);
  const { minX, minY, maxX, maxY } = aabb;
  const span = Math.max(maxX - minX, maxY - minY, 1);

  // 1. Floor fill + highlight at fixed room center
  const floorGrad = ctx.createRadialGradient(
    ARENA_ROOM_CX,
    ARENA_ROOM_CY,
    40,
    ARENA_ROOM_CX,
    ARENA_ROOM_CY,
    span * 0.55
  );
  floorGrad.addColorStop(0, '#15152a');
  floorGrad.addColorStop(0.55, '#111122');
  floorGrad.addColorStop(1, '#080812');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

  // 2. Fine tactical grid (30px world)
  const x0 = Math.floor(minX / 30) * 30;
  const y0 = Math.floor(minY / 30) * 30;
  ctx.strokeStyle = '#1c1c38';
  ctx.lineWidth = 1;
  for (let x = x0; x <= maxX; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
    ctx.stroke();
  }
  for (let y = y0; y <= maxY; y += 30) {
    ctx.beginPath();
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
    ctx.stroke();
  }

  // 3. Major tile seams every 90px
  const x0m = Math.floor(minX / 90) * 90;
  const y0m = Math.floor(minY / 90) * 90;
  ctx.strokeStyle = '#141428';
  ctx.lineWidth = 1.25;
  for (let x = x0m; x <= maxX; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
    ctx.stroke();
  }
  for (let y = y0m; y <= maxY; y += 90) {
    ctx.beginPath();
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
    ctx.stroke();
  }

  // 4. Rune rings at fixed room center — independent of camera pivot / player
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ARENA_ROOM_CX, ARENA_ROOM_CY, 68, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ARENA_ROOM_CX, ARENA_ROOM_CY, 74, 0, Math.PI * 2);
  ctx.stroke();

  // 5. Pillars at fixed room corners
  for (const p of ARENA_ROOM_PILLARS) {
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
}

/** Screen-space vignette (after enterScreenSpaceFromIso, or before ISO transform). */
function drawArenaVignetteScreen(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
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

/** Cached seamless tile pattern for maze outer cavern / rock texture */
const mazeFloorPatternCache = new Map<string, CanvasPattern | null>();

function getOrCreateMazeRockPattern(
  ctx: CanvasRenderingContext2D,
  theme: { id?: string; ambienceColor?: string; wallColor?: string; floorColor?: string; pathAccent?: string } | null | undefined,
  is20Man: boolean
): CanvasPattern | null {
  const wallColor = theme?.wallColor || (is20Man ? '#1c0b10' : '#121324');
  const ambienceColor = theme?.ambienceColor || (is20Man ? '#110508' : '#080814');
  const key = `${theme?.id || (is20Man ? '20m' : '5m')}|${wallColor}|${ambienceColor}`;
  if (mazeFloorPatternCache.has(key)) {
    return mazeFloorPatternCache.get(key) ?? null;
  }

  const size = 140;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;

  // Base matches maze wallColor so outer region blends seamlessly with maze walls
  tctx.fillStyle = wallColor;
  tctx.fillRect(0, 0, size, size);

  // Subtle deterministic rock strata / cobblestone blocks
  let s = 1337;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  for (let i = 0; i < 28; i++) {
    const rx = rand() * size;
    const ry = rand() * size;
    const rw = 16 + rand() * 26;
    const rh = 12 + rand() * 20;
    tctx.fillStyle = rand() > 0.5 ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.03)';
    // Draw wrapped for seamless tiling
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        tctx.beginPath();
        tctx.ellipse(rx + ox, ry + oy, rw * 0.5, rh * 0.5, rand() * Math.PI, 0, Math.PI * 2);
        tctx.fill();
      }
    }
  }

  const pattern = ctx.createPattern(tile, 'repeat');
  mazeFloorPatternCache.set(key, pattern);
  return pattern;
}

/**
 * Maze / Cavern floor in *world* space — drawn after applyCanvasViewTransform.
 * Uses GPU-accelerated seamless maze rock pattern across the entire 2.5D frustum AABB,
 * eliminating per-frame grid line loops and completely hiding outer canvas boundaries.
 */
function drawMazeCavernFloorWorld(
  ctx: CanvasRenderingContext2D,
  cam: ViewCamera,
  canvasW: number,
  canvasH: number,
  theme: { id?: string; ambienceColor?: string; wallColor?: string; floorColor?: string; pathAccent?: string } | null | undefined,
  is20Man: boolean
) {
  // Pad 420px ensures full coverage even at min pitch (20°) and min zoom (0.5)
  const aabb = worldAabbCoveringCanvas(cam, canvasW, canvasH, 420);
  const { minX, minY, maxX, maxY } = aabb;
  const w = maxX - minX;
  const h = maxY - minY;

  const pattern = getOrCreateMazeRockPattern(ctx, theme, is20Man);
  ctx.fillStyle = pattern || theme?.wallColor || (is20Man ? '#1c0b10' : '#121324');
  ctx.fillRect(minX, minY, w, h);
}

/**
 * Subtle screen-space radial vignette for maze cavern.
 */
function drawMazeCavernVignetteScreen(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.48,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.85
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(2, 2, 6, 0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Balanced movement speed constants:
 * - Boss chase speed: 2.8
 * - AI companion follow speed: 2.4
 * - Player combat move speed: 3.0 (balanced with boss speed, slightly faster for kiting/mechanics)
 * - Player maze traversal speed: 3.0 * MAZE_TRAVERSE_SPEED_SCALE
 */
const PLAYER_COMBAT_MOVE_SPEED = 3.0;
const PLAYER_MAZE_MOVE_SPEED = PLAYER_COMBAT_MOVE_SPEED * MAZE_TRAVERSE_SPEED_SCALE;

/** Canvas view zoom: default 1, clamped to ±50%. */
const CANVAS_VIEW_ZOOM_DEFAULT = 1;
const CANVAS_VIEW_ZOOM_MIN = CANVAS_VIEW_ZOOM_DEFAULT * 0.5;
const CANVAS_VIEW_ZOOM_MAX = CANVAS_VIEW_ZOOM_DEFAULT * 1.5;
const CANVAS_VIEW_ZOOM_STEP = 0.08;

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
  focusTargetId = null,
  dungeonTier = '5man',
  dungeonId,
  targetBossName = '首领',
  currentBossIndex = 0,
  travelRemainingMs,
  totalTravelMs = 7000,
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
  syncRemotePositions = false,
  isNetworkGuest = false,
  onNetworkMoveReport,
  autoNavActive = true,
  onAutoNavChange,
  combatDisplayPrefs = null,
  enemyUnits,
}) => {
  const displayPrefs = resolveCombatDisplayPrefs(combatDisplayPrefs);
  const displayPrefsRef = useRef(displayPrefs);
  displayPrefsRef.current = displayPrefs;
  const runPhaseRef = useRef(runPhase);
  runPhaseRef.current = runPhase;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewZoomRef = useRef(CANVAS_VIEW_ZOOM_DEFAULT);
  /** ISO-only local yaw (radians) + pitch deg from horizontal. Never synced. */
  const viewYawRadRef = useRef(0);
  const viewPitchDegRef = useRef(ISO_PITCH_DEG_DEFAULT);
  const orbitDragRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    yawAtStart: number;
    pitchDegAtStart: number;
    movedPx: number;
  } | null>(null);

  // Dynamic Positions (Centered in the 60% battle rectangle)
  const playerPosRef = useRef<{ x: number; y: number }>({ x: 230, y: 180 });
  const mouseCanvasPosRef = useRef<{ x: number; y: number } | null>(null);

  // Drop orbit when leaving ISO pref, or while maze locks top-down
  useEffect(() => {
    if (displayPrefs.canvasViewMode !== 'ISO') {
      viewYawRadRef.current = 0;
      viewPitchDegRef.current = ISO_PITCH_DEG_DEFAULT;
      orbitDragRef.current = null;
      isMouseChordMovingRef.current = false;
      isRmbHeldRef.current = false;
      isLmbHeldRef.current = false;
    }
  }, [displayPrefs.canvasViewMode]);

  useEffect(() => {
    if (runPhase === 'TRAVEL_RECOVERY') {
      orbitDragRef.current = null;
      isMouseChordMovingRef.current = false;
      isRmbHeldRef.current = false;
      isLmbHeldRef.current = false;
    }
  }, [runPhase]);

  /** Allow ISO (2.5D) in all run phases including maze travel. */
  const isIsoViewAllowed = () =>
    displayPrefsRef.current.canvasViewMode === 'ISO';

  const getViewCamera = (width: number, height: number): ViewCamera => {
    const mode = isIsoViewAllowed() ? 'ISO' : 'TOPDOWN';
    let screenX = width / 2;
    let screenY = height / 2;
    let zoom = viewZoomRef.current;
    if (runPhaseRef.current === 'TRAVEL_RECOVERY') {
      const layout = mazeLayoutRef.current;
      if (layout) {
        const { originX, originY, mazeW, mazeH } = getMazeDrawOrigin(layout, width, height);
        screenX = originX + mazeW / 2;
        screenY = originY + mazeH / 2;
      } else {
        screenX = width / 2;
        screenY = (MAZE_HUD_SAFE_INSETS.top + (height - MAZE_HUD_SAFE_INSETS.bottom)) / 2;
      }
    }
    if (mode === 'TOPDOWN') {
      return {
        mode: 'TOPDOWN',
        yawRad: 0,
        pivotX: screenX,
        pivotY: screenY,
        screenX,
        screenY,
        zoom,
      };
    }
    const pivot = playerPosRef.current;
    return {
      mode: 'ISO',
      yawRad: viewYawRadRef.current,
      pivotX: pivot.x,
      pivotY: pivot.y,
      screenX: width / 2,
      screenY: height / 2,
      pitchSin: pitchDegToSin(viewPitchDegRef.current),
      zoom,
    };
  };

  /** ISO/TOPDOWN: upright billboard at projected feet; sprite scales with view zoom. */
  const withUprightAt = (
    ctx: CanvasRenderingContext2D,
    cam: ViewCamera,
    worldPos: { x: number; y: number },
    draw: (screenPos: { x: number; y: number }) => void
  ) => {
    const screenPos = worldToView(worldPos.x, worldPos.y, cam);
    const zoom = cam.zoom && cam.zoom > 0 ? cam.zoom : 1;
    enterScreenSpaceFromIso(ctx, cam);
    if (Math.abs(zoom - 1) >= 1e-6) {
      ctx.translate(screenPos.x, screenPos.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-screenPos.x, -screenPos.y);
    }
    draw(screenPos);
    ctx.restore();
  };

  const clientToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sx = (clientX - rect.left) * scaleX;
    const sy = (clientY - rect.top) * scaleY;
    return viewToWorld(sx, sy, getViewCamera(canvas.width, canvas.height));
  };
  const bossPosRef = useRef<{ x: number; y: number }>({ x: 500, y: 180 });
  const lastBossIdRef = useRef<string | null>(null);
  const isBossMovingRef = useRef<boolean>(false);
  /** Boss 上一帧移动方向（用于朝向：移动中用移动方向） */
  const bossMoveDirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** 玩家 / AI 移动方向（八向建模） */
  const playerMoveDirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const lastPlayerPosForFacingRef = useRef<{ x: number; y: number } | null>(null);
  const unitMoveDirRef = useRef<Record<string, { dx: number; dy: number }>>({});
  const companionPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  /** AI 多动症：站桩计时 + 单次小幅踱步偏移（限制在走路区内且 ≤5 码） */
  const companionFidgetRef = useRef<Record<string, {
    idleMs: number;
    activeUntil: number;
    ox: number;
    oy: number;
    lastX: number;
    lastY: number;
  }>>({});
  const keysPressedRef = useRef<Set<string>>(new Set());

  // Mouse chord movement (2.5D boss room: hold RMB + press LMB = walk forward like 'W')
  const isMouseChordMovingRef = useRef<boolean>(false);
  const isRmbHeldRef = useRef<boolean>(false);
  const isLmbHeldRef = useRef<boolean>(false);
  const suppressNextClickRef = useRef<boolean>(false);
  const lastChordMoveEndMsRef = useRef<number>(0);

  // Mouse Click-to-Move & Auto-Pathfinding in Maze
  const clickTargetRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const autoNavActiveRef = useRef<boolean>(autoNavActive);
  autoNavActiveRef.current = autoNavActive;
  const onAutoNavChangeRef = useRef(onAutoNavChange);
  onAutoNavChangeRef.current = onAutoNavChange;
  const setAutoNav = (active: boolean) => {
    autoNavActiveRef.current = active;
    onAutoNavChangeRef.current?.(active);
  };
  const mazeLeadDistRef = useRef<number>(0);

  // Approach pull animation timer — start poses captured so march ends on combat spots
  const approachElapsedRef = useRef<number>(0);
  const approachStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const approachPullFiredRef = useRef(false);
  /** Fire portal→boss transition once per travel segment (avoid spam / double snap). */
  const portalEnterFiredRef = useRef(false);
  const prevCanvasPhaseRef = useRef<string | null>(null);
  const pullShoutRef = useRef<string | null>(null);

  // FX references
  /** Fill-only AoE rings (instant + persistent), multi-stack via alpha */
  const aoeRingsRef = useRef<AoeRingState[]>([]);
  const aoeSeenActionIdsRef = useRef<Set<string>>(new Set());
  const pendingAoeActionsRef = useRef<any[]>([]);
  /** Instant AoE class-color feathered pulse (above terrain rings, below boss) */
  const classAoePulsesRef = useRef<ClassAoePulseState>(createClassAoePulseState());
  const classAoePulseSeenIdsRef = useRef<Set<string>>(new Set());
  const hitFxRef = useRef<HitFxState>(createHitFxState());
  const hitFxSeenIdsRef = useRef<Set<string>>(new Set());

  // Diablo Dungeon Exploration: Corridor Trash Mobs State Machine
  const resolveDungeonId = useCallback(() => {
    if (dungeonId) return dungeonId;
    return dungeonTier === '20man' ? 'dragon_soul' : 'shadowfang_keep';
  }, [dungeonId, dungeonTier]);

  const mazeLayoutRef = useRef<MazeLayout | null>(null);
  /** Offscreen pre-rendered canvas cache for maze cloud walls & floor path */
  const mazeWallCanvasCacheRef = useRef<{
    seed: number;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
  } | null>(null);
  /** Cached wall candle positions per maze seed & canvas dimensions */
  const mazeCandleSitesCacheRef = useRef<{
    seed: number;
    width: number;
    height: number;
    is20Man: boolean;
    sites: Array<{ x: number; y: number }>;
  } | null>(null);

  // Live props for the RAF loop — travelRemainingMs was previously closed over stale
  // values (not in effect deps), so elapsed froze until a restart then jumped:
  // full-HP trash → instant tombstones, and party teleports on encounter.
  const travelRemainingMsRef = useRef(travelRemainingMs);
  const totalTravelMsRef = useRef(totalTravelMs);
  const isNetworkGuestRef = useRef(isNetworkGuest);
  const enemyUnitsRef = useRef<Unit[]>(enemyUnits || []);
  const dungeonTierRef = useRef(dungeonTier);
  const runPhaseLiveRef = useRef(runPhase);
  travelRemainingMsRef.current = travelRemainingMs;
  totalTravelMsRef.current = totalTravelMs;
  isNetworkGuestRef.current = isNetworkGuest;
  enemyUnitsRef.current = enemyUnits || [];
  dungeonTierRef.current = dungeonTier;
  runPhaseLiveRef.current = runPhase;

  /** High-frequency props kept in a ref so the 60fps RAF loop is never torn down per tick */
  const livePropsRef = useRef({
    units,
    bossUnit,
    bossTargetId,
    groundEffects,
    floatingTexts,
    screenShake,
    selectedUnitId,
    focusTargetId,
    onPlayerMove,
    onCancelCast,
    onApproachComplete,
    onFastForwardTravel,
    revivingUnitId,
    reviveProgress,
    autoApproachTarget,
    onApproachTargetReached,
    isCorpseRunning,
    corpseRunRemainingMs,
    groundTargetState,
    syncRemotePositions,
    onNetworkMoveReport,
  });
  livePropsRef.current = {
    units,
    bossUnit,
    bossTargetId,
    groundEffects,
    floatingTexts,
    screenShake,
    selectedUnitId,
    focusTargetId,
    onPlayerMove,
    onCancelCast,
    onApproachComplete,
    onFastForwardTravel,
    revivingUnitId,
    reviveProgress,
    autoApproachTarget,
    onApproachTargetReached,
    isCorpseRunning,
    corpseRunRemainingMs,
    groundTargetState,
    syncRemotePositions,
    onNetworkMoveReport,
  };

  /** Sub-tick interpolation state for travelRemainingMs so maze march is 60fps smooth */
  const lastRemSnapshotRef = useRef<{ rem: number; atPerfMs: number }>({ rem: -1, atPerfMs: 0 });

  /** Accumulators for maze trash DPS (stable cadence, not re-rolled every frame). */
  const mazeDpsAccMsRef = useRef(0);
  const mazeDpsNextMsRef = useRef(50);
  const mazeRetaliateAccMsRef = useRef(0);
  const mazeHealAccMsRef = useRef(0);

  const refreshMazeLayout = useCallback((): MazeLayout => {
    const did = resolveDungeonId();
    const stage = typeof currentBossIndex === 'number' ? currentBossIndex : 0;
    // Match canvas logical size (780×360) — mismatched 800×400 caused exit-path clamp twitch
    const layout = getMazeLayoutSync(did, stage);
    mazeLayoutRef.current = layout;
    // Best-effort server persist / fetch (async)
    void ensureMazeLayout(did, stage).then((remote) => {
      if (remote && remote.seed === layout.seed) mazeLayoutRef.current = remote;
    });
    return layout;
  }, [resolveDungeonId, currentBossIndex]);

  const initTrashMobs = useCallback((): TrashMob[] => {
    const layout = refreshMazeLayout();
    const { getPoint, totalLen } = computePathGeometry(layout.waypoints);
    const specs = trashSpawnsToMobs(layout.trashSpawns, getPoint, totalLen);
    return specs.map((s) =>
      makeTrashMob({
        id: s.id,
        name: s.name,
        mobModel: s.mobModel as TrashMob['mobModel'],
        packIndex: s.packIndex,
        isEncounter: s.isEncounter,
        distAlongMaze: s.distAlongMaze,
        x: s.x,
        y: s.y,
        maxHp: s.maxHp,
      })
    );
  }, [refreshMazeLayout]);

  const trashMobsRef = useRef<TrashMob[]>(initTrashMobs());
  const lastDungeonTierRef = useRef<string>(dungeonTier);
  const lastTargetBossRef = useRef<string>(targetBossName);
  /** Tracks phase for maze refresh — re-entering TRAVEL must revive trash (no leftover tombstones). */
  const lastPhaseForTrashResetRef = useRef<string | null>(null);
  /** Last travel elapsed used to detect clock rewind on new dungeon segment */
  const lastTravelElapsedRef = useRef<number>(0);
  const isEncounteringRef = useRef<boolean>(false);
  const currentEncounterPackRef = useRef<number>(0);
  const encounterTimerMsRef = useRef<number>(0);
  const encounterSCTRef = useRef<EncounterSCTItem[]>([]);
  /** Elapsed-ms when each pack was fully tombstoned — keeps early-clear march smooth. */
  const packClearedAtElapsedRef = useRef<Record<number, number | null>>({ 1: null, 2: null, 3: null });

  // Room / local AoE ring pulses (host emit + guest COMBAT_STATE.recentActions)
  useEffect(() => {
    const onActions = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      const actions = detail?.actions;
      if (!Array.isArray(actions) || actions.length === 0) return;
      pendingAoeActionsRef.current.push(...actions);

      const storeState = useGameStore.getState();
      const liveUnits = storeState.units;
      const selfUnitId = storeState.playerUnitId;
      const selfUnit = selfUnitId ? liveUnits.find((u) => u.id === selfUnitId) : undefined;
      const listenerPos = selfUnit?.position ?? null;
      const bossPos = bossPosRef?.current ?? null;

      for (const act of actions) {
        const actorId: string = act.actorId ?? '';
        const isSelf = !!selfUnitId && actorId === selfUnitId;
        const isSelfHealTarget =
          !!selfUnitId && act.targetId === selfUnitId && act.visualTone === 'HEAL';
        const isBoss = actorId === 'boss' || actorId.startsWith('boss') || act.visualTone === 'ENEMY';
        const role: SfxActorRole = isSelf || isSelfHealTarget ? 'self' : isBoss ? 'boss' : 'other';

        let actorPos = act.x != null && act.y != null ? { x: act.x, y: act.y } : null;
        if (!actorPos) {
          if (isBoss && bossPos) {
            actorPos = bossPos;
          } else {
            const u = liveUnits.find((unit) => unit.id === actorId);
            if (u?.position) actorPos = u.position;
          }
        }

        let kind: SfxEventKind = 'spell_hit';
        if (act.kind === 'CAST_START') {
          kind = isBoss ? 'boss_cast' : 'cast_start';
        } else if (act.kind === 'MELEE' || act.spellId === 'auto_attack') {
          kind = 'melee';
        } else if (act.visualTone === 'HEAL') {
          kind = 'heal';
        }

        // Play raid buff stinger for party/raid-wide buff spells (爪子/奥术光辉/韧/王者/嗜血等)
        const spText = `${act.spellId ?? ''} ${act.spellName ?? ''}`.toLowerCase();
        if (
          act.visualTone === 'FRIENDLY' &&
          /mark_of_the_wild|arcane_brilliance|power_word_fortitude|blessing_of_kings|blessing_of_might|bloodlust|heroism|time_warp|野性印记|奥术光辉|真言术：韧|王者|嗜血|英勇/.test(
            spText
          )
        ) {
          playRaidBuffSfx();
        }

        playCombatSfx({
          kind,
          school: inferSpellSchool(act.spellId, act.spellName),
          role,
          actorPos,
          listenerPos,
          actorId,
        });
      }
    };
    window.addEventListener('cata_combat_actions', onActions as EventListener);
    return () => window.removeEventListener('cata_combat_actions', onActions as EventListener);
  }, []);

  // Play heal chime when local player receives healing (direct heals, HoTs, AoE heals)
  const seenSelfHealFctIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!floatingTexts || floatingTexts.length === 0) return;
    const storeState = useGameStore.getState();
    const selfId = storeState.playerUnitId;
    if (!selfId) return;
    const seen = seenSelfHealFctIdsRef.current;
    let shouldPlay = false;
    for (const fct of floatingTexts) {
      if (seen.has(fct.id)) continue;
      seen.add(fct.id);
      if (fct.category === 'HEAL' && (fct.targetId === selfId || fct.isToPlayer)) {
        shouldPlay = true;
      }
    }
    if (seen.size > 400) {
      seen.clear();
      for (const fct of floatingTexts) seen.add(fct.id);
    }
    if (shouldPlay) {
      playCombatSfx({
        kind: 'heal',
        school: 'nature',
        role: 'self',
        actorId: `recv_heal_${selfId}`,
      });
    }
  }, [floatingTexts]);

  // Keyboard listeners for WASD & Arrow Keys (Alt+1~5 / Tab hostile targeting live in App)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
        // Pressing WASD turns off auto-pathfinding and click-to-move in combat (maze is always auto-nav)
        if (runPhaseRef.current !== 'TRAVEL_RECOVERY') {
          setAutoNav(false);
          clickTargetRef.current = null;
          if (onPlayerMove) onPlayerMove();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysPressedRef.current.delete(key);
    };

    const handleBlur = () => {
      keysPressedRef.current.clear();
      isMouseChordMovingRef.current = false;
      isRmbHeldRef.current = false;
      isLmbHeldRef.current = false;
      orbitDragRef.current = null;
    };

    const handleWindowMouseDown = (e: MouseEvent) => {
      // Top-down: RMB cancels ground target. ISO uses canvas pointer handlers instead.
      if (e.button === 2 && groundTargetState && !isIsoViewAllowed()) {
        if (onCancelGroundTarget) onCancelGroundTarget();
      }
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        isLmbHeldRef.current = false;
        if (isMouseChordMovingRef.current) {
          isMouseChordMovingRef.current = false;
          lastChordMoveEndMsRef.current = Date.now();
          suppressNextClickRef.current = true;
        }
      } else if (e.button === 2) {
        isRmbHeldRef.current = false;
        if (isMouseChordMovingRef.current) {
          isMouseChordMovingRef.current = false;
          lastChordMoveEndMsRef.current = Date.now();
          suppressNextClickRef.current = true;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('mousedown', handleWindowMouseDown);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('mousedown', handleWindowMouseDown);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [units, onSelectUnit, groundTargetState, onCancelGroundTarget]);

  const updatePointerView = (clientX: number, clientY: number, buttons?: number) => {
    // Store WORLD coords so reticle/logic stay correct under ISO view transform
    mouseCanvasPosRef.current = clientToWorld(clientX, clientY);
    const drag = orbitDragRef.current;
    const rmbHeld = drag?.active || isRmbHeldRef.current || ((buttons ?? 0) & 2) !== 0;
    const lmbHeld = isLmbHeldRef.current || ((buttons ?? 0) & 1) !== 0;

    if (isIsoViewAllowed()) {
      if (rmbHeld && lmbHeld) {
        if (!isMouseChordMovingRef.current) {
          isMouseChordMovingRef.current = true;
          suppressNextClickRef.current = true;
          if (drag) drag.movedPx = Math.max(drag.movedPx, 999);
          setAutoNav(false);
          clickTargetRef.current = null;
          if (onPlayerMove) onPlayerMove();
        }
      } else if (isMouseChordMovingRef.current && (!rmbHeld || !lmbHeld)) {
        isMouseChordMovingRef.current = false;
        lastChordMoveEndMsRef.current = Date.now();
        suppressNextClickRef.current = true;
      }

      if (rmbHeld && drag) {
        const dx = clientX - drag.startClientX;
        const dy = clientY - drag.startClientY;
        drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy));
        // Horizontal → yaw; vertical → pitch (20°↔90°). Sens from prefs (±50% of 1.0).
        const orbitSens = displayPrefsRef.current.isoOrbitSensitivity || 1;
        const pitchSens = displayPrefsRef.current.isoPitchSensitivity || 1;
        // Drag right → yaw positive (mirrored from prior sign)
        viewYawRadRef.current =
          drag.yawAtStart + dx * orbitRadiansPerPixel(ISO_ORBIT_PX_PER_TURN) * orbitSens;
        viewPitchDegRef.current = pitchDegFromOrbitDrag(
          drag.pitchDegAtStart,
          dy * pitchSens
        );
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    updatePointerView(e.clientX, e.clientY, e.buttons);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    updatePointerView(e.clientX, e.clientY, e.buttons);
  };

  const handleCanvasMouseLeave = () => {
    mouseCanvasPosRef.current = null;
  };

  // Mouse wheel zooms the view camera (±50%); textures stay screen-fixed / full-bleed
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Wheel up (deltaY < 0) → zoom in; wheel down → zoom out
      const dir = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
      if (!dir) return;
      const z = viewZoomRef.current + dir * CANVAS_VIEW_ZOOM_STEP;
      viewZoomRef.current = Math.min(
        CANVAS_VIEW_ZOOM_MAX,
        Math.max(CANVAS_VIEW_ZOOM_MIN, z)
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Always absorb right-click so the browser context menu never appears over combat.
    e.preventDefault();
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) {
      isRmbHeldRef.current = true;
      e.preventDefault();
      if (!isIsoViewAllowed()) {
        // Top-down / maze: right-click still cancels ground targeting (no orbit)
        if (groundTargetState && onCancelGroundTarget) onCancelGroundTarget();
        return;
      }
      orbitDragRef.current = {
        active: true,
        startClientX: e.clientX,
        startClientY: e.clientY,
        yawAtStart: viewYawRadRef.current,
        pitchDegAtStart: viewPitchDegRef.current,
        movedPx: 0,
      };
      try {
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      } catch {}

      // If LMB is already down when RMB is pressed (or buttons has LMB):
      if (isIsoViewAllowed() && (isLmbHeldRef.current || (e.buttons & 1) !== 0)) {
        if (runPhaseRef.current !== 'TRAVEL_RECOVERY') {
          isMouseChordMovingRef.current = true;
          setAutoNav(false);
          clickTargetRef.current = null;
          if (onPlayerMove) onPlayerMove();
        }
        suppressNextClickRef.current = true;
        orbitDragRef.current.movedPx = 999;
      }
      return;
    }

    if (e.button === 0) {
      isLmbHeldRef.current = true;
      const rmbHeld = isRmbHeldRef.current || orbitDragRef.current?.active || (e.buttons & 2) !== 0;
      if (isIsoViewAllowed() && rmbHeld) {
        if (runPhaseRef.current !== 'TRAVEL_RECOVERY') {
          isMouseChordMovingRef.current = true;
          setAutoNav(false);
          clickTargetRef.current = null;
          if (onPlayerMove) onPlayerMove();
        }
        suppressNextClickRef.current = true;
        if (orbitDragRef.current) {
          orbitDragRef.current.movedPx = Math.max(orbitDragRef.current.movedPx, 999);
        }
        e.preventDefault();
        return;
      }
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 0) {
      isLmbHeldRef.current = false;
      if (isMouseChordMovingRef.current) {
        isMouseChordMovingRef.current = false;
        lastChordMoveEndMsRef.current = Date.now();
        suppressNextClickRef.current = true;
        e.preventDefault();
      }
      return;
    }

    if (e.button === 2) {
      isRmbHeldRef.current = false;
      if (isMouseChordMovingRef.current) {
        isMouseChordMovingRef.current = false;
        lastChordMoveEndMsRef.current = Date.now();
        suppressNextClickRef.current = true;
      }
      const drag = orbitDragRef.current;
      orbitDragRef.current = null;
      try {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {}
      // Short click with almost no drag → cancel ground target (ISO & top-down via other path)
      if (
        isIsoViewAllowed() &&
        groundTargetState &&
        onCancelGroundTarget &&
        (!drag || drag.movedPx < 8)
      ) {
        onCancelGroundTarget();
      }
      return;
    }
  };

  // Single-click on canvas (Map Interaction):
  // - Click on unit or boss: directly select/target that unit
  // - Click on empty ground: navigate/walk player to clicked position
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressNextClickRef.current || Date.now() - lastChordMoveEndMsRef.current < 250) {
      suppressNextClickRef.current = false;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x: clickX, y: clickY } = clientToWorld(e.clientX, e.clientY);

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

    // 1.5 Direct Target Selection: Click on Summoned Add
    if (runPhase !== 'TRAVEL_RECOVERY') {
      for (const add of enemyUnitsRef.current) {
        if (bossUnit && add.id === bossUnit.id) continue;
        if (!(add.alive ?? add.isAlive) || add.hp <= 0 || !add.position) continue;
        if (Math.hypot(clickX - add.position.x, clickY - add.position.y) <= 26) {
          handleSelectOrFocus(add.id);
          clickTargetRef.current = null;
          return;
        }
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

    // 3. Direct Target Selection: Click on AI Companion (图腾单位不可选)
    for (const u of units) {
      if (u.isPlayer || isTotemUnit(u)) continue;
      const pos = companionPositionsRef.current[u.id];
      if (pos && Math.hypot(clickX - pos.x, clickY - pos.y) <= 28) {
        handleSelectOrFocus(u.id);
        clickTargetRef.current = null;
        return;
      }
    }

    // Click-to-move is disabled inside all dungeon phases (use WASD / chord move in combat; auto-march in maze)
  };

  // Double-click on canvas: Select unit or Boss
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x: clickX, y: clickY } = clientToWorld(e.clientX, e.clientY);

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

    // 3. Double click on AI Companions (图腾单位不可选)
    for (const u of units) {
      if (u.isPlayer || isTotemUnit(u)) continue;
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
      packClearedAtElapsedRef.current = { 1: null, 2: null, 3: null };
      mazeLeadDistRef.current = 0;
      lastTravelElapsedRef.current = 0;
      mazeDpsAccMsRef.current = 0;
      mazeDpsNextMsRef.current = 50;
      mazeRetaliateAccMsRef.current = 0;
      mazeHealAccMsRef.current = 0;
      const startWp = (mazeLayoutRef.current || refreshMazeLayout()).waypoints[0] || { x: 60, y: 80 };
      playerPosRef.current = { x: startWp.x, y: startWp.y };
      companionPositionsRef.current = {};
      companionFidgetRef.current = {};
      aoeRingsRef.current = [];
      classAoePulsesRef.current = createClassAoePulseState();
      hitFxRef.current = createHitFxState();
      pendingAoeActionsRef.current = [];
    }

    const render = () => {
      tickCount++;
      const {
        units,
        bossUnit,
        bossTargetId,
        groundEffects,
        floatingTexts,
        screenShake,
        selectedUnitId,
        focusTargetId,
        onPlayerMove,
        onCancelCast,
        onApproachComplete,
        onFastForwardTravel,
        revivingUnitId,
        reviveProgress,
        autoApproachTarget,
        onApproachTargetReached,
        isCorpseRunning,
        corpseRunRemainingMs,
        groundTargetState,
        syncRemotePositions,
        onNetworkMoveReport,
      } = livePropsRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const prefs = displayPrefsRef.current;
      const localPlayerId = units.find((u) => u.isPlayer)?.id ?? null;
      const hitFxFilter = {
        showFriendlyProjectiles: prefs.showFriendlyProjectiles,
        showFriendlySlash: prefs.showFriendlySlash,
        showEnemyProjectiles: prefs.showEnemyProjectiles,
        showEnemySlash: prefs.showEnemySlash,
      };
      const showAoeTone = (tone: string) => {
        if (tone === 'HEAL') return prefs.showHealTerrain;
        if (tone === 'FRIENDLY') return prefs.showBuffTerrain;
        return prefs.showDamageTerrain;
      };

      // Entering PULL_APPROACH: always reset march clock (skip-travel can bypass TRAVEL frames)
      if (runPhase === 'PULL_APPROACH' && prevCanvasPhaseRef.current !== 'PULL_APPROACH') {
        approachElapsedRef.current = 0;
        approachPullFiredRef.current = false;
        approachStartPositionsRef.current = {};
      }
      if (runPhase === 'TRAVEL_RECOVERY' && prevCanvasPhaseRef.current !== 'TRAVEL_RECOVERY') {
        portalEnterFiredRef.current = false;
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

      // Arena floor is drawn in world space under the view transform (yaw/pitch).
      // Maze ambience stays screen-fixed (TOPDOWN-locked). Pivot = player feet in ISO.
      const viewCam = getViewCamera(width, height);

      // Check dead members in party
      const deadMembers = units.filter(u => (!u.alive && !u.isAlive) || u.hp <= 0);
      const hasDeadMembers = deadMembers.length > 0;

      // ── Process Player Movement: WASD Hold / Click-to-Move / Maze Auto-Pathfinding ──
      const keys = keysPressedRef.current;
      let moveX = 0;
      let moveY = 0;
      const isChordMove =
        runPhase !== 'TRAVEL_RECOVERY' && isIsoViewAllowed() && isMouseChordMovingRef.current;
      if (runPhase !== 'TRAVEL_RECOVERY') {
        if (keys.has('w') || keys.has('arrowup') || isChordMove) moveY -= 1;
        if (keys.has('s') || keys.has('arrowdown')) moveY += 1;
        if (keys.has('a') || keys.has('arrowleft')) moveX -= 1;
        if (keys.has('d') || keys.has('arrowright')) moveX += 1;
      }

      // Lock movement if dead, stunned/rooted (moveSpeedMod === 0), or if in travel phase with dead members waiting for resurrection
      const pUnit = units.find(u => u.isPlayer);
      const isPlayerAlive = !!(pUnit && (pUnit.isAlive ?? pUnit.alive) && pUnit.hp > 0);
      const moveSpeedMult = getUnitMoveSpeedMultiplier(pUnit);
      const canMove = !(runPhase === 'TRAVEL_RECOVERY' && hasDeadMembers) && isPlayerAlive && moveSpeedMult > 0;
      if (moveSpeedMult <= 0 && (moveX !== 0 || moveY !== 0)) {
        clickTargetRef.current = null;
      }

      // ── Dungeon Labyrinth Corridors (Different Mazes per Dungeon Tier) ──
      const is20Man = dungeonTierRef.current === '20man';
      /** 20 人本战斗：人物 / 小怪精灵统一 70% 体积 */
      const combatSpriteScale = is20Man ? 0.7 : 1;
      const isNetworkGuestLive = isNetworkGuestRef.current;
      const mazeLayout = mazeLayoutRef.current || refreshMazeLayout();
      const mazeWaypoints = mazeLayout.waypoints.length
        ? mazeLayout.waypoints
        : is20Man
          ? DRAGON_SOUL_WAYPOINTS
          : SHADOWFANG_WAYPOINTS;
      const mazeTheme = mazeLayout.theme;
      const mazeGeometry = computePathGeometry(mazeWaypoints);
      const { segLens, totalLen: totalMazeLen, getPoint: getPointAlongMaze } = mazeGeometry;

      // ── Synchronized Timeline Calculation (with 60fps sub-tick interpolation) ──
      const totalTProp = totalTravelMsRef.current;
      const totalT = totalTProp && totalTProp > 0 ? totalTProp : (is20Man ? 14000 : 7000);
      const remProp = travelRemainingMsRef.current;
      const rawRem = remProp !== undefined ? remProp : totalT;
      const nowPerf = performance.now();
      if (lastRemSnapshotRef.current.rem !== rawRem) {
        lastRemSnapshotRef.current = { rem: rawRem, atPerfMs: nowPerf };
      }
      // Smoothly interpolate remaining time between discrete engine ticks (up to 250ms span)
      const subTickDelta =
        runPhase === 'TRAVEL_RECOVERY' && rawRem > 0 && rawRem < totalT
          ? Math.min(250, Math.max(0, nowPerf - lastRemSnapshotRef.current.atPerfMs))
          : 0;
      const rem = Math.max(0, rawRem - subTickDelta);
      const elapsed = Math.max(0, Math.min(totalT, totalT - rem));

      // New dungeon / wipe-retry: travel clock rewound → hard-reset trash (drop prior tombstones)
      if (runPhase === 'TRAVEL_RECOVERY' && elapsed + 400 < lastTravelElapsedRef.current) {
        trashMobsRef.current = initTrashMobs();
        packClearedAtElapsedRef.current = { 1: null, 2: null, 3: null };
        mazeLeadDistRef.current = 0;
        mazeDpsAccMsRef.current = 0;
        mazeDpsNextMsRef.current = 50;
        mazeRetaliateAccMsRef.current = 0;
        mazeHealAccMsRef.current = 0;
      }
      lastTravelElapsedRef.current = elapsed;

      // Guest: mirror host trash + lead BEFORE packStillAlive / draw decisions
      if (isNetworkGuestLive) {
        const guestMaze = readGuestMazeSync();
        if (guestMaze) {
          if (typeof guestMaze.mazeLeadDist === 'number') {
            // Soft follow host lead (avoid guest-side teleport when snapshot jumps)
            const cur = mazeLeadDistRef.current;
            const want = guestMaze.mazeLeadDist;
            const d = want - cur;
            const step = Math.max(3.8 * MAZE_TRAVERSE_SPEED_SCALE, Math.abs(d) * 0.28 * MAZE_TRAVERSE_SPEED_SCALE);
            mazeLeadDistRef.current =
              Math.abs(d) <= step ? want : cur + Math.sign(d) * step;
          }
          if (guestMaze.mazeTrash?.length) {
            const byId = new Map(guestMaze.mazeTrash.map((x) => [x.id, x]));
            for (const mob of trashMobsRef.current) {
              const sn = byId.get(mob.id);
              if (!sn) continue;
              mob.hp = sn.hp;
              mob.maxHp = sn.maxHp;
              // Keep visualHp lagging so bars chip smoothly (don't snap to snapshot)
              if (sn.isDead || sn.isTombstone) mob.visualHp = 0;
              mob.isDead = sn.isDead;
              mob.isTombstone = sn.isTombstone;
              if (typeof sn.dissipateAlpha === 'number') mob.dissipateAlpha = sn.dissipateAlpha;
            }
          }
          // Merge host maze floating numbers by id
          if (guestMaze.sctEvents?.length) {
            const seen = new Set(encounterSCTRef.current.map((s) => s.id));
            for (const ev of guestMaze.sctEvents) {
              if (!ev?.id || seen.has(ev.id)) continue;
              seen.add(ev.id);
              encounterSCTRef.current.push({
                id: ev.id,
                text: ev.text,
                x: ev.x,
                y: ev.y,
                color: ev.color,
                createdAt: ev.createdAt || Date.now(),
                isCrit: !!ev.isCrit,
              });
            }
          }
        }
      }

      // Prim 迷宫：场景可刷 ≥6 堆，时间线只打 isEncounter 的 2–3 堆
      const encounterPackIndices = [
        ...new Set(
          mazeLayout.trashSpawns
            .filter((s) => s.isEncounter !== false)
            .map((s) => s.packIndex)
        ),
      ].sort((a, b) => a - b);
      const fallbackEncounterCount = Math.max(0, mazeLayout.packCount ?? 0);
      const encounterList =
        encounterPackIndices.length > 0
          ? encounterPackIndices
          : Array.from({ length: fallbackEncounterCount }, (_, i) => i + 1);
      const packCount = encounterList.length;
      const packWindows = encounterList.map((packIndex, i) => {
        const pathT =
          mazeLayout.trashSpawns.find((s) => s.packIndex === packIndex && s.isEncounter !== false)
            ?.pathT ??
          mazeLayout.trashSpawns.find((s) => s.packIndex === packIndex)?.pathT ??
          ((i + 1) / (packCount + 1)) * 0.85 + 0.08;
        const stopDist = Math.max(0, totalMazeLen * pathT - 48);
        const segStart = packCount > 0 ? (i / packCount) * 0.88 * totalT : 0;
        const segEnd = packCount > 0 ? ((i + 1) / packCount) * 0.88 * totalT : 0;
        const segLen = Math.max(1, segEnd - segStart);
        return {
          packIndex,
          stopDist,
          // 打怪更快：更早开战、更早清完
          fightStart: segStart + segLen * 0.22,
          forceKillAt: segStart + segLen * 0.58,
          clearAt: segEnd,
        };
      });
      const exitSprintStart = 0.9 * totalT;

      const packStillAlive = (packIndex: number) =>
        trashMobsRef.current.some(
          (m) => m.isEncounter && m.packIndex === packIndex && !m.isDead && !m.isTombstone
        );

      if (elapsed < (packWindows[0]?.fightStart ?? 0)) {
        for (const p of encounterList) packClearedAtElapsedRef.current[p] = null;
      } else {
        for (const w of packWindows) {
          if (
            elapsed >= w.fightStart &&
            !packStillAlive(w.packIndex) &&
            packClearedAtElapsedRef.current[w.packIndex] == null
          ) {
            packClearedAtElapsedRef.current[w.packIndex] = elapsed;
          }
        }
      }

      let targetLeadDist = 0;
      let currentEncounterPack = 0;

      if (elapsed >= totalT) {
        targetLeadDist = totalMazeLen;
      } else {
        let handled = false;
        for (let i = 0; i < packWindows.length; i++) {
          const w = packWindows[i];
          const prevStop = i === 0 ? 0 : packWindows[i - 1].stopDist;
          // Final cleared segment runs continuously to totalT so targetLeadDist never snaps backward at exitSprintStart
          const nextFight = i + 1 < packWindows.length ? packWindows[i + 1].fightStart : totalT;
          if (elapsed < w.fightStart) {
            const marchStart = i === 0 ? 0 : packWindows[i - 1].clearAt;
            const denom = Math.max(1, w.fightStart - marchStart);
            const ratio = Math.max(0, Math.min(1, (elapsed - marchStart) / denom));
            targetLeadDist = prevStop + ratio * (w.stopDist - prevStop);
            handled = true;
            break;
          }
          if (packStillAlive(w.packIndex)) {
            targetLeadDist = w.stopDist;
            currentEncounterPack = w.packIndex;
            handled = true;
            break;
          }
          // cleared — march toward next stop / exit until next fight window
          if (elapsed < nextFight) {
            const marchT0 = packClearedAtElapsedRef.current[w.packIndex] ?? w.clearAt;
            const nextStop =
              i + 1 < packWindows.length ? packWindows[i + 1].stopDist : totalMazeLen;
            const denom = Math.max(1, nextFight - marchT0);
            const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
            targetLeadDist = w.stopDist + ratio * (nextStop - w.stopDist);
            handled = true;
            break;
          }
        }
        if (!handled) {
          if (packWindows.length === 0) {
            // 无遭遇：全程赶路到出口
            targetLeadDist = totalMazeLen * Math.min(1, elapsed / Math.max(1, totalT));
          } else {
            const last = packWindows[packWindows.length - 1];
            const marchT0 = packClearedAtElapsedRef.current[last.packIndex] ?? last.clearAt;
            const denom = Math.max(1, totalT - marchT0);
            const ratio = Math.max(0, Math.min(1, (elapsed - marchT0) / denom));
            targetLeadDist = last.stopDist + ratio * (totalMazeLen - last.stopDist);
          }
        }
      }

      isEncounteringRef.current = currentEncounterPack > 0;
      currentEncounterPackRef.current = currentEncounterPack;

      // Host/solo: revive before fight / soft deadline kill. Guests only mirror host trash.
      // Ambient (non-encounter) packs stay as scenery and are never force-killed.
      if (!isNetworkGuestLive) {
        trashMobsRef.current.forEach((mob) => {
          if (!mob.isEncounter) return;
          const win = packWindows.find((w) => w.packIndex === mob.packIndex);
          if (!win) return;
          const fightStart = win.fightStart;
          const forceKillAt = win.forceKillAt;
          if (elapsed < fightStart) {
            mob.hp = mob.maxHp;
            mob.visualHp = mob.maxHp;
            mob.isDead = false;
            mob.isTombstone = false;
            mob.dissipateAlpha = 1.0;
            mob.x = mob.baseX;
            mob.y = mob.baseY;
          } else if (!mob.isDead && !mob.isTombstone && elapsed >= fightStart) {
            // Timeline floor: HP must visibly drain toward 0 by forceKillAt (never full→tombstone)
            const span = Math.max(1, forceKillAt - fightStart);
            const t = Math.max(0, Math.min(1.05, (elapsed - fightStart) / span));
            const floorHp = Math.max(0, Math.round(mob.maxHp * (1 - t)));
            if (mob.hp > floorHp) mob.hp = floorHp;
            if (elapsed >= forceKillAt || mob.hp <= 0) {
              killTrashMobAsTombstone(mob);
            } else if (currentEncounterPack === mob.packIndex) {
              const bob = Math.sin(tickCount * 0.12 + mob.baseX * 0.05) * 2.2;
              const sway = Math.cos(tickCount * 0.09 + mob.baseY * 0.04) * 1.6;
              mob.x = mob.baseX + sway;
              mob.y = mob.baseY + bob;
            }
          }
        });
      } else {
        trashMobsRef.current.forEach((mob) => {
          if (!mob.isEncounter) return;
          if (!mob.isDead && currentEncounterPack === mob.packIndex) {
            const bob = Math.sin(tickCount * 0.12 + mob.baseX * 0.05) * 2.2;
            const sway = Math.cos(tickCount * 0.09 + mob.baseY * 0.04) * 1.6;
            mob.x = mob.baseX + sway;
            mob.y = mob.baseY + bob;
          }
        });
      }

      // Discrete party ↔ trash combat (chip HP + light return damage). No auto-fade corpses.
      // Publish happens AFTER this block so guests see chipped HP, not only tombstones.
      if (currentEncounterPack > 0) {
        const activePackMobs = trashMobsRef.current.filter(
          m =>
            m.isEncounter &&
            m.packIndex === currentEncounterPack &&
            !m.isDead &&
            !m.isTombstone
        );
        const livingAllies = units.filter(u => (u.isAlive ?? u.alive) && u.hp > 0);

        // Maze combat cadence scaled with path width so fight windows still clear in targetTravelMs
        const frameMs = 16;
        mazeDpsAccMsRef.current += frameMs;
        mazeRetaliateAccMsRef.current += frameMs;
        mazeHealAccMsRef.current += frameMs;

        if (!isNetworkGuestLive && activePackMobs.length > 0 && mazeDpsAccMsRef.current >= mazeDpsNextMsRef.current) {
          mazeDpsAccMsRef.current = 0;
          const dpsGap = Math.round((50 + Math.floor(Math.random() * 50)) / MAZE_TRAVERSE_SPEED_SCALE);
          mazeDpsNextMsRef.current = Math.max(28, dpsGap);
          const targetMob = activePackMobs[Math.floor(Math.random() * activePackMobs.length)];
          const isCrit = Math.random() > 0.55;
          const burst = Math.random() < 0.18 ? 1.55 + Math.random() * 0.7 : 0.65 + Math.random() * 0.9;
          const baseHit = is20Man
            ? (isCrit ? 13000 + Math.random() * 7000 : 7000 + Math.random() * 4000)
            : (isCrit ? 7500 + Math.random() * 4000 : 4000 + Math.random() * 2300);
          const dmg = Math.round(baseHit * burst);
          targetMob.hp = Math.max(0, targetMob.hp - dmg);

          // Maze hit FX share combatHitFx (class color / boss dark red; ≤12×12, scale 0.5)
          const meleeCaster = units.find(
            (u) =>
              (u.isAlive ?? u.alive) &&
              (u.classId === 'ROGUE' ||
                u.classId === 'DK' ||
                u.classId === 'WARRIOR' ||
                (u.classId === 'PALADIN' && u.role === 'DPS'))
          );
          const rangedCaster = units.find(
            (u) =>
              (u.isAlive ?? u.alive) &&
              (u.classId === 'MAGE' ||
                u.classId === 'SHAMAN' ||
                u.classId === 'DRUID' ||
                u.classId === 'HUNTER' ||
                u.classId === 'WARLOCK' ||
                u.classId === 'PRIEST')
          );
          if (meleeCaster && Math.random() > 0.4) {
            const mPos = meleeCaster.isPlayer
              ? playerPosRef.current
              : companionPositionsRef.current[meleeCaster.id] || meleeCaster.position || {
                  x: targetMob.x - 20,
                  y: targetMob.y,
                };
            const hand = meleeHandPose(mPos, { x: targetMob.x, y: targetMob.y }, combatSpriteScale);
            spawnHitSlash(hitFxRef.current, {
              x: hand.x,
              y: hand.y,
              angle: hand.angle,
              color: CLASS_COLORS[meleeCaster.classId as keyof typeof CLASS_COLORS] || '#EF4444',
              scale: combatSpriteScale,
            });
          } else if (rangedCaster) {
            const cPos = rangedCaster.isPlayer
              ? playerPosRef.current
              : companionPositionsRef.current[rangedCaster.id] || playerPosRef.current;
            spawnHitProjectile(hitFxRef.current, {
              fromX: cPos.x,
              fromY: cPos.y,
              toX: targetMob.x,
              toY: targetMob.y,
              classId: rangedCaster.classId,
              scale: combatSpriteScale,
            });
          } else {
            const fallbackFrom = playerPosRef.current;
            const hand = meleeHandPose(fallbackFrom, { x: targetMob.x, y: targetMob.y }, combatSpriteScale);
            spawnHitSlash(hitFxRef.current, {
              x: hand.x,
              y: hand.y,
              angle: hand.angle,
              color: isCrit ? '#FACC15' : '#EF4444',
              scale: combatSpriteScale,
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
        if (!isNetworkGuestLive && activePackMobs.length > 0 && livingAllies.length > 0 && mazeRetaliateAccMsRef.current >= Math.round(130 / MAZE_TRAVERSE_SPEED_SCALE)) {
          mazeRetaliateAccMsRef.current = 0;
          const attacker = activePackMobs[Math.floor(Math.random() * activePackMobs.length)];
          const tank = livingAllies.find(u => u.role === 'TANK');
          // 坦克优先吃伤害；迷宫环节永不致死
          const victim =
            tank && Math.random() < 0.78
              ? tank
              : livingAllies[Math.floor(Math.random() * livingAllies.length)];
          const spike = Math.random() < 0.22 ? 1.8 + Math.random() : 0.55 + Math.random() * 1.1;
          const hit = Math.round(
            (is20Man
              ? 900 + Math.random() * 1400
              : 550 + Math.random() * 900) * spike
          );
          const floorHp = Math.max(1, Math.round(victim.maxHp * 0.22));
          const applied = Math.min(hit, Math.max(0, victim.hp - floorHp));
          if (applied > 0) {
            victim.hp = Math.max(floorHp, victim.hp - applied);
            const vPos = victim.isPlayer
              ? playerPosRef.current
              : companionPositionsRef.current[victim.id] || {
                  x: victim.position?.x ?? attacker.x - 40,
                  y: victim.position?.y ?? attacker.y,
                };

            // Trash return: dark-red hit FX (same combatHitFx pipeline)
            if (
              attacker.mobModel === 'SHADOW_CHANNELER' ||
              attacker.mobModel === 'TWILIGHT_VOIDWEAVER' ||
              attacker.mobModel === 'SCARLET_ACOLYTE' ||
              attacker.mobModel === 'VENOM_WARLOCK' ||
              attacker.mobModel === 'GOBLIN_TECH'
            ) {
              spawnHitProjectile(hitFxRef.current, {
                fromX: attacker.x,
                fromY: attacker.y,
                toX: vPos.x,
                toY: vPos.y,
                color: BOSS_HIT_FX_COLOR,
                shape: 'bolt',
                scale: combatSpriteScale,
              });
            } else {
              const hand = meleeHandPose(
                { x: attacker.x, y: attacker.y },
                vPos,
                combatSpriteScale
              );
              spawnHitSlash(hitFxRef.current, {
                x: hand.x,
                y: hand.y,
                angle: hand.angle,
                color: BOSS_HIT_FX_COLOR,
                scale: combatSpriteScale,
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
        if (!isNetworkGuestLive && livingAllies.length > 0 && mazeHealAccMsRef.current >= Math.round(160 / MAZE_TRAVERSE_SPEED_SCALE)) {
          mazeHealAccMsRef.current = 0;
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
              spawnHealSnowBurst(hitFxRef.current, {
                actorId: healer.id,
                x: hPos.x,
                y: hPos.y,
                scale: combatSpriteScale,
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

      // Host/solo: publish AFTER HP chips so guests see bars drain (not full→tombstone)
      if (!isNetworkGuestLive) {
        const nowSct = Date.now();
        const recentSct = encounterSCTRef.current
          .filter((s) => nowSct - s.createdAt < 1200)
          .slice(-24)
          .map((s) => ({
            id: s.id,
            text: s.text,
            x: s.x,
            y: s.y,
            color: s.color,
            createdAt: s.createdAt,
            isCrit: s.isCrit,
          }));
        publishHostMazeSync({
          mazeSeed: mazeLayout.seed,
          mazeDungeonId: mazeLayout.dungeonId,
          mazeStageIndex: mazeLayout.stageIndex,
          mazeLeadDist: mazeLeadDistRef.current,
          mazeTrash: trashMobsRef.current.map((m) => ({
            id: m.id,
            hp: m.hp,
            maxHp: m.maxHp,
            isDead: m.isDead,
            isTombstone: m.isTombstone,
            dissipateAlpha: m.dissipateAlpha,
          })),
          sctEvents: recentSct,
        });
      }

      if ((moveX !== 0 || moveY !== 0) && canMove) {
        // Continuous smooth WASD: screen-intent → world (ISO), then normalize
        clickTargetRef.current = null;
        setAutoNav(false);
        const worldIntent = screenDirToWorld(moveX, moveY, viewCam);
        const len = Math.hypot(worldIntent.x, worldIntent.y) || 1;
        // Balanced speed: combat vs maze (scaled by aura moveSpeedMod)
        const speed =
          (runPhase === 'TRAVEL_RECOVERY' ? PLAYER_MAZE_MOVE_SPEED : PLAYER_COMBAT_MOVE_SPEED) *
          moveSpeedMult;
        playerMoveDirRef.current = { dx: worldIntent.x / len, dy: worldIntent.y / len };
        playerPosRef.current.x += (worldIntent.x / len) * speed;
        playerPosRef.current.y += (worldIntent.y / len) * speed;
        playerPosRef.current.x = Math.max(30, Math.min(width - 30, playerPosRef.current.x));
        playerPosRef.current.y = Math.max(30, Math.min(height - 30, playerPosRef.current.y));

        const playerUnit = units.find(u => u.isPlayer);
        if (playerUnit) {
          playerUnit.position.x = playerPosRef.current.x;
          playerUnit.position.y = playerPosRef.current.y;
          (playerUnit as { isMoving?: boolean }).isMoving = true;
        }
        if (onPlayerMove) onPlayerMove();
        if (onNetworkMoveReport) {
          onNetworkMoveReport(playerPosRef.current.x, playerPosRef.current.y);
        }
      } else if (autoApproachTarget && canMove) {
        // Auto-approach target when spell distance was insufficient
        const dx = autoApproachTarget.targetX - playerPosRef.current.x;
        const dy = autoApproachTarget.targetY - playerPosRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist > autoApproachTarget.desiredDist) {
          const speed = PLAYER_COMBAT_MOVE_SPEED * moveSpeedMult;
          playerMoveDirRef.current = { dx: dx / dist, dy: dy / dist };
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
          if (onNetworkMoveReport) {
            onNetworkMoveReport(playerPosRef.current.x, playerPosRef.current.y);
          }
        } else {
          if (onApproachTargetReached) onApproachTargetReached();
        }
      } else if (clickTargetRef.current && canMove) {
        // Mouse Click-to-Move (unified with WASD speed)
        const dest = clickTargetRef.current;
        const dx = dest.x - playerPosRef.current.x;
        const dy = dest.y - playerPosRef.current.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 4) {
          const speed =
            (runPhase === 'TRAVEL_RECOVERY' ? PLAYER_MAZE_MOVE_SPEED : PLAYER_COMBAT_MOVE_SPEED) *
            moveSpeedMult;
          playerMoveDirRef.current = { dx: dx / dist, dy: dy / dist };
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
          if (onNetworkMoveReport) {
            onNetworkMoveReport(playerPosRef.current.x, playerPosRef.current.y);
          }
        } else {
          clickTargetRef.current = null;
          playerMoveDirRef.current = { dx: 0, dy: 0 };
        }
      } else if (
        runPhase === 'TRAVEL_RECOVERY' &&
        canMove &&
        !isNetworkGuestLive
      ) {
        // Host/solo: smooth lead chase — never snap when encounter stopDist engages
        // Guests already soft-follow host mazeLeadDist above
        const cur = mazeLeadDistRef.current;
        const delta = targetLeadDist - cur;
        const maxStep = Math.max(3.8 * MAZE_TRAVERSE_SPEED_SCALE, Math.abs(delta) * 0.2 * MAZE_TRAVERSE_SPEED_SCALE);
        if (Math.abs(delta) <= maxStep) mazeLeadDistRef.current = targetLeadDist;
        else mazeLeadDistRef.current = cur + Math.sign(delta) * maxStep;
      }

      // If in TRAVEL_RECOVERY and lead reaches Exit Portal (once per segment):
      const exitPoint = mazeWaypoints[mazeWaypoints.length - 1];
      if (
        runPhase === 'TRAVEL_RECOVERY' &&
        !portalEnterFiredRef.current &&
        Math.hypot(playerPosRef.current.x - exitPoint.x, playerPosRef.current.y - exitPoint.y) <= 30
      ) {
        portalEnterFiredRef.current = true;
        if (onFastForwardTravel) onFastForwardTravel();
      }

      // Proximity pull is handled inside STAGE B after entry snap + boss draw (avoid pre-snap false pulls)

      // ── STAGE A: TRAVEL_RECOVERY (Prim maze) ──
      if (runPhase === 'TRAVEL_RECOVERY') {
      /**
       * Prim topology unchanged. Visual = cloud-like cavities squeezed along the graph.
       * Pre-rendered to an offscreen canvas and cached by seed to eliminate per-frame lag.
       */
      const drawPrimWalls = (layout: MazeLayout, theme: MazeLayout['theme']) => {
        const cache = mazeWallCanvasCacheRef.current;
        if (cache && cache.seed === layout.seed && cache.width === width && cache.height === height) {
          ctx.drawImage(cache.canvas, 0, 0);
          return;
        }

        const offCanvas = document.createElement('canvas');
        offCanvas.width = width;
        offCanvas.height = height;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) return;

        const { originX, originY } = getMazeDrawOrigin(layout, width, height);
        const { cols, rows, grid, cellSize: cs, seed } = layout;
        const isPath = (c: number, r: number) =>
          c >= 0 && r >= 0 && c < cols && r < rows && !!grid[r * cols + c];

        const u01 = (c: number, r: number, k: number) => {
          let s =
            ((seed >>> 0) ^
              Math.imul(c + 3, 374761393) ^
              Math.imul(r + 7, 668265263) ^
              Math.imul(k + 1, 2147483647)) >>>
            0;
          s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
          s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0;
          return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
        };

        const fillCloud = (
          cx: number,
          cy: number,
          baseR: number,
          c: number,
          r: number,
          salt: number,
          opts?: { stretchX?: number; stretchY?: number; rot?: number; puffs?: number }
        ) => {
          const stretchX = opts?.stretchX ?? 1;
          const stretchY = opts?.stretchY ?? 1;
          const rot = opts?.rot ?? 0;
          const puffs = opts?.puffs ?? 3;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          for (let p = 0; p < puffs; p++) {
            const ox = (u01(c, r, salt + p * 3) - 0.5) * baseR * 0.55;
            const oy = (u01(c, r, salt + p * 3 + 1) - 0.5) * baseR * 0.55;
            const pr = baseR * (0.55 + 0.55 * u01(c, r, salt + p * 3 + 2));
            const lobes = 12 + Math.floor(u01(c, r, salt + 40 + p) * 6);
            offCtx.beginPath();
            for (let i = 0; i <= lobes; i++) {
              const t = (i / lobes) * Math.PI * 2;
              const jig = 0.55 + 0.7 * u01(c, r, salt + 80 + p * 20 + i);
              const bump = 1 + 0.22 * Math.sin(t * (2 + (p % 3)) + u01(c, r, salt + 5) * 6);
              const px = Math.cos(t) * pr * jig * bump * stretchX;
              const py = Math.sin(t) * pr * jig * bump * stretchY;
              const x = cx + ox + px * cos - py * sin;
              const y = cy + oy + px * sin + py * cos;
              if (i === 0) offCtx.moveTo(x, y);
              else offCtx.lineTo(x, y);
            }
            offCtx.closePath();
            offCtx.fill();
          }
        };

        const cellCenter = (c: number, r: number) => ({
          x: originX + c * cs + cs / 2,
          y: originY + r * cs + cs / 2,
        });

        const entC = layout.entrance?.col ?? 1;
        const entR = layout.entrance?.row ?? 1;
        const exC = layout.exit?.col ?? cols - 2;
        const exR = layout.exit?.row ?? rows - 2;
        const nearPortal = (c: number, r: number, rad = 3.2) =>
          Math.max(Math.abs(c - entC), Math.abs(r - entR)) <= rad ||
          Math.max(Math.abs(c - exC), Math.abs(r - exR)) <= rad;
        const onOuterBand = (c: number, r: number) =>
          c <= 1 || r <= 1 || c >= cols - 2 || r >= rows - 2;

        // 1) Lumpy rock hull near path
        offCtx.fillStyle = theme.wallColor;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!isPath(c, r)) {
              const touch =
                isPath(c + 1, r) ||
                isPath(c - 1, r) ||
                isPath(c, r + 1) ||
                isPath(c, r - 1) ||
                isPath(c + 1, r + 1) ||
                isPath(c - 1, r + 1) ||
                isPath(c + 1, r - 1) ||
                isPath(c - 1, r - 1);
              if (!touch) continue;
              if (onOuterBand(c, r) && !nearPortal(c, r) && u01(c, r, 200) < 0.42) continue;
            }
            const { x, y } = cellCenter(c, r);
            const path = isPath(c, r);
            const edgeScale =
              onOuterBand(c, r) && !nearPortal(c, r) ? 0.75 + 0.55 * u01(c, r, 201) : 1;
            fillCloud(
              x,
              y,
              cs * (path ? 1.35 : 1.15) * (0.9 + 0.25 * u01(c, r, 1)) * edgeScale,
              c,
              r,
              10,
              {
                stretchX: 0.85 + 0.35 * u01(c, r, 2),
                stretchY: 0.85 + 0.35 * u01(c, r, 3),
                rot: (u01(c, r, 4) - 0.5) * 1.4,
                puffs: path ? 3 : 2,
              }
            );
          }
        }

        // 1b) Outer edge rocky clouds
        offCtx.fillStyle = theme.wallColor;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!onOuterBand(c, r) || nearPortal(c, r)) continue;
            if (!isPath(c, r)) {
              const touch =
                isPath(c + 1, r) ||
                isPath(c - 1, r) ||
                isPath(c, r + 1) ||
                isPath(c, r - 1);
              if (!touch && u01(c, r, 210) > 0.35) continue;
            }
            if (u01(c, r, 211) > 0.62) continue;
            const { x, y } = cellCenter(c, r);
            const nx = c <= 1 ? -1 : c >= cols - 2 ? 1 : 0;
            const ny = r <= 1 ? -1 : r >= rows - 2 ? 1 : 0;
            const push = cs * (0.55 + 0.9 * u01(c, r, 212));
            fillCloud(
              x + nx * push + (u01(c, r, 213) - 0.5) * cs * 0.4,
              y + ny * push + (u01(c, r, 214) - 0.5) * cs * 0.4,
              cs * (0.7 + 0.65 * u01(c, r, 215)),
              c,
              r,
              220,
              {
                stretchX: 0.7 + 0.6 * u01(c, r, 216),
                stretchY: 0.7 + 0.6 * u01(c, r, 217),
                rot: (u01(c, r, 218) - 0.5) * Math.PI,
                puffs: 2 + (u01(c, r, 219) > 0.5 ? 1 : 0),
              }
            );
          }
        }

        // 2) Carve cloud cavities on path
        offCtx.fillStyle = theme.floorColor;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!isPath(c, r)) continue;
            const { x, y } = cellCenter(c, r);
            const deg =
              (isPath(c + 1, r) ? 1 : 0) +
              (isPath(c - 1, r) ? 1 : 0) +
              (isPath(c, r + 1) ? 1 : 0) +
              (isPath(c, r - 1) ? 1 : 0);
            const chamber = deg >= 3 ? 1.35 : deg <= 1 ? 1.15 : 1;
            const caveR = cs * (0.55 + 0.28 * u01(c, r, 6)) * chamber;
            fillCloud(x, y, caveR, c, r, 20, {
              stretchX: 0.75 + 0.5 * u01(c, r, 7),
              stretchY: 0.7 + 0.55 * u01(c, r, 8),
              rot: (u01(c, r, 9) - 0.5) * Math.PI,
              puffs: 3 + (u01(c, r, 10) > 0.55 ? 1 : 0),
            });

            const dirs = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
              [1, 1],
              [-1, 1],
              [1, -1],
              [-1, -1],
            ] as const;
            for (let di = 0; di < dirs.length; di++) {
              const [dc, dr] = dirs[di];
              const nc = c + dc;
              const nr = r + dr;
              if (isPath(nc, nr)) continue;
              if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
              const biteChance = deg <= 2 ? 0.55 : 0.28;
              if (u01(c, r, 50 + di) > biteChance) continue;
              const wall = cellCenter(nc, nr);
              const biteR = cs * (0.35 + 0.35 * u01(c, r, 60 + di));
              const bx = x * 0.35 + wall.x * 0.65;
              const by = y * 0.35 + wall.y * 0.65;
              fillCloud(bx, by, biteR, nc, nr, 70 + di, {
                stretchX: 0.7 + 0.5 * u01(c, r, 80 + di),
                stretchY: 0.7 + 0.5 * u01(c, r, 90 + di),
                rot: (u01(c, r, 100 + di) - 0.5) * Math.PI,
                puffs: 2,
              });
            }

            // 3) Edge connectors
            if (isPath(c + 1, r)) {
              const b = cellCenter(c + 1, r);
              const mx = (x + b.x) / 2 + (u01(c, r, 12) - 0.5) * cs * 0.22;
              const my = (y + b.y) / 2 + (u01(c, r, 13) - 0.5) * cs * 0.22;
              const len = Math.hypot(b.x - x, b.y - y);
              fillCloud(mx, my, len * (0.42 + 0.18 * u01(c, r, 14)), c, r, 30, {
                stretchX: 1.35 + 0.4 * u01(c, r, 15),
                stretchY: 0.45 + 0.35 * u01(c, r, 16),
                rot: Math.atan2(b.y - y, b.x - x) + (u01(c, r, 17) - 0.5) * 0.5,
                puffs: 2 + (u01(c, r, 18) > 0.5 ? 1 : 0),
              });
            }
            if (isPath(c, r + 1)) {
              const b = cellCenter(c, r + 1);
              const mx = (x + b.x) / 2 + (u01(c, r, 19) - 0.5) * cs * 0.22;
              const my = (y + b.y) / 2 + (u01(c, r, 20) - 0.5) * cs * 0.22;
              const len = Math.hypot(b.x - x, b.y - y);
              fillCloud(mx, my, len * (0.42 + 0.18 * u01(c, r, 21)), c, r, 35, {
                stretchX: 1.35 + 0.4 * u01(c, r, 22),
                stretchY: 0.45 + 0.35 * u01(c, r, 23),
                rot: Math.atan2(b.y - y, b.x - x) + (u01(c, r, 24) - 0.5) * 0.5,
                puffs: 2 + (u01(c, r, 25) > 0.5 ? 1 : 0),
              });
            }
          }
        }

        mazeWallCanvasCacheRef.current = {
          seed: layout.seed,
          width,
          height,
          canvas: offCanvas,
        };
        ctx.drawImage(offCanvas, 0, 0);
      };

      const drawBlueExitPortal = (ex: number, ey: number) => {
        const S = 0.3;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.scale(S, S);
        const spin = (tickCount * 0.08) % (Math.PI * 2);
        const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
        glow.addColorStop(0, 'rgba(125, 211, 252, 0.9)');
        glow.addColorStop(0.45, 'rgba(37, 99, 235, 0.55)');
        glow.addColorStop(1, 'rgba(30, 58, 138, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(spin);
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, 22, 13, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(-spin * 2.2);
        ctx.strokeStyle = '#60A5FA';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 22, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(spin * 0.6);
        ctx.fillStyle = 'rgba(186, 230, 253, 0.85)';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      const drawEntranceMarker = (ex: number, ey: number, color: string) => {
        // 0.1× former marker (radius 7 → 0.7); no label text
        ctx.beginPath();
        ctx.arc(ex, ey, 0.7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      };

      /** Wall cells bordering a path — cached by seed & dimensions to avoid per-frame grid scan. */
      const collectMazeWallCandleSites = (layout: MazeLayout): Array<{ x: number; y: number }> => {
        const cachedCandles = mazeCandleSitesCacheRef.current;
        if (
          cachedCandles &&
          cachedCandles.seed === layout.seed &&
          cachedCandles.width === width &&
          cachedCandles.height === height &&
          cachedCandles.is20Man === is20Man
        ) {
          return cachedCandles.sites;
        }
        const { originX, originY } = getMazeDrawOrigin(layout, width, height);
        const { cols, rows, cellSize, grid, seed } = layout;
        const entC = layout.entrance?.col ?? 1;
        const entR = layout.entrance?.row ?? 1;
        const exC = layout.exit?.col ?? cols - 2;
        const exR = layout.exit?.row ?? rows - 2;

        const isWall = (c: number, r: number) =>
          c >= 0 && r >= 0 && c < cols && r < rows && !grid[r * cols + c];
        const isPath = (c: number, r: number) =>
          c >= 0 && r >= 0 && c < cols && r < rows && !!grid[r * cols + c];

        // Wall candidate with direction vector pointing towards adjacent path for wall mounting
        type CandleCand = { c: number; r: number; dx: number; dy: number };
        const candidates: CandleCand[] = [];

        // Exclude outer band (eroded rock hull) and entrance/exit proximity
        for (let r = 2; r < rows - 2; r++) {
          for (let c = 2; c < cols - 2; c++) {
            if (!isWall(c, r)) continue;
            if (Math.hypot(c - entC, r - entR) < 2.5 || Math.hypot(c - exC, r - exR) < 2.5) continue;

            // Determine which neighboring cell is path
            let dx = 0;
            let dy = 0;
            if (isPath(c, r + 1)) {
              // Path is below -> candle sits on bottom wall edge shining down into corridor
              dy = 0.35;
            } else if (isPath(c, r - 1)) {
              // Path is above -> candle sits on top wall edge shining up
              dy = -0.35;
            } else if (isPath(c + 1, r)) {
              // Path is right -> candle sits on right wall edge
              dx = 0.35;
            } else if (isPath(c - 1, r)) {
              // Path is left -> candle sits on left wall edge
              dx = -0.35;
            } else {
              continue; // no direct orthogonal path border
            }
            candidates.push({ c, r, dx, dy });
          }
        }

        let s = (seed >>> 0) || 1;
        const rand = () => {
          s = (Math.imul(1664525, s) + 1013904223) >>> 0;
          return s / 0x100000000;
        };
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        // 数量合理：5人 12~16 盏，20人 18~24 盏，间距均匀，氛围感充足
        const is20 = is20Man;
        const pickN = is20
          ? Math.max(16, Math.min(24, Math.floor(candidates.length / 10)))
          : Math.max(12, Math.min(16, Math.floor(candidates.length / 12)));
        const minDist = Math.max(4, Math.floor(Math.sqrt((cols * rows) / Math.max(1, pickN * 2.2))));
        const picked: CandleCand[] = [];
        for (const cand of candidates) {
          if (picked.length >= pickN) break;
          if (picked.every((p) => Math.hypot(p.c - cand.c, p.r - cand.r) >= minDist)) {
            picked.push(cand);
          }
        }
        // Fill remaining with minDist >= 3 if needed
        for (const cand of candidates) {
          if (picked.length >= pickN) break;
          if (picked.some((p) => p.c === cand.c && p.r === cand.r)) continue;
          if (picked.every((p) => Math.hypot(p.c - cand.c, p.r - cand.r) >= 3)) {
            picked.push(cand);
          }
        }

        const sites: Array<{ x: number; y: number }> = [];
        for (const p of picked) {
          sites.push({
            x: originX + p.c * cellSize + cellSize / 2 + p.dx * cellSize,
            y: originY + p.r * cellSize + cellSize / 2 + p.dy * cellSize,
          });
        }
        mazeCandleSitesCacheRef.current = {
          seed: layout.seed,
          width,
          height,
          is20Man,
          sites,
        };
        return sites;
      };

      /** Candles at 30% of the old hardcoded torch size — fast direct coordinate draw without save/restore. */
      const drawMazeWallCandle = (
        x: number,
        y: number,
        torchColor: string,
        style: 'amber' | 'violet'
      ) => {
        if (style === 'violet') {
          ctx.fillStyle = '#1e1b2e';
          ctx.fillRect(x - 0.9, y - 2.4, 1.8, 4.2);
          const flicker = Math.sin(tickCount * 0.25 + x) * 0.9;
          ctx.fillStyle = 'rgba(192, 38, 211, 0.28)';
          ctx.beginPath();
          ctx.arc(x, y, 4.8 + flicker, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#c026d3';
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#8B4513';
          ctx.fillRect(x - 0.6, y - 1.8, 1.2, 3.6);
          const flicker = Math.sin(tickCount * 0.2 + x) * 0.6;
          ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
          ctx.beginPath();
          ctx.arc(x, y, 4.2 + flicker, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = torchColor || '#F59E0B';
          ctx.beginPath();
          ctx.arc(x, y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      };

        approachElapsedRef.current = 0;

        // Apply world-space camera transform FIRST so all floor and maze elements yaw/pitch synchronously
        applyCanvasViewTransform(ctx, viewCam);

        // Infinite/full-screen cavern floor & world grid (eliminates "island in black void" look)
        drawMazeCavernFloorWorld(ctx, viewCam, width, height, mazeTheme, is20Man);

        if (is20Man) {
          // ── Dragon Soul (20-man Obsidian & Molten Magma) ──
          drawPrimWalls(mazeLayout, mazeTheme);

          // Wall candles (30% size) — random left-right symmetric on maze walls
          for (const site of collectMazeWallCandleSites(mazeLayout)) {
            drawMazeWallCandle(site.x, site.y, mazeTheme?.torchColor || '#c026d3', 'violet');
          }

          const ent = mazeLayout.entrance;
          const ex = mazeLayout.exit;
          drawEntranceMarker(ent.x, ent.y, '#f97316');
          drawBlueExitPortal(ex.x, ex.y);
        } else {
          // ── Shadowfang Keep (5-man Castle Corridors) ──
          drawPrimWalls(mazeLayout, mazeTheme);

          // Wall candles (30% size) — random left-right symmetric on maze walls
          for (const site of collectMazeWallCandleSites(mazeLayout)) {
            drawMazeWallCandle(site.x, site.y, mazeTheme?.torchColor || '#F59E0B', 'amber');
          }

          const ent = mazeLayout.entrance;
          const ex = mazeLayout.exit;
          drawEntranceMarker(ent.x, ent.y, '#10B981');
          drawBlueExitPortal(ex.x, ex.y);
        }

        // Draw Trash Mobs (scale matches Boss room combatSpriteScale) — ISO upright billboard
        trashMobsRef.current.forEach(mob => {
          withUprightAt(ctx, viewCam, { x: mob.x, y: mob.y }, (sp) => {
            const ox = mob.x;
            const oy = mob.y;
            mob.x = sp.x;
            mob.y = sp.y;
            drawTrashMob(ctx, mob, tickCount, is20Man, {
              scale: combatSpriteScale,
              showName: false,
              isSelected: mob.id === selectedUnitId,
            });
            mob.x = ox;
            mob.y = oy;
          });
        });

        // Floating SCT — upright in screen space
        const now = Date.now();
        encounterSCTRef.current = encounterSCTRef.current.filter(item => now - item.createdAt < 1200);
        encounterSCTRef.current.forEach(item => {
          const age = now - item.createdAt;
          const progress = age / 1200;
          const yOff = progress * 24;
          const alpha = 1 - progress;
          withUprightAt(ctx, viewCam, { x: item.x, y: item.y }, (sp) => {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = item.color;
            ctx.font = item.isCrit ? 'bold 13px sans-serif' : 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(item.text, sp.x, sp.y - yOff);
            ctx.restore();
          });
        });

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

          // Always auto-march along maze lead in maze phase
          const rankDist = Math.max(0, mazeLeadDistRef.current - rank * (is20Man ? 8 : 14));
          targetPos = getPointAlongMaze(rankDist);
          if (currentEncounterPack > 0) {
            const isTank = u.role === 'TANK';
            const isMelee = u.role === 'DPS' && (u.classId === 'ROGUE' || u.classId === 'DK' || u.classId === 'WARRIOR' || u.classId === 'PALADIN');
            const isHealer = u.role === 'HEALER';
            // Tiny lateral fidget only (keep on corridor; avoid yanking into walls)
            if (isTank) targetPos = { x: targetPos.x + 4, y: targetPos.y - 3 };
            else if (isMelee) targetPos = { x: targetPos.x - 2, y: targetPos.y + 5 };
            else if (isHealer) targetPos = { x: targetPos.x - 6 - (rank % 3) * 3, y: targetPos.y + 4 };
            else targetPos = { x: targetPos.x - 5 - (rank % 3) * 3, y: targetPos.y - 4 };
          }

          // Smooth Vector Lerp: Absolutely NO instant snapping/teleportation!
          const curPos = isPlayer
            ? playerPosRef.current
            : (companionPositionsRef.current[u.id] || { x: targetPos.x, y: targetPos.y });

          const dx = targetPos.x - curPos.x;
          const dy = targetPos.y - curPos.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 0.5) {
            // Cap step so encounter/timeline corrections never look like teleports
            const step = Math.min(
              dist,
              Math.min(8.5 * MAZE_TRAVERSE_SPEED_SCALE, Math.max(3.6 * MAZE_TRAVERSE_SPEED_SCALE, dist * 0.22 * MAZE_TRAVERSE_SPEED_SCALE))
            );
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

          // Maze: Scale matches Boss room (combatSpriteScale); ISO billboard upright at projected feet
          const showNm = shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
          const showHp = shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
          withUprightAt(ctx, viewCam, curPos, (sp) => {
            drawClassCharacter(ctx, u, sp, !!isPlayer, u.id === selectedUnitId, tickCount, rank, {
              scale: combatSpriteScale,
              showName: showNm && !showHp,
            });
          });

          // If member is dead during system mass-resurrection (8s), show holy beam & progress bar above corpse
          if ((!u.alive && !u.isAlive) && (revivingUnitId || reviveProgress > 0)) {
            ctx.save();
            ctx.strokeStyle = '#FBBF24';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(curPos.x, curPos.y - 42);
            ctx.lineTo(curPos.x, curPos.y);
            ctx.stroke();
            ctx.restore();

            // Resurrect bar above corpse
            ctx.fillStyle = '#000';
            ctx.fillRect(curPos.x - 25, curPos.y - 25, 50, 6);
            ctx.fillStyle = '#F59E0B';
            ctx.fillRect(curPos.x - 25, curPos.y - 25, 50 * (reviveProgress || 0), 6);
            ctx.strokeStyle = '#FFF';
            ctx.lineWidth = 1;
            ctx.strokeRect(curPos.x - 25, curPos.y - 25, 50, 6);
          }
        });

        // Layer: terrain < trash < characters < hit FX < HP bars
        const nowHit = performance.now();
        pruneHitFx(hitFxRef.current, nowHit);
        drawHitFx(ctx, hitFxRef.current, nowHit, hitFxFilter);
        units.forEach((u, idx) => {
          if (!shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId)) return;
          const pos = u.isPlayer
            ? playerPosRef.current
            : (companionPositionsRef.current[u.id] || { x: 160 + idx * 25, y: 150 + idx * 30 });
          withUprightAt(ctx, viewCam, pos, (sp) => {
            drawUnitHpBar(ctx, u, sp, {
              scale: combatSpriteScale,
              name: shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId)
                ? u.name
                : null,
            });
          });
        });

        // Restore context to screen coordinates and apply radial vignette to fade edges naturally
        ctx.restore();
        drawMazeCavernVignetteScreen(ctx, width, height);

        animId = requestAnimationFrame(render);
        return;
      }

      // ── STAGE B: PULL_APPROACH — continue from maze positions; AI settle by tank→boss range ───
      if (runPhase === 'PULL_APPROACH') {
        const bossStand = bossPosRef.current;
        const tankUnit = units.find(u => u.role === 'TANK') || units[0];
        const playerIsTank = !!(tankUnit && tankUnit.isPlayer);
        const leftEntry = { x: 110, y: 180 };

        // Capture current maze/world positions once — never teleport to left door
        if (approachElapsedRef.current === 0) {
          const startSnap: Record<string, { x: number; y: number }> = {};
          units.forEach((u, rank) => {
            let entry: { x: number; y: number };
            if (u.isPlayer) {
              entry = { ...playerPosRef.current };
            } else if (companionPositionsRef.current[u.id]) {
              entry = { ...companionPositionsRef.current[u.id] };
            } else if (u.position) {
              entry = { x: u.position.x, y: u.position.y };
            } else {
              entry = {
                x: leftEntry.x - rank * 12,
                y: leftEntry.y + ((rank % 2 === 0 ? -1 : 1) * 10),
              };
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

        ctx.fillStyle = '#080812';
        ctx.fillRect(0, 0, width, height);

        if (playerIsTank) {
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            `🛡️ 主坦靠近首领，队友随距离落位（${Math.round(progress * 100)}%）· WASD 移动开怪`,
            width / 2,
            42
          );
        }

        applyCanvasViewTransform(ctx, viewCam);
        drawMazeCavernFloorWorld(ctx, viewCam, width, height, mazeTheme, is20Man);
        enterScreenSpaceFromIso(ctx, viewCam);
        drawMazeCavernVignetteScreen(ctx, width, height);
        ctx.restore();

        // Update approach stands, then paint boss+party by camera depth
        {
          type DepthSprite = { depth: number; paint: () => void };
          const sprites: DepthSprite[] = [];

          if (bossUnit) {
            sprites.push({
              depth: viewDepthKey(bossStand.x, bossStand.y, viewCam),
              paint: () => {
                withUprightAt(ctx, viewCam, bossStand, (sp) => {
                  drawBossModel(ctx, bossUnit, sp, bossUnit.id === selectedUnitId, tickCount, false, {
                    showName: prefs.showBossName && !prefs.showBossHp,
                  });
                });
              },
            });
          } else {
            sprites.push({
              depth: viewDepthKey(bossStand.x, bossStand.y, viewCam),
              paint: () => {
                ctx.save();
                ctx.translate(bossStand.x, bossStand.y);
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.beginPath();
                ctx.ellipse(0, 36, 48, 18, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#7f1d1d';
                ctx.fillRect(-28, -36, 56, 64);
                if (prefs.showBossName && !prefs.showBossHp) {
                  ctx.fillStyle = '#FFE08A';
                  ctx.font = `bold ${Math.max(7, Math.round(12 * 0.85))}px sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  const label = `💀 ${targetBossName || '首领'}`;
                  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
                  ctx.lineWidth = 2;
                  ctx.strokeText(label, 0, -78 + 6);
                  ctx.fillText(label, 0, -78 + 6);
                  ctx.textBaseline = 'alphabetic';
                }
                ctx.restore();
              },
            });
          }

          units.forEach((u, idx) => {
            const start = approachStartPositionsRef.current[u.id] || { x: 100, y: 180 };
            const dest = getCombatFormationPos(u, idx, bossStand, 1);

            if (u.isPlayer && playerIsTank) {
              if (u.position) {
                u.position.x = playerPosRef.current.x;
                u.position.y = playerPosRef.current.y;
              }
              const pos = { ...playerPosRef.current };
              const showNm = shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
              const showHp = shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
              sprites.push({
                depth: viewDepthKey(pos.x, pos.y, viewCam),
                paint: () => {
                  withUprightAt(ctx, viewCam, pos, (sp) => {
                    drawClassCharacter(ctx, u, sp, true, u.id === selectedUnitId, tickCount, idx, {
                      scale: combatSpriteScale,
                      showName: showNm && !showHp,
                    });
                  });
                },
              });
              return;
            }

            if (u.role === 'TANK' && !u.isPlayer) {
              const pos = { ...tankPos };
              const showNm = shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
              const showHp = shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
              sprites.push({
                depth: viewDepthKey(pos.x, pos.y, viewCam),
                paint: () => {
                  withUprightAt(ctx, viewCam, pos, (sp) => {
                    drawClassCharacter(ctx, u, sp, false, u.id === selectedUnitId, tickCount, idx, {
                      scale: combatSpriteScale,
                      showName: showNm && !showHp,
                    });
                  });
                },
              });
              return;
            }

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
            const pos = { x: cur.x, y: cur.y };
            const showNm = shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
            const showHp = shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
            sprites.push({
              depth: viewDepthKey(pos.x, pos.y, viewCam),
              paint: () => {
                withUprightAt(ctx, viewCam, pos, (sp) => {
                  drawClassCharacter(ctx, u, sp, !!u.isPlayer, u.id === selectedUnitId, tickCount, idx, {
                    scale: combatSpriteScale,
                    showName: showNm && !showHp,
                  });
                });
              },
            });
          });

          sprites.sort((a, b) => a.depth - b.depth);
          for (const s of sprites) s.paint();
        }



        // HP bars above models — upright billboards
        if (bossUnit && prefs.showBossHp) {
          withUprightAt(ctx, viewCam, bossStand, (sp) => {
            drawBossHpBar(ctx, bossUnit, sp, {
              name: prefs.showBossName ? bossUnit.name : null,
            });
          });
        }
        units.forEach((u, idx) => {
          if (!shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId)) return;
          let pos: { x: number; y: number };
          if (u.isPlayer && playerIsTank) pos = playerPosRef.current;
          else if (u.role === 'TANK' && !u.isPlayer) pos = tankPos;
          else if (u.isPlayer) pos = playerPosRef.current;
          else pos = companionPositionsRef.current[u.id] || { x: 100, y: 180 };
          withUprightAt(ctx, viewCam, pos, (sp) => {
            drawUnitHpBar(ctx, u, sp, {
              scale: combatSpriteScale,
              name: shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId)
                ? u.name
                : null,
            });
          });
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
      ctx.fillStyle = '#080812';
      ctx.fillRect(0, 0, width, height);

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

      applyCanvasViewTransform(ctx, viewCam);
      drawMazeCavernFloorWorld(ctx, viewCam, width, height, mazeTheme, is20Man);
      enterScreenSpaceFromIso(ctx, viewCam);
      drawMazeCavernVignetteScreen(ctx, width, height);
      ctx.restore();

      // Active Ground Effects → fill-only AoE rings (no edge stroke) + totem/cone overlays
      const nowFx = performance.now();
      const unitsById = new Map<string, Unit>();
      for (const u of units) unitsById.set(u.id, u);
      if (bossUnit) unitsById.set(bossUnit.id, bossUnit);
      const livingAdds = enemyUnitsRef.current.filter(
        (e) => (!bossUnit || e.id !== bossUnit.id) && (e.isAlive ?? e.alive) && e.hp > 0
      );
      for (const add of livingAdds) unitsById.set(add.id, add);

      if (pendingAoeActionsRef.current.length > 0) {
        const batch = pendingAoeActionsRef.current.splice(0, pendingAoeActionsRef.current.length);
        aoeRingsRef.current = ingestCombatActionsAsRings(
          aoeRingsRef.current,
          batch,
          unitsById,
          nowFx,
          aoeSeenActionIdsRef.current
        );
        ingestCombatActionsAsClassAoePulses(classAoePulsesRef.current, {
          actions: batch,
          unitsById,
          seenIds: classAoePulseSeenIdsRef.current,
          now: nowFx,
        });
        const resolvePos = (unitId: string) => {
          const u = unitsById.get(unitId);
          if (!u) return null;
          if (u.isPlayer) return { ...playerPosRef.current };
          const c = companionPositionsRef.current[unitId];
          if (c) return { ...c };
          if (bossUnit && unitId === bossUnit.id) return { ...bossPosRef.current };
          if (u.position) return { x: u.position.x, y: u.position.y };
          return null;
        };
        ingestCombatActionsAsHitFx(hitFxRef.current, {
          actions: batch,
          unitsById,
          seenIds: hitFxSeenIdsRef.current,
          now: nowFx,
          bossName: bossUnit?.name,
          resolvePos,
          resolveScale: (unitId) => {
            const u = unitsById.get(unitId);
            if (!u) return 1;
            if (u.classId === 'BOSS' || u.unitKind === 'BOSS') return HIT_FX_BOSS_SIZE_MULT;
            return 1;
          },
        });
        // Cap seen-id set to avoid unbounded growth
        if (aoeSeenActionIdsRef.current.size > 200) {
          aoeSeenActionIdsRef.current = new Set(Array.from(aoeSeenActionIdsRef.current).slice(-80));
        }
        if (classAoePulseSeenIdsRef.current.size > 200) {
          classAoePulseSeenIdsRef.current = new Set(Array.from(classAoePulseSeenIdsRef.current).slice(-80));
        }
        if (hitFxSeenIdsRef.current.size > 200) {
          hitFxSeenIdsRef.current = new Set(Array.from(hitFxSeenIdsRef.current).slice(-80));
        }
      }
      // Ground AoE rings = terrain layer (under class pulse / boss / chars)
      aoeRingsRef.current = syncPersistentRingsFromGround(
        aoeRingsRef.current,
        groundEffects,
        unitsById,
        nowFx
      );
      for (const ring of aoeRingsRef.current) {
        if (!showAoeTone(ring.tone)) continue;
        ctx.save();
        drawAoeRing(ctx, ring, nowFx, {
          heightShadow: prefs.isoFxHeightShadow && prefs.canvasViewMode === 'ISO',
        });
        ctx.restore();
      }

      // Instant AoE class-color feathered pulse: above terrain rings, below boss
      pruneClassAoePulses(classAoePulsesRef.current, nowFx);
      drawClassAoePulses(ctx, classAoePulsesRef.current, nowFx);

      // Form casting snowflakes; drawHitFx deferred until after boss+characters
      for (const burst of hitFxRef.current.snowBursts) {
        if (!burst.fading && burst.form < 1) {
          burst.form = Math.min(1, burst.form + 0.016 / 1.2);
        }
      }
      pruneHitFx(hitFxRef.current, nowFx, {
        resolvePos: (unitId) => {
          const u = unitsById.get(unitId);
          if (!u) return null;
          if (u.isPlayer) return { ...playerPosRef.current };
          const c = companionPositionsRef.current[unitId];
          if (c) return { ...c };
          if (bossUnit && unitId === bossUnit.id) return { ...bossPosRef.current };
          return u.position ? { x: u.position.x, y: u.position.y } : null;
        },
        isActorAlive: (unitId) => {
          const u = unitsById.get(unitId);
          return !!u && (u.isAlive ?? u.alive) && u.hp > 0;
        },
      });

      for (const effect of groundEffects) {
        ctx.save();
        if (effect.kind === 'CONE_WARNING') {
          // 锥形：伤害红填充；描边按施法者敌我
          const coneOwner = unitsById.get(effect.ownerId);
          drawConeWarning(ctx, effect, {
            friendlyCaster: coneOwner ? !isEnemyActorUnit(coneOwner) : false,
          });
        } else if (effect.kind === 'TOTEM') {
          const cx = effect.x;
          const cy = effect.y;
          const sid = (effect.spellId || '').toLowerCase();
          const isLightwell =
            sid.includes('lightwell') || sid.includes('light_well') || sid.includes('圣光井');
          if (isLightwell) {
            // 圣光井：蜡烛同尺寸的小井（石圈 + 中央圣光），光圈由 AoE ring 绘制
            ctx.fillStyle = '#94A3B8';
            ctx.beginPath();
            ctx.ellipse(cx, cy + 1, 4.5, 2.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#64748B';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#CBD5E1';
            ctx.fillRect(cx - 3, cy - 6, 6, 7);
            ctx.strokeStyle = '#64748B';
            ctx.strokeRect(cx - 3, cy - 6, 6, 7);
            ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
            ctx.beginPath();
            ctx.ellipse(cx, cy - 3, 2, 2.4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(254, 249, 195, 0.95)';
            ctx.beginPath();
            ctx.ellipse(cx, cy - 3.5, 1, 1.3, 0, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Candle-sized totem marker (thin wax + small flame); radius fill comes from AoE ring
            ctx.fillStyle = '#C4A574';
            ctx.fillRect(cx - 1.5, cy - 7, 3, 9);
            ctx.strokeStyle = '#3F2A14';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 7);
            ctx.lineTo(cx, cy - 9.5);
            ctx.stroke();
            ctx.fillStyle = '#FBBF24';
            ctx.beginPath();
            ctx.ellipse(cx, cy - 12, 2.2, 3.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#F97316';
            ctx.beginPath();
            ctx.ellipse(cx, cy - 11.2, 1.1, 1.8, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (effect.spellId === 'cookie_bad_food' || effect.spellId === 'cookie_good_food') {
          const isBad = effect.spellId === 'cookie_bad_food';
          ctx.fillStyle = isBad ? '#A855F7' : '#22C55E';
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = isBad ? '#F3E8FF' : '#DCFCE7';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          withUprightAt(ctx, viewCam, { x: effect.x, y: effect.y }, (sp) => {
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isBad ? '☠️ 坏食物' : '🍖 好食物', sp.x, sp.y - 11);
          });
        } else if (effect.spellId === 'glubtok_firewall') {
          ctx.fillStyle = 'rgba(249, 115, 22, 0.9)';
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 8, 0, Math.PI * 2);
          ctx.fill();
          withUprightAt(ctx, viewCam, { x: effect.x, y: effect.y }, (sp) => {
            ctx.fillStyle = '#FDE047';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🔥 火墙', sp.x, sp.y - 12);
          });
        } else if (effect.spellId === 'morchok_pillar') {
          const px = effect.x;
          const py = effect.y;
          // 虚线安全区边界
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.arc(px, py, effect.radius || 55, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // 2.5D 碎石柱石块
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.beginPath();
          ctx.ellipse(px, py + 4, 18, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#57534E';
          ctx.beginPath();
          ctx.moveTo(px - 14, py + 2);
          ctx.lineTo(px - 10, py - 24);
          ctx.lineTo(px + 2, py - 28);
          ctx.lineTo(px + 14, py - 18);
          ctx.lineTo(px + 14, py + 2);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#A8A29E';
          ctx.beginPath();
          ctx.moveTo(px - 10, py - 24);
          ctx.lineTo(px + 2, py - 28);
          ctx.lineTo(px + 14, py - 18);
          ctx.lineTo(px + 2, py - 14);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#D6D3D1';
          ctx.lineWidth = 1;
          ctx.stroke();
          withUprightAt(ctx, viewCam, { x: px, y: py }, (sp) => {
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillText('🛡️ 碎石柱安全区', sp.x + 1, sp.y - 33);
            ctx.fillStyle = '#6EE7B7';
            ctx.fillText('🛡️ 碎石柱安全区', sp.x, sp.y - 34);
          });
        } else if (effect.spellId === 'resonating_crystal') {
          const cx = effect.x;
          const cy = effect.y;
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(cx, cy, effect.radius || 28, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#3B82F6';
          ctx.beginPath();
          ctx.moveTo(cx, cy - 20);
          ctx.lineTo(cx + 9, cy - 6);
          ctx.lineTo(cx + 5, cy + 4);
          ctx.lineTo(cx - 5, cy + 4);
          ctx.lineTo(cx - 9, cy - 6);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#DBEAFE';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          withUprightAt(ctx, viewCam, { x: cx, y: cy }, (sp) => {
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillText('💎 靠近吸收', sp.x + 1, sp.y - 25);
            ctx.fillStyle = '#93C5FD';
            ctx.fillText('💎 靠近吸收', sp.x, sp.y - 26);
          });
        } else if ((effect.spellId || '').startsWith('cauldron_marker_')) {
          const cx = effect.x;
          const cy = effect.y;
          const kind = (effect.spellId || '').replace('cauldron_marker_', '');
          const fill = kind === 'frost' ? '#38BDF8' : kind === 'fire' ? '#F97316' : '#84CC16';
          const label = kind === 'frost' ? '❄️ 冰釜' : kind === 'fire' ? '🔥 火釜' : '☠️ 毒釜';
          // 铁锅底座 + 药水液面
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.ellipse(cx, cy + 2, 11, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.ellipse(cx, cy - 1, 8, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#E2E8F0';
          ctx.lineWidth = 1;
          ctx.stroke();
          withUprightAt(ctx, viewCam, { x: cx, y: cy }, (sp) => {
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillText(label, sp.x + 1, sp.y - 13);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(label, sp.x, sp.y - 14);
          });
        } else if (effect.spellId === 'zonozz_ball_target') {
          const zx = effect.x;
          const zy = effect.y;
          const zr = effect.radius || 100;
          const pulse = 0.5 + 0.5 * Math.sin(tickCount * 0.18);
          ctx.strokeStyle = `rgba(192, 132, 252, ${0.65 + pulse * 0.35})`;
          ctx.lineWidth = 2.6;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.arc(zx, zy, zr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // 4 inward-pointing chevron arrows around the target circle
          for (let i = 0; i < 4; i++) {
            const ang = (i * Math.PI) / 2 + (tickCount * 0.02);
            const ax = zx + Math.cos(ang) * (zr - 6);
            const ay = zy + Math.sin(ang) * (zr - 6);
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(ang + Math.PI);
            ctx.fillStyle = '#FDE047';
            ctx.beginPath();
            ctx.moveTo(7, 0);
            ctx.lineTo(-4, -5);
            ctx.lineTo(-4, 5);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
          const sec = Math.max(0, (effect.remainingMs || 0) / 1000).toFixed(1);
          withUprightAt(ctx, viewCam, { x: zx, y: zy + zr }, (sp) => {
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillText(`⚫ 撞球目标区 (${sec}s)`, sp.x + 1, sp.y + 15);
            ctx.fillStyle = '#E9D5FF';
            ctx.fillText(`⚫ 撞球目标区 (${sec}s)`, sp.x, sp.y + 14);
          });
        } else if (effect.spellId === 'twilight_onslaught_soak') {
          const sx = effect.x;
          const sy = effect.y;
          const sr = effect.radius || 75;
          const sec = Math.max(0, (effect.remainingMs || 0) / 1000).toFixed(1);
          ctx.strokeStyle = 'rgba(216, 180, 254, 0.9)';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          withUprightAt(ctx, viewCam, { x: sx, y: sy - sr }, (sp) => {
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillText(`🟣 集合分摊 (${sec}s)`, sp.x + 1, sp.y - 7);
            ctx.fillStyle = '#F3E8FF';
            ctx.fillText(`🟣 集合分摊 (${sec}s)`, sp.x, sp.y - 8);
          });
        }
        ctx.restore();
      }

      // Networked guests: pull boss toward host-authoritative position.
      // Host keeps local chase AI — do not lerp-overwrite host boss pose.
      if (syncRemotePositions && isNetworkGuestRef.current) {
        if (bossUnit?.position) {
          bossPosRef.current.x += (bossUnit.position.x - bossPosRef.current.x) * 0.4;
          bossPosRef.current.y += (bossUnit.position.y - bossPosRef.current.y) * 0.4;
        }
      }

      // ── Process AI Companions Pathfinding & Behaviors (Item 5: Perturbation & Micro-stepping) ──
      const bossPos = bossPosRef.current;
      // 主坦世界坐标：非高优意图时队友须保持在其 25 码内
      const primaryTank =
        orderTanksByThreatPriority(units.filter((t) => t.role === 'TANK'))[0] ??
        units.find((t) => t.role === 'TANK' && ((t.isAlive ?? t.alive) && t.hp > 0));
      let primaryTankPos: { x: number; y: number } | undefined;
      if (primaryTank) {
        if (primaryTank.isPlayer) {
          primaryTankPos = { ...playerPosRef.current };
        } else {
          primaryTankPos =
            companionPositionsRef.current[primaryTank.id] ||
            (primaryTank.position ? { ...primaryTank.position } : undefined);
        }
      }

      const bossTargetUnit =
        (bossTargetId
          ? units.find((t) => t.id === bossTargetId && (t.alive ?? t.isAlive) && t.hp > 0)
          : null) ?? null;
      const bossTargetPos = bossTargetUnit
        ? bossTargetUnit.isPlayer
          ? { ...playerPosRef.current }
          : companionPositionsRef.current[bossTargetUnit.id] ||
            (bossTargetUnit.position ? { ...bossTargetUnit.position } : undefined)
        : undefined;
      const bossFacingRad = resolveUnitFacingRad({
        position: bossPos,
        isMoving: isBossMovingRef.current,
        moveDx: bossMoveDirRef.current.dx,
        moveDy: bossMoveDirRef.current.dy,
        targetPos: bossTargetPos ?? null,
        fallbackFacingRad: (bossUnit as { facingRad?: number } | undefined)?.facingRad,
      });
      if (bossUnit) {
        (bossUnit as { facingRad?: number }).facingRad = bossFacingRad;
      }
      const aggroIsNonTank = !!(bossTargetUnit && bossTargetUnit.role !== 'TANK');

      let nearestHealerPos: { x: number; y: number } | undefined;
      {
        let bestD = Infinity;
        for (const h of units) {
          if (h.role !== 'HEALER' || !((h.isAlive ?? h.alive) && h.hp > 0)) continue;
          const hp = h.isPlayer
            ? playerPosRef.current
            : companionPositionsRef.current[h.id] || h.position;
          if (!hp) continue;
          const d = Math.hypot(hp.x - bossPos.x, hp.y - bossPos.y);
          if (d < bestD) {
            bestD = d;
            nearestHealerPos = { x: hp.x, y: hp.y };
          }
        }
      }

      units.forEach((u, idx) => {
        if (u.isPlayer) return;

        // Missing pose (hot-join etc.): seed on predicted combat formation, slight perturb
        if (!companionPositionsRef.current[u.id]) {
          const seed = u.position || getCombatFormationPos(u, idx, bossPos, 1);
          const perturbX = ((idx * 17) % 21) - 10;
          const perturbY = ((idx * 23) % 21) - 10;
          companionPositionsRef.current[u.id] = {
            x: seed.x + (u.position ? 0 : perturbX * 0.35),
            y: seed.y + (u.position ? 0 : perturbY * 0.35),
          };
        }
        const pos = companionPositionsRef.current[u.id];
        const isAlive = (u.isAlive ?? u.alive) && u.hp > 0;
        if (!isAlive) return;

        // Network sync: guests follow all remotes; host only follows remote humans (MOVE).
        // Do NOT use onNetworkMoveReport as a guest signal — App always passes that callback,
        // which previously made host AI early-return and freeze (no heal-zone / dodge / fidget).
        // Host AI companions still pathfind locally and write unit.position for broadcast.
        const followHostPos =
          syncRemotePositions &&
          !!u.position &&
          (isNetworkGuestRef.current || !!u.isHumanControlled);
        if (followHostPos) {
          pos.x += (u.position.x - pos.x) * 0.4;
          pos.y += (u.position.y - pos.y) * 0.4;
          return;
        }

        let targetX = pos.x;
        let targetY = pos.y;
        const hpPct = u.hp / u.maxHp;

        // 1. 默认阵型：与 PULL_APPROACH 共用 getCombatFormationPos，开怪不瞬移
        const defaultTarget = getCombatFormationPos(u, idx, bossPos, hpPct);

        // 2. 走位可行域求交：躲红圈 → 仇恨纠偏 → 危血绿圈 → 健康输出位叠层 → 主坦 25 码
        const looseAddForTank =
          u.role === 'TANK'
            ? findLooseAddForTank(u, enemyUnitsRef.current, bossUnit, units)
            : null;
        const attackTargetPos =
          looseAddForTank?.position
            ? { x: looseAddForTank.position.x, y: looseAddForTank.position.y }
            : bossPos;

        const allyPositions = units
          .filter((a) => (a.isAlive ?? a.alive) && a.hp > 0 && !isTotemUnit(a))
          .map((a) => {
            const ap = a.isPlayer
              ? playerPosRef.current
              : companionPositionsRef.current[a.id] || a.position;
            return ap ? { id: a.id, x: ap.x, y: ap.y, unit: a } : null;
          })
          .filter((x): x is { id: string; x: number; y: number; unit: Unit } => x !== null);
        const dungeonPriorityZone = computeDungeonPriorityZone({
          unit: u,
          boss: bossUnit,
          bossPos,
          allies: allyPositions,
          groundEffects,
          bossCastingSpellName: (bossUnit as { castingSpellName?: string } | undefined)?.castingSpellName,
        });

        const friendlyUnitIds = new Set(units.filter((x) => x.role !== 'ENEMY').map((x) => x.id));
        const formationResult = evaluateGroundFormationPosition({
          currentPos: pos,
          unit: u,
          groundEffects,
          defaultTarget,
          bossPos,
          attackTargetPos,
          tankPos: primaryTank && primaryTank.id !== u.id ? primaryTankPos : undefined,
          bossFacingRad,
          bossTargetUnitId: bossTargetId,
          aggroIsNonTank,
          nearestHealerPos,
          isPrimaryTank: !!primaryTank && primaryTank.id === u.id,
          dungeonPriorityZone,
          friendlyUnitIds,
        });

        targetX = formationResult.targetPos.x;
        targetY = formationResult.targetPos.y;

        // 3. 多动症：仅在 allowFidget 的可行域内；单次位移 ≤5 码，且不得踏入红圈
        {
          const canFidget =
            runPhase === 'BOSS_COMBAT' &&
            !!bossUnit &&
            !!(bossUnit.alive ?? bossUnit.isAlive) &&
            formationResult.allowFidget;

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
          const fidgetCap = Math.min(
            formationResult.fidgetMaxRadiusPx || FIDGET_MAX_PX,
            FIDGET_MAX_PX
          );

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
              if (atIntent && movedPx < 0.85) {
                fidget.idleMs += frameDtMs;
                if (fidget.idleMs >= idleThresholdMs) {
                  const angle =
                    (((personality.seed + Math.floor(nowMs / 17) + idx * 97) % 360) * Math.PI) / 180;
                  const radius = Math.min(
                    fidgetCap,
                    personality.fidgetRadiusPx * (0.55 + ((personality.seed >> 5) % 46) / 100)
                  );
                  let ox = Math.cos(angle) * radius;
                  let oy = Math.sin(angle) * radius;
                  const trial = {
                    x: formationResult.targetPos.x + ox,
                    y: formationResult.targetPos.y + oy,
                  };
                  if (
                    groundEffects.some(
                      (g) => !isFriendlyGroundEffect(g, friendlyUnitIds) && isPosInHazard(trial, g)
                    )
                  ) {
                    ox = 0;
                    oy = 0;
                  }
                  fidget.ox = ox;
                  fidget.oy = oy;
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

        // 踱步偏移后再次压回主坦 25 码（仅低优默认可踱步意图；躲圈与吃治疗圈不受限）
        if (
          primaryTankPos &&
          u.role !== 'TANK' &&
          formationResult.allowFidget &&
          (formationResult.tradeOffDecision === 'DEFAULT_POSITION' ||
            formationResult.tradeOffDecision === 'RETURN_TO_BOSS' ||
            formationResult.tradeOffDecision === 'STAY_IN_CURRENT_HEAL_ZONE')
        ) {
          const stacked = clampPosWithinTankRange({ x: targetX, y: targetY }, primaryTankPos);
          targetX = stacked.x;
          targetY = stacked.y;
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
          unitMoveDirRef.current[u.id] = { dx: dx / dist, dy: dy / dist };
        } else {
          (u as any).isMoving = false;
          unitMoveDirRef.current[u.id] = { dx: 0, dy: 0 };
        }

        // 全图自由移动，外圈不限制通行
        pos.x = Math.max(30, Math.min(width - 30, pos.x));
        pos.y = Math.max(30, Math.min(height - 30, pos.y));

        // Sync to unit position
        u.position.x = pos.x;
        u.position.y = pos.y;
      });

      // ── Process Boss Movement & Pursuit AI (受距离约束，够不着会跑过去) ──
      // Guests: boss pose already lerped from host snapshot — skip local chase AI.
      // Host must keep chase AI (onNetworkMoveReport is always passed from App).
      let bossIsMoving = false;
      const guestFollowHostBoss = syncRemotePositions && isNetworkGuestRef.current;
      if (
        !guestFollowHostBoss &&
        runPhase === 'BOSS_COMBAT' &&
        bossUnit &&
        (bossUnit.alive ?? bossUnit.isAlive) &&
        bossUnit.hp > 0
      ) {
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
                bossMoveDirRef.current = { dx: dx / dist, dy: dy / dist };
                bossPosRef.current.x += (dx / dist) * step;
                bossPosRef.current.y += (dy / dist) * step;
              }
            } else if (tPos) {
              // 站定时朝向打击目标（供下一帧走位 / 正面锥使用）
              bossMoveDirRef.current = { dx: 0, dy: 0 };
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

      // Decorative tick% combat FX removed — ST hit FX driven by recentActions (combatHitFx)

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

      // 八向朝向：移动中朝移动方向，否则朝释法/打击对象
      const resolveUnitLookTarget = (u: Unit): { x: number; y: number } | null => {
        if (u.role === 'ENEMY' || u.classId === 'BOSS') {
          return bossTargetPos ?? primaryTankPos ?? null;
        }
        // 当前选中目标（玩家常用）
        if (selectedUnitId) {
          if (bossUnit && (selectedUnitId === bossUnit.id || selectedUnitId === 'boss')) {
            return { ...bossPosRef.current };
          }
          const sel = units.find((t) => t.id === selectedUnitId);
          if (sel) {
            if (sel.isPlayer) return { ...playerPosRef.current };
            const cp = companionPositionsRef.current[sel.id];
            if (cp) return { ...cp };
            if (sel.position) return { x: sel.position.x, y: sel.position.y };
          }
        }
        // 默认：输出/坦克看 Boss；治疗也看 Boss（无选中时）
        if (bossUnit && ((bossUnit.isAlive ?? bossUnit.alive) && bossUnit.hp > 0)) {
          return { ...bossPosRef.current };
        }
        return null;
      };

      for (const u of units) {
        const pos = u.isPlayer
          ? playerPosRef.current
          : companionPositionsRef.current[u.id] ||
            (u.position ? { x: u.position.x, y: u.position.y } : null);
        if (!pos) continue;
        const moveDir = u.isPlayer
          ? playerMoveDirRef.current
          : unitMoveDirRef.current[u.id] || { dx: 0, dy: 0 };
        const moving =
          !!(u as { isMoving?: boolean }).isMoving ||
          Math.hypot(moveDir.dx, moveDir.dy) > 0.15;
        if (u.isPlayer && !moving) {
          playerMoveDirRef.current = { dx: 0, dy: 0 };
        }
        const facingRad = resolveUnitFacingRad({
          position: pos,
          isMoving: moving,
          moveDx: moveDir.dx,
          moveDy: moveDir.dy,
          targetPos: resolveUnitLookTarget(u),
          fallbackFacingRad: (u as { facingRad?: number }).facingRad,
        });
        (u as { facingRad?: number }).facingRad = facingRad;
      }
      lastPlayerPosForFacingRef.current = { ...playerPosRef.current };

      // Layer: terrain auras < boss/chars (camera depth) < hit FX < HP bars < SCT
      // ISO: closer-to-camera billboards paint later (painter's algorithm)
      {
        type DepthSprite = { depth: number; paint: () => void };
        const sprites: DepthSprite[] = [];
        if (bossUnit) {
          const bPos = bossPosRef.current;
          const bFacing = (bossUnit as { facingRad?: number }).facingRad || 0;
          sprites.push({
            depth: viewDepthKey(bPos.x, bPos.y, viewCam),
            paint: () => {
              withUprightAt(ctx, viewCam, bPos, (sp) => {
                drawBossModel(
                  ctx,
                  bossUnit,
                  sp,
                  bossUnit.id === selectedUnitId,
                  tickCount,
                  isBossMovingRef.current,
                  {
                    showName: prefs.showBossName && !prefs.showBossHp,
                    facingRad: viewRelativeFacingRad(bFacing, viewCam),
                  }
                );
              });
            },
          });
        }
        for (const add of livingAdds) {
          const aPos = add.position || { x: bossPosRef.current.x + 40, y: bossPosRef.current.y + 30 };
          const showAddHpBar =
            prefs.showAddHp || add.id === selectedUnitId || add.id === focusTargetId;
          const showAddNameOnly =
            (prefs.showAddName || add.id === selectedUnitId) && !showAddHpBar;
          sprites.push({
            depth: viewDepthKey(aPos.x, aPos.y, viewCam),
            paint: () => {
              withUprightAt(ctx, viewCam, aPos, (sp) => {
                drawEnemyAddModel(ctx, add, sp, add.id === selectedUnitId, tickCount, {
                  showName: showAddNameOnly,
                });
              });
            },
          });
        }
        units.forEach((u, idx) => {
          const isPlayer = u.isPlayer;
          const pos = isPlayer
            ? playerPosRef.current
            : companionPositionsRef.current[u.id] || { x: 160 + idx * 25, y: 150 + idx * 30 };
          const showNm = shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
          const showHp = shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId);
          const wFacing = (u as { facingRad?: number }).facingRad || 0;
          sprites.push({
            depth: viewDepthKey(pos.x, pos.y, viewCam),
            paint: () => {
              withUprightAt(ctx, viewCam, pos, (sp) => {
                drawClassCharacter(ctx, u, sp, !!isPlayer, u.id === selectedUnitId, tickCount, idx, {
                  showName: showNm && !showHp,
                  facingRad: viewRelativeFacingRad(wFacing, viewCam),
                });
              });
            },
          });
        });
        sprites.sort((a, b) => a.depth - b.depth);
        for (const s of sprites) s.paint();
      }

      const bossLinkBeams = resolveBossLinkBeams({
        units,
        enemyUnits: enemyUnitsRef.current,
        bossUnit,
        groundEffects,
        resolveUnitPos: (unitId) => {
          const u = unitsById.get(unitId);
          if (u) {
            if (u.isPlayer) return { ...playerPosRef.current };
            const c = companionPositionsRef.current[unitId];
            if (c) return { ...c };
            if (bossUnit && unitId === bossUnit.id) return { ...bossPosRef.current };
            return u.position ? { x: u.position.x, y: u.position.y } : null;
          }
          if (bossUnit && unitId === bossUnit.id) return { ...bossPosRef.current };
          const e = (enemyUnitsRef.current || []).find((x) => x.id === unitId);
          return e?.position ? { x: e.position.x, y: e.position.y } : null;
        },
      });
      drawBossLinkBeams(ctx, bossLinkBeams, tickCount);

      // Helix 胸弹携带者：随人实时移动的 55px 爆炸警戒圈
      for (const u of units) {
        const bombBuff = u.buffs?.find((b) => b.spellId === 'chest_bomb');
        if (!bombBuff || !(u.isAlive ?? u.alive) || u.hp <= 0) continue;
        const cPos = u.isPlayer
          ? playerPosRef.current
          : companionPositionsRef.current[u.id] || u.position;
        if (!cPos) continue;
        const pulse = 0.22 + 0.12 * Math.sin(tickCount * 0.28);
        ctx.save();
        ctx.fillStyle = `rgba(239, 68, 68, ${pulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(cPos.x, cPos.y, 55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(cPos.x, cPos.y, 55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        withUprightAt(ctx, viewCam, cPos, (sp) => {
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.fillText('💣 胸弹范围(远离)', sp.x + 1, sp.y - 61);
          ctx.fillStyle = '#FCA5A5';
          ctx.fillText('💣 胸弹范围(远离)', sp.x, sp.y - 62);
        });
        ctx.restore();
      }

      drawHitFx(ctx, hitFxRef.current, nowFx, hitFxFilter);

      // Zonozz 黑光球持球者视觉特效：连线指引 + 脚下脉冲圈 + 头顶黑光球
      for (const u of units) {
        const ballBuff = u.buffs?.find((b) => b.spellId === 'black_blood_ball_carrier');
        if (!ballBuff || !(u.isAlive ?? u.alive)) continue;
        const cPos = u.isPlayer
          ? playerPosRef.current
          : companionPositionsRef.current[u.id] || u.position || { x: 200, y: 200 };
        const bPos = bossPosRef.current;
        const pulse = 0.5 + 0.5 * Math.sin(tickCount * 0.22);

        ctx.save();
        // Dashed tether line from carrier to Boss
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.55 + pulse * 0.35})`;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(cPos.x, cPos.y);
        ctx.lineTo(bPos.x, bPos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Pulsing carrier ring
        ctx.strokeStyle = '#C084FC';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cPos.x, cPos.y, 20 + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();

        const sec = Math.max(0, (ballBuff.remainingMs || 0) / 1000).toFixed(1);
        withUprightAt(ctx, viewCam, cPos, (sp) => {
          // Floating Void Orb above carrier (upright circle)
          const orbY = sp.y - 38 + Math.sin(tickCount * 0.16) * 3;
          const grad = ctx.createRadialGradient(sp.x, orbY, 2, sp.x, orbY, 14);
          grad.addColorStop(0, '#09090B');
          grad.addColorStop(0.55, '#6D28D9');
          grad.addColorStop(1, 'rgba(192, 132, 252, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(sp.x, orbY, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FDE047';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sp.x, orbY, 9, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.fillText(`⚫ 持球！去撞Boss (${sec}s)`, sp.x + 1, orbY - 15);
          ctx.fillStyle = '#FDE047';
          ctx.fillText(`⚫ 持球！去撞Boss (${sec}s)`, sp.x, orbY - 16);
        });
        ctx.restore();
      }

      // HP bars overlay — upright billboards above models
      if (bossUnit && prefs.showBossHp) {
        withUprightAt(ctx, viewCam, bossPosRef.current, (sp) => {
          drawBossHpBar(ctx, bossUnit, sp, {
            name: prefs.showBossName ? bossUnit.name : null,
          });
        });
      }
      for (const add of livingAdds) {
        const showAddHpBar =
          prefs.showAddHp || add.id === selectedUnitId || add.id === focusTargetId;
        if (!showAddHpBar) continue;
        const aPos = add.position || { x: bossPosRef.current.x + 40, y: bossPosRef.current.y + 30 };
        withUprightAt(ctx, viewCam, aPos, (sp) => {
          drawEnemyAddHpBar(ctx, add, sp, {
            name: prefs.showAddName ? add.name : null,
          });
        });
      }
      units.forEach((u, idx) => {
        if (!shouldShowUnitHpBar(u, selectedUnitId, focusTargetId, prefs, localPlayerId)) return;
        const pos = u.isPlayer
          ? playerPosRef.current
          : (companionPositionsRef.current[u.id] || { x: 160 + idx * 25, y: 150 + idx * 30 });
        withUprightAt(ctx, viewCam, pos, (sp) => {
          drawUnitHpBar(ctx, u, sp, {
            name: shouldShowCombatName(u, selectedUnitId, focusTargetId, prefs, localPlayerId)
              ? u.name
              : null,
          });
        });
      });

      // ── Draw Floating Combat Text (SCT) ────────────────────────────────────
      // 范围由 combatDisplayPrefs 控制（默认：我伤/我疗/疗我/伤我；友方伤/疗关）
      const nowSCT = Date.now();
      const sctPrefs = displayPrefs;

      for (const fct of floatingTexts) {
        const ageMs = nowSCT - fct.createdAtMs;
        if (ageMs > 1500) continue;

        const mode = resolveLocalFloatingTextMode(fct, {
          localPlayerId,
          units,
          bossUnitId: bossUnit?.id,
          prefs: sctPrefs,
        });
        if (!mode) continue;

        const targetUnit = units.find((u) => u.id === fct.targetId);
        let feet: { x: number; y: number } | null = null;
        let headLift = 25;
        const isTargetBoss = fct.targetId === bossUnit?.id;

        if (isTargetBoss) {
          feet = { x: bossPos.x, y: bossPos.y };
          headLift = 35;
        } else if (targetUnit) {
          const uPos = targetUnit.isPlayer
            ? playerPosRef.current
            : companionPositionsRef.current[targetUnit.id];
          if (uPos) feet = { x: uPos.x, y: uPos.y };
        }
        if (!feet) continue;

        let hash = 0;
        for (let i = 0; i < fct.id.length; i++) hash = (hash << 5) - hash + fct.id.charCodeAt(i);
        const xJitter = (Math.abs(hash) % 36) - 18;

        const progress = ageMs / 1500;
        const yOffset = Math.sin(progress * Math.PI * 0.5) * 45;
        const alpha = Math.max(0, 1 - Math.pow(progress, 1.4));

        const isAllyFx = mode === 'ALLY_OUTGOING' || mode === 'ALLY_HEAL';
        const basePx =
          mode === 'OUTGOING' || mode === 'ALLY_OUTGOING'
            ? 15.5
            : mode === 'HEAL_SELF' || mode === 'ALLY_HEAL'
              ? 14.5
              : 15;
        const fontPx = fct.isCrit ? basePx * 1.2 : basePx;

        const screenFeet = worldToView(feet.x, feet.y, viewCam);
        enterScreenSpaceFromIso(ctx, viewCam);
        ctx.save();
        ctx.globalAlpha = alpha * (isAllyFx ? 0.72 : 1);
        ctx.translate(screenFeet.x + xJitter, screenFeet.y - headLift - yOffset);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${fontPx}px "Microsoft YaHei", sans-serif`;
        ctx.lineWidth = fct.isCrit ? 3 : 2.5;
        ctx.strokeStyle = '#000000';

        if (mode === 'OUTGOING' || mode === 'ALLY_OUTGOING') {
          ctx.fillStyle = mode === 'ALLY_OUTGOING' ? '#FDE68A' : '#FFFF00';
          ctx.strokeText(fct.text, 0, 0);
          ctx.fillText(fct.text, 0, 0);
        } else if (mode === 'HEAL_SELF' || mode === 'ALLY_HEAL') {
          ctx.fillStyle =
            mode === 'ALLY_HEAL'
              ? fct.isCrit
                ? '#86EFAC'
                : '#4ADE80'
              : fct.isCrit
                ? '#4ADE80'
                : '#22C55E';
          ctx.strokeStyle = '#022c22';
          const healStr = `+${fct.text.replace(/^\+/, '')}`;
          ctx.strokeText(healStr, 0, 0);
          ctx.fillText(healStr, 0, 0);
        } else {
          ctx.fillStyle = fct.isCrit ? '#FF0000' : '#EF4444';
          ctx.strokeStyle = '#450a0a';
          const dmgStr = `-${fct.text.replace(/^-/, '')}`;
          ctx.strokeText(dmgStr, 0, 0);
          ctx.fillText(dmgStr, 0, 0);
        }
        ctx.restore();
        ctx.restore(); // enterScreenSpaceFromIso
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

        // Flat disc: 透明度 ≤5yd 40% … ≥30yd 96%（alpha = 1−透明度），无羽化
        const ringAlpha = resolveAoeAlphaByRadiusPx(radius);
        const hex = (color || '#10b981').replace('#', '');
        const rr = parseInt(hex.slice(0, 2), 16) || 16;
        const gg = parseInt(hex.slice(2, 4), 16) || 185;
        const bb = parseInt(hex.slice(4, 6), 16) || 129;

        if (isAllowed) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${ringAlpha})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          // 玩家点地预览：友方施法者 → 强制白描边
          ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, 0.55 + ringAlpha * 0.45)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 8, y);
          ctx.lineTo(x + 8, y);
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x, y + 8);
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();

          withUprightAt(ctx, viewCam, { x, y: y + radius }, (sp) => {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 4;
            ctx.fillText(`左键释放 【${name}】`, sp.x, sp.y + 18);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#9ca3af';
            ctx.font = '9px sans-serif';
            ctx.fillText('右键或ESC取消', sp.x, sp.y + 30);
          });
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = `rgba(20, 20, 30, ${Math.min(0.55, ringAlpha)})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(150, 50, 50, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 6, y);
          ctx.lineTo(x + 6, y);
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x, y + 6);
          ctx.stroke();

          withUprightAt(ctx, viewCam, { x, y: y + radius }, (sp) => {
            ctx.fillStyle = '#f87171';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('❌ 超出施法范围 (光圈变暗不可释放)', sp.x, sp.y + 18);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '9px sans-serif';
            ctx.fillText('右键或ESC取消', sp.x, sp.y + 30);
          });
        }

        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [runPhase, dungeonTier, targetBossName, initTrashMobs, refreshMazeLayout]);

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
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        className="w-full h-full block"
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
          {runPhase === 'TRAVEL_RECOVERY' ? (
            <>
              迷宫自动行军 ·
              {displayPrefs.canvasViewMode === 'ISO' ? (
                <> 按住 <strong className="text-amber-300 bg-slate-800 px-1 rounded">右键</strong> 旋转视角/俯仰 · </>
              ) : null}
              滚轮缩放（±50%）
            </>
          ) : (
            <>
              单击选人 · 长按 <strong className="text-white bg-slate-800 px-1 rounded">W A S D</strong> 连续移动 ·
              滚轮缩放（±50%）
              {displayPrefs.canvasViewMode === 'ISO' ? (
                <>
                  {' '}
                  · 按住 <strong className="text-amber-300 bg-slate-800 px-1 rounded">右键</strong>{' '}
                  左右转视角/俯仰 · 按住右键按 <strong className="text-amber-300 bg-slate-800 px-1 rounded">左键</strong> 向前走
                </>
              ) : null}
            </>
          )}
          · 按 <strong className="text-amber-300 bg-slate-800 px-1 rounded">Alt+1~5</strong> 切换当前小队目标 · 施法距离不足自动跑向目标
        </span>
      </div>
    </div>
  );
};
