// ============================================================
// Cata Raid Sim — Healer AI  [AI-03]
// Druid: Lifebloom(3) + Rejuv, emergency: Swiftmend / Tranquility
// Shaman: Riptide + Healing Rain, emergency: Healing Wave
// ============================================================

import { Unit } from '../types.js';
import {
  Action, GameState, Priority, PrioritisedAction, RoleAI,
  getMainTank, hpFraction, hasAura, auraStacks,
} from './AIController.js';

// ── HP thresholds ─────────────────────────────────────────────
const TANK_PRIORITY_HP   = 0.40; // < 40% → prioritise tank heal
const EMERGENCY_HP       = 0.50; // < 50% → big fast heal
const SLOW_HEAL_HP       = 0.80; // < 80% → HoT / slow heal

// ── Druid spell IDs ───────────────────────────────────────────
const DRUID = {
  LIFEBLOOM:    'druid_lifebloom',
  REJUVENATION: 'druid_rejuvenation',
  REGROWTH:     'druid_regrowth',       // 1.5s fast + HoT
  NOURISH:      'druid_nourish',         // efficient slow heal
  SWIFTMEND:    'druid_swiftmend',       // instant big heal (off-GCD proc)
  WILD_GROWTH:  'druid_wild_growth',     // smart 5-target HoT
  TRANQUILITY:  'druid_tranquility',     // 8s channelled raid heal (long CD)
  INNERVATE:    'druid_innervate',       // mana restore
  BARKSKIN:     'druid_barkskin',        // personal 20% DR
  REBIRTH:      'druid_rebirth',         // battle rez (travel phase only)
} as const;

// ── Shaman spell IDs ──────────────────────────────────────────
const SHAMAN = {
  RIPTIDE:         'shaman_riptide',
  HEALING_WAVE:    'shaman_healing_wave',
  GREATER_HEALING: 'shaman_greater_healing_wave',
  HEALING_SURGE:   'shaman_healing_surge',    // fast nuke heal
  CHAIN_HEAL:      'shaman_chain_heal',
  HEALING_RAIN:    'shaman_healing_rain',
  SPIRIT_LINK:     'shaman_spirit_link_totem',
  MANA_TIDE:       'shaman_mana_tide_totem',
  ANCESTRAL_SPIRIT:'shaman_ancestral_spirit', // rez (travel phase only)
} as const;

// ──────────────────────────────────────────────────────────────
export class HealerAI implements RoleAI {
  decide(unit: Unit, gs: GameState): PrioritisedAction[] {
    switch (unit.classId) {
      case 'DRUID':  return this.decideDruid(unit, gs);
      case 'SHAMAN': return this.decideShaman(unit, gs);
      default:       return [];
    }
  }

