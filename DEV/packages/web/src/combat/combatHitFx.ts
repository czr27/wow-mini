/**
 * Single-target hit FX: semi-transparent, stackable.
 * Proj ≤12×12 (scaled by unit); slash ≤6×24 from melee hand (sharp blade);
 * heal = 5 flakes spiral up around body.
 * Driven by NetworkCombatAction; clients draw locally. Maze reuses the same API.
 */
import type { NetworkCombatAction, Unit } from '@cata-raid-sim/engine';
import { isMeleeClassSpec, isEnemyActorUnit } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';

/** Projectile / flake max square (before unit scale). */
export const HIT_FX_MAX_SIZE_PX = 12;
/** Melee slash bounding box (width × chord). */
export const HIT_FX_SLASH_W = 6;
export const HIT_FX_SLASH_H = 24;
export const HIT_FX_ALPHA = 0.72;
/** Boss projectile/slash base opacity (more solid than party FX). */
export const HIT_FX_BOSS_ALPHA = 0.94;
/** Base unit draw scale in combat (maze party uses 0.7). */
export const HIT_FX_DEFAULT_UNIT_SCALE = 1;
/**
 * Boss FX size = bossHeight / charHeight.
 * Boss body approx feet(+36)-crown(-48)=84px; party approx footY(+14)-name(-34)=48px.
 */
export const HIT_FX_CHAR_HEIGHT_PX = 48;
export const HIT_FX_BOSS_HEIGHT_PX = 84;
export const HIT_FX_BOSS_SIZE_MULT = HIT_FX_BOSS_HEIGHT_PX / HIT_FX_CHAR_HEIGHT_PX;
/** Triple-tap impact: 3 copies, 20ms apart. */
export const HIT_FX_IMPACT_COUNT = 3;
export const HIT_FX_IMPACT_STAGGER_MS = 20;

const MAX_PROJECTILES = 36;
const MAX_SLASHES = 30;
const MAX_SNOW_BURSTS = 6;
const FLAKES_PER_BURST = 5;

const PROJ_MS = 280;
const SLASH_MS = 200;
const SNOW_FLAKE_MS = 420;
const SNOW_STAGGER_MS = 70;

export type HitProjShape = 'droplet' | 'orb' | 'arrow' | 'star' | 'bolt' | 'shard' | 'spike';

export type HitFxSide = 'FRIENDLY' | 'ENEMY';

/** Magic casters lob on an arc; physical (hunter etc.) fly straight. */
export type ProjectileFlightStyle = 'arc' | 'straight';

export interface HitProjectile {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  shape: HitProjShape;
  /** Multiplier from actor/target unit draw scale */
  scale: number;
  side: HitFxSide;
  /** arc = parabola (mage / balance druid…); straight = hunter line */
  flight: ProjectileFlightStyle;
  bornAt: number;
  durationMs: number;
}

/**
 * 法系抛物线（法师、平衡德等）；物理系直线（猎人等）。
 * Boss 远程默认走弧线（偏法术感）。
 */
export function resolveProjectileFlightStyle(classId?: string | null): ProjectileFlightStyle {
  const id = (classId || '').toUpperCase();
  switch (id) {
    case 'HUNTER':
    case 'WARRIOR':
    case 'ROGUE':
      return 'straight';
    case 'MAGE':
    case 'WARLOCK':
    case 'PRIEST':
    case 'SHAMAN':
    case 'DRUID':
    case 'PALADIN':
    case 'DK':
    case 'BOSS':
      return 'arc';
    default:
      return 'arc';
  }
}

/** Sample position (+ facing) along a flight path. t in [0,1]. */
export function sampleProjectileFlight(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  t: number,
  style: ProjectileFlightStyle = 'straight'
): { x: number; y: number; angle: number; lift: number } {
  const u = Math.max(0, Math.min(1, t));
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (style === 'arc' && dist > 1) {
    const lift = Math.min(96, Math.max(26, dist * 0.3));
    const x = fromX + dx * u;
    const y = fromY + dy * u - lift * 4 * u * (1 - u);
    // Tangent of the parabola for sprite facing
    const dYdu = dy - lift * 4 * (1 - 2 * u);
    return { x, y, angle: Math.atan2(dYdu, dx), lift };
  }
  return {
    x: fromX + dx * u,
    y: fromY + dy * u,
    angle: Math.atan2(dy, dx),
    lift: 0,
  };
}

