import { GroundEffect, FloatingCombatText, Unit } from '../types.js';

export class EffectsManager {
  public groundEffects: GroundEffect[] = [];
  public floatingTexts: FloatingCombatText[] = [];

  constructor(public engine?: any) {}

  public addGroundEffect(effect: Partial<GroundEffect> & Omit<GroundEffect, 'id'>): GroundEffect {
    const newEffect: GroundEffect = {
      id: effect.id || `effect_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tickIntervalMs: effect.tickIntervalMs || 1000,
      tickElapsedMs: 0,
      ...effect,
    } as GroundEffect;
    this.groundEffects.push(newEffect);
    return newEffect;
  }

  public removeGroundEffect(id: string) {
    this.groundEffects = this.groundEffects.filter(e => e.id !== id);
  }

  public addFloatingText(text: Partial<FloatingCombatText> & Omit<FloatingCombatText, 'id' | 'createdAtMs'>): FloatingCombatText {
    const fct: FloatingCombatText = {
      id: text.id || `fct_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      createdAtMs: text.createdAtMs || Date.now(),
      ...text,
    } as FloatingCombatText;
    this.floatingTexts.push(fct);
    // Keep max 60 active combat texts to prevent memory accumulation
    if (this.floatingTexts.length > 60) {
      this.floatingTexts.shift();
    }
    return fct;
  }

  /**
   * Check if a coordinate position is inside a ground effect circle
   */
  public isPositionInEffect(pos: { x: number; y: number }, effect: GroundEffect): boolean {
    const dist = Math.hypot(pos.x - effect.x, pos.y - effect.y);
    return dist <= effect.radius;
  }

  /**
   * Check if a position is in any dangerous ground effect (Desecration, Red Cone, etc.)
   */
  public isPositionInHazard(pos: { x: number; y: number }): boolean {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false;
    for (const eff of this.groundEffects) {
      if (eff.remainingMs <= 0) continue;
      if (eff.kind === 'DAMAGE_ZONE') {
        if (this.isPositionInEffect(pos, eff)) return true;
      } else if (eff.kind === 'CONE_WARNING') {
        // Cone facing left from eff.x, eff.y
        const dx = pos.x - eff.x;
        const dy = pos.y - eff.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= eff.radius && dx < 0) {
          // Angle within ±30 degrees of negative X axis
          const angle = Math.atan2(dy, dx); // [-PI, PI]
          const diffFromLeft = Math.abs(Math.abs(angle) - Math.PI);
          if (diffFromLeft <= Math.PI / 6) return true; // 30 deg each side = 60 deg cone
        }
      }
    }
    return false;
  }

  /**
   * Get all active healing zones (Efflorescence, Healing Rain)
   */
  public getActiveHealZones(): GroundEffect[] {
    return this.groundEffects.filter(e => e.kind === 'HEAL_ZONE' && e.remainingMs > 0);
  }

  public tick(deltaMsOrUnits: any, deltaMs?: number) {
    const actualDelta = typeof deltaMs === 'number' ? deltaMs : (typeof deltaMsOrUnits === 'number' ? deltaMsOrUnits : 50);
    const unitsMapOrList = typeof deltaMs === 'number' ? deltaMsOrUnits : undefined;

    // 1. Tick down ground effects and process range-based ticks
    for (let i = this.groundEffects.length - 1; i >= 0; i--) {
      const eff = this.groundEffects[i];
      eff.remainingMs -= actualDelta;
      eff.tickElapsedMs = (eff.tickElapsedMs || 0) + actualDelta;

      const interval = eff.tickIntervalMs || 1000;
      if (eff.tickElapsedMs >= interval) {
        eff.tickElapsedMs -= interval;

        // If units are available, evaluate range-based AoE!
        if (this.engine) {
          this.evaluateGroundEffectTick(eff);
        }
      }

      if (eff.remainingMs <= 0) {
        this.groundEffects.splice(i, 1);
      }
    }

    // 2. Clear expired floating texts (> 1500ms)
    const now = Date.now();
    this.floatingTexts = this.floatingTexts.filter(f => now - f.createdAtMs < 1500);
  }

  private evaluateGroundEffectTick(eff: GroundEffect): void {
    if (!this.engine) return;
    const value = eff.tickValue || (eff.kind === 'HEAL_ZONE' ? 4500 : 3800);

    if (eff.kind === 'HEAL_ZONE') {
      // Heal friendly units standing inside radius
      const owner = (this.engine.units.get(eff.ownerId) || this.engine.friendlyUnits.find((f: any) => f.id === eff.ownerId) || this.engine.friendlyUnits[0]) as any;
      for (const u of this.engine.friendlyUnits) {
        if ((u.isAlive ?? u.alive) && this.isPositionInEffect(u.position, eff)) {
          this.engine.healUnit(owner, u, value, false, eff.spellId === 'healing_rain' ? '治疗之雨' : '百花齐放');
        }
      }
    } else if (eff.kind === 'DAMAGE_ZONE') {
      // If placed by boss: damage any friendly unit inside
      const boss = this.engine.bossUnit;
      if (eff.ownerId === boss?.id) {
        for (const u of this.engine.friendlyUnits) {
          if ((u.isAlive ?? u.alive) && this.isPositionInEffect(u.position, eff)) {
            const spellName = eff.spellId === 'death_and_decay' ? '凋零凋落' : (eff.spellId === 'frozen_orb' ? '寒冰宝珠' : '暗影坍缩');
            this.engine.dealDamage(boss, u, value, 'SHADOW', false, spellName);
          }
        }
      } else {
        // Placed by player (e.g. Death and Decay, Frozen Orb)
        if (boss && (boss.isAlive ?? boss.alive) && this.isPositionInEffect(boss.position, eff)) {
          const owner = this.engine.units.get(eff.ownerId) || this.engine.friendlyUnits[0];
          const school = eff.spellId === 'frozen_orb' ? 'FROST' : 'SHADOW';
          const spellName = eff.spellId === 'death_and_decay' ? '死亡凋零' : (eff.spellId === 'frozen_orb' ? '寒冰宝珠' : '地面伤害');
          this.engine.dealDamage(owner, boss, value, school, false, spellName);
        }
      }
    }
  }

  public clearAll() {
    this.groundEffects = [];
    this.floatingTexts = [];
  }
}
