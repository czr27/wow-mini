import type { Unit, ResourceKind, RuneSlot } from '../types.js';
import type { CombatEngine } from './CombatEngine.js';
import { getUnitHaste } from './BuffEffects.js';

/**
 * [E-06] ResourceManager — 资源系统
 *
 * 法力（MANA）：战斗中灵魂回蓝（约5% max/5s = 1%/s × deltaMs）
 * 能量（ENERGY）：潜行者每秒+10（受急速加成）
 * 符文（RUNE）：DK 6枚，每枚独立10s CD
 * 符文能量（RUNIC_POWER）：自然衰减，技能消耗/生成
 */
/** Maze / TRAVEL_RECOVERY passive mana regen multiplier (host + guest local seats). */
export const TRAVEL_MANA_REGEN_MULTIPLIER = 20;

export class ResourceManager {
  private engine: CombatEngine;

  // Mana regen interval tracking per unit
  private manaRegenMs: Map<string, number> = new Map();

  /**
   * Passive MANA regen scale. Set to TRAVEL_MANA_REGEN_MULTIPLIER during maze;
   * each authority ticks own seats → OWNER_SNAPSHOT carries mp.
   */
  manaRegenMultiplier = 1;

  /**
   * Base mana regen rate per second (ratio of maxMp).
   * Unset or <= 0 defaults to raid/dungeon tier adaptivity:
   *  - 20-man raid: 0.0065 /s (0.65%/s ~ 650 mana/s with spirit & raid auras)
   *  - 5-man dungeon: 0.0045 /s (0.45%/s ~ 425 mana/s)
   */
  baseManaRegenRate?: number;

  constructor(engine: CombatEngine) {
    this.engine = engine;
  }

  tickAll(units: Map<string, Unit>, deltaMs: number): void {
    for (const unit of units.values()) {
      if (!unit.isAlive) continue;
      this.tickUnit(unit, deltaMs);
    }
  }

  private tickUnit(unit: Unit, deltaMs: number): void {
    for (const res of unit.resources) {
      switch (res.kind) {
        case 'MANA':
          this.tickMana(unit, res, deltaMs);
          break;
        case 'ENERGY':
          this.tickEnergy(unit, res, deltaMs);
          break;
        case 'FOCUS':
          this.tickFocus(unit, res, deltaMs);
          break;
        case 'RAGE':
          this.tickRage(unit, res, deltaMs);
          break;
        case 'RUNIC_POWER':
          this.tickRunicPower(unit, res, deltaMs);
          break;
        case 'HOLY_POWER':
        case 'COMBO_POINTS':
          break;
      }
    }

    // Tick DK runes
    if (unit.runes) {
      this.tickRunes(unit, deltaMs);
    }
  }

  // ── Mana regen (Spirit-based combat regen) ────────────────────
  private tickMana(unit: Unit, res: { current: number; max: number }, deltaMs: number): void {
    if (res.current >= res.max) return;
    const mult = Number.isFinite(this.manaRegenMultiplier)
      ? Math.max(0, this.manaRegenMultiplier)
      : 1;

    let baseRate = this.baseManaRegenRate;
    if (typeof baseRate !== 'number' || baseRate <= 0) {
      const isRaid = this.engine.friendlyUnits.length > 5;
      baseRate = isRaid ? 0.0065 : 0.0045;
    }
    if (unit.role === 'DPS') {
      baseRate += 0.0025; // 法系 DPS 冥想/暴击回蓝支持
    }

    const regenPerMs = (res.max * baseRate * mult) / 1_000;
    const amount = regenPerMs * deltaMs;
    res.current = Math.min(res.max, res.current + amount);
    unit.mp = res.current;

    this.engine.emitEvent({
      kind: 'RESOURCE_CHANGE',
      sourceId: unit.id,
      targetId: unit.id,
      value: amount,
      resourceKind: 'MANA',
      timestamp: this.engine.elapsed,
    });
  }

  // ── Energy regen (+10/s baseline, haste-modified) ─────────────
  private tickEnergy(unit: Unit, res: { current: number; max: number }, deltaMs: number): void {
    if (res.current >= res.max) return;
    const haste = getUnitHaste(unit, 0);
    const regenPerMs = (10 * (1 + haste)) / 1_000; // 10/s base
    const amount = regenPerMs * deltaMs;
    res.current = Math.min(res.max, res.current + amount);
    unit.energy = res.current;

    this.engine.emitEvent({
      kind: 'RESOURCE_CHANGE',
      sourceId: unit.id,
      targetId: unit.id,
      value: amount,
      resourceKind: 'ENERGY',
      timestamp: this.engine.elapsed,
    });
  }

