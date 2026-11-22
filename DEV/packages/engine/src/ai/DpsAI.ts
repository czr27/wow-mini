// ============================================================
// Cata Raid Sim — DPS AI  [AI-04]
// Mage (Fire): Living Bomb DoT + Fireball loop, Pyroblast on Hot Streak
// Rogue (Combat): Sinister Strike → Eviscerate/Rupture finisher
// Interrupt coordination: each DPS has a priority index to avoid pile-ups
// ============================================================

import { Unit } from '../types.js';
import {
  Action, GameState, Priority, PrioritisedAction, RoleAI,
  getBoss, hpFraction, hasAura, auraStacks,
} from './AIController.js';

// ── Mage spell IDs ────────────────────────────────────────────
const MAGE = {
  FIREBALL:       'mage_fireball',
  LIVING_BOMB:    'mage_living_bomb',
  PYROBLAST:      'mage_pyroblast',
  SCORCH:         'mage_scorch',
  COMBUSTION:     'mage_combustion',
  SPELL_STEAL:    'mage_spellsteal',
  COUNTERSPELL:   'mage_counterspell',   // 24s CD interrupt
  TIME_WARP:      'mage_time_warp',
  ARCANE_BRILLIANCE: 'mage_arcane_brilliance',
} as const;

// ── Rogue spell IDs ───────────────────────────────────────────
const ROGUE = {
  SINISTER_STRIKE: 'rogue_sinister_strike',
  BACKSTAB:        'rogue_backstab',       // positional (behind)
  EVISCERATE:      'rogue_eviscerate',     // finisher
  RUPTURE:         'rogue_rupture',        // DoT finisher
  KICK:            'rogue_kick',           // 10s CD interrupt
  SLICE_AND_DICE:  'rogue_slice_and_dice', // +40% attack speed buff
  KILLING_SPREE:   'rogue_killing_spree',  // burst
  SHADOWSTEP:      'rogue_shadowstep',     // gap-closer / positional
} as const;

// Combo-point threshold for finisher
const FINISHER_CP_THRESHOLD = 4; // ≥4 combo points → use finisher

// ──────────────────────────────────────────────────────────────
export class DpsAI implements RoleAI {
  /**
   * @param interruptPriority 0 = first interrupter, 1 = second, etc.
   *   Higher-priority interrupters (index 0) act on the first window;
   *   index 1+ wait until index 0 misses.
   */
  constructor(private readonly interruptPriority: number = 0) {}

  decide(unit: Unit, gs: GameState): PrioritisedAction[] {
    switch (unit.classId) {
      case 'MAGE':  return this.decideMage(unit, gs);
      case 'ROGUE': return this.decideRogue(unit, gs);
      default:      return [];
    }
  }

  // ── Fire Mage ─────────────────────────────────────────────────
  private decideMage(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    // Auto-attack fallback: find any living enemy
    const boss = getBoss(gs.units, gs.bossId) ??
      gs.units.find(u => u.role === 'ENEMY' && u.isAlive && u.hp > 0);
    if (!boss) return actions;

    // ── Interrupt coordination ────────────────────────────────
    if (this.shouldInterrupt(unit, gs)) {
      actions.push(act(MAGE.COUNTERSPELL, boss.id, Priority.INTERRUPT, true));
    }

    // ── Buff: Arcane Brilliance ───────────────────────────────
    const needsBrilliance = gs.units
      .filter(u => u.role !== 'ENEMY' && u.isAlive)
      .some(u => !hasAura(u, MAGE.ARCANE_BRILLIANCE));
    if (needsBrilliance) {
      actions.push(act(MAGE.ARCANE_BRILLIANCE, unit.id, Priority.BUFF, true));
    }

    // ── Rotation ──────────────────────────────────────────────
    const manaRes = unit.resources.find(r => r.kind === 'MANA');
    const mana = manaRes?.current ?? unit.mp ?? 0;

    // 1. Apply Living Bomb DoT (2600 mana)
    if (mana >= 2600 && !hasAura(boss, MAGE.LIVING_BOMB)) {
      actions.push(act(MAGE.LIVING_BOMB, boss.id, Priority.DPS));
    }

    // 2. Combustion on cooldown for ignite fishing
    if (!hasAura(unit, MAGE.COMBUSTION)) {
      actions.push(act(MAGE.COMBUSTION, unit.id, Priority.DPS, true));
    }

    // 3. Hot Streak proc → Pyroblast (instant, 0 mana)
    if (hasAura(unit, 'mage_hot_streak')) {
      actions.push(act(MAGE.PYROBLAST, boss.id, Priority.DPS, true));
    }

    // 4. Filler: Fireball (2000 mana)
    if (mana >= 2000) {
      actions.push(act(MAGE.FIREBALL, boss.id, Priority.DPS));
    }

    return actions;
  }