export interface HitSlash {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  scale: number;
  side: HitFxSide;
  bornAt: number;
  durationMs: number;
}

/** One flake in a heal burst: spiral up around body. */
export interface HealSnowflakeFlake {
  index: number;
  /** Stagger delay from burst bornAt */
  delayMs: number;
  /** Phase offset on the spiral (radians) */
  phase: number;
}

export interface HealSnowflakeBurst {
  id: string;
  actorId: string;
  /** Body center (spiral origin) */
  cx: number;
  cy: number;
  scale: number;
  /** 0..1 cast progress while reading; 1 when released */
  form: number;
  fading: boolean;
  flakes: HealSnowflakeFlake[];
  bornAt: number;
  expireAt: number;
}

export interface HitFxState {
  projectiles: HitProjectile[];
  slashes: HitSlash[];
  snowBursts: HealSnowflakeBurst[];
}

export function createHitFxState(): HitFxState {
  return { projectiles: [], slashes: [], snowBursts: [] };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '#888888').replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 136,
    parseInt(full.slice(2, 4), 16) || 136,
    parseInt(full.slice(4, 6), 16) || 136,
  ];
}

function rgbaFromHex(hex: string, alpha = HIT_FX_ALPHA): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

const BOSS_SHAPES: HitProjShape[] = ['bolt', 'shard', 'orb', 'spike'];
/** Bright red for boss/enemy hit FX (slash / projectile). */
export const BOSS_HIT_FX_COLOR = '#EF4444';
const BOSS_COLOR = BOSS_HIT_FX_COLOR;
const HEAL_SNOW_COLOR = '#a3e635';

/** Class → ranged shape; color always class color (mage droplet stays sky-blue class color). */
export function rangedShapeForClass(classId: string): { shape: HitProjShape; color: string } {
  const id = (classId || '').toUpperCase();
  const color = CLASS_COLORS[id as keyof typeof CLASS_COLORS] || '#69CCF0';
  switch (id) {
    case 'MAGE':
      return { shape: 'droplet', color };
    case 'WARLOCK':
      return { shape: 'orb', color };
    case 'HUNTER':
      return { shape: 'arrow', color };
    case 'PRIEST':
      return { shape: 'star', color };
    case 'SHAMAN':
      return { shape: 'bolt', color };
    case 'DRUID':
      return { shape: 'orb', color };
    case 'PALADIN':
      return { shape: 'star', color };
    case 'DK':
      return { shape: 'shard', color };
    case 'WARRIOR':
      return { shape: 'spike', color };
    case 'ROGUE':
      return { shape: 'shard', color };
    default:
      return { shape: 'orb', color };
  }
}

function bossRangedShape(bossName: string): HitProjShape {
  return BOSS_SHAPES[hashStr(bossName || 'boss') % BOSS_SHAPES.length];
}

function isSingleTargetAction(a: NetworkCombatAction): boolean {
  if (!a.targetId) return false;
  if (a.kind === 'GROUND_PLACE' || a.kind === 'SUMMON') return false;
  if (a.radius && a.radius > 0) return false;
  if (a.aoePulse) return false;
  return a.kind === 'CAST_START' || a.kind === 'CAST_LAND' || a.kind === 'INSTANT' || a.kind === 'INTERRUPT';
}

function lookHealSpell(spellId: string, spellName?: string): boolean {
  const s = `${spellId || ''} ${spellName || ''}`.toLowerCase();
  if (s.includes('chain_heal')) return false;
  return (
    s.includes('heal') ||
    s.includes('flash') ||
    s.includes('nourish') ||
    s.includes('regrowth') ||
    s.includes('rejuven') ||
    s.includes('renew') ||
    s.includes('greater_heal') ||
    s.includes('healing_touch') ||
    s.includes('holy_light') ||
    s.includes('holy_shock') ||
    s.includes('word_of_glory') ||
    s.includes('治疗') ||
    s.includes('愈合') ||
    s.includes('回春') ||
    s.includes('快速治疗') ||
    s.includes('圣光')
  );
}