  // ── Restoration Druid ────────────────────────────────────────
  private decideDruid(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    const tank = getMainTank(gs.units);
    const allies = gs.units.filter(u => u.role !== 'ENEMY' && u.isAlive);

    // Mana management
    const manaRes = unit.resources.find(r => r.kind === 'MANA');
    if (manaRes && manaRes.current / manaRes.max < 0.25) {
      actions.push(act(DRUID.INNERVATE, unit.id, Priority.DEFENSIVE, true));
    }
    const currentMana = manaRes?.current ?? unit.mp ?? 0;
    if (currentMana < 1400) return actions; // OOM, cannot cast heals

    // ── 1. Tank emergency ────────────────────────────────────
    if (tank && hpFraction(tank) < TANK_PRIORITY_HP) {
      actions.push(act(DRUID.SWIFTMEND, tank.id, Priority.HEAL, true));
      actions.push(act(DRUID.REGROWTH, tank.id, Priority.HEAL));
    }

    // ── 2. Full-raid emergency ────────────────────────────────
    const injured = allies.filter(u => hpFraction(u) < EMERGENCY_HP);
    if (injured.length >= 3) {
      // Pop Tranquility if on CD-free; Wild Growth for <=3 injured
      actions.push(act(DRUID.TRANQUILITY, unit.id, Priority.HEAL, true));
    }
    if (injured.length >= 2) {
      actions.push(act(DRUID.WILD_GROWTH, unit.id, Priority.HEAL, true));
    }
    for (const target of injured) {
      actions.push(act(DRUID.SWIFTMEND, target.id, Priority.HEAL, true));
    }

    // ── 3. HoT maintenance on tank ────────────────────────────
    if (tank) {
      // Keep 3 stacks of Lifebloom on tank
      const lbStacks = auraStacks(tank, DRUID.LIFEBLOOM);
      if (lbStacks < 3) {
        actions.push(act(DRUID.LIFEBLOOM, tank.id, Priority.HEAL));
      }
      // Keep Rejuvenation on tank
      if (!hasAura(tank, DRUID.REJUVENATION)) {
        actions.push(act(DRUID.REJUVENATION, tank.id, Priority.HEAL));
      }
    }

    // ── 4. HoT spread on other injured allies ─────────────────
    for (const target of allies) {
      if (target.role === 'TANK') continue;
      if (hpFraction(target) < SLOW_HEAL_HP && !hasAura(target, DRUID.REJUVENATION)) {
        actions.push(act(DRUID.REJUVENATION, target.id, Priority.HEAL));
      }
      if (hpFraction(target) < EMERGENCY_HP && !hasAura(target, DRUID.REGROWTH)) {
        actions.push(act(DRUID.REGROWTH, target.id, Priority.HEAL));
      }
    }

    // ── 5. Filler: Nourish to refresh Lifebloom ───────────────
    if (tank && auraStacks(tank, DRUID.LIFEBLOOM) > 0) {
      actions.push(act(DRUID.NOURISH, tank.id, Priority.DPS)); // "DPS" = lowest priority filler
    }

    return actions;
  }

  // ── Restoration Shaman ───────────────────────────────────────
  private decideShaman(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    const tank = getMainTank(gs.units);
    const allies = gs.units.filter(u => u.role !== 'ENEMY' && u.isAlive);

    // Mana management
    const manaRes = unit.resources.find(r => r.kind === 'MANA');
    if (manaRes && manaRes.current / manaRes.max < 0.25) {
      actions.push(act(SHAMAN.MANA_TIDE, unit.id, Priority.DEFENSIVE, true));
    }
    const currentMana = manaRes?.current ?? unit.mp ?? 0;
    if (currentMana < 1800) return actions; // OOM, cannot cast heals

    const injured = allies.filter(u => hpFraction(u) < EMERGENCY_HP);

    // ── 1. Tank emergency ────────────────────────────────────
    if (tank && hpFraction(tank) < TANK_PRIORITY_HP) {
      actions.push(act(SHAMAN.GREATER_HEALING, tank.id, Priority.HEAL, true));
    }

    // ── 2. Raid emergency: Spirit Link Totem ─────────────────
    if (injured.length >= 3) {
      actions.push(act(SHAMAN.SPIRIT_LINK, unit.id, Priority.HEAL, true));
    }

    // ── 3. Healing Rain uptime with smart placement ───────────
    if (!hasAura(unit, SHAMAN.HEALING_RAIN)) {
      const bestPos = findOptimalGroundAuraCentroid(unit, allies, 55, 360);
      actions.push({
        priority: Priority.HEAL,
        action: {
          spellId: SHAMAN.HEALING_RAIN,
          targetId: unit.id,
          immediate: false,
          targetX: bestPos.x,
          targetY: bestPos.y,
        },
      });
    }

    // ── 4. Riptide maintenance ────────────────────────────────
    if (tank && !hasAura(tank, SHAMAN.RIPTIDE)) {
      actions.push(act(SHAMAN.RIPTIDE, tank.id, Priority.HEAL, true));
    }
    // Spread Riptide to injured non-tanks
    for (const target of allies) {
      if (target.role === 'TANK') continue;
      if (hpFraction(target) < SLOW_HEAL_HP && !hasAura(target, SHAMAN.RIPTIDE)) {
        actions.push(act(SHAMAN.RIPTIDE, target.id, Priority.HEAL, true));
        break; // one per decision cycle
      }
    }

    // ── 5. Single-target heals for injured ───────────────────
    for (const target of injured) {
      if (hpFraction(target) < EMERGENCY_HP) {
        actions.push(act(SHAMAN.HEALING_SURGE, target.id, Priority.HEAL));
      }
    }

    // ── 6. Chain Heal for multi-injured ──────────────────────
    if (injured.length >= 2 && tank) {
      actions.push(act(SHAMAN.CHAIN_HEAL, tank.id, Priority.HEAL));
    }

    // ── 7. Mana Tide when low mana ────────────────────────────
    if (manaRes && manaRes.current / manaRes.max < 0.30) {
      actions.push(act(SHAMAN.MANA_TIDE, unit.id, Priority.DEFENSIVE, true));
    }

    // ── 8. Filler: standard Healing Wave ─────────────────────
    if (tank && hpFraction(tank) < SLOW_HEAL_HP) {
      actions.push(act(SHAMAN.HEALING_WAVE, tank.id, Priority.DPS));
    }

    return actions;
  }
}

