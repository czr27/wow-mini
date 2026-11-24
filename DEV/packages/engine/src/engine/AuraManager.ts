import type { Unit, Buff, AuraTag } from '../types.js';
import type { CombatEngine } from './CombatEngine.js';
import { isValidLifebloomTarget } from './UnitSpawn.js';
/** Buff templates registered by spell authors */
const auraTemplates: Map<string, Omit<Buff, 'id' | 'sourceUnitId' | 'targetUnitId' | 'remainingMs' | 'tickElapsedMs' | 'stacks'>> = new Map();

/**
 * [E-05] AuraManager — Buff/HoT/DoT 管理器
 *
 * - addBuff / removeBuff / removeAllAuras
 * - tickAllAuras: HoT每tick回血，DoT每tick扣血
 * - 支持叠层（最多3层，默认maxStacks）
 */
export class AuraManager {
  private engine: CombatEngine;

  constructor(engine: CombatEngine) {
    this.engine = engine;
  }

  applyAura(targetId: string, buff: Buff): void {
    const target = this.engine.getUnit(targetId);
    if (!target) return;
    this.addBuff(target, buff);
  }

  // ── Template registry ─────────────────────────────────────────
  static registerTemplate(template: Omit<Buff, 'id' | 'sourceUnitId' | 'targetUnitId' | 'remainingMs' | 'tickElapsedMs' | 'stacks'>): void {
    auraTemplates.set(template.spellId, template);
  }

  /** Apply an aura by looking up its registered template */
  applyAuraById(auraId: string, sourceId: string, targetId: string): boolean {
    const tmpl = auraTemplates.get(auraId);
    if (!tmpl) return false;
    const target = this.engine.getUnit(targetId);
    if (!target) return false;
    this.addBuff(target, { ...tmpl, sourceUnitId: sourceId, targetUnitId: targetId });
    return true;
  }

  // ── Core aura operations ──────────────────────────────────────
  addBuff(target: Unit, partial: Omit<Buff, 'id' | 'remainingMs' | 'tickElapsedMs' | 'stacks'> & Partial<Pick<Buff, 'stacks'>>): void {
    // 生命绽放：仅友方；图腾不可作为目标
    if (partial.spellId === 'lifebloom' && !isValidLifebloomTarget(target, this.engine)) {
      return;
    }
    // 生命绽放唯一目标限制：同一释放者同时只能给一个人维持生命绽放；若给其他人施放，立即没收该释放者给其他人施加的生命绽放buff（包括所有层数）
    if (partial.spellId === 'lifebloom') {
      for (const unit of this.engine.getAllUnits()) {
        if (unit.id !== target.id) {
          while (this.removeBuff(unit, 'lifebloom', partial.sourceUnitId)) {}
        }
      }
    }

    const existing = target.buffs.find(b => b.spellId === partial.spellId && b.sourceUnitId === partial.sourceUnitId);

    if (existing) {
      if (existing.spellId === 'lifebloom') {
        // Shared timer (Cata): stacks amplify ticks/bloom; all stacks expire together.
        const duration = partial.durationMs || 15000;
        if (existing.stacks < existing.maxStacks) {
          existing.stacks++;
        }
        existing.remainingMs = duration;
        existing.durationMs = duration;
        delete existing.stackRemainingMs;
        existing.name = `生命绽放 (${existing.stacks}层)`;
        if (partial.tickIntervalMs != null) existing.tickIntervalMs = partial.tickIntervalMs;
        if (partial.tickValue != null) existing.tickValue = partial.tickValue;
        this.engine.emitEvent({
          kind: 'BUFF_APPLIED',
          sourceId: partial.sourceUnitId,
          targetId: target.id,
          spellId: partial.spellId,
          value: existing.stacks,
          timestamp: this.engine.elapsed,
        });
      } else {
        // Refresh duration
        existing.remainingMs = partial.durationMs;
        // Add stack if below max
        if (existing.stacks < existing.maxStacks) {
          existing.stacks++;
          this.engine.emitEvent({
            kind: 'BUFF_APPLIED',
            sourceId: partial.sourceUnitId,
            targetId: target.id,
            spellId: partial.spellId,
            value: existing.stacks,
            timestamp: this.engine.elapsed,
          });
        }
      }
    } else {
      const isLifebloom = partial.spellId === 'lifebloom';
      const duration = partial.durationMs || (isLifebloom ? 15000 : 10000);
      const buff: Buff = {
        ...partial,
        id: `${partial.spellId}_${target.id}_${Date.now()}`,
        stacks: partial.stacks ?? 1,
        remainingMs: duration,
        durationMs: duration,
        tickElapsedMs: 0,
        tickIntervalMs: partial.tickIntervalMs || (isLifebloom ? 2000 : 1000),
        tickValue: partial.tickValue,
        name: isLifebloom ? `生命绽放 (${partial.stacks ?? 1}层)` : partial.name,
        // Lifebloom uses shared remainingMs only — no per-stack peel
        stackRemainingMs: undefined,
      };
      target.buffs.push(buff);
      this.engine.emitEvent({
        kind: 'BUFF_APPLIED',
        sourceId: partial.sourceUnitId,
        targetId: target.id,
        spellId: partial.spellId,
        value: buff.stacks,
        timestamp: this.engine.elapsed,
      });
    }
  }

  removeBuff(target: Unit, spellId: string, sourceId?: string): boolean {
    const idx = target.buffs.findIndex(
      b => b.spellId === spellId && (!sourceId || b.sourceUnitId === sourceId)
    );
    if (idx === -1) return false;
    const removed = target.buffs.splice(idx, 1)[0];
    this.engine.emitEvent({
      kind: 'BUFF_REMOVED',
      sourceId: removed.sourceUnitId,
      targetId: target.id,
      spellId,
      timestamp: this.engine.elapsed,
    });
    return true;
  }

