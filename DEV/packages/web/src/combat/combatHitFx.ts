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
const MAX_AOE_BURSTS = 24;
const FLAKES_PER_BURST = 5;

const PROJ_MS = 280;
const SLASH_MS = 200;
const SWEEP_MS = 260;
const AOE_BURST_MS = 360;
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

export type HitSlashStyle =
  | 'blade'
  | 'claw_rend'
  | 'cross_twin'
  | 'heavy_cleave'
  | 'frost_jagged'
  | 'holy_arc';

export type HitSlashMode = 'thrust' | 'sweep';

export interface HitSlash {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  scale: number;
  side: HitFxSide;
  style?: HitSlashStyle;
  /** 'thrust' = single-target piercing lunge; 'sweep' = AoE wide sweeping cleave */
  mode?: HitSlashMode;
  /** Total angular span (radians) for sweep mode */
  sweepArcRad?: number;
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

export interface HitAoeBurst {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  scale: number;
  side: HitFxSide;
  bornAt: number;
  durationMs: number;
}

export interface HitFxState {
  projectiles: HitProjectile[];
  slashes: HitSlash[];
  snowBursts: HealSnowflakeBurst[];
  aoeBursts: HitAoeBurst[];
}

export function createHitFxState(): HitFxState {
  return { projectiles: [], slashes: [], snowBursts: [], aoeBursts: [] };
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

/**
 * Deterministic spell + class visual resolver for projectiles and melee slashes.
 * Ensures host & all guests render identical FX for the same NetworkCombatAction.
 */
export function resolveHitFxVisual(opts: {
  spellId?: string | null;
  spellName?: string | null;
  classId?: string | null;
  spec?: string | null;
  isEnemy?: boolean;
  bossName?: string | null;
}): {
  shape: HitProjShape;
  projColor: string;
  slashColor: string;
  slashStyle: HitSlashStyle;
} {
  const sid = `${opts.spellId || ''} ${opts.spellName || ''}`.toLowerCase();
  const cid = (opts.classId || '').toUpperCase();

  if (opts.isEnemy) {
    const slashStyle: HitSlashStyle =
      sid.includes('rend') || sid.includes('bleed') || sid.includes('claw') || sid.includes('撕裂') || sid.includes('流血')
        ? 'claw_rend'
        : sid.includes('cleave') || sid.includes('trample') || sid.includes('swipe') || sid.includes('践踏') || sid.includes('顺劈')
          ? 'heavy_cleave'
          : 'blade';
    return {
      shape: bossRangedShape(opts.bossName || 'boss'),
      projColor: BOSS_COLOR,
      slashColor: BOSS_COLOR,
      slashStyle,
    };
  }

  const base = rangedShapeForClass(cid || 'MAGE');
  let shape: HitProjShape = base.shape;
  let projColor = base.color;
  let slashColor = CLASS_COLORS[cid as keyof typeof CLASS_COLORS] || '#FFF569';
  let slashStyle: HitSlashStyle = 'blade';

  // Spell-school projectile differentiation (preserves Mage frostbolt -> 'droplet')
  if (cid === 'MAGE') {
    if (sid.includes('fire') || sid.includes('pyroblast') || sid.includes('scorch') || sid.includes('living_bomb') || sid.includes('火')) {
      shape = 'orb';
      projColor = '#FB923C';
    } else if (sid.includes('arcane') || sid.includes('奥术')) {
      shape = 'star';
      projColor = '#C084FC';
    } else if (sid.includes('frost') || sid.includes('ice') || sid.includes('寒冰') || sid.includes('冰枪')) {
      shape = 'droplet';
      projColor = '#38BDF8';
    }
  } else if (cid === 'WARLOCK') {
    if (sid.includes('chaos') || sid.includes('混乱')) {
      shape = 'bolt';
      projColor = '#4ADE80';
    } else if (sid.includes('incinerate') || sid.includes('immolate') || sid.includes('conflagrate') || sid.includes('burn') || sid.includes('献祭') || sid.includes('烧尽')) {
      shape = 'orb';
      projColor = '#F97316';
    } else {
      shape = 'orb';
      projColor = '#A855F7';
    }
  } else if (cid === 'SHAMAN') {
    if (sid.includes('lava') || sid.includes('flame') || sid.includes('熔岩') || sid.includes('烈焰')) {
      shape = 'orb';
      projColor = '#F97316';
    } else {
      shape = 'bolt';
      projColor = '#38BDF8';
    }
  } else if (cid === 'DRUID') {
    if (sid.includes('star') || sid.includes('moon') || sid.includes('sun') || sid.includes('星') || sid.includes('月') || sid.includes('日')) {
      shape = 'star';
      projColor = sid.includes('moon') || sid.includes('月') ? '#818CF8' : '#FACC15';
    } else if (sid.includes('wrath') || sid.includes('愤怒')) {
      shape = 'orb';
      projColor = '#4ADE80';
    }
  } else if (cid === 'PRIEST') {
    if (sid.includes('shadow') || sid.includes('mind') || sid.includes('暗言') || sid.includes('心灵')) {
      shape = 'shard';
      projColor = '#A855F7';
    } else if (sid.includes('smite') || sid.includes('penance') || sid.includes('holy') || sid.includes('惩击') || sid.includes('苦修')) {
      shape = 'star';
      projColor = '#FDE047';
    }
  } else if (cid === 'HUNTER') {
    shape = 'arrow';
    if (sid.includes('arcane') || sid.includes('奥术')) projColor = '#C084FC';
    else if (sid.includes('explosive') || sid.includes('fire') || sid.includes('爆炸')) projColor = '#FB923C';
    else projColor = '#A3E635';
  }

  // Melee slash / rend differentiation
  if (
    sid.includes('rend') ||
    sid.includes('rake') ||
    sid.includes('rip') ||
    sid.includes('rupture') ||
    sid.includes('garrote') ||
    sid.includes('hemorrhage') ||
    sid.includes('mangle') ||
    sid.includes('bleed') ||
    sid.includes('lacerate') ||
    sid.includes('割裂') ||
    sid.includes('斜掠') ||
    sid.includes('撕扯') ||
    sid.includes('出血') ||
    sid.includes('割伤')
  ) {
    slashStyle = 'claw_rend';
    slashColor = '#EF4444';
  } else if (
    sid.includes('backstab') ||
    sid.includes('ambush') ||
    sid.includes('eviscerate') ||
    sid.includes('stormstrike') ||
    sid.includes('lava_lash') ||
    sid.includes('mutilate') ||
    sid.includes('背刺') ||
    sid.includes('伏击') ||
    sid.includes('刺骨') ||
    sid.includes('风暴打击') ||
    sid.includes('熔岩猛击')
  ) {
    slashStyle = 'cross_twin';
    if (sid.includes('lava')) slashColor = '#F97316';
    else if (sid.includes('storm')) slashColor = '#38BDF8';
  } else if (
    sid.includes('obliterate') ||
    sid.includes('frost_strike') ||
    sid.includes('scourge_strike') ||
    sid.includes('death_strike') ||
    sid.includes('heart_strike') ||
    sid.includes('湮没') ||
    sid.includes('冰霜打击') ||
    sid.includes('天灾打击') ||
    sid.includes('灵界打击')
  ) {
    slashStyle = 'frost_jagged';
    if (sid.includes('frost') || sid.includes('obliterate')) slashColor = '#38BDF8';
    else if (sid.includes('death') || sid.includes('blood') || sid.includes('heart')) slashColor = '#C41E3A';
  } else if (
    sid.includes('crusader') ||
    sid.includes('templar') ||
    sid.includes('shield_of_the_righteous') ||
    sid.includes('十字军') ||
    sid.includes('圣殿') ||
    sid.includes('正义盾击')
  ) {
    slashStyle = 'holy_arc';
    slashColor = '#FDE047';
  } else if (
    sid.includes('mortal') ||
    sid.includes('cleave') ||
    sid.includes('execute') ||
    sid.includes('slam') ||
    sid.includes('ferocious_bite') ||
    sid.includes('致死') ||
    sid.includes('顺劈') ||
    sid.includes('斩杀') ||
    sid.includes('猛击') ||
    sid.includes('凶猛撕咬')
  ) {
    slashStyle = 'heavy_cleave';
  } else if (cid === 'ROGUE') {
    slashStyle = 'cross_twin';
  } else if (cid === 'WARRIOR') {
    slashStyle = 'heavy_cleave';
  } else if (cid === 'PALADIN') {
    slashStyle = 'holy_arc';
  } else if (cid === 'DK') {
    slashStyle = 'frost_jagged';
  } else if (cid === 'DRUID') {
    slashStyle = 'claw_rend';
  }

  return { shape, projColor, slashColor, slashStyle };
}

function isSingleTargetAction(a: NetworkCombatAction): boolean {
  if (!a.targetId) return false;
  if (a.kind === 'GROUND_PLACE' || a.kind === 'SUMMON') return false;
  if (a.radius && a.radius > 0) return false;
  if (a.aoePulse) return false;
  return a.kind === 'CAST_START' || a.kind === 'CAST_LAND' || a.kind === 'INSTANT' || a.kind === 'INTERRUPT';
}

function isAoePulseAction(a: NetworkCombatAction): boolean {
  if (a.kind !== 'INSTANT' && a.kind !== 'CAST_LAND') return false;
  return Boolean(a.aoePulse || (a.radius && a.radius > 0));
}

function isMeleeAoeSpell(spellId?: string | null, spellName?: string | null): boolean {
  const s = `${spellId || ''} ${spellName || ''}`.toLowerCase();
  return (
    s.includes('cleave') ||
    s.includes('whirlwind') ||
    s.includes('swipe') ||
    s.includes('trample') ||
    s.includes('thrash') ||
    s.includes('shockwave') ||
    s.includes('thunder') ||
    s.includes('stomp') ||
    s.includes('sweep') ||
    s.includes('bladestorm') ||
    s.includes('fan_of_knives') ||
    s.includes('divine_storm') ||
    s.includes('blood_boil') ||
    s.includes('howling_blast') ||
    s.includes('heart_strike') ||
    s.includes('hammer_of_the_righteous') ||
    s.includes('顺劈') ||
    s.includes('旋风斩') ||
    s.includes('横扫') ||
    s.includes('践踏') ||
    s.includes('痛击') ||
    s.includes('震荡波') ||
    s.includes('雷霆') ||
    s.includes('重踏') ||
    s.includes('剑刃风暴') ||
    s.includes('刀扇') ||
    s.includes('神圣风暴') ||
    s.includes('血液沸腾') ||
    s.includes('凛风冲击') ||
    s.includes('正义之锤')
  );
}

function isMagicAoeSpell(spellId?: string | null, spellName?: string | null): boolean {
  const s = `${spellId || ''} ${spellName || ''}`.toLowerCase();
  return (
    s.includes('nova') ||
    s.includes('bolt') ||
    s.includes('fire') ||
    s.includes('flame') ||
    s.includes('frost') ||
    s.includes('ice') ||
    s.includes('shadow') ||
    s.includes('void') ||
    s.includes('arcane') ||
    s.includes('poison') ||
    s.includes('venom') ||
    s.includes('meteor') ||
    s.includes('rain') ||
    s.includes('blizzard') ||
    s.includes('barrage') ||
    s.includes('roar') ||
    s.includes('scream') ||
    s.includes('全场') ||
    s.includes('弹幕') ||
    s.includes('灾厄') ||
    s.includes('新星') ||
    s.includes('烈焰') ||
    s.includes('寒冰') ||
    s.includes('暗影') ||
    s.includes('奥术') ||
    s.includes('剧毒') ||
    s.includes('流星') ||
    s.includes('咆哮')
  );
}

function isSpinAoeSpell(spellId?: string | null, spellName?: string | null): boolean {
  const s = `${spellId || ''} ${spellName || ''}`.toLowerCase();
  return (
    s.includes('whirlwind') ||
    s.includes('bladestorm') ||
    s.includes('divine_storm') ||
    s.includes('fan_of_knives') ||
    s.includes('blood_boil') ||
    s.includes('thunder_clap') ||
    s.includes('consecration') ||
    s.includes('旋风斩') ||
    s.includes('剑刃风暴') ||
    s.includes('神圣风暴') ||
    s.includes('刀扇') ||
    s.includes('血液沸腾') ||
    s.includes('雷霆一击') ||
    s.includes('奉献')
  );
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
    const isSingle = isSingleTargetAction(a);
    const isAoe = !isSingle && isAoePulseAction(a);
    if (!isSingle && !isAoe) continue;
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

    if (isAoe) {
      if (!aPos && typeof a.x !== 'number') continue;
      const meleeAoe = !isHeal && (isEnemy
        ? isMeleeAoeSpell(a.spellId, a.spellName) ||
          (!isMagicAoeSpell(a.spellId, a.spellName) &&
            !!aPos &&
            !!tPos &&
            Math.hypot(aPos.x - tPos.x, aPos.y - tPos.y) <= 95)
        : isMeleeClassSpec((actor?.classId as any) || 'MAGE', (actor as any)?.spec) ||
          isMeleeAoeSpell(a.spellId, a.spellName));

      const hitScale = isEnemy ? HIT_FX_BOSS_SIZE_MULT : actorScale;
      const visual = resolveHitFxVisual({
        spellId: a.spellId,
        spellName: a.spellName,
        classId: actor?.classId,
        spec: (actor as any)?.spec,
        isEnemy,
        bossName: opts.bossName || actor?.name,
      });
      const side: HitFxSide = isEnemy ? 'ENEMY' : 'FRIENDLY';

      if (meleeAoe && aPos) {
        const spin = isSpinAoeSpell(a.spellId, a.spellName);
        const ang =
          tPos && (tPos.x !== aPos.x || tPos.y !== aPos.y)
            ? Math.atan2(tPos.y - aPos.y, tPos.x - aPos.x)
            : 0;
        const pivotX = spin ? aPos.x : aPos.x + Math.cos(ang) * 4 * hitScale;
        const pivotY = spin ? aPos.y : aPos.y + Math.sin(ang) * 4 * hitScale;
        const sweepArcRad = spin ? Math.PI * 1.55 : Math.PI * 1.1;
        for (let i = 0; i < 2; i++) {
          pushCap(
            state.slashes,
            {
              id: `${a.id}_sw${i}`,
              x: pivotX,
              y: pivotY,
              angle: ang + (i === 1 ? 0.35 : 0),
              color: visual.slashColor,
              scale: hitScale,
              side,
              style: visual.slashStyle,
              mode: 'sweep',
              sweepArcRad,
              bornAt: now + i * 45,
              durationMs: SWEEP_MS,
            },
            MAX_SLASHES
          );
        }
        changed = true;
        continue;
      }

      // Ranged / caster AoE: class-colored (or boss red) explosion at designated area
      const targetCenter =
        typeof a.x === 'number' && typeof a.y === 'number'
          ? { x: a.x, y: a.y }
          : tPos || aPos;
      if (!targetCenter) continue;
      const classFallbackColor =
        CLASS_COLORS[(actor?.classId || '').toUpperCase() as keyof typeof CLASS_COLORS];
      const burstColor = isEnemy
        ? BOSS_COLOR
        : isHeal
          ? classFallbackColor || HEAL_SNOW_COLOR
          : visual.projColor || classFallbackColor || '#69CCF0';
      pushCap(
        state.aoeBursts,
        {
          id: `${a.id}_ab`,
          x: targetCenter.x,
          y: targetCenter.y,
          radius: Math.max(18, 26 * hitScale),
          color: burstColor,
          scale: hitScale,
          side,
          bornAt: now,
          durationMs: AOE_BURST_MS,
        },
        MAX_AOE_BURSTS
      );
      changed = true;
      continue;
    }

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
            expireAt: now + 6_000,
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

    const visual = resolveHitFxVisual({
      spellId: a.spellId,
      spellName: a.spellName,
      classId: actor?.classId,
      spec: (actor as any)?.spec,
      isEnemy,
      bossName: opts.bossName || actor?.name,
    });

    if (melee) {
      const hand = meleeHandPose(aPos, tPos, hitScale);
      const side: HitFxSide = isEnemy ? 'ENEMY' : 'FRIENDLY';
      pushImpactCopies<HitSlash>(
        state.slashes,
        (i, bornAt) => ({
          id: `${a.id}_s${i}`,
          x: hand.x,
          y: hand.y,
          angle: hand.angle + (i - 1) * 0.06,
          color: visual.slashColor,
          scale: hitScale,
          side,
          style: visual.slashStyle,
          mode: 'thrust',
          bornAt,
          durationMs: SLASH_MS,
        }),
        MAX_SLASHES,
        now
      );
      changed = true;
    } else {
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
          color: visual.projColor,
          shape: visual.shape,
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
    style?: HitSlashStyle;
    mode?: HitSlashMode;
    sweepArcRad?: number;
    spellId?: string;
    classId?: string;
    now?: number;
  }
): void {
  const now = opts.now ?? performance.now();
  const side: HitFxSide =
    opts.side ||
    (opts.color === BOSS_HIT_FX_COLOR || opts.color === BOSS_COLOR ? 'ENEMY' : 'FRIENDLY');
  const style =
    opts.style ||
    (opts.spellId || opts.classId
      ? resolveHitFxVisual({
          spellId: opts.spellId,
          classId: opts.classId,
          isEnemy: side === 'ENEMY',
        }).slashStyle
      : 'blade');
  const mode: HitSlashMode = opts.mode || 'thrust';
  const baseId = opts.id || `slash_${now}_${Math.random().toString(36).slice(2, 6)}`;
  if (mode === 'sweep') {
    for (let i = 0; i < 2; i++) {
      pushCap(
        state.slashes,
        {
          id: `${baseId}_${i}`,
          x: opts.x,
          y: opts.y,
          angle: opts.angle + (i === 1 ? 0.35 : 0),
          color: opts.color,
          scale: opts.scale ?? HIT_FX_DEFAULT_UNIT_SCALE,
          side,
          style,
          mode: 'sweep',
          sweepArcRad: opts.sweepArcRad ?? Math.PI * 1.1,
          bornAt: now + i * 45,
          durationMs: SWEEP_MS,
        },
        MAX_SLASHES
      );
    }
    return;
  }
  pushImpactCopies<HitSlash>(
    state.slashes,
    (i, bornAt) => ({
      id: `${baseId}_${i}`,
      x: opts.x,
      y: opts.y,
      angle: opts.angle + (i - 1) * 0.06,
      color: opts.color,
      scale: opts.scale ?? HIT_FX_DEFAULT_UNIT_SCALE,
      side,
      style,
      mode: 'thrust',
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

export function pruneHitFx(
  state: HitFxState,
  now = performance.now(),
  opts?: {
    resolvePos?: (unitId: string) => { x: number; y: number } | null;
    isActorAlive?: (unitId: string) => boolean;
  }
): void {
  state.projectiles = state.projectiles.filter((p) => now - p.bornAt < p.durationMs);
  state.slashes = state.slashes.filter((s) => now - s.bornAt < s.durationMs);
  state.aoeBursts = state.aoeBursts.filter((b) => now - b.bornAt < b.durationMs);
  state.snowBursts = state.snowBursts.filter((s) => {
    if (now >= s.expireAt) return false;
    if (!s.fading && opts?.isActorAlive && !opts.isActorAlive(s.actorId)) return false;
    if (!s.fading && opts?.resolvePos) {
      const p = opts.resolvePos(s.actorId);
      if (p) {
        s.cx = p.x;
        s.cy = p.y;
      }
    }
    return true;
  });
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
  /** Draw ground blob under arcing projectiles */
  heightShadow?: boolean;
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
  const heightShadow = !!filter?.heightShadow;

  for (const p of state.projectiles) {
    const side = p.side || 'FRIENDLY';
    if (side === 'ENEMY' ? !showEProj : !showFProj) continue;
    if (now < p.bornAt) continue;
    const t = Math.min(1, (now - p.bornAt) / Math.max(1, p.durationMs));
    const flight = p.flight || 'straight';
    const pose = sampleProjectileFlight(p.fromX, p.fromY, p.toX, p.toY, t, flight);
    const prevPose = sampleProjectileFlight(
      p.fromX,
      p.fromY,
      p.toX,
      p.toY,
      Math.max(0, t - 0.14),
      flight
    );
    const baseA = side === 'ENEMY' ? HIT_FX_BOSS_ALPHA : HIT_FX_ALPHA;
    const alpha = baseA * (1 - t * 0.35);
    const size = HIT_FX_MAX_SIZE_PX * Math.max(0.55, p.scale);
    if (heightShadow && pose.lift > 2) {
      const gx = p.fromX + (p.toX - p.fromX) * t;
      const gy = p.fromY + (p.toY - p.fromY) * t;
      const shadowT = Math.min(1, pose.lift / 80);
      ctx.fillStyle = `rgba(0,0,0,${0.26 * shadowT})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, Math.max(4, size * 0.45), Math.max(2, size * 0.18), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Motion trail behind projectile
    if (t > 0.04) {
      ctx.strokeStyle = rgbaFromHex(p.color, alpha * 0.42);
      ctx.lineWidth = Math.max(1.2, size * 0.28);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prevPose.x, prevPose.y);
      ctx.lineTo(pose.x, pose.y);
      ctx.stroke();
    }
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
    const style = s.style || 'blade';
    const mode: HitSlashMode = s.mode || 'thrust';

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    if (mode === 'sweep') {
      // AoE melee: wide horizontal sweeping crescent / arc
      const arcSpan = s.sweepArcRad ?? Math.PI * 1.1;
      const ease = 1 - Math.pow(1 - t, 2.4);
      const leadAng = -arcSpan / 2 + arcSpan * ease;
      const trailSpan = arcSpan * (0.58 - t * 0.22);
      const tailAng = Math.max(-arcSpan / 2, leadAng - trailSpan);
      const sweepR = Math.max(20 * sc, h * 1.12);
      const innerR = sweepR * 0.72;

      if (leadAng > tailAng + 0.04) {
        // Tapered crescent ribbon body
        ctx.fillStyle = rgbaFromHex(s.color, alpha * 0.42);
        ctx.beginPath();
        ctx.arc(0, 0, sweepR, tailAng, leadAng, false);
        ctx.arc(0, 0, innerR, leadAng, tailAng, true);
        ctx.closePath();
        ctx.fill();

        // Crisp outer sweeping blade edge
        ctx.strokeStyle = rgbaFromHex(s.color, Math.min(0.96, alpha + 0.2));
        ctx.lineWidth = Math.max(1.4, w * 0.36);
        ctx.beginPath();
        ctx.arc(0, 0, sweepR, tailAng, leadAng, false);
        ctx.stroke();

        // White-hot leading highlight on front 45% of the sweep
        const hiTail = Math.max(tailAng, leadAng - (leadAng - tailAng) * 0.45);
        ctx.strokeStyle = rgbaFromHex('#FFFFFF', Math.min(0.85, alpha * 0.78));
        ctx.lineWidth = Math.max(0.85, w * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, sweepR * 0.96, hiTail, leadAng, false);
        ctx.stroke();

        if (style === 'claw_rend') {
          for (const mult of [0.84, 1.12]) {
            ctx.strokeStyle = rgbaFromHex(s.color, alpha * 0.78);
            ctx.lineWidth = Math.max(0.9, w * 0.2);
            ctx.beginPath();
            ctx.arc(0, 0, sweepR * mult, tailAng, leadAng, false);
            ctx.stroke();
          }
        } else if (style === 'cross_twin') {
          ctx.strokeStyle = rgbaFromHex(s.color, alpha * 0.75);
          ctx.lineWidth = Math.max(1.0, w * 0.22);
          ctx.beginPath();
          ctx.arc(0, 0, sweepR * 0.82, -leadAng, -tailAng, false);
          ctx.stroke();
        } else if (style === 'frost_jagged') {
          const teeth = 5;
          ctx.strokeStyle = rgbaFromHex('#E0F2FE', Math.min(0.9, alpha * 0.82));
          ctx.lineWidth = Math.max(0.9, w * 0.18);
          ctx.beginPath();
          for (let k = 0; k <= teeth; k++) {
            const u = k / teeth;
            const a = tailAng + (leadAng - tailAng) * u;
            const r = sweepR * (k % 2 === 0 ? 1.08 : 0.92);
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else if (style === 'holy_arc') {
          ctx.strokeStyle = rgbaFromHex('#FEF08A', Math.min(0.92, alpha * 0.85));
          ctx.lineWidth = Math.max(1.1, w * 0.24);
          ctx.beginPath();
          ctx.arc(0, 0, sweepR * 1.08, hiTail, leadAng, false);
          ctx.stroke();
        }
      }
      ctx.restore();
      continue;
    }

    // Single-target melee: forward-lunging thrust / pierce
    const ease = 1 - Math.pow(1 - t, 3);
    const lunge = -3 * sc + h * 0.42 * ease;
    const len = h * (0.45 + 0.68 * ease);
    ctx.translate(lunge, 0);
    ctx.lineCap = 'butt';

    if (style === 'claw_rend') {
      // 3 tight forward-raking piercing claw streaks
      const offsets = [-w * 0.52, 0, w * 0.52];
      for (let idx = 0; idx < offsets.length; idx++) {
        const oy = offsets[idx];
        const cLen = len * (idx === 1 ? 1.05 : 0.88);
        ctx.strokeStyle = rgbaFromHex(s.color, idx === 1 ? Math.min(0.95, alpha + 0.2) : alpha * 0.85);
        ctx.lineWidth = Math.max(0.85, w * (idx === 1 ? 0.24 : 0.16));
        ctx.beginPath();
        ctx.moveTo(-h * 0.08, oy);
        ctx.lineTo(cLen, oy * 0.22);
        ctx.stroke();
      }
    } else if (style === 'cross_twin') {
      // Twin forward-converging dagger stabs
      ctx.strokeStyle = rgbaFromHex(s.color, Math.min(0.94, alpha + 0.18));
      ctx.lineWidth = Math.max(0.9, w * 0.22);
      ctx.beginPath();
      ctx.moveTo(-h * 0.06, -w * 0.58);
      ctx.lineTo(len * 0.98, -w * 0.06);
      ctx.moveTo(-h * 0.06, w * 0.58);
      ctx.lineTo(len * 0.98, w * 0.06);
      ctx.stroke();
      // Bright pierce tips
      ctx.strokeStyle = rgbaFromHex('#FFFFFF', Math.min(0.88, alpha * 0.8));
      ctx.lineWidth = Math.max(0.7, w * 0.12);
      ctx.beginPath();
      ctx.moveTo(len * 0.45, 0);
      ctx.lineTo(len * 1.04, 0);
      ctx.stroke();
    } else if (style === 'heavy_cleave') {
      // Heavy forward-driving greatsword thrust + V-shockwave wake
      ctx.strokeStyle = rgbaFromHex(s.color, Math.min(0.95, alpha + 0.15));
      ctx.lineWidth = Math.max(1.2, w * 0.34);
      ctx.beginPath();
      ctx.moveTo(-h * 0.1, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      // Shockwave wake behind piercing tip
      ctx.lineWidth = Math.max(0.9, w * 0.22);
      ctx.beginPath();
      ctx.moveTo(len * 0.48, -w * 0.82);
      ctx.lineTo(len, 0);
      ctx.lineTo(len * 0.48, w * 0.82);
      ctx.stroke();
      // White-hot lance core
      ctx.strokeStyle = rgbaFromHex('#FFFFFF', Math.min(0.85, alpha * 0.78));
      ctx.lineWidth = Math.max(0.75, w * 0.14);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len * 1.04, 0);
      ctx.stroke();
    } else if (style === 'frost_jagged') {
      // Forward-shooting jagged icicle spear
      ctx.strokeStyle = rgbaFromHex(s.color, Math.min(0.92, alpha + 0.16));
      ctx.lineWidth = Math.max(0.95, w * 0.24);
      ctx.beginPath();
      ctx.moveTo(-h * 0.08, 0);
      ctx.lineTo(len * 0.3, -w * 0.38);
      ctx.lineTo(len * 0.56, w * 0.32);
      ctx.lineTo(len * 0.8, -w * 0.24);
      ctx.lineTo(len * 1.04, 0);
      ctx.stroke();
      ctx.fillStyle = rgbaFromHex('#E0F2FE', Math.min(0.92, alpha + 0.2));
      ctx.beginPath();
      ctx.moveTo(len * 1.06, 0);
      ctx.lineTo(len * 0.84, -1.6 * sc);
      ctx.lineTo(len * 0.84, 1.6 * sc);
      ctx.closePath();
      ctx.fill();
    } else if (style === 'holy_arc') {
      // Radiant golden-white piercing lance
      ctx.strokeStyle = rgbaFromHex(s.color, alpha);
      ctx.lineWidth = Math.max(1.0, w * 0.26);
      ctx.beginPath();
      ctx.moveTo(len * 0.38, -w * 0.65);
      ctx.lineTo(len * 0.96, 0);
      ctx.lineTo(len * 0.38, w * 0.65);
      ctx.stroke();
      ctx.strokeStyle = rgbaFromHex('#FFFFFF', Math.min(0.9, alpha + 0.22));
      ctx.lineWidth = Math.max(0.8, w * 0.16);
      ctx.beginPath();
      ctx.moveTo(-h * 0.1, 0);
      ctx.lineTo(len * 1.04, 0);
      ctx.stroke();
    } else {
      // Sharp tapered lance thrust
      ctx.strokeStyle = rgbaFromHex(s.color, alpha);
      ctx.lineWidth = Math.max(0.85, w * 0.2);
      ctx.beginPath();
      ctx.moveTo(-h * 0.08, -w * 0.35);
      ctx.lineTo(len * 0.96, -w * 0.05);
      ctx.moveTo(-h * 0.08, w * 0.35);
      ctx.lineTo(len * 0.96, w * 0.05);
      ctx.stroke();
      // Bright central piercing edge
      ctx.strokeStyle = rgbaFromHex('#FFFFFF', Math.min(0.85, alpha * 0.72));
      ctx.lineWidth = Math.max(0.75, w * 0.14);
      ctx.beginPath();
      ctx.moveTo(-h * 0.1, 0);
      ctx.lineTo(len * 1.02, 0);
      ctx.stroke();
      // Sharp spearhead tip
      ctx.fillStyle = rgbaFromHex(s.color, Math.min(0.95, alpha + 0.22));
      ctx.beginPath();
      ctx.moveTo(len * 1.06, 0);
      ctx.lineTo(len * 1.06 - 4.2 * sc, -1.7 * sc);
      ctx.lineTo(len * 1.06 - 4.2 * sc, 1.7 * sc);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  for (const b of state.aoeBursts) {
    const side = b.side || 'FRIENDLY';
    if (side === 'ENEMY' ? !showEProj : !showFProj) continue;
    if (now < b.bornAt) continue;
    const t = Math.min(1, (now - b.bornAt) / Math.max(1, b.durationMs));
    const ease = 1 - Math.pow(1 - t, 2.2);
    const sc = Math.max(0.55, b.scale);
    const maxR = Math.max(16 * sc, b.radius);
    const curR = maxR * (0.22 + 0.78 * ease);
    const baseA = side === 'ENEMY' ? HIT_FX_BOSS_ALPHA : HIT_FX_ALPHA;
    const alpha = baseA * (1 - Math.pow(t, 1.3));
    if (alpha <= 0.01) continue;

    ctx.save();
    ctx.translate(b.x, b.y);

    // 1. Class-colored radial explosion flash
    const [r, g, bl] = hexToRgb(b.color);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, curR);
    grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.72 * (1 - t)})`);
    grad.addColorStop(0.35, `rgba(${r},${g},${bl},${alpha * 0.65})`);
    grad.addColorStop(0.75, `rgba(${r},${g},${bl},${alpha * 0.25})`);
    grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, curR, 0, Math.PI * 2);
    ctx.fill();

    // 2. Expanding shockwave ring
    ctx.strokeStyle = rgbaFromHex(b.color, Math.min(0.95, alpha + 0.15));
    ctx.lineWidth = Math.max(1.2, 3.2 * sc * (1 - t * 0.65));
    ctx.beginPath();
    ctx.arc(0, 0, curR * 0.92, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Radial burst sparks/shards flying outward
    const rays = 8;
    ctx.strokeStyle = rgbaFromHex('#FFFFFF', alpha * 0.78);
    ctx.lineWidth = Math.max(1, 1.8 * sc * (1 - t * 0.5));
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2 + 0.2;
      const r0 = curR * (0.35 + 0.3 * t);
      const r1 = curR * (0.75 + 0.32 * ease);
      ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
    }
    ctx.stroke();
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
