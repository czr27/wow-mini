import type { Unit, Spell, ResourceKind } from '../types.js';

interface CooldownEntry {
  spellId: string;
  remainingMs: number;
  totalMs: number;
}

/**
 * [E-07] CooldownManager — 技能冷却管理器
 *
 * - GCD: 1.5s 通用（盗贼 1.0s）
 * - 独立CD：每个技能独立倒计时
 * - canCast / startCooldown / tick
 */
export class CooldownManager {
  /** unitId → gcdRemainingMs */
  private gcdMap: Map<string, number> = new Map();

  /** unitId → spellId → CooldownEntry */
  private cdMap: Map<string, Map<string, CooldownEntry>> = new Map();

  static readonly GCD_NORMAL_MS  = 1_500;
  static readonly GCD_ROGUE_MS   = 1_000;

  // ── Tick ─────────────────────────────────────────────────────
  tick(deltaMs: number): void {
    // Tick GCDs
    for (const [unitId, gcd] of this.gcdMap) {
      this.gcdMap.set(unitId, Math.max(0, gcd - deltaMs));
    }

    // Tick spell CDs
    for (const spellCds of this.cdMap.values()) {
      for (const [spellId, entry] of spellCds) {
        entry.remainingMs = Math.max(0, entry.remainingMs - deltaMs);
      }
    }
  }

  // ── canCast ───────────────────────────────────────────────────
  canCast(unitId: string, spellId: string, unit?: Unit): boolean {
    // Check GCD (without spell reference, assume NORMAL GCD category)
    if (!this.isGcdFree(unitId)) return false;

    const cd = this.cdMap.get(unitId)?.get(spellId);
    if (cd && cd.remainingMs > 0) return false;

    return true;
  }

  canCastSpell(unitId: string, spell: Spell, unit?: Unit): boolean {
    const isOffGcd = spell?.gcdCategory === 'OFF_GCD' || (spell as any)?.gcdType === 'off';
    if (!isOffGcd && !this.isGcdFree(unitId)) return false;

    const cd = this.cdMap.get(unitId)?.get(spell?.id);
    if (cd && cd.remainingMs > 0) return false;

    return true;
  }

  // ── startCooldown ─────────────────────────────────────────────
  startCooldown(unitId: string, spellId: string, spell: Spell, unit: Unit): void {
    const isOffGcd = spell?.gcdCategory === 'OFF_GCD' || (spell as any)?.gcdType === 'off';
    const isRogueGcd = spell?.gcdCategory === 'ROGUE' || (spell as any)?.gcdType === 'rogue';

    // Start GCD
    if (!isOffGcd) {
      const gcdMs = isRogueGcd
        ? CooldownManager.GCD_ROGUE_MS
        : CooldownManager.GCD_NORMAL_MS;
      // Haste reduces GCD (min 750ms)
      const hasted = Math.max(750, gcdMs / (1 + (unit?.stats?.haste ?? 0)));
      this.gcdMap.set(unitId, hasted);
    }

    // Start spell-specific CD
    if (spell?.cooldownMs > 0) {
      if (!this.cdMap.has(unitId)) this.cdMap.set(unitId, new Map());
      this.cdMap.get(unitId)!.set(spellId, {
        spellId,
        remainingMs: spell.cooldownMs,
        totalMs: spell.cooldownMs,
      });
    }
  }

  startGcd(unitId: string, durationMs?: number): void {
    this.gcdMap.set(unitId, durationMs ?? CooldownManager.GCD_NORMAL_MS);
  }

  // ── Queries ───────────────────────────────────────────────────
  getGcdRemaining(unitId: string): number {
    return this.gcdMap.get(unitId) ?? 0;
  }

  getCdRemaining(unitId: string, spellId: string): number {
    return this.cdMap.get(unitId)?.get(spellId)?.remainingMs ?? 0;
  }

  isGcdFree(unitId: string): boolean {
    return (this.gcdMap.get(unitId) ?? 0) === 0;
  }

  isSpellReady(unitId: string, spellId: string): boolean {
    return (this.cdMap.get(unitId)?.get(spellId)?.remainingMs ?? 0) === 0;
  }

  // ── Reset (travel recovery resets long CDs ≥ 3min) ───────────
  resetLongCooldowns(unitId: string, thresholdMs = 180_000): void {
    const spellCds = this.cdMap.get(unitId);
    if (!spellCds) return;
    for (const [, entry] of spellCds) {
      if (entry.totalMs >= thresholdMs) {
        entry.remainingMs = 0;
      }
    }
  }

  resetAll(unitId: string): void {
    this.gcdMap.set(unitId, 0);
    this.cdMap.get(unitId)?.clear();
  }

  resetAllUnits(): void {
    this.gcdMap.clear();
    for (const map of this.cdMap.values()) map.clear();
  }

  reset(): void {
    this.resetAllUnits();
  }
}