function act(
  spellId: string,
  targetId: string,
  priority: Priority,
  immediate = false,
): PrioritisedAction {
  return { priority, action: { spellId, targetId, immediate } };
}

export interface Point2D {
  x: number;
  y: number;
}

export function findOptimalGroundAuraCentroid(
  caster: { position?: Point2D },
  allies: Array<{ id: string; hp: number; maxHp: number; alive?: boolean; isAlive?: boolean; position?: Point2D }>,
  radius: number = 55,
  maxRange: number = 360
): Point2D {
  const casterPos = caster.position || { x: 200, y: 200 };
  const living = allies.filter(u => (u.isAlive ?? u.alive ?? true) && u.hp > 0 && u.position);
  if (living.length === 0) return { ...casterPos };

  const reachable = living.filter(u => Math.hypot(u.position!.x - casterPos.x, u.position!.y - casterPos.y) <= maxRange);
  const pool = reachable.length > 0 ? reachable : living;

  const getWeight = (u: { hp: number; maxHp: number }) => {
    const hpPct = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    if (hpPct < 0.50) return 3.0;
    if (hpPct < 0.85) return 2.0;
    if (hpPct < 1.00) return 1.5;
    return 1.0;
  };

  let bestCenter: Point2D = { ...casterPos };
  let maxScore = -1;

  for (const seed of pool) {
    const seedPos = seed.position!;
    const cluster = pool.filter(u => Math.hypot(u.position!.x - seedPos.x, u.position!.y - seedPos.y) <= radius);
    if (cluster.length === 0) continue;

    let totalW = 0, sumX = 0, sumY = 0;
    for (const m of cluster) {
      const w = getWeight(m);
      totalW += w;
      sumX += m.position!.x * w;
      sumY += m.position!.y * w;
    }

    let cx = Math.round(sumX / totalW);
    let cy = Math.round(sumY / totalW);
    const dCaster = Math.hypot(cx - casterPos.x, cy - casterPos.y);
    if (dCaster > maxRange) {
      const r = maxRange / dCaster;
      cx = Math.round(casterPos.x + (cx - casterPos.x) * r);
      cy = Math.round(casterPos.y + (cy - casterPos.y) * r);
    }

    let score = 0;
    for (const u of living) {
      if (Math.hypot(u.position!.x - cx, u.position!.y - cy) <= radius) {
        score += getWeight(u);
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestCenter = { x: cx, y: cy };
    }
  }

  return bestCenter;
}