  // ── Focus regen (+4/s baseline, haste-modified) ──────────────
  private tickFocus(unit: Unit, res: { current: number; max: number }, deltaMs: number): void {
    if (res.current >= res.max) return;
    const haste = getUnitHaste(unit, 0);
    const regenPerMs = (4 * (1 + haste)) / 1_000; // 4/s base modified by haste
    const amount = regenPerMs * deltaMs;
    res.current = Math.min(res.max, res.current + amount);
    unit.focus = res.current;

    this.engine.emitEvent({
      kind: 'RESOURCE_CHANGE',
      sourceId: unit.id,
      targetId: unit.id,
      value: amount,
      resourceKind: 'FOCUS',
      timestamp: this.engine.elapsed,
    });
  }

  // ── Rage: passive in-combat melee/damage gen (+6/s) & out-of-combat decay (-1/s) ──
  private tickRage(unit: Unit, res: { current: number; max: number }, deltaMs: number): void {
    const inCombat = Boolean(this.engine.bossUnit?.isAlive);
    if (inCombat) {
      if (res.current >= res.max) return;
      const haste = getUnitHaste(unit, 0);
      const genPerMs = (6 * (1 + haste * 0.5)) / 1_000;
      const amount = genPerMs * deltaMs;
      res.current = Math.min(res.max, res.current + amount);
      unit.rage = res.current;
      return;
    }
    if (res.current <= 0) return;
    const decayPerMs = 1 / 1_000; // -1/s out of combat
    const amount = decayPerMs * deltaMs;
    res.current = Math.max(0, res.current - amount);
    unit.rage = res.current;

    this.engine.emitEvent({
      kind: 'RESOURCE_CHANGE',
      sourceId: unit.id,
      targetId: unit.id,
      value: -amount,
      resourceKind: 'RAGE',
      timestamp: this.engine.elapsed,
    });
  }

  // ── Runic Power out-of-combat decay (-2/s) ───────────────────
  private tickRunicPower(unit: Unit, res: { current: number; max: number }, deltaMs: number): void {
    if (res.current <= 0) return;
    const inCombat = Boolean(this.engine.bossUnit?.isAlive);
    if (!inCombat) {
      const decayPerMs = 2 / 1_000; // -2/s out of combat
      const amount = decayPerMs * deltaMs;
      res.current = Math.max(0, res.current - amount);
      unit.runicPower = res.current;

      this.engine.emitEvent({
        kind: 'RESOURCE_CHANGE',
        sourceId: unit.id,
        targetId: unit.id,
        value: -amount,
        resourceKind: 'RUNIC_POWER',
        timestamp: this.engine.elapsed,
      });
    }
  }

  // ── DK Rune cooldowns (6 runes, 10s base modified by haste) ───
  private tickRunes(unit: Unit, deltaMs: number): void {
    if (!unit.runes) return;
    const haste = Math.max(0, getUnitHaste(unit, 0));
    const effectiveDelta = deltaMs * (1 + haste);
    for (const rune of unit.runes) {
      if (rune.cooldownMs > 0) {
        rune.cooldownMs = Math.max(0, rune.cooldownMs - effectiveDelta);
      }
    }
  }

  // ── Synchronize unit convenience properties ──────────────────
  private syncUnitResourceProperty(unit: Unit, kind: ResourceKind, value: number): void {
    switch (kind) {
      case 'MANA': unit.mp = value; break;
      case 'ENERGY': unit.energy = value; break;
      case 'RAGE': unit.rage = value; break;
      case 'FOCUS': unit.focus = value; break;
      case 'HOLY_POWER': unit.holyPower = value; break;
      case 'RUNIC_POWER': unit.runicPower = value; break;
      case 'COMBO_POINTS': unit.comboPoints = value; break;
    }
  }

  // ── Manual resource operations ────────────────────────────────
  consume(unitId: string, kind: ResourceKind, amount: number): boolean {
    const unit = this.engine.getUnit(unitId);
    if (!unit) return false;
    const res = unit.resources?.find(r => r.kind === kind);
    if (res) {
      if (res.current < amount) return false;
      res.current -= amount;
      this.syncUnitResourceProperty(unit, kind, res.current);
      return true;
    }
    let cur = 0;
    if (kind === 'MANA') cur = unit.mp ?? 0;
    else if (kind === 'ENERGY') cur = unit.energy ?? 0;
    else if (kind === 'RAGE') cur = unit.rage ?? 0;
    else if (kind === 'FOCUS') cur = unit.focus ?? 0;
    else if (kind === 'HOLY_POWER') cur = unit.holyPower ?? 0;
    else if (kind === 'RUNIC_POWER') cur = unit.runicPower ?? 0;
    else if (kind === 'COMBO_POINTS') cur = unit.comboPoints ?? 0;
    if (cur < amount) return false;
    this.syncUnitResourceProperty(unit, kind, cur - amount);
    return true;
  }