function lookDamageSpell(spellId: string, spellName?: string): boolean {
  if (lookHealSpell(spellId, spellName)) return false;
  const s = `${spellId || ''} ${spellName || ''}`.toLowerCase();
  if (s.includes('shield') || s.includes('buff') || s.includes('totem')) return false;
  return true;
}

function unitPos(
  unitsById: Map<string, Unit>,
  id: string | null | undefined,
  fallback?: { x: number; y: number }
): { x: number; y: number } | null {
  if (!id) return fallback || null;
  const u = unitsById.get(id);
  if (u?.position) return { x: u.position.x, y: u.position.y };
  return fallback || null;
}

function pushCap<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

/** Push the same impact N times with staggered bornAt (strike feel). */
function pushImpactCopies<T extends { id: string; bornAt: number }>(
  arr: T[],
  make: (index: number, bornAt: number) => T,
  max: number,
  now: number
): void {
  for (let i = 0; i < HIT_FX_IMPACT_COUNT; i++) {
    const bornAt = now + i * HIT_FX_IMPACT_STAGGER_MS;
    pushCap(arr, make(i, bornAt), max);
  }
}

function makeFlakes(): HealSnowflakeFlake[] {
  return Array.from({ length: FLAKES_PER_BURST }, (_, i) => ({
    index: i,
    delayMs: i * SNOW_STAGGER_MS,
    phase: (i / FLAKES_PER_BURST) * Math.PI * 2,
  }));
}

/** Body center used as spiral origin. */
function bodyCenter(pos: { x: number; y: number }, _scale: number) {
  return { cx: pos.x, cy: pos.y };
}

/** Melee hand just in front of actor, facing target — slash pivots here. */
export function meleeHandPose(
  from: { x: number; y: number },
  to: { x: number; y: number },
  scale = HIT_FX_DEFAULT_UNIT_SCALE
): { x: number; y: number; angle: number } {
  const s = Math.max(0.5, scale);
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const reach = 11 * s;
  return {
    x: from.x + Math.cos(ang) * reach,
    y: from.y + Math.sin(ang) * reach + 2 * s,
    angle: ang,
  };
}

export type IngestHitFxOpts = {
  actions: NetworkCombatAction[];
  unitsById: Map<string, Unit>;
  seenIds: Set<string>;
  now?: number;
  bossName?: string;
  resolvePos?: (unitId: string) => { x: number; y: number } | null;
  /** Per-unit draw scale (maze 0.7, combat 1, boss larger). */
  resolveScale?: (unitId: string) => number;
  skipActorIds?: Set<string>;
};

/**
 * Ingest combat actions into hit-fx state.
 */
