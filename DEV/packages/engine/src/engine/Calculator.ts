import type { Unit, SpellSchool } from '../types.js';
import type { CombatEngine } from './CombatEngine.js';

export interface DamageResult {
  damage: number;
  isCrit: boolean;
  blocked: boolean;
  absorbed: number;
  raw: number;
}

export interface HealResult {
  healing: number;
  isCrit: boolean;
  overheal: number;
  raw: number;
}

/**
 * [E-03] Calculator — 伤害与治疗计算
 *
 * 物理伤害：含暴击（200%倍率）、格挡减伤、护甲减伤、吸收
 * 法术伤害：含暴击、吸收
 * 治疗：含暴击、过量治疗裁切
 */
export class Calculator {
  private engine: CombatEngine;

  constructor(engine: CombatEngine) {
    this.engine = engine;
  }

  // ── Physical Damage ──────────────────────────────────────────
  calcPhysicalDamage(attacker: Unit, target: Unit, baseDmg: number, forceCrit?: boolean): DamageResult {
    const raw = baseDmg * (1 + (attacker.stats?.attackPower ?? 0) / 14_000);

    // Armor damage reduction (Cata formula approximation)
    const armorReduction = this.armorReduction(target.stats?.armor ?? 0);

    // Block: 30% damage reduction on blocked hits
    const blocked = this.roll(target.stats?.block ?? 0);
    const blockMult = blocked ? 0.7 : 1.0;

    // Crit: 200% (2× multiplier) on critical hits
    const isCrit = forceCrit !== undefined ? forceCrit : this.roll(attacker.stats?.critChance ?? 0);
    const critMult = isCrit ? 2.0 : 1.0;

    let damage = raw * critMult * (1 - armorReduction) * blockMult;
    damage = Math.max(0, damage);

    // Absorb shield (applied by CombatEngine.applyDamage, tracked here for result)
    const absorbed = Math.min(target.absorb ?? 0, damage);
    const effective = damage - absorbed;

    return { damage: effective, isCrit, blocked, absorbed, raw };
  }

  // ── Spell Damage ─────────────────────────────────────────────
  calcSpellDamage(
    attacker: Unit,
    target: Unit,
    baseDmg: number,
    school: SpellSchool,
    forceCrit?: boolean,
  ): DamageResult {
    const spBonus = (attacker.stats?.spellPower ?? 0) * this.schoolCoefficient(school);
    const raw = baseDmg + spBonus;

    // Spell resistance (simplified: flat % reduction)
    const resistReduction = (target.stats?.spellResist ?? 0) / 100;

    const isCrit = forceCrit !== undefined ? forceCrit : this.roll((attacker.stats?.critChance ?? 0) + 0.05); // spell crit bonus
    const critMult = isCrit ? 2.0 : 1.0;

    let damage = raw * critMult * (1 - Math.min(0.75, resistReduction));
    damage = Math.max(0, damage);

    const absorbed = Math.min(target.absorb ?? 0, damage);
    const effective = damage - absorbed;

    return { damage: effective, isCrit, blocked: false, absorbed, raw };
  }

  // ── Healing ──────────────────────────────────────────────────
  calcHealing(healer: Unit, target: Unit, baseHeal: number, forceCrit?: boolean): HealResult {
    const spBonus = (healer.stats?.spellPower ?? 0) * 0.8; // standard healing coefficient
    const raw = baseHeal + spBonus;

    const isCrit = forceCrit !== undefined ? forceCrit : this.roll((healer.stats?.critChance ?? 0) + 0.03);
    const critMult = isCrit ? 2.0 : 1.0;

    const potential = Math.max(0, raw * critMult);
    const deficit = Math.max(0, target.maxHp - target.hp);

    const effective = Math.min(potential, deficit);
    const overheal  = Math.max(0, potential - deficit);

    return { healing: effective, isCrit, overheal, raw };
  }

  // ── Helpers ───────────────────────────────────────────────────
  private roll(chance: number): boolean {
    return Math.random() < Math.max(0, Math.min(1, chance));
  }

  /**
   * WoW Cata armor damage reduction formula.
   * DR = Armor / (Armor + K), K ≈ 11,960 for level-83 boss.
   */
  private armorReduction(armor: number): number {
    const K = 11_960;
    return Math.min(0.75, armor / (armor + K));
  }

  private schoolCoefficient(school: SpellSchool): number {
    // All schools share ~0.86 coefficient; kept extensible
    return 0.86;
  }
}
