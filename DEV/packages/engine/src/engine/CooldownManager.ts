import type { Unit, Spell } from '../types.js';
import { getUnitHaste } from './BuffEffects.js';
import { getEffectiveGcdMs } from './TierProfile.js';

interface CooldownEntry {
  spellId: string;
  remainingMs: number;
  totalMs: number;
}

/**
 * [E-07] CooldownManager — 技能冷却管理器（80级满级满急速 GCD 分组规范）
 *
 * GCD 严格分三组：
 * 1. NORMAL:  基础 1.5s，受急速缩减至最低 1.0s 下限 (50% 满急速时恰好 1.0s)
 * 2. ROGUE:   固定 1.0s，不受急速继续压低 (潜行者/猫德/猎人/邪DK 能量与集中值职业)
 * 3. OFF_GCD: 0ms，不受公共冷却阻塞也不触发公共冷却 (打断/嘲讽/减伤/瞬发爆发)
 */
export class CooldownManager {
  /** unitId → gcdRemainingMs */
  private gcdMap: Map<string, number> = new Map();

  /** unitId → spellId → CooldownEntry */
  private cdMap: Map<string, Map<string, CooldownEntry>> = new Map();

  static readonly GCD_NORMAL_MS = 1_500;
  static readonly GCD_ROGUE_MS  = 1_000;
  static readonly GCD_FLOOR_MS  = 1_000;

  // ── Tick ─────────────────────────────────────────────────────
  tick(deltaMs: number): void {
    for (const [unitId, gcd] of this.gcdMap) {
      this.gcdMap.set(unitId, Math.max(0, gcd - deltaMs));
    }

    for (const spellCds of this.cdMap.values()) {
      for (const [, entry] of spellCds) {
        entry.remainingMs = Math.max(0, entry.remainingMs - deltaMs);
      }
    }
  }

  // ── canCast ───────────────────────────────────────────────────
  canCast(unitId: string, spellId: string, _unit?: Unit): boolean {
    if (!this.isGcdFree(unitId)) return false;

    const cd = this.cdMap.get(unitId)?.get(spellId);
    if (cd && cd.remainingMs > 0) return false;

    return true;
  }

  canCastSpell(unitId: string, spell: Spell, _unit?: Unit): boolean {
    const isOffGcd = spell?.gcdCategory === 'OFF_GCD' || (spell as any)?.gcdType === 'off';
    if (!isOffGcd && !this.isGcdFree(unitId)) return false;

    const cd = this.cdMap.get(unitId)?.get(spell?.id);
    if (cd && cd.remainingMs > 0) return false;

    return true;
  }

  // ── startCooldown ─────────────────────────────────────────────
  startGcdForSpell(unitId: string, spell: Spell, unit?: Unit): void {
    const rawCat = spell?.gcdCategory
      ?? ((spell as any)?.gcdType === 'off'
        ? 'OFF_GCD'
        : (spell as any)?.gcdType === 'rogue'
        ? 'ROGUE'
        : 'NORMAL');

    if (rawCat !== 'OFF_GCD') {
      const haste = getUnitHaste(unit, 0);
      const effectiveGcd = getEffectiveGcdMs(rawCat, haste);
      this.gcdMap.set(unitId, effectiveGcd);
    }
  }

  startSpellCooldownOnly(unitId: string, spellId: string, spell: Spell): void {
    if (spell?.cooldownMs > 0) {
      if (!this.cdMap.has(unitId)) this.cdMap.set(unitId, new Map());
      this.cdMap.get(unitId)!.set(spellId, {
        spellId,
        remainingMs: spell.cooldownMs,
        totalMs: spell.cooldownMs,
      });
    }
  }

  startCooldown(unitId: string, spellId: string, spell: Spell, unit?: Unit): void {
    this.startGcdForSpell(unitId, spell, unit);
    this.startSpellCooldownOnly(unitId, spellId, spell);
  }

  startGcd(unitId: string, durationMs?: number): void {
    this.gcdMap.set(unitId, durationMs ?? CooldownManager.GCD_FLOOR_MS);
  }

  // ── Queries ───────────────────────────────────────────────────
  getGcdRemaining(unitId: string): number {
    return this.gcdMap.get(unitId) ?? 0;
  }

  getCdRemaining(unitId: string, spellId: string): number {
    return this.cdMap.get(unitId)?.get(spellId)?.remainingMs ?? 0;
  }

  getCdEntry(unitId: string, spellId: string): CooldownEntry | undefined {
    return this.cdMap.get(unitId)?.get(spellId);
  }

  /** Active spell CDs with remaining > 0 (for network timeline sync). */
  getActiveCooldowns(unitId: string): CooldownEntry[] {
    const map = this.cdMap.get(unitId);
    if (!map) return [];
    return Array.from(map.values()).filter((e) => e.remainingMs > 0);
  }

  getAllActiveCooldowns(): Array<CooldownEntry & { unitId: string }> {
    const out: Array<CooldownEntry & { unitId: string }> = [];
    for (const [unitId, map] of this.cdMap) {
      for (const entry of map.values()) {
        if (entry.remainingMs > 0) out.push({ ...entry, unitId });
      }
    }
    return out;
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