export function ingestCombatActionsAsHitFx(state: HitFxState, opts: IngestHitFxOpts): boolean {
  const now = opts.now ?? performance.now();
  let changed = false;
  for (const a of opts.actions) {
    if (!a?.id || opts.seenIds.has(a.id)) continue;
    if (!isSingleTargetAction(a)) continue;
    if (opts.skipActorIds?.has(a.actorId)) continue;

    opts.seenIds.add(a.id);
    const actor = opts.unitsById.get(a.actorId);
    const aPos =
      opts.resolvePos?.(a.actorId) ||
      unitPos(opts.unitsById, a.actorId) ||
      (typeof a.x === 'number' && typeof a.y === 'number' ? { x: a.x, y: a.y } : null);
    const tPos =
      (a.targetId && opts.resolvePos?.(a.targetId)) ||
      unitPos(opts.unitsById, a.targetId) ||
      aPos;
    const actorScale = opts.resolveScale?.(a.actorId) ?? HIT_FX_DEFAULT_UNIT_SCALE;

    if (a.kind === 'INTERRUPT') {
      state.snowBursts = state.snowBursts.filter((s) => s.actorId !== a.actorId);
      changed = true;
      continue;
    }

    const isHeal =
      actor?.role === 'HEALER' ||
      lookHealSpell(a.spellId, a.spellName) ||
      a.visualTone === 'HEAL';
    const isEnemy = isEnemyActorUnit(actor) || actor?.role === 'ENEMY' || actor?.classId === 'BOSS';

    if (isHeal && !isEnemy) {
      if (!aPos) continue;
      const { cx, cy } = bodyCenter(aPos, actorScale);
      if (a.kind === 'CAST_START') {
        state.snowBursts = state.snowBursts.filter((s) => s.actorId !== a.actorId || s.fading);
        pushCap(
          state.snowBursts,
          {
            id: a.id,
            actorId: a.actorId,
            cx,
            cy,
            scale: actorScale,
            form: 0.08,
            fading: false,
            flakes: makeFlakes(),
            bornAt: now,
            expireAt: now + 30_000,
          },
          MAX_SNOW_BURSTS
        );
        changed = true;
      } else if (a.kind === 'CAST_LAND' || a.kind === 'INSTANT') {
        const existing = state.snowBursts.find((s) => s.actorId === a.actorId && !s.fading);
        const burstLife = SNOW_FLAKE_MS + (FLAKES_PER_BURST - 1) * SNOW_STAGGER_MS + 80;
        if (existing) {
          existing.form = 1;
          existing.cx = cx;
          existing.cy = cy;
          existing.scale = actorScale;
          existing.fading = true;
          existing.bornAt = now;
          existing.expireAt = now + burstLife;
          existing.flakes = makeFlakes();
        } else {
          pushCap(
            state.snowBursts,
            {
              id: a.id,
              actorId: a.actorId,
              cx,
              cy,
              scale: actorScale,
              form: 1,
              fading: true,
              flakes: makeFlakes(),
              bornAt: now,
              expireAt: now + burstLife,
            },
            MAX_SNOW_BURSTS
          );
        }
        changed = true;
      }
      continue;
    }

    if (a.kind !== 'CAST_LAND' && a.kind !== 'INSTANT') continue;
    if (!lookDamageSpell(a.spellId, a.spellName) && actor?.role === 'HEALER') continue;
    if (!aPos || !tPos) continue;

    const melee = isEnemy
      ? Math.hypot(aPos.x - tPos.x, aPos.y - tPos.y) <= 80
      : isMeleeClassSpec((actor?.classId as any) || 'MAGE', (actor as any)?.spec);

    // Boss FX size = bossHeight/charHeight (HIT_FX_BOSS_SIZE_MULT)
    const hitScale = isEnemy ? HIT_FX_BOSS_SIZE_MULT : actorScale;

    if (melee) {
      const color = isEnemy
        ? BOSS_COLOR
        : CLASS_COLORS[(actor?.classId || '') as keyof typeof CLASS_COLORS] || '#FFF569';
      const hand = meleeHandPose(aPos, tPos, hitScale);
      const side: HitFxSide = isEnemy ? 'ENEMY' : 'FRIENDLY';
      pushImpactCopies(
        state.slashes,
        (i, bornAt) => ({
          id: `${a.id}_s${i}`,
          x: hand.x,
          y: hand.y,
          angle: hand.angle,
          color,
          scale: hitScale,
          side,
          bornAt,
          durationMs: SLASH_MS,
        }),
        MAX_SLASHES,
        now
      );
      changed = true;
    } else {
      let shape: HitProjShape;
      let color: string;
      if (isEnemy) {
        shape = bossRangedShape(opts.bossName || actor?.name || 'boss');
        color = BOSS_COLOR;
      } else {
        const r = rangedShapeForClass(actor?.classId || 'MAGE');
        shape = r.shape;
        color = r.color;
      }
      const side: HitFxSide = isEnemy ? 'ENEMY' : 'FRIENDLY';
      const flight = isEnemy
        ? resolveProjectileFlightStyle('BOSS')
        : resolveProjectileFlightStyle(actor?.classId);
      pushImpactCopies(
        state.projectiles,
        (i, bornAt) => ({
          id: `${a.id}_p${i}`,
          fromX: aPos.x,
          fromY: aPos.y,
          toX: tPos.x,
          toY: tPos.y,
          color,
          shape,
          scale: hitScale,
          side,
          flight,
          bornAt,
          durationMs: PROJ_MS,
        }),
        MAX_PROJECTILES,
        now
      );
      changed = true;
    }
  }
  return changed;
}