  removeAllAuras(unitId: string): void {
    const unit = this.engine.getUnit(unitId);
    if (!unit) return;
    for (const buff of [...unit.buffs]) {
      this.engine.emitEvent({
        kind: 'BUFF_REMOVED',
        sourceId: buff.sourceUnitId,
        targetId: unitId,
        spellId: buff.spellId,
        timestamp: this.engine.elapsed,
      });
    }
    unit.buffs = [];
  }

  /**
   * 刷新目标身上的生命绽放持续时间（重置为 15,000ms），保持当前层数不变
   * @param target 目标单位
   * @param sourceId 可选施法者ID限制，若提供则只刷新该施法者施加的生命绽放
   * @returns 是否成功刷新了生命绽放
   */
  refreshLifebloom(target: Unit, sourceId?: string): boolean {
    if (!isValidLifebloomTarget(target, this.engine)) return false;
    const lb = target.buffs.find(b => b.spellId === 'lifebloom' && (!sourceId || b.sourceUnitId === sourceId));
    if (!lb) return false;
    const dur = lb.durationMs || 15000;
    // Shared timer: refresh whole aura, keep stacks
    lb.remainingMs = dur;
    delete lb.stackRemainingMs;
    this.engine.emitEvent({
      kind: 'BUFF_APPLIED',
      sourceId: lb.sourceUnitId,
      targetId: target.id,
      spellId: 'lifebloom',
      value: lb.stacks,
      timestamp: this.engine.elapsed,
    });
    return true;
  }

  // ── Tick loop ─────────────────────────────────────────────────
  tickAll(units: Map<string, Unit>, deltaMs: number): void {
    for (const unit of units.values()) {
      if (!unit.isAlive) continue;
      this.tickUnit(unit, deltaMs);
    }
  }

  private tickUnit(unit: Unit, deltaMs: number): void {
    const toRemove: string[] = [];

    for (const buff of unit.buffs) {
      // Lifebloom always uses shared remainingMs (migrate legacy per-stack timers)
      if (buff.spellId === 'lifebloom' && buff.stackRemainingMs?.length) {
        delete buff.stackRemainingMs;
      }
      if (buff.stackRemainingMs && buff.stackRemainingMs.length > 0) {
        buff.stackRemainingMs = buff.stackRemainingMs.map(ms => ms - deltaMs);
        const expiredCount = buff.stackRemainingMs.filter(ms => ms <= 0).length;
        if (expiredCount > 0) {
          buff.stackRemainingMs = buff.stackRemainingMs.filter(ms => ms > 0);
          buff.stacks = buff.stackRemainingMs.length;
        }
        if (buff.stackRemainingMs.length <= 0) {
          toRemove.push(buff.id);
        } else {
          buff.remainingMs = Math.min(...buff.stackRemainingMs);
        }
      } else {
        buff.remainingMs -= deltaMs;
        if (buff.remainingMs <= 0) {
          if (buff.spellId === 'lifebloom') {
            // 生命绽放自然结束：整组层数一次绽放
            const val = buff.tickValue ?? 2400;
            const bloomVal = val * 4 * buff.stacks;
            this.engine.applyHeal(buff.sourceUnitId, unit.id, bloomVal, false, 0, 'lifebloom');
          }
          toRemove.push(buff.id);
        }
      }

      // Tick-based effect (HoT / DoT)
      if (buff.tickIntervalMs && buff.tickIntervalMs > 0) {
        buff.tickElapsedMs = (buff.tickElapsedMs ?? 0) + deltaMs;
        while (buff.tickElapsedMs >= buff.tickIntervalMs) {
          buff.tickElapsedMs -= buff.tickIntervalMs;
          this.applyTickEffect(buff, unit);
        }
      }
    }

    for (const id of toRemove) {
      const idx = unit.buffs.findIndex(b => b.id === id);
      if (idx !== -1) {
        const removed = unit.buffs.splice(idx, 1)[0];
        this.engine.emitEvent({
          kind: 'BUFF_REMOVED',
          sourceId: removed.sourceUnitId,
          targetId: unit.id,
          spellId: removed.spellId,
          timestamp: this.engine.elapsed,
        });
      }
    }
  }

  private applyTickEffect(buff: Buff, target: Unit): void {
    const tickValue = (buff.tickValue ?? 0) * buff.stacks;
    if (tickValue <= 0) return;

    if (buff.tags.includes('HOT')) {
      // HoT: heal per tick
      const { healing, isCrit, overheal } = this.engine.calculator.calcHealing(
        this.engine.getUnit(buff.sourceUnitId) ?? target,
        target,
        tickValue,
      );
      this.engine.applyHeal(buff.sourceUnitId, target.id, healing, isCrit, overheal, buff.spellId, false, true);
    } else if (buff.tags.includes('DOT')) {
      // DoT: damage per tick
      const school = buff.school ?? 'SHADOW';
      const result = this.engine.calculator.calcSpellDamage(
        this.engine.getUnit(buff.sourceUnitId) ?? target,
        target,
        tickValue,
        school,
      );
      this.engine.applyDamage(buff.sourceUnitId, target.id, result.damage, result.isCrit, buff.spellId, school, true);
    }
  }

  hasAura(unit: Unit, spellId: string): boolean {
    return unit.buffs.some(b => b.spellId === spellId);
  }

  getAura(unit: Unit, spellId: string): Buff | undefined {
    return unit.buffs.find(b => b.spellId === spellId);
  }

  getStacks(unit: Unit, spellId: string): number {
    return unit.buffs.find(b => b.spellId === spellId)?.stacks ?? 0;
  }
}
