/**
 * Instant AoE: feathered class-color disc at cast center.
 * Layer: above terrain ground rings, below boss/characters.
 * Boss / enemy uses bright red; players use CLASS_COLORS.
 */
import type { NetworkCombatAction, Unit } from '@cata-raid-sim/engine';
import { isEnemyActorUnit } from '@cata-raid-sim/engine';
import { CLASS_COLORS } from '../components/AuthAndCharacterModal.js';

/** Bright boss/enemy pulse (replaces dark #7f1d1d for AoE/aura FX). */
export const BOSS_AOE_PULSE_COLOR = '#EF4444';
export const CLASS_AOE_PULSE_MS = 520;
/** Peak center opacity (was ~0.38 / felt ~30%). */
export const CLASS_AOE_PULSE_PEAK_ALPHA = 0.72;
/**
 * Visual radius ≈ half caster body width (not spell yards).
 * Normal companion ~32px wide → 16; player slightly larger; boss larger.
 */
export const CLASS_AOE_PULSE_HALF_WIDTH_PX = 16;
const MAX_PULSES = 10;

export interface ClassAoePulse {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  bornAt: number;
  durationMs: number;
}

export interface ClassAoePulseState {
  pulses: ClassAoePulse[];
}

export function createClassAoePulseState(): ClassAoePulseState {
  return { pulses: [] };
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

export function resolveClassAoePulseColor(actor: Unit | undefined | null): string {
  if (!actor) return BOSS_AOE_PULSE_COLOR;
  if (isEnemyActorUnit(actor) || actor.classId === 'BOSS' || actor.role === 'ENEMY') {
    return BOSS_AOE_PULSE_COLOR;
  }
  const id = (actor.classId || '').toUpperCase();
  return CLASS_COLORS[id as keyof typeof CLASS_COLORS] || '#69CCF0';
}

/** Disc radius = half of drawn body width (ignore spell yard radius). */
export function resolveClassAoePulseRadius(actor: Unit | undefined | null): number {
  if (!actor) return CLASS_AOE_PULSE_HALF_WIDTH_PX;
  if (isEnemyActorUnit(actor) || actor.classId === 'BOSS' || actor.unitKind === 'BOSS') {
    return Math.round(CLASS_AOE_PULSE_HALF_WIDTH_PX * 3.0);
  }
  if (actor.isPet) return Math.round(CLASS_AOE_PULSE_HALF_WIDTH_PX * 0.7);
  if (actor.isPlayer) return Math.round(CLASS_AOE_PULSE_HALF_WIDTH_PX * 1.15);
  return CLASS_AOE_PULSE_HALF_WIDTH_PX;
}

export function ingestCombatActionsAsClassAoePulses(
  state: ClassAoePulseState,
  opts: {
    actions: NetworkCombatAction[];
    unitsById: Map<string, Unit>;
    seenIds: Set<string>;
    now?: number;
  }
): boolean {
  const now = opts.now ?? performance.now();
  let changed = false;
  for (const a of opts.actions) {
    if (!a?.id || opts.seenIds.has(a.id)) continue;
    if (!a.aoePulse) continue;
    // Presence of radius marks AoE; visual size is half caster width
    if (!(a.radius && a.radius > 0)) continue;
    if (typeof a.x !== 'number' || typeof a.y !== 'number') continue;
    // Persistent ground FX already drawn as flat terrain rings
    if (a.kind === 'GROUND_PLACE' && a.groundEffectId) continue;

    opts.seenIds.add(a.id);
    const actor = opts.unitsById.get(a.actorId);
    const color = resolveClassAoePulseColor(actor);
    state.pulses.push({
      id: a.id,
      x: a.x,
      y: a.y,
      radius: resolveClassAoePulseRadius(actor),
      color,
      bornAt: now,
      durationMs: CLASS_AOE_PULSE_MS,
    });
    if (state.pulses.length > MAX_PULSES) {
      state.pulses.splice(0, state.pulses.length - MAX_PULSES);
    }
    changed = true;
  }
  return changed;
}

export function pruneClassAoePulses(state: ClassAoePulseState, now = performance.now()): void {
  state.pulses = state.pulses.filter((p) => now - p.bornAt < p.durationMs);
}

/**
 * Soft radial feather: opaque-ish center → transparent edge, fade out over life.
 */
export function drawClassAoePulses(
  ctx: CanvasRenderingContext2D,
  state: ClassAoePulseState,
  now = performance.now()
): void {
  for (const p of state.pulses) {
    const t = Math.min(1, (now - p.bornAt) / Math.max(1, p.durationMs));
    const life = 1 - t;
    const alpha = CLASS_AOE_PULSE_PEAK_ALPHA * Math.pow(life, 1.15);
    if (alpha <= 0.004) continue;
    const rad = Math.max(4, p.radius);
    const [r, g, b] = hexToRgb(p.color);
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},${alpha * 0.7})`);
    grad.addColorStop(0.72, `rgba(${r},${g},${b},${alpha * 0.28})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}