/** Spawn a class-colored projectile (maze / local helpers). */
export function spawnHitProjectile(
  state: HitFxState,
  opts: {
    id?: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    classId?: string;
    color?: string;
    shape?: HitProjShape;
    scale?: number;
    side?: HitFxSide;
    flight?: ProjectileFlightStyle;
    now?: number;
  }
): void {
  const now = opts.now ?? performance.now();
  const r = rangedShapeForClass(opts.classId || 'MAGE');
  const side: HitFxSide =
    opts.side ||
    (opts.color === BOSS_HIT_FX_COLOR || opts.color === BOSS_COLOR ? 'ENEMY' : 'FRIENDLY');
  const flight =
    opts.flight ||
    resolveProjectileFlightStyle(
      opts.color === BOSS_HIT_FX_COLOR || opts.color === BOSS_COLOR ? 'BOSS' : opts.classId
    );
  const baseId = opts.id || `proj_${now}_${Math.random().toString(36).slice(2, 6)}`;
  pushImpactCopies(
    state.projectiles,
    (i, bornAt) => ({
      id: `${baseId}_${i}`,
      fromX: opts.fromX,
      fromY: opts.fromY,
      toX: opts.toX,
      toY: opts.toY,
      color: opts.color || r.color,
      shape: opts.shape || r.shape,
      scale: opts.scale ?? HIT_FX_DEFAULT_UNIT_SCALE,
      side,
      flight,
      bornAt,
      durationMs: PROJ_MS,
    }),
    MAX_PROJECTILES,
    now
  );
}

/** Spawn a melee slash (maze / local helpers). */
export function spawnHitSlash(
  state: HitFxState,
  opts: {
    id?: string;
    x: number;
    y: number;
    angle: number;
    color: string;
    scale?: number;
    side?: HitFxSide;
    now?: number;
  }
): void {
  const now = opts.now ?? performance.now();
  const side: HitFxSide =
    opts.side ||
    (opts.color === BOSS_HIT_FX_COLOR || opts.color === BOSS_COLOR ? 'ENEMY' : 'FRIENDLY');
  const baseId = opts.id || `slash_${now}_${Math.random().toString(36).slice(2, 6)}`;
  pushImpactCopies(
    state.slashes,
    (i, bornAt) => ({
      id: `${baseId}_${i}`,
      x: opts.x,
      y: opts.y,
      angle: opts.angle,
      color: opts.color,
      scale: opts.scale ?? HIT_FX_DEFAULT_UNIT_SCALE,
      side,
      bornAt,
      durationMs: SLASH_MS,
    }),
    MAX_SLASHES,
    now
  );
}

/** Spawn heal snow burst at unit (maze heal). */
export function spawnHealSnowBurst(
  state: HitFxState,
  opts: {
    id?: string;
    actorId: string;
    x: number;
    y: number;
    scale?: number;
    now?: number;
  }
): void {
  const now = opts.now ?? performance.now();
  const scale = opts.scale ?? HIT_FX_DEFAULT_UNIT_SCALE;
  const { cx, cy } = bodyCenter({ x: opts.x, y: opts.y }, scale);
  const burstLife = SNOW_FLAKE_MS + (FLAKES_PER_BURST - 1) * SNOW_STAGGER_MS + 80;
  pushCap(
    state.snowBursts,
    {
      id: opts.id || `snow_${now}_${Math.random().toString(36).slice(2, 6)}`,
      actorId: opts.actorId,
      cx,
      cy,
      scale,
      form: 1,
      fading: true,
      flakes: makeFlakes(),
      bornAt: now,
      expireAt: now + burstLife,
    },
    MAX_SNOW_BURSTS
  );
}

export function tickHealSnowflakeForm(
  state: HitFxState,
  actorId: string,
  progress: number,
  pos: { x: number; y: number },
  scale = HIT_FX_DEFAULT_UNIT_SCALE,
  now = performance.now()
): void {
  const s = state.snowBursts.find((x) => x.actorId === actorId && !x.fading);
  if (!s) return;
  s.form = Math.max(s.form, Math.min(1, progress));
  const bc = bodyCenter(pos, scale);
  s.cx = bc.cx;
  s.cy = bc.cy;
  s.scale = scale;
  s.expireAt = Math.max(s.expireAt, now + 2000);
}