  restore(unitId: string, kind: ResourceKind, amount: number): void {
    const unit = this.engine.getUnit(unitId);
    if (!unit) return;
    const maxLimit = unit.resources?.find(r => r.kind === kind)?.max ?? (kind === 'MANA' ? (unit.maxMp ?? 100000) : 100);
    const effectiveAmount = (kind === 'MANA' && amount > 0 && amount <= 1.0)
      ? Math.round(amount * maxLimit)
      : amount;

    const res = unit.resources?.find(r => r.kind === kind);
    if (res) {
      res.current = Math.min(res.max, res.current + effectiveAmount);
      this.syncUnitResourceProperty(unit, kind, res.current);
    } else {
      let max = 100;
      if (kind === 'MANA') max = unit.maxMp ?? 50000;
      else if (kind === 'HOLY_POWER') max = 3;
      else if (kind === 'COMBO_POINTS') max = 5;

      let cur = 0;
      if (kind === 'MANA') cur = unit.mp ?? 0;
      else if (kind === 'ENERGY') cur = unit.energy ?? 0;
      else if (kind === 'RAGE') cur = unit.rage ?? 0;
      else if (kind === 'FOCUS') cur = unit.focus ?? 0;
      else if (kind === 'HOLY_POWER') cur = unit.holyPower ?? 0;
      else if (kind === 'RUNIC_POWER') cur = unit.runicPower ?? 0;
      else if (kind === 'COMBO_POINTS') cur = unit.comboPoints ?? 0;

      const updated = Math.min(max, cur + amount);
      this.syncUnitResourceProperty(unit, kind, updated);
      if (unit.resources) {
        unit.resources.push({ kind, current: updated, max });
      }
    }
  }

  fillAll(unitId: string): void {
    const unit = this.engine.getUnit(unitId);
    if (!unit) return;
    for (const res of unit.resources) {
      if (['RAGE', 'RUNIC_POWER', 'HOLY_POWER', 'COMBO_POINTS'].includes(res.kind)) {
        res.current = 0;
      } else {
        res.current = res.max;
      }
      this.syncUnitResourceProperty(unit, res.kind, res.current);
    }
    if (unit.maxMp) unit.mp = unit.maxMp;
    if (unit.energy !== undefined) unit.energy = 100;
    if (unit.rage !== undefined) unit.rage = 0;
    if (unit.focus !== undefined) unit.focus = 100;
    if (unit.holyPower !== undefined) unit.holyPower = 0;
    if (unit.runicPower !== undefined) unit.runicPower = 0;
    if (unit.comboPoints !== undefined) unit.comboPoints = 0;
    if (unit.runes) {
      for (const rune of unit.runes) {
        rune.cooldownMs = 0; // All runes ready
      }
    }
  }

  /**
   * Consume DK runes by type. Returns false if insufficient runes available.
   */
  consumeRunes(unitId: string, required: Array<'BLOOD' | 'FROST' | 'UNHOLY'>): boolean {
    const unit = this.engine.getUnit(unitId);
    if (!unit?.runes) return false;

    const readyRunes = unit.runes.filter(r => r.cooldownMs === 0);
    // Check availability by type
    for (const type of required) {
      const idx = readyRunes.findIndex(r => r.runeType === type);
      if (idx === -1) return false;
      readyRunes.splice(idx, 1); // consume for checking
    }

    // Actually consume
    const toConsume = [...required];
    for (const rune of unit.runes) {
      if (toConsume.length === 0) break;
      const idx = toConsume.findIndex(t => t === rune.runeType && rune.cooldownMs === 0);
      if (idx !== -1) {
        rune.cooldownMs = rune.totalCdMs;
        toConsume.splice(idx, 1);
      }
    }
    return true;
  }

  hasResource(unitId: string, kind: ResourceKind, amount: number): boolean {
    const unit = this.engine.getUnit(unitId);
    if (!unit) return false;
    const res = unit.resources.find(r => r.kind === kind);
    return (res?.current ?? 0) >= amount;
  }
}