  // ── Combat / Assassination Rogue ─────────────────────────────
  private decideRogue(unit: Unit, gs: GameState): PrioritisedAction[] {
    const actions: PrioritisedAction[] = [];
    // Auto-attack fallback: find any living enemy
    const boss = getBoss(gs.units, gs.bossId) ??
      gs.units.find(u => u.role === 'ENEMY' && u.isAlive && u.hp > 0);
    if (!boss) return actions;

    const energyRes = unit.resources.find(r => r.kind === 'ENERGY');
    const energy = energyRes?.current ?? unit.energy ?? 100;

    // ── Interrupt (15 energy) ──────────────────────────────────
    if (energy >= 15 && this.shouldInterrupt(unit, gs)) {
      actions.push(act(ROGUE.KICK, boss.id, Priority.INTERRUPT, true));
    }

    // ── Combo points & finisher ───────────────────────────────
    const cp = unit.resources.find(r => r.kind === 'COMBO_POINTS');
    const comboPoints = cp?.current ?? 0;

    if (comboPoints >= FINISHER_CP_THRESHOLD) {
      // Prefer Slice and Dice if not up (attack speed buff, 25 energy)
      if (energy >= 25 && !hasAura(unit, ROGUE.SLICE_AND_DICE)) {
        actions.push(act(ROGUE.SLICE_AND_DICE, unit.id, Priority.DPS, true));
      } else if (energy >= 25 && !hasAura(boss, ROGUE.RUPTURE)) {
        // Apply Rupture DoT for sustained damage (25 energy)
        actions.push(act(ROGUE.RUPTURE, boss.id, Priority.DPS, true));
      } else if (energy >= 35) {
        // Dump into Eviscerate for burst (35 energy)
        actions.push(act(ROGUE.EVISCERATE, boss.id, Priority.DPS, true));
      }
    }

    // ── Builder: Sinister Strike → combo points (40 energy) ────
    if (energy >= 40) {
      actions.push(act(ROGUE.SINISTER_STRIKE, boss.id, Priority.DPS));
    }

    // ── Cooldowns ─────────────────────────────────────────────
    if (!hasAura(unit, ROGUE.KILLING_SPREE)) {
      actions.push(act(ROGUE.KILLING_SPREE, unit.id, Priority.DPS, true));
    }

    return actions;
  }

  // ── Interrupt coordination ────────────────────────────────────
  /**
   * Returns true if THIS dps unit should be the one to interrupt.
   * Lower interruptPriority index = first to act.
   * We model a simple "if the boss is channelling and I am priority 0, go;
   * if I am priority 1, only go if the channel has been running > 500ms (missed by 0)"
   */
  private shouldInterrupt(unit: Unit, gs: GameState): boolean {
    if (!gs.bossChannelSpellId) return false;
    if (!this.isInterruptible(gs.bossChannelSpellId)) return false;

    const totalDuration = this.getChannelDuration(gs.bossChannelSpellId);
    const elapsed = totalDuration - gs.bossChannelRemainingMs;

    // Index 0: interrupt immediately (first 200ms window)
    if (this.interruptPriority === 0) return elapsed < 300;
    // Index 1: interrupt if first interrupter missed (past 300ms)
    if (this.interruptPriority === 1) return elapsed >= 300 && elapsed < 600;
    // Index 2+: last-resort (past 600ms)
    return elapsed >= 600;
  }

  /** Spells that can be interrupted */
  private isInterruptible(spellId: string): boolean {
    const INTERRUPTIBLE = new Set([
      'boss_choke',            // Ashbury: Choke
      'boss_last_rites',       // Ashbury: Last Rites
      'boss_mend_rotten_flesh',// Ashbury: Mend Rotten Flesh
      'boss_cursed_bullet',    // Godfrey: Cursed Bullet
    ]);
    return INTERRUPTIBLE.has(spellId);
  }

  private getChannelDuration(spellId: string): number {
    const DURATIONS: Record<string, number> = {
      boss_choke: 3000,
      boss_last_rites: 2500,
      boss_mend_rotten_flesh: 2000,
      boss_cursed_bullet: 1500,
    };
    return DURATIONS[spellId] ?? 3000;
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