function spiralFlakePos(
  burst: HealSnowflakeBurst,
  flake: HealSnowflakeFlake,
  t: number
): { x: number; y: number } {
  const sc = Math.max(0.55, burst.scale);
  const turns = 1.35;
  const ang = flake.phase + turns * Math.PI * 2 * t;
  const radius = 11 * sc * (1 - t * 0.28);
  const baseY = burst.cy + 5 * sc;
  const rise = -30 * sc * t;
  return {
    x: burst.cx + Math.cos(ang) * radius,
    y: baseY + rise,
  };
}

export function pruneHitFx(state: HitFxState, now = performance.now()): void {
  state.projectiles = state.projectiles.filter((p) => now - p.bornAt < p.durationMs);
  state.slashes = state.slashes.filter((s) => now - s.bornAt < s.durationMs);
  state.snowBursts = state.snowBursts.filter((s) => now < s.expireAt);
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: HitProjShape,
  color: string,
  alpha: number,
  sizePx: number
): void {
  const half = sizePx / 2;
  ctx.fillStyle = rgbaFromHex(color, alpha);
  ctx.strokeStyle = rgbaFromHex(color, Math.min(0.7, alpha + 0.15));
  ctx.lineWidth = 1;
  ctx.beginPath();
  switch (shape) {
    case 'droplet':
      ctx.moveTo(0, -half);
      ctx.quadraticCurveTo(half, -half * 0.2, 0, half);
      ctx.quadraticCurveTo(-half, -half * 0.2, 0, -half);
      ctx.fill();
      break;
    case 'orb':
      ctx.arc(0, 0, half * 0.85, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'arrow':
      ctx.moveTo(half, 0);
      ctx.lineTo(-half, -half * 0.7);
      ctx.lineTo(-half * 0.3, 0);
      ctx.lineTo(-half, half * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star': {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bolt':
      ctx.moveTo(-half * 0.2, -half);
      ctx.lineTo(half * 0.4, -half * 0.1);
      ctx.lineTo(0, -half * 0.1);
      ctx.lineTo(half * 0.2, half);
      ctx.lineTo(-half * 0.4, half * 0.1);
      ctx.lineTo(0, half * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'shard':
      ctx.moveTo(0, -half);
      ctx.lineTo(half * 0.7, 0);
      ctx.lineTo(0, half);
      ctx.lineTo(-half * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 'spike':
      ctx.moveTo(half, 0);
      ctx.lineTo(-half, -half * 0.55);
      ctx.lineTo(-half * 0.5, 0);
      ctx.lineTo(-half, half * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.arc(0, 0, half * 0.8, 0, Math.PI * 2);
      ctx.fill();
  }
}

function drawOneFlake(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha: number
): void {
  const half = size / 2;
  const [r, g, b] = hexToRgb(HEAL_SNOW_COLOR);
  ctx.save();
  ctx.translate(x, y);
  const grad = ctx.createRadialGradient(0, 0, 0.4, 0, 0, half);
  grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},${alpha * 0.5})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.9})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * half * 0.95, Math.sin(a) * half * 0.95);
  }
  ctx.stroke();
  ctx.restore();
}

export type HitFxDrawFilter = {
  showFriendlyProjectiles?: boolean;
  showFriendlySlash?: boolean;
  showEnemyProjectiles?: boolean;
  showEnemySlash?: boolean;
};

/**
 * Draw hit FX on top layer (after characters). Projectiles/slashes/snow only.
 */
export function drawHitFx(
  ctx: CanvasRenderingContext2D,
  state: HitFxState,
  now = performance.now(),
  filter?: HitFxDrawFilter
): void {
  const showFProj = filter?.showFriendlyProjectiles !== false;
  const showEProj = filter?.showEnemyProjectiles !== false;
  const showFSlash = filter?.showFriendlySlash !== false;
  const showESlash = filter?.showEnemySlash !== false;

  for (const p of state.projectiles) {
    const side = p.side || 'FRIENDLY';
    if (side === 'ENEMY' ? !showEProj : !showFProj) continue;
    if (now < p.bornAt) continue;
    const t = Math.min(1, (now - p.bornAt) / Math.max(1, p.durationMs));
    const flight = p.flight || 'straight';
    const pose = sampleProjectileFlight(p.fromX, p.fromY, p.toX, p.toY, t, flight);
    const baseA = side === 'ENEMY' ? HIT_FX_BOSS_ALPHA : HIT_FX_ALPHA;
    const alpha = baseA * (1 - t * 0.35);
    const size = HIT_FX_MAX_SIZE_PX * Math.max(0.55, p.scale);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    drawShape(ctx, p.shape, p.color, alpha, size);
    ctx.restore();
  }

  for (const s of state.slashes) {
    const side = s.side || 'FRIENDLY';
    if (side === 'ENEMY' ? !showESlash : !showFSlash) continue;
    if (now < s.bornAt) continue;
    const t = Math.min(1, (now - s.bornAt) / Math.max(1, s.durationMs));
    const baseA = side === 'ENEMY' ? HIT_FX_BOSS_ALPHA : HIT_FX_ALPHA;
    const alpha = baseA * (1 - t * 0.55);
    const sc = Math.max(0.55, s.scale);
    const w = HIT_FX_SLASH_W * sc;
    const h = HIT_FX_SLASH_H * sc;
    // Swing opens from near hand outward along facing
    const open = 0.15 + t * 0.85;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    // Sharp tapered blade: thin spine + hard tip (fits 6×24)
    ctx.strokeStyle = rgbaFromHex(s.color, alpha);
    ctx.lineWidth = Math.max(0.85, w * 0.22);
    ctx.beginPath();
    ctx.moveTo(h * 0.05, -w * 0.15);
    ctx.quadraticCurveTo(h * 0.35 * open, -w * 0.95, h * 0.92 * open, -w * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(h * 0.05, w * 0.15);
    ctx.quadraticCurveTo(h * 0.35 * open, w * 0.95, h * 0.92 * open, w * 0.08);
    ctx.stroke();
    // Center cutting edge (brighter/thinner)
    ctx.strokeStyle = rgbaFromHex(s.color, Math.min(0.85, alpha + 0.25));
    ctx.lineWidth = Math.max(0.7, w * 0.12);
    ctx.beginPath();
    ctx.moveTo(h * 0.02, 0);
    ctx.lineTo(h * open, 0);
    ctx.stroke();
    // Tip point
    ctx.fillStyle = rgbaFromHex(s.color, Math.min(0.9, alpha + 0.2));
    ctx.beginPath();
    ctx.moveTo(h * open, 0);
    ctx.lineTo(h * open - 3.2 * sc, -1.4 * sc);
    ctx.lineTo(h * open - 3.2 * sc, 1.4 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  for (const burst of state.snowBursts) {
    const sc = Math.max(0.55, burst.scale);
    const flakeSize = HIT_FX_MAX_SIZE_PX * 0.55 * sc;
    for (const flake of burst.flakes) {
      if (burst.fading) {
        const localT = (now - burst.bornAt - flake.delayMs) / SNOW_FLAKE_MS;
        if (localT < 0 || localT > 1) continue;
        const { x, y } = spiralFlakePos(burst, flake, localT);
        const alpha = HIT_FX_ALPHA * (1 - localT * 0.85) * burst.form;
        drawOneFlake(ctx, x, y, flakeSize, alpha);
      } else {
        // Casting: flakes appear around body and slowly spiral up with form
        const appear = burst.form * FLAKES_PER_BURST;
        if (flake.index > appear) continue;
        const t = 0.08 + burst.form * 0.35 * ((flake.index + 1) / FLAKES_PER_BURST);
        const { x, y } = spiralFlakePos(burst, flake, t);
        drawOneFlake(
          ctx,
          x,
          y,
          flakeSize * Math.min(1, appear - flake.index + 0.35),
          HIT_FX_ALPHA * 0.85
        );
      }
    }
  }
}
